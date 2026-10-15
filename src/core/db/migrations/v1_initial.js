import { APPLICATION_ID } from '../constants.js';

function columns(db, table) {
  return new Set((db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => row[1]));
}

export function migrateV1(db, schemaSql, inferImageMime) {
  db.run('BEGIN');
  try {
    const messageColumns = columns(db, 'message');
    if (messageColumns.size) {
      const additions = {
        seq: 'INTEGER NOT NULL DEFAULT 0',
        status: "TEXT NOT NULL DEFAULT 'complete'",
        error: 'TEXT',
        recheck_of: 'TEXT REFERENCES message(id) ON DELETE SET NULL',
        image_corrected: 'INTEGER NOT NULL DEFAULT 0',
      };
      for (const [name, type] of Object.entries(additions)) {
        if (!messageColumns.has(name)) db.run(`ALTER TABLE message ADD COLUMN ${name} ${type}`);
      }
      if (!messageColumns.has('seq')) {
        db.run(`UPDATE message SET seq = (
          SELECT count(*) - 1 FROM message earlier
          WHERE earlier.conversation_id = message.conversation_id
            AND (earlier.created_at < message.created_at
              OR (earlier.created_at = message.created_at AND earlier.rowid <= message.rowid))
        )`);
      }
    }
    const imageColumns = columns(db, 'image');
    if (imageColumns.size) {
      if (!imageColumns.has('name')) db.run("ALTER TABLE image ADD COLUMN name TEXT NOT NULL DEFAULT '图片'");
      if (!imageColumns.has('mime')) {
        db.run("ALTER TABLE image ADD COLUMN mime TEXT NOT NULL DEFAULT ''");
        const statement = db.prepare('SELECT id, blob FROM image');
        const rows = [];
        try { while (statement.step()) rows.push(statement.getAsObject()); }
        finally { statement.free(); }
        for (const row of rows) db.run('UPDATE image SET mime = ? WHERE id = ?', [inferImageMime(row.blob), row.id]);
      }
    }
    db.run(schemaSql);
    db.run(`PRAGMA application_id = ${APPLICATION_ID}`);
    db.run('PRAGMA user_version = 1');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
