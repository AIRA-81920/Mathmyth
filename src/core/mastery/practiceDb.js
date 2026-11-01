import { rows } from '../db/validation.js';
import { DatabaseError } from '../db/errors.js';
import { applyPractice } from './state.js';
import { assessSelection } from './selection.js';
import { isRouteQuestion, entranceMethodIds } from '../practice/routes.js';
import { validPatternEvidence } from '../knowledge/patterns.js';
import { isInstalledReviewedQuestion } from '../practice/reviewedIdentity.js';
import { fingerprintQuestion } from './fingerprint.js';
import { normalizeSubject, subjectForNodeId } from '../config/subject.js';


const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const learner = (db) => rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0].id;
function invalid() { return new DatabaseError('练习记录不完整，请重新打开练习。', 'invalid_practice'); }
function appendAttempt(history, attempt) {
  const entries = [...(history ?? []), attempt];
  if (entries.length <= 40) return entries;
  // Keep the first observation and decisive independent evidence even after
  // many retries. A bounded recent history must not erase earned evidence.
  const keep = new Set([0]);
  for (const mode of ['selection', 'steps']) {
    for (const predicate of [entry => entry.mode === mode && entry.outcome !== 'uncertain',
      entry => entry.mode === mode && entry.outcome === 'right' && entry.independent && !entry.assisted && !entry.revealed]) {
      const index = entries.findIndex(predicate); if (index >= 0) keep.add(index);
    }
  }
  for (let index = entries.length - 1; keep.size < 40 && index >= 0; index--) keep.add(index);
  return [...keep].sort((a, b) => a - b).map(index => entries[index]);
}
function readRun(db, id) {
  const run = rows(db, 'SELECT * FROM practice_run WHERE id=? AND learner_id=?', [id, learner(db)])[0];
  if (!run) throw invalid();
  const items = rows(db, 'SELECT * FROM practice_item WHERE run_id=? ORDER BY seq', [id]).map((row) => ({
    id: row.id, seq: row.seq, question: JSON.parse(row.question), answer: row.answer ? JSON.parse(row.answer) : null, result: row.result,
  }));
  return { id: run.id, scenarioId: run.scenario_id, methodId: JSON.parse(run.method_ids)[0], subject: run.subject,
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
  const minRoutes = question.metadata?.reviewStatus === 'model_unverified' ? 1 : 3;
  return question.entranceScenarioId === entrance && Array.isArray(question.routes) && question.routes.length >= minRoutes
    && ['single', 'multi', 'best'].includes(question.selectionMode)
    && question.routes.every((route) => typeof route.valid === 'boolean' && route.steps?.length && route.steps[0].scenarioId === entrance)
    && question.routes.some((route) => route.valid)
    // AI 草稿按契约只给一条正确路线（见 routes.js 的 draft 豁免与 related.js 的提示词），
    // "必须带一条错误路线"只适用于人工库题的选路线玩法；对草稿套用会让出题 100% 失败。
    && (question.metadata?.reviewStatus === 'model_unverified' || question.routes.some((route) => !route.valid));
}

// all 为已加载的题库集合（prepareRouteTargets）；within 存在时只在该 target 内比对，
// 否则在全题库内比对。题库改为由调用方按需加载后传入，语义与原先模块级常量一致。
function knownPreparedQuestion(question, within, all) {
  return question?.metadata?.reviewStatus === 'worked_example_checked'
    && typeof question.metadata.motherId === 'string' && typeof question.metadata.source?.kind === 'string'
    && (within ? [within] : all).some((target) => Array.isArray(target?.questions) && target.questions.some((entry) =>
      entry?.metadata?.motherId === question.metadata.motherId && entry.question === question.question
      && entry.entranceScenarioId === question.entranceScenarioId && entry.solution === question.solution
      && entry.metadata.source?.kind === question.metadata.source?.kind
      && JSON.stringify(entry.routes) === JSON.stringify(question.routes)
      && JSON.stringify(entry.structure) === JSON.stringify(question.structure)));
}

async function verifiedRouteIdentity(question) {
  if (!isRouteQuestion(question)) return true;
  try {
    const identity = await fingerprintQuestion(question);
    if (identity.questionKey !== question.questionKey || identity.faceKey !== question.faceKey) return false;
    // A caller cannot gain reviewed credit through the AI-run/append path.
    if (question.metadata?.reviewStatus === 'worked_example_checked' && !await isInstalledReviewedQuestion(question)) return false;
    return Array.isArray(question.options) && question.options.length === question.routes.length
      && new Set(question.options.map(option => option.id)).size === question.routes.length
      && question.options.every(option => question.routes.some(route => route.id === option.id && route.summary === option.name));
  } catch { return false; }
}

// 本地已准备题需要题库比对；改为 async 并按需加载题库，其余校验/写入逻辑不变。
// localPrepared=true 的请求必须自带 preparedTarget（命中的那一个题库 target）；
// worker 不再加载题库，所以这段永远不会去下载大题集。
export async function createPracticeRun(engine, input) {
  // 题库由主线程按需加载，这一段只接收“命中的那一个 target”（≤126KB），
  // worker 因此完全不需要题库 → 不会再把 2.4MB 的题库打进 worker 包。
  const target = input?.preparedTarget ?? null;
  const localRound = input?.localPrepared === true && Boolean(target)
    && target.scenarioId === input.scenarioId
    && target.methodId === input.methodId
    && Array.isArray(target.questions) && target.questions.length > 0
    && Array.isArray(input.items) && input.items.length
    && input.items.every((question) => knownPreparedQuestion(question, target, [target]));
  const installed = localRound && (await Promise.all(input.items.map(async question => {
    if (!await isInstalledReviewedQuestion(question)) return false;
    const identity = await fingerprintQuestion(question);
    return identity.questionKey === question.questionKey && identity.faceKey === question.faceKey;
  }))).every(Boolean);
  const validIdentities = Array.isArray(input?.items) && (await Promise.all(input.items.map(verifiedRouteIdentity))).every(Boolean);
  if ((input?.localPrepared === true && (!localRound || !installed))
    || !validIdentities || !input?.scenarioId || !input.methodId || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 3
    || input.items.some((question) => !validQuestion(question, input.scenarioId, input.methodId,
      localRound))
    || new Set(input.items.map((question) => question.questionKey)).size !== input.items.length) throw invalid();
  return engine.transaction((db) => {
    if (input.chat) {
      const m = rows(db, `SELECT m.* FROM message m JOIN conversation c ON c.id=m.conversation_id
        WHERE m.id=? AND m.conversation_id=? AND c.learner_id=? AND m.role='assistant' AND m.superseded=0`,
        [input.chat.messageId, input.chat.conversationId, learner(db)])[0];
      const draft = input.items.length === 1 && isRouteQuestion(input.items[0])
        && input.items[0].metadata?.reviewStatus === 'model_unverified'
        && input.items[0].metadata?.source?.kind === 'ai_variant'
        && input.items[0].metadata?.learning?.provenance;
      if ((!localRound && !draft) || input.items.length !== 1 || !m) throw invalid();
      if (input.chat.sourceMessageId && !rows(db, "SELECT id FROM message WHERE id=? AND conversation_id=? AND role='user' AND superseded=0", [input.chat.sourceMessageId, m.conversation_id]).length) throw invalid();
    }
    for (const question of input.items) {
      const learning = question.metadata?.learning;
      if (!learning?.reviewId) continue;
      const review = rows(db, `SELECT v.*,i.question FROM practice_review v JOIN practice_item i ON i.id=v.source_item_id
        WHERE v.id=? AND v.learner_id=? AND v.status='pending'`, [learning.reviewId, learner(db)])[0];
      if (!input.chat || !review || review.source_item_id !== learning.provenance?.sourceItemId
        || JSON.parse(review.question).metadata?.learning?.familyId !== learning.familyId
        || rows(db, `SELECT i.id FROM practice_item i JOIN practice_run r ON r.id=i.run_id JOIN chat_practice cp ON cp.item_id=i.id
          WHERE r.learner_id=? AND r.finished_at IS NULL AND cp.conversation_id IS NOT NULL
          AND json_extract(i.question,'$.metadata.learning.reviewId')=?`, [learner(db), learning.reviewId]).length) throw invalid();
    }
    const id = uid('practice');
    const timestamp = now();
    const learnerId = learner(db);
    const touched = rows(db, 'SELECT id FROM encounter WHERE learner_id=? AND scenario_id=? AND method_id=? LIMIT 1', [learnerId, input.scenarioId, input.methodId]);
    if (!touched.length && !localRound && !input.chat)
      throw new DatabaseError('这个训练目标还没有接触过，可先使用已准备的本地题。', 'unseen_edge');
    if (!input.chat) db.run('UPDATE practice_run SET finished_at=? WHERE learner_id=? AND finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.run_id=practice_run.id)', [timestamp, learnerId]);
    // 学科由训练目标的场景 ID 决定：即使创建后马上切换学科，这条记录仍归它原本的学科。
    db.run('INSERT INTO practice_run(id,learner_id,scenario_id,method_ids,started_at,generation_status,subject) VALUES(?,?,?,?,?,?,?)',
      [id, learnerId, input.scenarioId, JSON.stringify([input.methodId]), timestamp,
        localRound || input.chat || input.items.length === 3 ? 'complete' : 'preparing', subjectForNodeId(input.scenarioId)]);
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

export async function appendPracticeItems(engine, runId, items = [], status = 'preparing') {
  if (!Array.isArray(items) || !['preparing','complete','failed'].includes(status)) throw invalid();
  if (!(await Promise.all(items.map(verifiedRouteIdentity))).every(Boolean)) throw invalid();
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

// 只恢复当前学科那一轮练习：切到高中数学时，不该弹出高数没做完的一轮。
export function loadActivePractice(engine, subject = 'advanced') {
  const db = engine.ensureOpen();
  const row = rows(db, 'SELECT id FROM practice_run WHERE learner_id=? AND subject=? AND finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.run_id=practice_run.id) ORDER BY started_at DESC,id LIMIT 1', [learner(db), normalizeSubject(subject)])[0];
  return row ? readRun(db, row.id) : null;
}

export function loadPracticeItem(engine, id) {
  const db = engine.ensureOpen();
  const row = rows(db, 'SELECT run_id FROM practice_item WHERE id=?', [id])[0];
  if (!row) throw invalid();
  const run = readRun(db, row.run_id);
  const item = run.items.find((item) => item.id === id);
  const source = rows(db, 'SELECT conversation_id,message_id,source_message_id FROM chat_practice WHERE item_id=?', [id])[0];
  return { ...item, runId: run.id, finishedAt: run.finishedAt, origin: run.origin, scenarioId: item.question.entranceScenarioId ?? run.scenarioId, methodId: run.methodId,
    source: source ? { conversationId: source.conversation_id, messageId: source.message_id, sourceMessageId: source.source_message_id } : null,
    review: reviewForItem(db, id) };
}

export function listPracticeHistory(engine, { limit = 60, offset = 0, subject = 'advanced' } = {}) {
  const db = engine.ensureOpen();
  const take = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 60));
  const skip = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
  const result = rows(db, `SELECT i.*,r.scenario_id,r.method_ids,r.started_at,r.finished_at
    FROM practice_item i JOIN practice_run r ON r.id=i.run_id
    WHERE r.learner_id=? AND r.subject=? ORDER BY r.started_at DESC,r.id DESC,i.seq LIMIT ? OFFSET ?`,
  [learner(db), normalizeSubject(subject), take + 1, skip]);
  return { items: result.slice(0, take).map((row) => ({ id: row.id, seq: row.seq, runId: row.run_id,
    scenarioId: JSON.parse(row.question).entranceScenarioId ?? row.scenario_id, methodId: JSON.parse(row.method_ids)[0], startedAt: row.started_at, finishedAt: row.finished_at,
    question: JSON.parse(row.question), answer: row.answer ? JSON.parse(row.answer) : null, result: row.result })), hasMore: result.length > take };
}

export function loadPracticeUsage(engine, subject = 'advanced') {
  const usage = new Map();
  for (const row of rows(engine.ensureOpen(), `SELECT i.question,i.created_at FROM practice_item i
    JOIN practice_run r ON r.id=i.run_id WHERE r.learner_id=? AND r.subject=? AND i.answer IS NOT NULL`,
  [learner(engine.ensureOpen()), normalizeSubject(subject)])) {
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
    const assisted = Boolean(item.answer?.assisted || item.answer?.hintLevel
      || item.answer?.helpEvents?.some(event => event.kind !== 'route_options')
      || (attempt.mode === 'steps' && item.answer?.routeOptionsRevealed));
    const routeQuestion = isRouteQuestion(item.question);
    const draft = routeQuestion && item.question.metadata?.reviewStatus !== 'worked_example_checked';
    const attemptCounts = { ...item.answer?.attemptCounts };
    const previousAttempts = attemptCounts[attempt.mode] ?? (item.answer?.mode === attempt.mode && item.answer.outcome ? 1 : 0);
    const independent = previousAttempts === 0 && !revealed && !assisted && !item.answer?.disputed;
    // Asking for clarification does not consume an independent attempt. It is
    // not evidence that the student performed an incorrect operation.
    attemptCounts[attempt.mode] = previousAttempts + (assessment.outcome === 'uncertain' ? 0 : 1);
    if (assessment.outcome !== 'uncertain' && !draft && independent) {
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
    const timestamp = now();
    const feedbackHelpsNext = assessment.feedbackAssists === true || assessment.outcome === 'wrong' || (Boolean(item.question.metadata?.learning) && attempt.mode === 'selection');
    const helpEvents = [...(item.answer?.helpEvents ?? []), ...(feedbackHelpsNext ? [{ kind: 'feedback', at: timestamp }] : [])];
    const answer = { ...item.answer, mode: attempt.mode, selectedIds: attempt.selectedIds ?? [], steps: attempt.steps ?? '',
      ...(attempt.mode === 'steps' ? { draft: attempt.steps ?? '' } : {}),
      outcome: assessment.outcome, feedback: revealed ? `${item.answer?.assisted ? '这题已使用答疑帮助' : '这题已看过答案'}，本次不改变掌握度。${assessment.feedback}`
        : assisted ? `${previousAttempts > 0 ? '这是再次判断，' : ''}借助过本题提示或反馈，本次不计新的独立成功。${assessment.feedback}`
        : draft ? `AI 生成题尚未人工核对，本次不改变掌握度。${assessment.feedback}`
          : !independent ? `这是再次判断，不计新的独立成功。${assessment.feedback}` : assessment.feedback,
      methodIds: assessment.methodIds ?? [], executedEdges: assessment.executedEdges ?? [], patternEvidence,
      mathematicalEvidence: assessment.mathematicalEvidence ?? [],
      assessmentScope: assessment.scope ?? null, resultCorrect: assessment.resultCorrect === true,
      mathematicallyValid: assessment.mathematicallyValid ?? assessment.outcome === 'right', revealed, assisted: assisted || feedbackHelpsNext, advanced: false,
      independent, attemptCounts, helpEvents,
      attemptHistory: appendAttempt(item.answer?.attemptHistory, { mode: attempt.mode, selectedIds: attempt.selectedIds ?? [],
        steps: attempt.steps ?? '', outcome: assessment.outcome, feedback: assessment.feedback,
        methodIds: assessment.methodIds ?? [], executedEdges: assessment.executedEdges ?? [], patternEvidence,
        mathematicalEvidence: assessment.mathematicalEvidence ?? [],
        assessmentScope: assessment.scope ?? null, resultCorrect: assessment.resultCorrect === true,
        independent, revealed, assisted, at: timestamp }) };
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
    const routeOptions = options.kind === 'route_options';
    const kind = routeOptions ? 'route_options' : options.assisted ? 'conversation' : 'solution';
    const helpEvents = [...(item.answer?.helpEvents ?? [])];
    if (!helpEvents.some(event => event.kind === kind)) helpEvents.push({ kind, at: now() });
    database.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer,
      ...(routeOptions ? { routeOptionsRevealed: true } : { revealed: true }), helpEvents, ...(options.assisted ? { assisted: true } : {}) }), itemId]);
    if (!routeOptions && (!isRouteQuestion(item.question) || item.question.metadata?.reviewStatus === 'worked_example_checked')) expose(database, run, item, isRouteQuestion(item.question)
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

function reviewForItem(db, itemId) {
  const row = rows(db, 'SELECT * FROM practice_review WHERE source_item_id=? AND learner_id=?', [itemId, learner(db)])[0];
  return row ? { id: row.id, sourceItemId: row.source_item_id, status: row.status, dueAt: row.due_at,
    createdAt: row.created_at, completedItemId: row.completed_item_id } : null;
}

export function recordPracticeHint(engine, runId, itemId, level) {
  const { item } = readItem(engine.ensureOpen(), runId, itemId);
  const hints = item.question.metadata?.learning?.hints ?? [];
  if (!Number.isInteger(level) || level < 1 || level > hints.length) throw invalid();
  return engine.transaction(db => {
    const helpEvents = [...(item.answer?.helpEvents ?? [])];
    if (!helpEvents.some(event => event.kind === 'hint' && event.level === level)) helpEvents.push({ kind: 'hint', level, at: now() });
    db.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, assisted: true,
      hintLevel: Math.max(level, item.answer?.hintLevel ?? 0), helpEvents }), itemId]);
    return readRun(db, runId);
  });
}

