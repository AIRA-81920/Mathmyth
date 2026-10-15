export function migrateV3(db) {
  db.run('BEGIN');
  try {
    const columns = new Set(db.exec('PRAGMA table_info(encounter)')[0].values.map((row) => row[1]));
    if (!columns.has('practice_item_id')) db.run('ALTER TABLE encounter ADD COLUMN practice_item_id TEXT REFERENCES practice_item(id) ON DELETE CASCADE');
    db.run(`CREATE TABLE IF NOT EXISTS practice_credit (
      learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('scenario','method')),
      target_id TEXT NOT NULL, question_key TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(learner_id,target_type,target_id,question_key)
    )`);
    db.run('PRAGMA user_version=3');
    db.run('COMMIT');
  } catch (error) { db.run('ROLLBACK'); throw error; }
}
