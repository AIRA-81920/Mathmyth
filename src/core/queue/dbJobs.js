import { rows } from '../db/validation.js';
import { DatabaseError } from '../db/errors.js';
import { wantsChatPractice, chatRouteLetters } from '../chat/practiceIntent.js';
import { validateQuestionRoutes, mergeQuestionRoute } from '../chat/questionRoutes.js';

export const MAX_ATTEMPTS = 3;
export function sourceQuestion(db, message) {
  if (!message) return '';
  const documents = rows(db, `SELECT d.name,d.text FROM message_attachment a JOIN document d ON a.document_ref=d.id WHERE a.message_id=? ORDER BY a.seq`, [message.id]);
  return [message.content, ...documents.filter((item) => item.text.trim()).map((item) => `附件《${item.name}》：\n${item.text}`)].filter(Boolean).join('\n\n');
}

export function enqueueAnswers(db, conversationIds) {
  if (conversationIds?.length === 0) return 0;
  const condition = conversationIds ? ` AND m.conversation_id IN (${conversationIds.map(() => '?').join(',')})` : '';
  const answers = rows(db, `SELECT m.* FROM message m LEFT JOIN queue_job q
    ON q.source_message_id=m.id AND q.kind='locate'
    WHERE m.role='assistant' AND m.superseded=0 AND m.status='complete' AND trim(m.content)<>'' AND q.id IS NULL
    AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.message_id=m.id)
    AND EXISTS(SELECT 1 FROM conversation c WHERE c.id=m.conversation_id AND c.method_id IS NULL)${condition}`, conversationIds ?? []);
  let added = 0;
  for (const answer of answers) {
    const history = rows(db, 'SELECT * FROM message WHERE conversation_id=? AND superseded=0 AND seq<=? ORDER BY seq', [answer.conversation_id, answer.seq]);
    const users = history.filter((message) => message.role === 'user');
    if (!users.length) continue;
    const last = users.at(-1);
    if (wantsChatPractice(last.content)) continue;
    if (chatRouteLetters(last.content) && history.some(m => rows(db, 'SELECT run_id FROM chat_practice WHERE message_id=?', [m.id]).length)) continue;
    const selectedAnswer = last.recheck_of ? history.find((message) => message.id === last.recheck_of)?.content : undefined;
    const payload = {
      phase: 'blocks', blockIds: [], source: {
        question: sourceQuestion(db, users[0]), followup: sourceQuestion(db, last), answer: answer.content,
        userMessageId: last.id, userQuestion: sourceQuestion(db, last),
        questionMessages: users.filter(message => message.is_math_question !== 0).slice(-8)
          .map(message => ({ messageId: message.id, question: sourceQuestion(db, message).slice(0, 1200) })),
        ...((last.image_ref || users[0].image_ref) ? { imageId: last.image_ref || users[0].image_ref } : {}),
        ...(selectedAnswer ? { selectedAnswer } : {}),
        context: history.filter((message) => message.status !== 'error' && message.status !== 'streaming')
          .slice(-6).map(({ id, role, content }) => ({ messageId: id, role, content })),
      },
    };
    db.run(`INSERT OR IGNORE INTO queue_job(id,kind,conversation_id,status,attempts,payload,created_at,source_message_id)
      VALUES(?,'locate',?,'pending',0,?,?,?)`,
    [`locate:${answer.id}`, answer.conversation_id, JSON.stringify(payload), answer.created_at, answer.id]);
    added += db.getRowsModified();
  }
  return added;
}

export function cancelSupersededJobs(db) {
  db.run(`UPDATE queue_job SET status='failed',lease_token=NULL,next_attempt_at=NULL WHERE kind='locate' AND status IN ('pending','running')
    AND EXISTS(SELECT 1 FROM message m WHERE m.id=queue_job.source_message_id AND m.superseded=1)`);
  return db.getRowsModified();
}

