import { DatabaseError } from './errors.js';
import { rows } from './validation.js';
import { sourceQuestion, requestMessageQuestionClassification as requestClassification } from '../queue/dbJobs.js';
import { normalizedQuestion } from '../mastery/fingerprint.js';

const learner = (db) => rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
const messageRow = (db, id) => rows(db, "SELECT * FROM message WHERE id=? AND role='user'", [id])[0];
function pruneImages(db) {
  db.run('DELETE FROM image WHERE id NOT IN(SELECT image_ref FROM message WHERE image_ref IS NOT NULL) AND id NOT IN(SELECT image_ref FROM message_attachment WHERE image_ref IS NOT NULL) AND id NOT IN(SELECT image_ref FROM starred_question_image)');
}
function decode(engine, row, includeImages = true) {
  const imageIds = rows(engine.ensureOpen(), 'SELECT image_ref FROM starred_question_image WHERE starred_question_id=? ORDER BY seq', [row.id]).map((image) => image.image_ref);
  return { id: row.id, questionKey: row.question_key, sourceMessageId: row.source_message_id,
    content: row.content, recognizedQuestion: row.recognized_question, createdAt: row.created_at,
    imageIds, hasImages: imageIds.length > 0,
    images: includeImages ? imageIds.map((imageId) => engine.loadImage(imageId)) : [] };
}

export function listStarredQuestions(engine, { includeImages = true } = {}) {
  const db = engine.ensureOpen();
  return rows(db, 'SELECT * FROM starred_question WHERE learner_id=? ORDER BY created_at DESC,id', [learner(db)]).map((row) => decode(engine, row, includeImages));
}

export function loadStarredQuestion(engine, id) {
  const db = engine.ensureOpen();
  const row = rows(db, 'SELECT * FROM starred_question WHERE id=? AND learner_id=?', [id, learner(db)])[0];
  if (!row) throw new DatabaseError('这道收藏题目已不存在。', 'question_star_not_found');
  return decode(engine, row);
}

export function getMessageQuestionClassification(engine, id) {
  const db = engine.ensureOpen(), message = messageRow(db, id);
  if (!message) throw new DatabaseError('这条消息已不存在。', 'message_not_found');
  const star = rows(db, 'SELECT id FROM starred_question WHERE learner_id=? AND (source_message_id=? OR question_key=?) LIMIT 1', [learner(db), id, message.question_key])[0];
  return { messageId: id, isMathQuestion: message.is_math_question === null ? null : Boolean(message.is_math_question),
    recognizedQuestion: message.recognized_question, questionKey: message.question_key,
    starred: Boolean(star), starId: star?.id ?? null,
    status: message.is_math_question === null ? 'pending' : 'complete' };
}

export async function requestMessageQuestionClassification(engine, id) {
  await engine.transaction((db) => requestClassification(db, id));
  return getMessageQuestionClassification(engine, id);
}

async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function snapshot(db, id) {
  const message = messageRow(db, id);
  if (!message || message.superseded) throw new DatabaseError('这条消息已被替换，请收藏当前题目。', 'message_not_found');
  if (message.is_math_question !== 1) throw new DatabaseError('请等题目识别完成后再收藏。', 'question_not_confirmed');
  const imageIds = [...new Set([message.image_ref,
    ...rows(db, 'SELECT image_ref FROM message_attachment WHERE message_id=? AND image_ref IS NOT NULL ORDER BY seq', [id]).map((row) => row.image_ref)].filter(Boolean))];
  return { message, content: sourceQuestion(db, message), imageIds,
    imageBytes: imageIds.map((imageId) => rows(db, 'SELECT blob FROM image WHERE id=?', [imageId])[0].blob) };
}

export async function setQuestionStar(engine, { messageId, starred = true } = {}) {
  if (typeof messageId !== 'string' || typeof starred !== 'boolean') throw new DatabaseError('收藏请求无效。', 'invalid_question_star');
  if (!starred) {
    return engine.transaction((db) => {
      const message = messageRow(db, messageId);
      if (!message) throw new DatabaseError('这条消息已不存在。', 'message_not_found');
      db.run('DELETE FROM starred_question WHERE learner_id=? AND (source_message_id=? OR question_key=?)', [learner(db), messageId, message.question_key]);
      pruneImages(db);
      return { starred: false, messageId };
    });
  }
  const source = snapshot(engine.ensureOpen(), messageId);
  const imageHashes = await Promise.all(source.imageBytes.map(digest));
  // A versioned identity follows the actual question and image bytes, never the
  // conversation ID. Editing creates a new message and leaves this snapshot intact.
  const questionKey = `chat-question-v1:${await digest(JSON.stringify([normalizedQuestion(source.content), imageHashes]))}`;
  const id = await engine.transaction((db) => {
    const current = snapshot(db, messageId), owner = learner(db);
    if (current.content !== source.content || JSON.stringify(current.imageIds) !== JSON.stringify(source.imageIds)) throw new DatabaseError('题目已变更，请重新收藏。', 'question_changed');
    let star = rows(db, 'SELECT id FROM starred_question WHERE learner_id=? AND question_key=?', [owner, questionKey])[0];
    if (!star) {
      star = { id: `star-${globalThis.crypto.randomUUID()}` };
      db.run('INSERT INTO starred_question(id,learner_id,question_key,source_message_id,content,recognized_question,created_at) VALUES(?,?,?,?,?,?,?)',
        [star.id, owner, questionKey, messageId, source.content, source.message.recognized_question, new Date().toISOString()]);
      source.imageIds.forEach((imageId, index) => db.run('INSERT INTO starred_question_image(starred_question_id,seq,image_ref) VALUES(?,?,?)', [star.id, index, imageId]));
    }
    db.run('UPDATE message SET question_key=? WHERE id=?', [questionKey, messageId]);
    return star.id;
  });
  const row = rows(engine.ensureOpen(), 'SELECT * FROM starred_question WHERE id=?', [id])[0];
  return { starred: true, messageId, ...decode(engine, row) };
}

export function removeStarredQuestion(engine, id) {
  if (typeof id !== 'string') throw new DatabaseError('收藏题目不存在。', 'question_star_not_found');
  return engine.transaction((db) => { db.run('DELETE FROM starred_question WHERE id=? AND learner_id=?', [id, learner(db)]); pruneImages(db); return { deleted: true }; });
}
