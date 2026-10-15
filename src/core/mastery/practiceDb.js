import { rows } from '../db/validation.js';
import { DatabaseError } from '../db/errors.js';
import { applyPractice } from './state.js';
import { assessSelection } from './selection.js';
import { isRouteQuestion, entranceMethodIds } from '../practice/routes.js';
import { validPatternEvidence } from '../knowledge/patterns.js';
import { preparedRouteTargets } from '../../assets/practice/route-bank.js';

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const learner = (db) => rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0].id;
function invalid() { return new DatabaseError('练习记录不完整，请重新打开练习。', 'invalid_practice'); }
function readRun(db, id) {
  const run = rows(db, 'SELECT * FROM practice_run WHERE id=? AND learner_id=?', [id, learner(db)])[0];
  if (!run) throw invalid();
  const items = rows(db, 'SELECT * FROM practice_item WHERE run_id=? ORDER BY seq', [id]).map((row) => ({
    id: row.id, seq: row.seq, question: JSON.parse(row.question), answer: row.answer ? JSON.parse(row.answer) : null, result: row.result,
  }));
  return { id: run.id, scenarioId: run.scenario_id, methodId: JSON.parse(run.method_ids)[0],
    origin: rows(db, 'SELECT run_id FROM chat_practice WHERE run_id=?', [id]).length ? 'chat' : 'practice',
    startedAt: run.started_at, finishedAt: run.finished_at, generationStatus: run.generation_status, items };
}
function readItem(db, runId, itemId) {
  const run = readRun(db, runId);
  const item = run.items.find((entry) => entry.id === itemId);
  if (!item || run.finishedAt) throw invalid();
  return { run, item };
}

function validQuestion(question, scenarioId, methodId, mixedPrepared = false) {
  if (!question?.question?.trim() || !question.solution?.trim() || !/^[a-f0-9]{64}$/.test(question.questionKey)
    || !/^[a-f0-9]{64}$/.test(question.faceKey) || !Array.isArray(question.options)) return false;
  if (!isRouteQuestion(question)) return question.coreMethodIds?.includes(methodId);
  const entrance = mixedPrepared ? question.entranceScenarioId : scenarioId;
  return question.entranceScenarioId === entrance && Array.isArray(question.routes) && question.routes.length >= 3
    && ['single', 'multi', 'best'].includes(question.selectionMode)
    && question.routes.every((route) => typeof route.valid === 'boolean' && route.steps?.length && route.steps[0].scenarioId === entrance)
    && question.routes.some((route) => route.valid) && question.routes.some((route) => !route.valid);
}

function knownPreparedQuestion(question, within) {
  return question.metadata?.reviewStatus === 'worked_example_checked'
    && (within ? [within] : preparedRouteTargets).some((target) => target.questions.some((entry) =>
      entry.metadata.motherId === question.metadata.motherId && entry.question === question.question
      && entry.entranceScenarioId === question.entranceScenarioId && entry.solution === question.solution
      && entry.metadata.source.kind === question.metadata.source.kind
      && JSON.stringify(entry.routes) === JSON.stringify(question.routes)
      && JSON.stringify(entry.structure) === JSON.stringify(question.structure)));
}