export function requestMessageQuestionClassification(db, id) {
  const message = rows(db, "SELECT * FROM message WHERE id=? AND role='user'", [id])[0];
  if (!message) throw new DatabaseError('这条消息已不存在。', 'message_not_found');
  if (message.is_math_question !== null || message.superseded) return false;
  // A failed/stopped foreground answer cannot prove what an image contains.
  // Keep it unknown until there is a normally completed answer to classify.
  const answer = rows(db, `SELECT a.* FROM message a WHERE a.conversation_id=? AND a.superseded=0 AND a.role='assistant'
    AND a.status='complete' AND trim(a.content)<>'' AND a.seq>?
    AND NOT EXISTS(SELECT 1 FROM message u WHERE u.conversation_id=a.conversation_id AND u.superseded=0 AND u.role='user' AND u.seq>? AND u.seq<a.seq)
    ORDER BY a.seq LIMIT 1`, [message.conversation_id, message.seq, message.seq])[0];
  if (!answer) return false;
  enqueueAnswers(db, [message.conversation_id]);
  const job = rows(db, "SELECT * FROM queue_job WHERE source_message_id=? AND kind='locate'", [answer.id])[0];
  if (!job || ['running','pending'].includes(job.status)) return false;
  const payload = JSON.parse(job.payload);
  payload.phase = 'blocks'; payload.blockIds = [];
  payload.source.userMessageId = message.id; payload.source.userQuestion = sourceQuestion(db, message);
  payload.classificationOnly = true;
  db.run("UPDATE queue_job SET status='pending',attempts=0,payload=?,lease_token=NULL,next_attempt_at=NULL WHERE id=?", [JSON.stringify(payload), job.id]);
  return true;
}

export function recoverJobs(db) {
  const cancelled = cancelSupersededJobs(db);
  db.run(`UPDATE queue_job SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,lease_token=NULL
    WHERE kind='locate' AND (status='running' OR (status='pending' AND attempts>=?))`, [MAX_ATTEMPTS, MAX_ATTEMPTS]);
  return db.getRowsModified() > 0 || cancelled > 0;
}

function claimRow(engine, claim) {
  const job = rows(engine.ensureOpen(), "SELECT q.* FROM queue_job q JOIN message m ON q.source_message_id=m.id WHERE q.id=? AND q.kind='locate' AND m.superseded=0", [claim?.id ?? ''])[0];
  if (!job || job.status !== 'running' || !claim?.leaseToken || job.lease_token !== claim.leaseToken) {
    throw new DatabaseError('后台任务已经失效。', 'stale_job');
  }
  return job;
}

export async function claimNextJob(engine, now = new Date().toISOString()) {
  const job = rows(engine.ensureOpen(), `SELECT q.* FROM queue_job q JOIN message m ON q.source_message_id=m.id WHERE q.kind='locate' AND q.status='pending' AND m.superseded=0
    AND q.attempts<? AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?) ORDER BY q.created_at,q.id LIMIT 1`, [MAX_ATTEMPTS, now])[0];
  if (!job) return null;
  return engine.transaction((db) => {
    const payload = JSON.parse(job.payload);
    if (!payload.source.userMessageId) {
      const answer = rows(db, 'SELECT conversation_id,seq FROM message WHERE id=?', [job.source_message_id])[0];
      const user = rows(db, "SELECT * FROM message WHERE conversation_id=? AND role='user' AND superseded=0 AND seq<? ORDER BY seq DESC LIMIT 1", [answer.conversation_id, answer.seq])[0];
      if (user) {
        payload.source.userMessageId = user.id;
        payload.source.userQuestion = sourceQuestion(db, user);
        // Older leases had a block checkpoint but no structured math flag.
        // Re-run that existing phase once rather than trusting old context.
        if (user.is_math_question === null) { payload.phase = 'blocks'; payload.blockIds = []; }
      }
    }
    const leaseToken = globalThis.crypto.randomUUID();
    db.run("UPDATE queue_job SET status='running',attempts=attempts+1,lease_token=?,next_attempt_at=NULL,payload=? WHERE id=?", [leaseToken, JSON.stringify(payload), job.id]);
    return { id: job.id, leaseToken, attempts: job.attempts + 1, payload };
  });
}