export function savePracticeDraft(engine, runId, itemId, text) {
  const { item } = readItem(engine.ensureOpen(), runId, itemId);
  if (typeof text !== 'string' || text.length > 50000) throw invalid();
  return engine.transaction(db => {
    db.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, draft: text }), itemId]);
    return { saved: true };
  });
}

export function finishChatPractice(engine, runId, itemId) {
  const run = readRun(engine.ensureOpen(), runId), item = run.items.find(entry => entry.id === itemId);
  if (!item || run.origin !== 'chat') throw invalid();
  if (run.finishedAt) return Promise.resolve(run);
  return engine.transaction(db => {
    const timestamp = now();
    db.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, advanced: true, endedAt: timestamp }), itemId]);
    db.run('UPDATE practice_run SET finished_at=? WHERE id=?', [timestamp, runId]);
    const reviewId = item.question.metadata?.learning?.reviewId;
    if (reviewId && ['right', 'wrong'].includes(item.answer?.outcome) && !item.answer?.disputed) db.run(`UPDATE practice_review SET status='completed',completed_item_id=?,updated_at=?
      WHERE id=? AND learner_id=? AND status='pending' AND source_item_id<>?`, [itemId, timestamp, reviewId, learner(db), itemId]);
    return readRun(db, runId);
  });
}

