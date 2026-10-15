export function migrateV9(db) {
  db.run(`CREATE TABLE IF NOT EXISTS chat_practice (
    run_id TEXT PRIMARY KEY NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL UNIQUE REFERENCES practice_item(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversation(id) ON DELETE SET NULL,
    message_id TEXT UNIQUE REFERENCES message(id) ON DELETE SET NULL,
    source_message_id TEXT REFERENCES message(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  ); PRAGMA user_version=9`);
}
