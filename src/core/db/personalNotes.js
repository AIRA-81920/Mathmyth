import { DatabaseError } from './errors.js';
import { rows } from './validation.js';

const learner = (db) => rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
const decode = (row) => ({ id: row.id, content: row.content, targetType: row.target_type, targetId: row.target_id, createdAt: row.created_at, updatedAt: row.updated_at });
export function validNoteTarget(type, id) {
  return type === null && id === null || typeof id === 'string' && id.length < 180
    && (type === 'scenario' && /^S\.[A-Za-z0-9_.]+$/.test(id) || type === 'method' && /^M\.[A-Za-z0-9_.]+$/.test(id));
}
export function listPersonalNotes(engine) {
  const db = engine.ensureOpen();
  return rows(db, 'SELECT * FROM personal_note WHERE learner_id=? ORDER BY updated_at DESC,id', [learner(db)]).map(decode);
}
export function savePersonalNote(engine, input) {
  const content = typeof input?.content === 'string' ? input.content.trim() : '';
  const targetType = input?.targetType ?? null, targetId = input?.targetId ?? null;
  if (!content || content.length > 5000 || !validNoteTarget(targetType, targetId)) throw new DatabaseError('请填写易错点，并选择完整的关联内容；每条最多5000字。', 'invalid_personal_note');
  return engine.transaction((db) => {
    const owner = learner(db), now = new Date().toISOString();
    const id = input.id ?? `note-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    if (input.id !== undefined) {
      if (!rows(db, 'SELECT id FROM personal_note WHERE id=? AND learner_id=?', [id, owner]).length) throw new DatabaseError('这条易错点已不存在，请重新打开列表。', 'personal_note_not_found');
      db.run('UPDATE personal_note SET content=?,target_type=?,target_id=?,updated_at=? WHERE id=? AND learner_id=?', [content, targetType, targetId, now, id, owner]);
    } else db.run('INSERT INTO personal_note(id,learner_id,content,target_type,target_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id, owner, content, targetType, targetId, now, now]);
    return decode(rows(db, 'SELECT * FROM personal_note WHERE id=? AND learner_id=?', [id, owner])[0]);
  });
}
export function deletePersonalNote(engine, id) {
  if (typeof id !== 'string') throw new DatabaseError('这条易错点已不存在，请重新打开列表。', 'personal_note_not_found');
  return engine.transaction((db) => {
    db.run('DELETE FROM personal_note WHERE id=? AND learner_id=?', [id, learner(db)]);
    return { deleted: true };
  });
}
