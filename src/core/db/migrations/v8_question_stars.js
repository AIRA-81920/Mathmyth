import { rows } from '../validation.js';

export function migrateV8(db) {
  const columns = new Set(rows(db, 'PRAGMA table_info(message)').map((column) => column.name));
  const additions = {
    is_math_question: 'INTEGER CHECK(is_math_question IS NULL OR is_math_question IN (0,1))',
    recognized_question: 'TEXT', question_key: 'TEXT',
    superseded: 'INTEGER NOT NULL DEFAULT 0 CHECK(superseded IN (0,1))',
    revision_of: 'TEXT REFERENCES message(id) ON DELETE SET NULL',
    revision_action: "TEXT CHECK(revision_action IS NULL OR revision_action IN ('edit','retry'))",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) db.run(`ALTER TABLE message ADD COLUMN ${name} ${definition}`);
  }
  db.run(`CREATE TABLE IF NOT EXISTS starred_question (
    id TEXT PRIMARY KEY NOT NULL,
    learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
    question_key TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    content TEXT NOT NULL,
    recognized_question TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(learner_id,question_key)
  );
  CREATE TABLE IF NOT EXISTS starred_question_image (
    starred_question_id TEXT NOT NULL REFERENCES starred_question(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK(seq>=0),
    image_ref TEXT NOT NULL REFERENCES image(id),
    PRIMARY KEY(starred_question_id,seq)
  );
  CREATE INDEX IF NOT EXISTS starred_question_by_learner_created ON starred_question(learner_id,created_at DESC);
  PRAGMA user_version = 8`);
}
