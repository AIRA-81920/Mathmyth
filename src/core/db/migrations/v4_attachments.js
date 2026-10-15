export function migrateV4(db) {
  const add = (table, name, definition) => {
    if (!db.exec(`PRAGMA table_info(${table})`)[0].values.some((row) => row[1] === name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  db.run('BEGIN');
  try {
    add('conversation', 'pinned', 'INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1))');
    add('encounter', 'question_snapshot', 'TEXT');
    add('practice_run', 'generation_status', "TEXT NOT NULL DEFAULT 'complete' CHECK(generation_status IN ('preparing','complete','failed'))");
    db.run(`CREATE TABLE IF NOT EXISTS document(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,
      blob BLOB NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_attachment(message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK(seq>=0),image_ref TEXT REFERENCES image(id),document_ref TEXT REFERENCES document(id),
      PRIMARY KEY(message_id,seq),CHECK((image_ref IS NOT NULL) != (document_ref IS NOT NULL)));
      CREATE INDEX IF NOT EXISTS attachment_image ON message_attachment(image_ref);
      CREATE INDEX IF NOT EXISTS attachment_document ON message_attachment(document_ref);`);
    db.run('PRAGMA user_version=4'); db.run('COMMIT');
  } catch (error) { db.run('ROLLBACK'); throw error; }
}