export function createPracticeRun(engine, input) {
  const localRound = input?.localPrepared === true && preparedRouteTargets.some((target) =>
    target.scenarioId === input.scenarioId && target.methodId === input.methodId
    && Array.isArray(input.items) && input.items.length && input.items.every((question) => knownPreparedQuestion(question, target)));
  if (!input?.scenarioId || !input.methodId || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 3
    || input.items.some((question) => !validQuestion(question, input.scenarioId, input.methodId,
      localRound))
    || new Set(input.items.map((question) => question.questionKey)).size !== input.items.length) throw invalid();
  return engine.transaction((db) => {
    if (input.chat) {
      const m = rows(db, `SELECT m.* FROM message m JOIN conversation c ON c.id=m.conversation_id
        WHERE m.id=? AND m.conversation_id=? AND c.learner_id=? AND m.role='assistant' AND m.superseded=0`,
        [input.chat.messageId, input.chat.conversationId, learner(db)])[0];
      if (!localRound || input.items.length !== 1 || !m) throw invalid();
      if (input.chat.sourceMessageId && !rows(db, "SELECT id FROM message WHERE id=? AND conversation_id=? AND role='user' AND superseded=0", [input.chat.sourceMessageId, m.conversation_id]).length) throw invalid();
    }
    const id = uid('practice');
    const timestamp = now();
    const learnerId = learner(db);
    const touched = rows(db, 'SELECT id FROM encounter WHERE learner_id=? AND scenario_id=? AND method_id=? LIMIT 1', [learnerId, input.scenarioId, input.methodId]);
    if (!touched.length && !localRound)
      throw new DatabaseError('这个训练目标还没有接触过，可先使用已准备的本地题。', 'unseen_edge');
    if (!input.chat) db.run('UPDATE practice_run SET finished_at=? WHERE learner_id=? AND finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.run_id=practice_run.id)', [timestamp, learnerId]);
    db.run('INSERT INTO practice_run(id,learner_id,scenario_id,method_ids,started_at,generation_status) VALUES(?,?,?,?,?,?)',
      [id, learnerId, input.scenarioId, JSON.stringify([input.methodId]), timestamp, localRound || input.items.length === 3 ? 'complete' : 'preparing']);
    input.items.forEach((question, index) => db.run('INSERT INTO practice_item(id,run_id,seq,step,question,created_at) VALUES(?,?,?,?,?,?)',
      [uid('item'), id, index + 1, index + 1, JSON.stringify(question), timestamp]));
    if (input.chat) {
      const itemId = rows(db, 'SELECT id FROM practice_item WHERE run_id=?', [id])[0].id;
      db.run('INSERT INTO chat_practice(run_id,item_id,conversation_id,message_id,source_message_id,created_at) VALUES(?,?,?,?,?,?)',
        [id, itemId, input.chat.conversationId, input.chat.messageId, input.chat.sourceMessageId || null, timestamp]);
    }
    return readRun(db, id);
  });
}

export function appendPracticeItems(engine, runId, items = [], status = 'preparing') {
  if (!Array.isArray(items) || !['preparing','complete','failed'].includes(status)) throw invalid();
  return engine.transaction((db) => {
    const run = readRun(db, runId);
    if (run.finishedAt || run.generationStatus !== 'preparing' || run.items.length + items.length > 3) throw invalid();
    for (const [index, question] of items.entries()) {
      if (!validQuestion(question, run.scenarioId, run.methodId)
        || run.items.some((item) => item.question.questionKey === question.questionKey)) throw invalid();
      const seq = run.items.length + index + 1;
      db.run('INSERT INTO practice_item(id,run_id,seq,step,question,created_at) VALUES(?,?,?,?,?,?)', [uid('item'),runId,seq,seq,JSON.stringify(question),now()]);
    }
    if (status === 'complete' && run.items.length + items.length !== 3) throw invalid();
    db.run('UPDATE practice_run SET generation_status=? WHERE id=?', [status,runId]);
    if (status === 'failed' && run.items.length && run.items.every((item) => item.answer?.advanced)) db.run('UPDATE practice_run SET finished_at=? WHERE id=?', [now(),runId]);
    return readRun(db, runId);
  });
}

export function loadActivePractice(engine) {
  const db = engine.ensureOpen();
  const row = rows(db, 'SELECT id FROM practice_run WHERE learner_id=? AND finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.run_id=practice_run.id) ORDER BY started_at DESC,id LIMIT 1', [learner(db)])[0];
  return row ? readRun(db, row.id) : null;
}

export function loadPracticeItem(engine, id) {
  const db = engine.ensureOpen();
  const row = rows(db, 'SELECT run_id FROM practice_item WHERE id=?', [id])[0];
  if (!row) throw invalid();
  const run = readRun(db, row.run_id);
  const item = run.items.find((item) => item.id === id);
  return { ...item, runId: run.id, finishedAt: run.finishedAt, origin: run.origin, scenarioId: item.question.entranceScenarioId ?? run.scenarioId, methodId: run.methodId };
}

export function listPracticeHistory(engine, { limit = 60, offset = 0 } = {}) {
  const db = engine.ensureOpen();
  const take = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 60));
  const skip = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
  const result = rows(db, `SELECT i.*,r.scenario_id,r.method_ids,r.started_at,r.finished_at
    FROM practice_item i JOIN practice_run r ON r.id=i.run_id
    WHERE r.learner_id=? ORDER BY r.started_at DESC,r.id DESC,i.seq LIMIT ? OFFSET ?`, [learner(db), take + 1, skip]);
  return { items: result.slice(0, take).map((row) => ({ id: row.id, seq: row.seq, runId: row.run_id,
    scenarioId: JSON.parse(row.question).entranceScenarioId ?? row.scenario_id, methodId: JSON.parse(row.method_ids)[0], startedAt: row.started_at, finishedAt: row.finished_at,
    question: JSON.parse(row.question), answer: row.answer ? JSON.parse(row.answer) : null, result: row.result })), hasMore: result.length > take };
}

