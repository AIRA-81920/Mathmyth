import { rows } from '../db/validation.js';
import { DatabaseError } from '../db/errors.js';
import { wantsChatPractice, chatRouteLetters } from '../chat/practiceIntent.js';
import { validateQuestionRoutes, mergeQuestionRoute } from '../chat/questionRoutes.js';
import { archiveClassification, archiveClassifications } from './classificationResults.js';
import { answerRouteSnapshots, STALL_MS } from '../chat/answerRoutes.js';

export const MAX_ATTEMPTS = 3;
export function sourceQuestion(db, message) {
  if (!message) return '';
  const documents = rows(db, `SELECT d.name,d.text FROM message_attachment a JOIN document d ON a.document_ref=d.id WHERE a.message_id=? ORDER BY a.seq`, [message.id]);
  return [message.content, ...documents.filter((item) => item.text.trim()).map((item) => `附件《${item.name}》：\n${item.text}`)].filter(Boolean).join('\n\n');
}

export function enqueueAnswers(db, conversationIds, { retryAnswerIds = [] } = {}) {
  if (conversationIds?.length === 0) return 0;
  const condition = conversationIds ? ` AND m.conversation_id IN (${conversationIds.map(() => '?').join(',')})` : '';
  const retry = retryAnswerIds.length ? ` OR m.id IN (${retryAnswerIds.map(() => '?').join(',')})` : '';
  const answers = rows(db, `SELECT m.* FROM message m LEFT JOIN queue_job q
    ON q.source_message_id=m.id AND q.kind='locate'
    WHERE m.role='assistant' AND m.superseded=0 AND m.status='complete' AND trim(m.content)<>'' AND q.id IS NULL
    AND (NOT EXISTS(SELECT 1 FROM classification_result r WHERE r.source_message_id=m.id)${retry})
    AND NOT EXISTS(SELECT 1 FROM chat_practice cp WHERE cp.message_id=m.id)
    AND EXISTS(SELECT 1 FROM conversation c WHERE c.id=m.conversation_id AND c.method_id IS NULL)${condition}`, [...retryAnswerIds, ...(conversationIds ?? [])]);
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
        // D7：后台分类改为纯文本。图片题的用户消息正文在转写完成后已含完整题面
        // （appStore 把 <mathmyth_question> 内容写进正文），再带图片只是白付 token，
        // 也让"删图"与后台任务互相牵制。这里不再附加 imageId。
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
  const added = enqueueAnswers(db, [message.conversation_id], { retryAnswerIds: [answer.id] });
  const job = rows(db, "SELECT * FROM queue_job WHERE source_message_id=? AND kind='locate'", [answer.id])[0];
  if (!job || job.status === 'running' || (job.status === 'pending' && !added)) return false;
  const payload = JSON.parse(job.payload);
  payload.phase = 'blocks'; payload.blockIds = [];
  payload.source.userMessageId = message.id; payload.source.userQuestion = sourceQuestion(db, message);
  payload.classificationOnly = true;
  db.run("UPDATE queue_job SET status='pending',attempts=0,payload=?,lease_token=NULL,next_attempt_at=NULL WHERE id=?", [JSON.stringify(payload), job.id]);
  return true;
}

// 卡在 pending 超过这么久就判失败：给用户一个"重新整理"的出口，
// 免得重建库之后界面永远显示"整理中"（以前只有切会话才能救）。
export const STALE_JOB_MINUTES = STALL_MS / 60000;
export function staleJobCutoff(now = Date.now()) {
  return new Date(now - STALE_JOB_MINUTES * 60000).toISOString();
}
export function recoverJobs(db) {
  const cancelled = cancelSupersededJobs(db);
  db.run(`UPDATE queue_job SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,lease_token=NULL
    WHERE kind='locate' AND (status='running' OR (status='pending' AND attempts>=?))`, [MAX_ATTEMPTS, MAX_ATTEMPTS]);
  return db.getRowsModified() > 0 || cancelled > 0;
}

// D8 启动清理：只删除"已完成/已失败且创建超过 7 天"的历史任务。
// 运行中（running）与待执行（pending）的任务永不删除，避免误伤在跑的工作。
export const JOB_RETENTION_DAYS = 7;
export function pruneJobs(db, now = new Date()) {
  archiveClassifications(db);
  const cutoff = new Date(now.getTime() - JOB_RETENTION_DAYS * 86400000).toISOString();
  db.run("DELETE FROM queue_job WHERE status IN ('done','failed') AND created_at < ?", [cutoff]);
  return db.getRowsModified();
}

function claimRow(engine, claim) {
  const job = rows(engine.ensureOpen(), "SELECT q.* FROM queue_job q JOIN message m ON q.source_message_id=m.id WHERE q.id=? AND q.kind='locate' AND m.superseded=0", [claim?.id ?? ''])[0];
  if (!job || job.status !== 'running' || !claim?.leaseToken || job.lease_token !== claim.leaseToken) {
    throw new DatabaseError('后台任务已经失效。', 'stale_job');
  }
  return job;
}

