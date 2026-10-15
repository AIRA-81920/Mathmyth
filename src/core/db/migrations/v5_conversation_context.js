export function migrateV5(db) {
  db.run("ALTER TABLE conversation ADD COLUMN method_id TEXT");
  db.run("ALTER TABLE conversation ADD COLUMN title_status TEXT NOT NULL DEFAULT 'legacy' CHECK(title_status IN ('legacy','pending','auto','manual','failed'))");
  db.run('PRAGMA user_version = 5');
}