export function loadPracticeUsage(engine) {
  const usage = new Map();
  for (const row of rows(engine.ensureOpen(), `SELECT i.question,i.created_at FROM practice_item i
    JOIN practice_run r ON r.id=i.run_id WHERE r.learner_id=? AND i.answer IS NOT NULL`, [learner(engine.ensureOpen())])) {
    const question = JSON.parse(row.question);
    const previous = usage.get(question.questionKey) ?? { questionKey: question.questionKey, count: 0, lastPracticedAt: '' };
    previous.count += 1;
    if (row.created_at > previous.lastPracticedAt) previous.lastPracticedAt = row.created_at;
    usage.set(question.questionKey, previous);
  }
  return [...usage.values()];
}

function expose(db, run, item, methodIds, scenarioId = item.question.entranceScenarioId ?? run.scenarioId) {
  const learnerId = learner(db);
  for (const methodId of new Set(methodIds)) {
    db.run(`INSERT OR IGNORE INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at,practice_item_id)
      VALUES(?,?,?,?,?,'practice',?,?)`, [`practice:${item.id}:${scenarioId}:${methodId}`, learnerId, scenarioId, methodId, methodId === run.methodId ? 1 : 0, now(), item.id]);
    for (const [type, targetId] of [['scenario', scenarioId], ['method', methodId]]) {
      db.run(`INSERT OR IGNORE INTO mastery(id,learner_id,target_type,target_id,state,success_count,faces,updated_at)
        VALUES(?,?,?,?,'exposed',0,'[]',?)`, [`${learnerId}:${type}:${targetId}`, learnerId, type, targetId, now()]);
    }
  }
}

function updateMastery(db, type, targetId, item, right) {
  const learnerId = learner(db);
  const question = item.question;
  if (right) {
    db.run('INSERT OR IGNORE INTO practice_credit(learner_id,target_type,target_id,question_key,created_at) VALUES(?,?,?,?,?)',
      [learnerId, type, targetId, question.questionKey, now()]);
    if (!db.getRowsModified()) return;
  }
  const row = rows(db, 'SELECT * FROM mastery WHERE learner_id=? AND target_type=? AND target_id=?', [learnerId, type, targetId])[0];
  const previous = row ? { state: row.state, successCount: row.success_count, faces: JSON.parse(row.faces) } : undefined;
  const result = applyPractice(previous, { targetType: type, right, face: type === 'scenario' ? question.faceKey : question.questionKey });
  db.run(`INSERT INTO mastery(id,learner_id,target_type,target_id,state,success_count,faces,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(learner_id,target_type,target_id) DO UPDATE SET state=excluded.state,success_count=excluded.success_count,faces=excluded.faces,updated_at=excluded.updated_at`,
  [`${learnerId}:${type}:${targetId}`, learnerId, type, targetId, result.state, result.successCount, JSON.stringify(result.faces), result.updatedAt]);
}

