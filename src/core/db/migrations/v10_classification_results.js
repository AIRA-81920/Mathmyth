import { archiveClassifications, archiveClassification } from '../../queue/classificationResults.js';
import { rows } from '../validation.js';

export function migrateV10(db) {
  db.run(`CREATE TABLE IF NOT EXISTS classification_result (
    job_id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('done','failed')),
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS classification_by_answer ON classification_result(source_message_id);
  CREATE INDEX IF NOT EXISTS classification_by_conversation ON classification_result(conversation_id);
  PRAGMA user_version=10`);
  archiveClassifications(db);
  // Older builds may already have removed the queue row. Encounters still
  // prove classification occurred; retain them as unordered knowledge links.
  for (const answer of rows(db, `SELECT DISTINCT m.id,m.conversation_id,m.created_at FROM encounter e JOIN message m ON m.id=e.message_id
    WHERE m.role='assistant' AND NOT EXISTS(SELECT 1 FROM queue_job q WHERE q.source_message_id=m.id AND q.kind='locate')
    AND NOT EXISTS(SELECT 1 FROM classification_result r WHERE r.source_message_id=m.id)`)) {
    archiveClassification(db, { id: `locate:${answer.id}`, kind: 'locate', status: 'done', source_message_id: answer.id,
      conversation_id: answer.conversation_id, created_at: answer.created_at, payload: '{"source":{}}' });
  }
}
