import { rows } from '../db/validation.js';

// Classification is a learning record. A queue row is only its execution lease.
export function archiveClassification(db, job) {
  if (job.kind !== 'locate' || !job.source_message_id || !job.conversation_id || !['done', 'failed'].includes(job.status)) return;
  let payload;
  try { payload = JSON.parse(job.payload); } catch { return; }
  const existing = rows(db, 'SELECT job_id FROM classification_result WHERE job_id=?', [job.id])[0];
  if (payload?.classificationOnly && existing) return;
  const source = payload?.source ?? {};
  const userId = source.userMessageId ?? rows(db, `SELECT u.id FROM message u JOIN message a ON a.conversation_id=u.conversation_id
    WHERE a.id=? AND u.role='user' AND u.seq<a.seq AND u.superseded=0 ORDER BY u.seq DESC LIMIT 1`, [job.source_message_id])[0]?.id;
  const compact = { source: { userMessageId: userId }, ...(payload?.classificationOnly ? { classificationOnly: true } : {}),
    ...(Array.isArray(payload?.questionRoutes) ? { questionRoutes: payload.questionRoutes } : {}) };
  db.run(`INSERT INTO classification_result(job_id,conversation_id,source_message_id,status,payload,created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,payload=excluded.payload`,
  [job.id, job.conversation_id, job.source_message_id, job.status, JSON.stringify(compact), job.created_at]);
}

export function archiveClassifications(db) {
  for (const job of rows(db, `SELECT q.* FROM queue_job q LEFT JOIN classification_result r ON r.job_id=q.id
    WHERE q.kind='locate' AND q.status IN ('done','failed') AND (r.job_id IS NULL OR r.status<>q.status)
    ORDER BY q.created_at,q.rowid`)) archiveClassification(db, job);
}
