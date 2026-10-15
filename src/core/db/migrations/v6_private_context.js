export function migrateV6(db) {
  const columns = db.exec('PRAGMA table_info(message)')[0].values.map((row) => row[1]);
  if (!columns.includes('reasoning_content')) db.run('ALTER TABLE message ADD COLUMN reasoning_content TEXT');
  db.run('PRAGMA user_version = 6');
}