export function gradePracticeItem(engine, runId, itemId, attempt) {
  const { run, item } = readItem(engine.ensureOpen(), runId, itemId);
  if (item.answer?.advanced || !['selection','steps'].includes(attempt?.mode)) throw invalid();
  let assessment;
  if (attempt.mode === 'selection') {
    if (!Array.isArray(attempt.selectedIds) || attempt.selectedIds.some((id) => !item.question.options.some((option) => option.id === id))) throw invalid();
    assessment = assessSelection(item.question, attempt.selectedIds);
  } else {
    assessment = attempt.assessment;
    const mathProof = Array.isArray(assessment?.mathematicalEvidence) && assessment.mathematicalEvidence.length > 0
      && assessment.mathematicalEvidence.every((entry) => entry.studentExcerpt?.trim()
        && attempt.steps?.includes(entry.studentExcerpt) && entry.explanation?.trim());
    if (!attempt.steps?.trim() || !['right','wrong','uncertain'].includes(assessment?.outcome) || !assessment.feedback?.trim()
      || !Array.isArray(assessment.methodIds) || assessment.methodIds.some((id) => !item.question.candidateMethodIds.includes(id))
      || (assessment.outcome === 'right' && ((!assessment.methodIds.length
        && !(isRouteQuestion(item.question) && assessment.mathematicallyValid === true && mathProof))
        || (!isRouteQuestion(item.question) && assessment.methodIds.some((id) => !item.question.applicableMethodIds.includes(id)))))) throw invalid();
    if (assessment.mathematicalEvidence?.length && !mathProof) throw invalid();
    if (isRouteQuestion(item.question) && (assessment.methodIds.length && (!Array.isArray(assessment.executedEdges)
      || assessment.executedEdges.some((edge) => !attempt.steps.includes(edge.studentExcerpt)
        || !item.question.allowedEdges?.some((allowed) => allowed.methodId === edge.methodId && allowed.scenarioId === edge.scenarioId))
      || assessment.methodIds.some((id) => !assessment.executedEdges.some((edge) => edge.methodId === id))))) throw invalid();
  }
  const patternEvidence = assessment.patternEvidence ?? [];
  if (!Array.isArray(patternEvidence) || validPatternEvidence(item.question, patternEvidence, assessment.executedEdges ?? [], attempt.steps ?? '').length !== patternEvidence.length) throw invalid();
  return engine.transaction((db) => {
    const revealed = Boolean(item.answer?.revealed);
    const routeQuestion = isRouteQuestion(item.question);
    const draft = routeQuestion && item.question.metadata?.reviewStatus !== 'worked_example_checked';
    const attemptCounts = { ...item.answer?.attemptCounts };
    const previousAttempts = attemptCounts[attempt.mode] ?? (item.answer?.mode === attempt.mode && item.answer.outcome ? 1 : 0);
    const independent = previousAttempts === 0;
    attemptCounts[attempt.mode] = previousAttempts + 1;
    if (assessment.outcome !== 'uncertain' && !revealed && !draft && independent) {
      if (attempt.mode === 'selection') {
        updateMastery(db, 'scenario', item.question.entranceScenarioId ?? run.scenarioId, item, assessment.outcome === 'right');
        // A route card is recognition evidence at its entrance only. Reading
        // downstream methods is not evidence of executing or recognizing them.
        const selectedMethods = routeQuestion ? entranceMethodIds(item.question, attempt.selectedIds) : [run.methodId];
        expose(db, run, item, selectedMethods.length ? selectedMethods
          : entranceMethodIds(item.question, item.question.routes.filter((route) => route.preferred).map((route) => route.id)));
      } else {
        for (const id of assessment.methodIds) updateMastery(db, 'method', id, item, assessment.outcome === 'right');
        if (routeQuestion && assessment.executedEdges?.length) {
          for (const edge of assessment.executedEdges) expose(db, run, item, [edge.methodId], edge.scenarioId);
        } else if (!routeQuestion) expose(db, run, item, assessment.methodIds);
      }
    }
    const answer = { mode: attempt.mode, selectedIds: attempt.selectedIds ?? [], steps: attempt.steps ?? '',
      outcome: assessment.outcome, feedback: revealed ? `${item.answer?.assisted ? '这题已使用答疑帮助' : '这题已看过答案'}，本次不改变掌握度。${assessment.feedback}`
        : draft ? `AI 生成题尚未人工核对，本次不改变掌握度。${assessment.feedback}`
          : !independent ? `这是再次判断，不计新的独立成功。${assessment.feedback}` : assessment.feedback,
      methodIds: assessment.methodIds ?? [], executedEdges: assessment.executedEdges ?? [], patternEvidence,
      mathematicalEvidence: assessment.mathematicalEvidence ?? [],
      mathematicallyValid: assessment.mathematicallyValid ?? assessment.outcome === 'right', revealed, assisted: Boolean(item.answer?.assisted), advanced: false,
      independent, attemptCounts,
      attemptHistory: [...(item.answer?.attemptHistory ?? []), { mode: attempt.mode, selectedIds: attempt.selectedIds ?? [],
        steps: attempt.steps ?? '', outcome: assessment.outcome, feedback: assessment.feedback,
        methodIds: assessment.methodIds ?? [], executedEdges: assessment.executedEdges ?? [], patternEvidence,
        independent, revealed, assisted: Boolean(item.answer?.assisted) }].slice(-20) };
    db.run('UPDATE practice_item SET answer=?,result=? WHERE id=?', [JSON.stringify(answer),
      assessment.outcome === 'right' ? 'right' : assessment.outcome === 'wrong' ? 'wrong' : null, itemId]);
    return readRun(db, runId);
  });
}