export function checkpointJob(engine, claim, blockIds, classification) {
  const job = claimRow(engine, claim);
  if (!Array.isArray(blockIds) || blockIds.length > 2 || blockIds.some((id) => typeof id !== 'string')) throw new DatabaseError('归位结果无效。', 'invalid_location');
  if (classification !== undefined && (!classification || typeof classification.isMathQuestion !== 'boolean'
    || (classification.recognizedQuestion != null && typeof classification.recognizedQuestion !== 'string'))) throw new DatabaseError('题目标记无效。', 'invalid_location');
  const payload = { ...JSON.parse(job.payload), phase: 'edges', blockIds };
  return engine.transaction((db) => {
    let userId = payload.source.userMessageId;
    if (!userId) {
      const answer = rows(db, 'SELECT conversation_id,seq FROM message WHERE id=?', [job.source_message_id])[0];
      userId = rows(db, "SELECT id FROM message WHERE conversation_id=? AND role='user' AND superseded=0 AND seq<? ORDER BY seq DESC LIMIT 1", [answer.conversation_id, answer.seq])[0]?.id;
      payload.source.userMessageId = userId;
    }
    if (classification && userId) db.run('UPDATE message SET is_math_question=?,recognized_question=? WHERE id=? AND role=\'user\' AND superseded=0',
      [classification.isMathQuestion ? 1 : 0, classification.recognizedQuestion?.trim() || null, userId]);
    db.run('UPDATE queue_job SET payload=? WHERE id=?', [JSON.stringify(payload), job.id]);
    return { checkpointed: true, messageId: userId, ...(classification ?? {}) };
  });
}

export function completeJob(engine, claim, entries) {
  const job = claimRow(engine, claim);
  const payload = JSON.parse(job.payload);
  const result = Array.isArray(entries) ? { encounters: entries, routes: [] } : entries;
  entries = result?.encounters;
  if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.scenario_id !== 'string'
    || (entry.method_id !== null && typeof entry.method_id !== 'string') || typeof entry.is_main !== 'boolean')) {
    throw new DatabaseError('归位结果无效。', 'invalid_location');
  }
  let routes;
  try { routes = validateQuestionRoutes(result.routes, entries, payload.source); }
  catch { throw new DatabaseError('本题路径缺少可靠依据。', 'invalid_location'); }
  return engine.transaction((db) => {
    const learnerId = rows(db, 'SELECT learner_id FROM conversation WHERE id=?', [job.conversation_id])[0]?.learner_id;
    const now = new Date().toISOString();
    for (const entry of (JSON.parse(job.payload).classificationOnly ? [] : entries)) {
      db.run(`INSERT OR IGNORE INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at,conversation_id,message_id,question_snapshot)
        VALUES(?,?,?,?,?,'ask',?,?,?,?)`,
      [`${job.id}:${entry.scenario_id}:${entry.method_id ?? 'scenario'}`, learnerId, entry.scenario_id, entry.method_id,
        entry.is_main ? 1 : 0, job.created_at, job.conversation_id, job.source_message_id, payload.source.userQuestion || payload.source.question]);
      const targets = [['scenario', entry.scenario_id], ...(entry.method_id ? [['method', entry.method_id]] : [])];
      for (const [type, id] of targets) {
        db.run(`INSERT OR IGNORE INTO mastery(id,learner_id,target_type,target_id,state,success_count,faces,updated_at)
          VALUES(?,?,?,?,'exposed',0,'[]',?)`, [`${learnerId}:${type}:${id}`, learnerId, type, id, now]);
      }
    }
    // Keep existing schema/backup compatibility: route evidence belongs to the
    // specific answer job, and is invalidated with that answer's revision.
    payload.questionRoutes = routes;
    db.run("UPDATE queue_job SET status='done',lease_token=NULL,next_attempt_at=NULL,payload=? WHERE id=?", [JSON.stringify(payload), job.id]);
    return { recorded: JSON.parse(job.payload).classificationOnly ? 0 : entries.length };
  });
}

