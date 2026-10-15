export function migrateV2(db) {
  db.run('BEGIN');
  try {
    for (const [table, additions] of Object.entries({
      encounter: { conversation_id: 'TEXT REFERENCES conversation(id) ON DELETE CASCADE', message_id: 'TEXT REFERENCES message(id) ON DELETE CASCADE' },
      queue_job: { source_message_id: 'TEXT REFERENCES message(id) ON DELETE CASCADE', lease_token: 'TEXT', next_attempt_at: 'TEXT' },
    })) {
      const columns = new Set(db.exec(`PRAGMA table_info(${table})`)[0].values.map((row) => row[1]));
      for (const [name, type] of Object.entries(additions)) {
        if (!columns.has(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
    }
    db.run('CREATE INDEX IF NOT EXISTS queue_location_source ON queue_job(source_message_id)');
    db.run('CREATE INDEX IF NOT EXISTS encounter_by_message ON encounter(message_id)');
    db.run('PRAGMA user_version = 2');
    db.run('COMMIT');
  } catch (error) { db.run('ROLLBACK'); throw error; }
}