export function revealPracticeItem(engine, runId, itemId, options = {}) {
  const db = engine.ensureOpen();
  const run = readRun(db, runId);
  const item = run.items.find((entry) => entry.id === itemId);
  if (!item) throw invalid();
  return engine.transaction((database) => {
    database.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, revealed: true, ...(options.assisted ? { assisted: true } : {}) }), itemId]);
    if (!isRouteQuestion(item.question) || item.question.metadata?.reviewStatus === 'worked_example_checked') expose(database, run, item, isRouteQuestion(item.question)
      ? entranceMethodIds(item.question, item.question.routes.filter((route) => route.valid).map((route) => route.id)) : [run.methodId]);
    return readRun(database, runId);
  });
}

export function advancePracticeItem(engine, runId, itemId) {
  const { run, item } = readItem(engine.ensureOpen(), runId, itemId);
  return engine.transaction((db) => {
    db.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, advanced: true }), itemId]);
    if (item.seq === 3 || (run.generationStatus !== 'preparing' && item.seq === run.items.length)) db.run('UPDATE practice_run SET finished_at=? WHERE id=?', [now(), runId]);
    return readRun(db, runId);
  });
}

// Chat-origin runs are separate from the practice page, but participate in the
// user's choice to delete both a conversation and its learning records.
export function deleteChatPracticeRecords(db, conversationId) {
  const doomed = rows(db, `SELECT cp.run_id,i.question FROM chat_practice cp JOIN practice_item i ON i.id=cp.item_id WHERE cp.conversation_id=?`, [conversationId]);
  if (!doomed.length) return;
  const learnerId = learner(db), removedKeys = new Set(doomed.map(r => JSON.parse(r.question).questionKey));
  const credits = rows(db, 'SELECT * FROM practice_credit WHERE learner_id=?', [learnerId]).filter(c => removedKeys.has(c.question_key));
  for (const row of doomed) db.run('DELETE FROM practice_run WHERE id=?', [row.run_id]);
  const survivors = rows(db, `SELECT i.question,i.answer FROM practice_item i JOIN practice_run r ON r.id=i.run_id WHERE r.learner_id=? AND i.answer IS NOT NULL`, [learnerId])
    .map(r => ({ q: JSON.parse(r.question), a: JSON.parse(r.answer) }));
  const affected = new Map();
  for (const credit of credits) {
    const retained = survivors.some(({ q, a }) => {
      if (q.questionKey !== credit.question_key || a.revealed) return false;
      const mode = credit.target_type === 'scenario' ? 'selection' : 'steps';
      const first = (a.attemptHistory ?? []).find(h => h.mode === mode) ?? (a.mode === mode ? a : null);
      if (!first || first.outcome !== 'right' || first.revealed) return false;
      return credit.target_type === 'scenario' ? q.entranceScenarioId === credit.target_id
        : (first.methodIds ?? a.methodIds ?? q.applicableMethodIds ?? []).includes(credit.target_id);
    });
    if (!retained) {
      db.run('DELETE FROM practice_credit WHERE learner_id=? AND target_type=? AND target_id=? AND question_key=?', [learnerId, credit.target_type, credit.target_id, credit.question_key]);
      affected.set(`${credit.target_type}:${credit.target_id}`, credit);
    }
  }
  for (const c of affected.values()) {
    const m = rows(db, 'SELECT * FROM mastery WHERE learner_id=? AND target_type=? AND target_id=?', [learnerId, c.target_type, c.target_id])[0];
    if (!m) continue;
    const remaining = rows(db, 'SELECT question_key FROM practice_credit WHERE learner_id=? AND target_type=? AND target_id=?', [learnerId, c.target_type, c.target_id]);
    const faces = [...new Set(remaining.map(r => c.target_type === 'method' ? r.question_key : survivors.find(s => s.q.questionKey === r.question_key)?.q.faceKey).filter(Boolean))];
    const count = Math.min(m.success_count, remaining.length), threshold = c.target_type === 'scenario' ? 3 : 2;
    const state = count === 0 ? 'exposed' : m.state === 'mastered' && count >= threshold && faces.length >= threshold ? 'mastered' : 'consolidating';
    db.run('UPDATE mastery SET success_count=?,faces=?,state=?,updated_at=? WHERE id=?', [count, JSON.stringify(faces), state, now(), m.id]);
  }
}