export function loadQuestionRoutes(engine, conversationId) {
  const db = engine.ensureOpen();
  const jobs = rows(db, `SELECT q.*,m.seq FROM queue_job q JOIN message m ON m.id=q.source_message_id
    WHERE q.conversation_id=? AND q.kind='locate' AND m.superseded=0 ORDER BY m.seq`, [conversationId]);
  const userRows = rows(db, "SELECT id,is_math_question,image_ref FROM message WHERE conversation_id=? AND role='user' AND superseded=0", [conversationId]);
  const validUsers = new Set(userRows.map(row => row.id));
  const grouped = new Map();
  for (const job of jobs) {
    let payload; try { payload = JSON.parse(job.payload); } catch { continue; }
    if (payload.classificationOnly) continue;
    const userId = payload.source.userMessageId;
    if (!validUsers.has(userId)) continue;
    if (job.status !== 'done') {
      const user = userRows.find(row => row.id === userId);
      if (!grouped.has(userId) && (user.is_math_question === 1 || user.image_ref)) grouped.set(userId, { messageId: userId, status: job.status, routes: [] });
      continue;
    }
    const routes = payload.questionRoutes ?? [];
    if (routes.length) for (const route of routes) {
      if (!validUsers.has(route.user_message_id)) continue;
      const anchor = route.user_message_id;
      const previous = grouped.get(anchor) ?? { messageId: anchor, routes: [] };
      const oldRoute = previous.routes.find(old => old.question_index === route.question_index);
      const combined = anchor !== userId ? mergeQuestionRoute(oldRoute, route) : route;
      grouped.set(anchor, { ...previous, status: 'done', ordered: true,
        routes: [...previous.routes.filter(old => old.question_index !== route.question_index), combined].sort((a,b) => a.question_index-b.question_index) });
      if (anchor !== userId) grouped.delete(userId);
    }
    else {
      const encounters = rows(db, 'SELECT scenario_id,method_id FROM encounter WHERE message_id=? ORDER BY rowid', [job.source_message_id]);
      if (encounters.length) grouped.set(userId, { messageId: userId, status: 'done', ordered: false,
        routes: [{ user_message_id: userId, question_index: 1, steps: encounters }] });
    }
  }
  return [...grouped.values()];
}

export function retryQuestionRoutes(engine, messageId) {
  const db = engine.ensureOpen();
  const jobs = rows(db, `SELECT q.* FROM queue_job q JOIN message a ON a.id=q.source_message_id
    JOIN message u ON u.conversation_id=a.conversation_id WHERE u.id=? AND u.role='user'
    AND u.superseded=0 AND a.superseded=0 AND q.status='failed' AND q.kind='locate'`, [messageId]);
  const eligible = jobs.filter(job => {
    const payload = JSON.parse(job.payload);
    return !payload.classificationOnly && payload.source.userMessageId === messageId;
  });
  return engine.transaction(database => {
    for (const job of eligible) database.run("UPDATE queue_job SET status='pending',attempts=0,lease_token=NULL,next_attempt_at=NULL WHERE id=?", [job.id]);
    return { retried: eligible.length };
  });
}

export function failJob(engine, claim, { cancelled = false } = {}) {
  const job = claimRow(engine, claim);
  const terminal = !cancelled && job.attempts >= MAX_ATTEMPTS;
  const attempts = cancelled ? Math.max(0, job.attempts - 1) : job.attempts;
  const nextAttempt = cancelled ? null : new Date(Date.now() + 5000 * 2 ** (job.attempts - 1)).toISOString();
  return engine.transaction((db) => {
    db.run('UPDATE queue_job SET status=?,attempts=?,lease_token=NULL,next_attempt_at=? WHERE id=?',
      [terminal ? 'failed' : 'pending', attempts, terminal ? null : nextAttempt, job.id]);
    return { terminal };
  });
}

export function loadTrail(engine) {
  const db = engine.ensureOpen();
  const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
  return {
    mastery: rows(db, 'SELECT * FROM mastery WHERE learner_id=?', [learnerId]).map((row) => ({
      targetType: row.target_type, targetId: row.target_id, state: row.state,
      successCount: row.success_count, faces: JSON.parse(row.faces), updatedAt: row.updated_at,
    })),
    encounters: rows(db, `SELECT e.*, COALESCE(e.question_snapshot,(SELECT content FROM message u WHERE u.conversation_id=e.conversation_id
      AND u.role='user' ORDER BY seq LIMIT 1),(SELECT json_extract(question,'$.question') FROM practice_item p WHERE p.id=e.practice_item_id))
      AS question FROM encounter e WHERE e.learner_id=? ORDER BY e.occurred_at,e.id`, [learnerId]).map((row) => ({
      id: row.id, scenarioId: row.scenario_id, methodId: row.method_id, isMain: Boolean(row.is_main),
      source: row.source, occurredAt: row.occurred_at, conversationId: row.conversation_id, messageId: row.message_id, practiceItemId: row.practice_item_id, question: row.question,
    })),
  };
}
