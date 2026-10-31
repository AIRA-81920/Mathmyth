// Review is an explicit learner choice. It is independent of the transient
// model queue, and survives exports and deletion of chat text alone.
export function migrateV11(db) {
  db.run(`CREATE TABLE IF NOT EXISTS practice_review (
    id TEXT PRIMARY KEY NOT NULL,
    learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
    source_item_id TEXT NOT NULL UNIQUE REFERENCES practice_item(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','cancelled','completed')),
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_item_id TEXT REFERENCES practice_item(id) ON DELETE SET NULL
  ); CREATE INDEX IF NOT EXISTS practice_review_by_learner ON practice_review(learner_id,status,due_at);
  PRAGMA user_version=11`);
}
