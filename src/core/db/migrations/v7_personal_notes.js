export function migrateV7(db) {
  db.run(`CREATE TABLE IF NOT EXISTS personal_note (
    id TEXT PRIMARY KEY NOT NULL,
    learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0 AND length(content) <= 5000),
    target_type TEXT CHECK(target_type IS NULL OR target_type IN ('scenario','method')),
    target_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((target_type IS NULL AND target_id IS NULL) OR (target_type IS NOT NULL AND target_id IS NOT NULL AND length(trim(target_id)) > 0))
  );
  CREATE INDEX IF NOT EXISTS personal_note_by_learner_updated ON personal_note(learner_id, updated_at DESC);
  PRAGMA user_version = 7`);
}