export function setPracticeReview(engine, runId, itemId, enabled) {
  const run = readRun(engine.ensureOpen(), runId), item = run.items.find(entry => entry.id === itemId);
  if (!item || typeof enabled !== 'boolean' || !item.question.metadata?.learning?.familyId) throw invalid();
  return engine.transaction(db => {
    const timestamp = now(), existing = reviewForItem(db, itemId);
    if (enabled && !existing) db.run(`INSERT INTO practice_review(id,learner_id,source_item_id,status,due_at,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?,?)`, [uid('review'), learner(db), itemId, new Date(Date.now() + 3 * 86400000).toISOString(), timestamp, timestamp]);
    else if (existing && existing.status !== 'completed') db.run('UPDATE practice_review SET status=?,updated_at=? WHERE id=?', [enabled ? 'pending' : 'cancelled', timestamp, existing.id]);
    return { review: reviewForItem(db, itemId) };
  });
}

export function listPracticeReviews(engine, subject = 'advanced') {
  const db = engine.ensureOpen();
  const value = normalizeSubject(subject);
  const active = rows(db, `SELECT i.id,cp.conversation_id,json_extract(i.question,'$.metadata.learning.reviewId') AS review_id
    FROM practice_item i JOIN practice_run r ON r.id=i.run_id LEFT JOIN chat_practice cp ON cp.item_id=i.id
    WHERE r.learner_id=? AND r.subject=? AND r.finished_at IS NULL AND cp.conversation_id IS NOT NULL
      AND json_extract(i.question,'$.metadata.learning.reviewId') IS NOT NULL`, [learner(db), value]);
  // 复习安排通过它来源的练习轮次判断学科：高中数学的“接着上次”不会显示高数复习。
  return rows(db, `SELECT v.*,i.question,cp.conversation_id,cp.message_id,cp.source_message_id FROM practice_review v
    JOIN practice_item i ON i.id=v.source_item_id JOIN practice_run r ON r.id=i.run_id LEFT JOIN chat_practice cp ON cp.item_id=i.id
    WHERE v.learner_id=? AND r.subject=? AND v.status='pending' ORDER BY v.due_at,v.created_at LIMIT 50`, [learner(db), value])
    .map(row => ({ id: row.id, sourceItemId: row.source_item_id, status: row.status, dueAt: row.due_at, createdAt: row.created_at,
      question: JSON.parse(row.question), conversationId: row.conversation_id, messageId: row.message_id, sourceMessageId: row.source_message_id,
      activeItemId: active.find(entry => entry.review_id === row.id)?.id ?? null,
      activeConversationId: active.find(entry => entry.review_id === row.id)?.conversation_id ?? null }));
}