export async function claimNextJob(engine, now = new Date().toISOString(), { conversationId = null } = {}) {
  const job = rows(engine.ensureOpen(), `SELECT q.* FROM queue_job q JOIN message m ON q.source_message_id=m.id WHERE q.kind='locate' AND q.status='pending' AND m.superseded=0
    AND q.attempts<? AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?)
    ORDER BY CASE WHEN q.conversation_id=? THEN 0 ELSE 1 END,
      CASE WHEN q.conversation_id=? THEN m.seq END DESC,q.created_at,q.id LIMIT 1`, [MAX_ATTEMPTS, now, conversationId, conversationId])[0];
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
    // E2：claim 不是恢复锚点，只在内存提交即可——checkpoint（携带 attempts 与 phase）
    // 才是崩溃后用来判断"是否已花过一次模型调用"的落盘点。
  }, { durable: false });
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
    // Keep answer-specific route evidence independently of the execution lease.
    payload.questionRoutes = routes;
    db.run("UPDATE queue_job SET status='done',lease_token=NULL,next_attempt_at=NULL,payload=? WHERE id=?", [JSON.stringify(payload), job.id]);
    archiveClassification(db, { ...job, status: 'done', payload: JSON.stringify(payload) });
    return { recorded: JSON.parse(job.payload).classificationOnly ? 0 : entries.length };
  });
}

export function loadAnswerQuestionRoutes(engine, conversationId) {
  const db = engine.ensureOpen();
  const records = rows(db, `SELECT r.job_id AS id,r.*,m.seq FROM classification_result r JOIN message m ON m.id=r.source_message_id
    WHERE r.conversation_id=? AND m.superseded=0`, [conversationId]);
  const byId = new Map(records.map(record => [record.id, record]));
  for (const job of rows(db, `SELECT q.*,m.seq FROM queue_job q JOIN message m ON m.id=q.source_message_id
    WHERE q.conversation_id=? AND q.kind='locate' AND m.superseded=0`, [conversationId])) {
    let payload; try { payload = JSON.parse(job.payload); } catch { continue; }
    if (!payload.classificationOnly) byId.set(job.id, job);
  }
  const users = rows(db, "SELECT id,is_math_question FROM message WHERE conversation_id=? AND role='user' AND superseded=0", [conversationId]);
  const encounters = rows(db, 'SELECT message_id,scenario_id,method_id FROM encounter WHERE conversation_id=? ORDER BY rowid', [conversationId]);
  return answerRouteSnapshots([...byId.values()], users, encounters);
}

export function loadQuestionRoutes(engine, conversationId) {
  const db = engine.ensureOpen();
  const records = rows(db, `SELECT r.job_id AS id,r.*,m.seq FROM classification_result r JOIN message m ON m.id=r.source_message_id
    WHERE r.conversation_id=? AND m.superseded=0`, [conversationId]);
  const byId = new Map(records.map(record => [record.id, record]));
  for (const job of rows(db, `SELECT q.*,m.seq FROM queue_job q JOIN message m ON m.id=q.source_message_id
    WHERE q.conversation_id=? AND q.kind='locate' AND m.superseded=0`, [conversationId])) {
    let classificationOnly = false; try { classificationOnly = JSON.parse(job.payload)?.classificationOnly; } catch { /* handled below */ }
    if (!classificationOnly || !byId.has(job.id)) byId.set(job.id, job);
  }
  const jobs = [...byId.values()].sort((a,b) => a.seq-b.seq);
  const userRows = rows(db, "SELECT id,is_math_question,image_ref FROM message WHERE conversation_id=? AND role='user' AND superseded=0", [conversationId]);
  const validUsers = new Set(userRows.map(row => row.id));
  const grouped = new Map();
  for (const job of jobs) {
    let payload; try { payload = JSON.parse(job.payload); } catch { continue; }
    if (!payload || payload.classificationOnly) continue;
    const userId = payload.source?.userMessageId;
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
  return engine.transaction(database => {
    let recreated = 0;
    const requeuedAt = new Date().toISOString();
    const archived = rows(database, `SELECT DISTINCT r.source_message_id,r.conversation_id FROM classification_result r
    JOIN message a ON a.id=r.source_message_id JOIN message u ON u.conversation_id=a.conversation_id
    WHERE u.id=? AND u.role='user' AND u.superseded=0 AND a.superseded=0 AND r.status='failed'
    AND json_extract(r.payload,'$.source.userMessageId')=? AND COALESCE(json_extract(r.payload,'$.classificationOnly'),0)=0`, [messageId, messageId]);
    // 先查"卡住的旧任务"，再重建——顺序反了会把刚重建出来的任务当成旧的，
    // 因为重建的任务继承了原答案的 created_at。
    // 除了 failed，也认"pending 卡太久"的：界面在 stalled 时给的就是这个按钮，
    // 点下去必须真能重新排上，否则按钮等于装饰。
    const jobs = rows(database, `SELECT q.* FROM queue_job q JOIN message a ON a.id=q.source_message_id
    JOIN message u ON u.conversation_id=a.conversation_id WHERE u.id=? AND u.role='user'
    AND u.superseded=0 AND a.superseded=0 AND q.kind='locate'
    AND (q.status='failed' OR (q.status IN ('pending','running')
      AND COALESCE(json_extract(q.payload,'$.requeuedAt'),q.created_at) < ?))`, [messageId, staleJobCutoff()]);
    const eligible = jobs.filter(job => {
      const payload = JSON.parse(job.payload);
      return !payload.classificationOnly && payload.source?.userMessageId === messageId;
    });
    for (const record of archived) {
      recreated += enqueueAnswers(database, [record.conversation_id], { retryAnswerIds: [record.source_message_id] });
      database.run("UPDATE queue_job SET payload=json_set(payload,'$.requeuedAt',?) WHERE source_message_id=? AND status='pending'", [requeuedAt, record.source_message_id]);
      database.run("DELETE FROM classification_result WHERE source_message_id=? AND status='failed'", [record.source_message_id]);
    }
    for (const job of eligible) database.run("UPDATE queue_job SET status='pending',attempts=0,lease_token=NULL,next_attempt_at=NULL,payload=json_set(json_remove(payload,'$.cancels'),'$.requeuedAt',?) WHERE id=?", [requeuedAt, job.id]);
    return { retried: eligible.length + recreated };
  });
}

// 取消（界面正忙、切会话等）不该消耗"模型调用"次数——那 3 次留给真失败。
// 但以前取消会把 attempts 减回去，于是 task 可以无限 pending，界面永远"整理中"。
// 现在取消单独计数，超过 MAX_CANCELS 就判为 failed，让用户能点"重新整理"。
export const MAX_CANCELS = 6;
export function failJob(engine, claim, { cancelled = false } = {}) {
  const job = claimRow(engine, claim);
  if (cancelled) {
    let payload = {};
    try { payload = JSON.parse(job.payload) ?? {}; } catch { payload = {}; }
    const cancels = Number(payload.cancels ?? 0) + 1;
    const terminal = cancels >= MAX_CANCELS;
    payload.cancels = cancels;
    // 取消仍然把 attempts 还回去：那 3 次是留给"真的调用失败"的预算。
    // 以前少了取消计数，于是回滚让任务可以无限 pending——那才是界面永远"整理中"的根。
    const attempts = Math.max(0, job.attempts - 1);
    return engine.transaction((db) => {
      // 取消后立刻可以重新排（队列自己每 pollDelay 才轮询一次，不需要额外退避）。
      db.run('UPDATE queue_job SET status=?,attempts=?,lease_token=NULL,next_attempt_at=NULL,payload=? WHERE id=?',
        [terminal ? 'failed' : 'pending', attempts, JSON.stringify(payload), job.id]);
      if (terminal) archiveClassification(db, { ...job, status: 'failed', payload: JSON.stringify(payload) });
      return { terminal, cancels };
    });
  }
  const terminal = job.attempts >= MAX_ATTEMPTS;
  const nextAttempt = new Date(Date.now() + 5000 * 2 ** (job.attempts - 1)).toISOString();
  return engine.transaction((db) => {
    db.run('UPDATE queue_job SET status=?,attempts=?,lease_token=NULL,next_attempt_at=? WHERE id=?',
      [terminal ? 'failed' : 'pending', job.attempts, terminal ? null : nextAttempt, job.id]);
    if (terminal) archiveClassification(db, { ...job, status: 'failed' });
    return { terminal };
  });
}

// 诊断只读统计：给隐藏诊断页用。绝不写库，也不改任何任务状态。
export function queueStats(engine, now = Date.now()) {
  const db = engine.ensureOpen();
  const counts = new Map();
  for (const row of rows(db, 'SELECT status,count(*) AS total FROM queue_job GROUP BY status')) counts.set(row.status, row.total);
  // claimable 用与 claimNextJob 完全相同的条件，只是取数量：能直接回答
  // "任务都在排队却一个也领不到" 是不是 SQL 条件本身造成的。
  const claimable = rows(db, `SELECT count(*) AS total FROM queue_job q JOIN message m ON q.source_message_id=m.id
    WHERE q.kind='locate' AND q.status='pending' AND m.superseded=0 AND q.attempts<?
    AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?)`, [MAX_ATTEMPTS, new Date(now).toISOString()])[0]?.total ?? 0;
  const oldest = rows(db, "SELECT id,created_at FROM queue_job WHERE kind='locate' AND status='pending' ORDER BY created_at,id LIMIT 1")[0];
  const createdAt = oldest?.created_at ?? null;
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  return {
    pending: counts.get('pending') ?? 0, running: counts.get('running') ?? 0,
    done: counts.get('done') ?? 0, failed: counts.get('failed') ?? 0,
    claimable, createdAtOfOldestPending: createdAt,
    ageOfOldestPendingMs: Number.isFinite(parsed) ? Math.max(0, now - parsed) : null,
  };
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