export function disputePracticeItem(engine, runId, itemId) {
  const run = readRun(engine.ensureOpen(), runId), item = run.items.find(entry => entry.id === itemId);
  if (!item?.answer?.outcome) throw invalid();
  return engine.transaction(db => {
    const previous = item.answer.attemptHistory?.length ? item.answer.attemptHistory : [item.answer];
    const attemptHistory = previous.map((entry, index) => index === previous.length - 1 ? { ...entry, disputed: true, disputedAt: now() } : entry);
    db.run('UPDATE practice_item SET answer=? WHERE id=?', [JSON.stringify({ ...item.answer, disputed: true, disputedAt: now(), attemptHistory }), itemId]);
    removeUnsupportedCredits(db, new Set([item.question.questionKey]));
    return readRun(db, runId);
  });
}

function firstIndependentSuccess(answer, type) {
  const mode = type === 'scenario' ? 'selection' : 'steps';
  return (answer.attemptHistory ?? [answer]).find(entry => entry.mode === mode && entry.outcome === 'right'
    && entry.independent !== false && !entry.revealed && !entry.assisted && !entry.disputed);
}

function removeUnsupportedCredits(db, questionKeys) {
  const learnerId = learner(db);
  const survivors = rows(db, `SELECT i.question,i.answer FROM practice_item i JOIN practice_run r ON r.id=i.run_id
    WHERE r.learner_id=? AND i.answer IS NOT NULL`, [learnerId]).map(row => ({ q: JSON.parse(row.question), a: JSON.parse(row.answer) }));
  const affected = new Map();
  for (const credit of rows(db, 'SELECT * FROM practice_credit WHERE learner_id=?', [learnerId]).filter(entry => questionKeys.has(entry.question_key))) {
    const retained = survivors.some(({ q, a }) => {
      if (q.questionKey !== credit.question_key) return false;
      const first = firstIndependentSuccess(a, credit.target_type);
      if (!first) return false;
      return credit.target_type === 'scenario' ? q.entranceScenarioId === credit.target_id
        : (first.methodIds ?? q.applicableMethodIds ?? []).includes(credit.target_id);
    });
    if (retained) continue;
    db.run('DELETE FROM practice_credit WHERE learner_id=? AND target_type=? AND target_id=? AND question_key=?', [learnerId, credit.target_type, credit.target_id, credit.question_key]);
    affected.set(`${credit.target_type}:${credit.target_id}`, credit);
  }
  for (const credit of affected.values()) {
    const mastery = rows(db, 'SELECT * FROM mastery WHERE learner_id=? AND target_type=? AND target_id=?', [learnerId, credit.target_type, credit.target_id])[0];
    if (!mastery) continue;
    const remaining = rows(db, 'SELECT question_key FROM practice_credit WHERE learner_id=? AND target_type=? AND target_id=?', [learnerId, credit.target_type, credit.target_id]);
    const faces = [...new Set(remaining.map(row => credit.target_type === 'method' ? row.question_key : survivors.find(entry => entry.q.questionKey === row.question_key)?.q.faceKey).filter(Boolean))];
    const count = Math.min(mastery.success_count, remaining.length), threshold = credit.target_type === 'scenario' ? 3 : 2;
    const state = count === 0 ? 'exposed' : mastery.state === 'mastered' && count >= threshold && faces.length >= threshold ? 'mastered' : 'consolidating';
    db.run('UPDATE mastery SET success_count=?,faces=?,state=?,updated_at=? WHERE id=?', [count, JSON.stringify(faces), state, now(), mastery.id]);
  }
}

// Chat-origin runs are separate from the practice page, but participate in the
// user's choice to delete both a conversation and its learning records.
export function deleteChatPracticeRecords(db, conversationId) {
  const doomed = rows(db, `SELECT cp.run_id,i.question FROM chat_practice cp JOIN practice_item i ON i.id=cp.item_id WHERE cp.conversation_id=?`, [conversationId]);
  if (!doomed.length) return;
  const removedKeys = new Set(doomed.map(row => JSON.parse(row.question).questionKey));
  for (const row of doomed) db.run('DELETE FROM practice_run WHERE id=?', [row.run_id]);
  removeUnsupportedCredits(db, removedKeys);
}
