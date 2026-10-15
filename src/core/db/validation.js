import { APPLICATION_ID, LEGACY_CORE_COLUMNS, REQUIRED_COLUMNS, V1_REQUIRED_COLUMNS, V2_REQUIRED_COLUMNS, V3_REQUIRED_COLUMNS, V4_REQUIRED_COLUMNS, V5_REQUIRED_COLUMNS, V6_REQUIRED_COLUMNS, V7_REQUIRED_COLUMNS, V8_REQUIRED_COLUMNS, SCHEMA_VERSION } from './constants.js';
import { DatabaseError } from './errors.js';

export function rows(db, sql, params = []) {
  const statement = db.prepare(sql, params);
  const result = [];
  try { while (statement.step()) result.push(statement.getAsObject()); }
  finally { statement.free(); }
  return result;
}

export function scalar(db, sql) {
  return db.exec(sql)[0]?.values[0]?.[0];
}

function invalid() {
  return new DatabaseError('这个文件不是完整、有效的 Mathmyth 备份，原数据未被更改。', 'invalid_backup');
}

export function validateSqliteHeader(bytes) {
  const signature = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
  if (!(bytes instanceof Uint8Array) || bytes.length < 100 || signature.some((value, index) => bytes[index] !== value)) throw invalid();
}

export function validateIdentity(db) {
  if (scalar(db, 'PRAGMA application_id') !== APPLICATION_ID) throw invalid();
  const version = scalar(db, 'PRAGMA user_version');
  if (!Number.isInteger(version) || version < 0) throw invalid();
  if (version > SCHEMA_VERSION) {
    throw new DatabaseError('这个备份由更新版本的 Mathmyth 创建，请先更新 App。原数据未被更改。', 'newer_backup');
  }
  return version;
}

export function validateColumns(db, legacy = false) {
  const expected = legacy === true || legacy === 0 ? LEGACY_CORE_COLUMNS : legacy === 1 ? V1_REQUIRED_COLUMNS : legacy === 2 ? V2_REQUIRED_COLUMNS : legacy === 3 ? V3_REQUIRED_COLUMNS : legacy === 4 ? V4_REQUIRED_COLUMNS : legacy === 5 ? V5_REQUIRED_COLUMNS : legacy === 6 ? V6_REQUIRED_COLUMNS : legacy === 7 ? V7_REQUIRED_COLUMNS : legacy === 8 ? V8_REQUIRED_COLUMNS : REQUIRED_COLUMNS;
  for (const [table, required] of Object.entries(expected)) {
    if (rows(db, 'SELECT type FROM sqlite_master WHERE name = ?', [table])[0]?.type !== 'table') throw invalid();
    const names = new Set(rows(db, `PRAGMA table_info(${table})`).map((row) => row.name));
    if (required.some((name) => !names.has(name))) throw invalid();
  }
}

function isJson(value, array = false) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value);
    return array ? Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') : parsed !== null && typeof parsed === 'object';
  } catch { return false; }
}

export function inferImageMime(bytes, actualSize = bytes?.length) {
  if (!(bytes instanceof Uint8Array)) throw invalid();
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
    && view.getUint32(8) === 13 && ascii(12, 4) === 'IHDR' && view.getUint32(16) > 0 && view.getUint32(20) > 0) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[3] !== 0) return 'image/jpeg';
  if (bytes.length >= 13 && ['GIF87a','GIF89a'].includes(ascii(0, 6))
    && (bytes[6] | bytes[7] << 8) > 0 && (bytes[8] | bytes[9] << 8) > 0) return 'image/gif';
  if (bytes.length >= 20 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12,4))) {
    const containerSize = view.getUint32(4, true) + 8;
    const firstChunk = view.getUint32(16, true);
    if (containerSize <= actualSize && firstChunk > 0 && 20 + firstChunk + firstChunk % 2 <= containerSize) return 'image/webp';
  }
  throw invalid();
}

const INVALID_ROW_QUERIES = [
  `SELECT 1 FROM chat_practice cp LEFT JOIN practice_item i ON i.id=cp.item_id LEFT JOIN practice_run r ON r.id=cp.run_id
    LEFT JOIN message m ON m.id=cp.message_id LEFT JOIN conversation c ON c.id=cp.conversation_id
    LEFT JOIN message s ON s.id=cp.source_message_id
    WHERE i.id IS NULL OR r.id IS NULL OR i.run_id<>r.id
    OR (cp.conversation_id IS NOT NULL AND (c.id IS NULL OR c.learner_id<>r.learner_id))
    OR (cp.message_id IS NOT NULL AND (m.id IS NULL OR m.role<>'assistant' OR m.conversation_id<>cp.conversation_id))
    OR (cp.source_message_id IS NOT NULL AND (s.id IS NULL OR s.role<>'user' OR s.conversation_id<>cp.conversation_id)) LIMIT 1`,
  "SELECT 1 FROM message WHERE (is_math_question IS NOT NULL AND (typeof(is_math_question)<>'integer' OR is_math_question NOT IN (0,1))) OR typeof(recognized_question) NOT IN ('text','null') OR typeof(question_key) NOT IN ('text','null') OR typeof(superseded)<>'integer' OR superseded NOT IN (0,1) OR revision_action NOT IN ('edit','retry') LIMIT 1",
  "SELECT 1 FROM message m LEFT JOIN message p ON m.revision_of=p.id WHERE m.revision_of IS NOT NULL AND (p.id IS NULL OR p.conversation_id<>m.conversation_id OR p.role<>'user' OR m.role<>'user' OR p.id=m.id) LIMIT 1",
  "SELECT 1 FROM starred_question WHERE typeof(id)<>'text' OR trim(id)='' OR typeof(question_key)<>'text' OR trim(question_key)='' OR typeof(source_message_id)<>'text' OR trim(source_message_id)='' OR typeof(content)<>'text' OR typeof(recognized_question) NOT IN ('text','null') LIMIT 1",
  'SELECT 1 FROM starred_question s LEFT JOIN learner l ON s.learner_id=l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM starred_question GROUP BY learner_id,question_key HAVING count(*)>1 LIMIT 1',
  'SELECT 1 FROM starred_question_image WHERE typeof(seq)<>\'integer\' OR seq<0 LIMIT 1',
  'SELECT 1 FROM starred_question_image x LEFT JOIN starred_question s ON x.starred_question_id=s.id LEFT JOIN image i ON x.image_ref=i.id WHERE s.id IS NULL OR i.id IS NULL LIMIT 1',
  "SELECT 1 FROM personal_note WHERE typeof(id)<>'text' OR trim(id)='' OR typeof(content)<>'text' OR length(trim(content))=0 OR length(content)>5000 OR NOT ((target_type IS NULL AND target_id IS NULL) OR (target_type IN ('scenario','method') AND typeof(target_id)='text' AND length(target_id)>0 AND length(target_id)<180)) LIMIT 1",
  "SELECT 1 FROM conversation WHERE title_status NOT IN ('legacy','pending','auto','manual','failed') OR typeof(method_id) NOT IN ('text','null') LIMIT 1",
  "SELECT 1 FROM message WHERE typeof(reasoning_content) NOT IN ('text','null') LIMIT 1",
  "SELECT 1 FROM conversation WHERE pinned NOT IN (0,1) OR typeof(pinned)<>'integer' LIMIT 1",
  "SELECT 1 FROM practice_run WHERE generation_status NOT IN ('preparing','complete','failed') LIMIT 1",
  "SELECT 1 FROM document WHERE typeof(blob)<>'blob' OR length(blob)=0 OR typeof(text)<>'text' OR typeof(name)<>'text' OR trim(name)='' OR typeof(mime)<>'text' LIMIT 1",
  "SELECT 1 FROM message_attachment WHERE (image_ref IS NULL)=(document_ref IS NULL) OR typeof(seq)<>'integer' OR seq<0 LIMIT 1",
  "SELECT 1 FROM learner WHERE id IS NULL OR trim(id) = '' OR typeof(id) <> 'text' LIMIT 1",
  "SELECT 1 FROM setting WHERE key IS NULL OR trim(key) = '' OR typeof(key) <> 'text' OR (value IS NOT NULL AND typeof(value) <> 'text') LIMIT 1",
  "SELECT 1 FROM conversation WHERE id IS NULL OR trim(id) = '' OR learner_id IS NULL OR typeof(title) NOT IN ('text','null') LIMIT 1",
  "SELECT 1 FROM message WHERE id IS NULL OR trim(id) = '' OR conversation_id IS NULL OR role IS NULL OR role NOT IN ('user','assistant') OR typeof(content) <> 'text' OR typeof(seq) <> 'integer' OR seq < 0 OR status IS NULL OR status NOT IN ('complete','streaming','stopped','error') OR image_corrected NOT IN (0,1) OR typeof(image_corrected) <> 'integer' OR typeof(error) NOT IN ('text','null') LIMIT 1",
  "SELECT 1 FROM message GROUP BY conversation_id, seq HAVING count(*) > 1 LIMIT 1",
  "SELECT 1 FROM image WHERE id IS NULL OR trim(id) = '' OR typeof(blob) <> 'blob' OR length(blob) = 0 OR typeof(name) <> 'text' OR trim(name) = '' OR mime NOT IN ('image/jpeg','image/png','image/gif','image/webp') LIMIT 1",
  "SELECT 1 FROM encounter WHERE id IS NULL OR trim(id) = '' OR learner_id IS NULL OR scenario_id IS NULL OR trim(scenario_id) = '' OR source IS NULL OR source NOT IN ('ask','practice') OR typeof(is_main) <> 'integer' OR is_main NOT IN (0,1) LIMIT 1",
  "SELECT 1 FROM mastery WHERE id IS NULL OR trim(id) = '' OR learner_id IS NULL OR target_id IS NULL OR trim(target_id) = '' OR target_type IS NULL OR target_type NOT IN ('scenario','method') OR state IS NULL OR state NOT IN ('exposed','consolidating','mastered') OR typeof(success_count) <> 'integer' OR success_count < 0 LIMIT 1",
  "SELECT 1 FROM mastery GROUP BY learner_id, target_type, target_id HAVING count(*) > 1 LIMIT 1",
  "SELECT 1 FROM practice_run WHERE id IS NULL OR trim(id) = '' OR learner_id IS NULL OR scenario_id IS NULL OR trim(scenario_id) = '' LIMIT 1",
  "SELECT 1 FROM practice_item WHERE id IS NULL OR trim(id) = '' OR run_id IS NULL OR typeof(seq) <> 'integer' OR seq NOT BETWEEN 1 AND 3 OR typeof(step) <> 'integer' OR step NOT BETWEEN 1 AND 3 OR (result IS NOT NULL AND result NOT IN ('right','wrong')) LIMIT 1",
  "SELECT 1 FROM practice_item GROUP BY run_id, seq HAVING count(*) > 1 LIMIT 1",
  "SELECT 1 FROM queue_job WHERE id IS NULL OR trim(id) = '' OR typeof(kind) <> 'text' OR trim(kind) = '' OR status IS NULL OR status NOT IN ('pending','running','done','failed') OR typeof(attempts) <> 'integer' OR attempts < 0 LIMIT 1",
  'SELECT 1 FROM conversation c LEFT JOIN learner l ON c.learner_id = l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM personal_note n LEFT JOIN learner l ON n.learner_id=l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM message m LEFT JOIN conversation c ON m.conversation_id = c.id WHERE c.id IS NULL LIMIT 1',
  'SELECT 1 FROM message m LEFT JOIN image i ON m.image_ref = i.id WHERE m.image_ref IS NOT NULL AND i.id IS NULL LIMIT 1',
  "SELECT 1 FROM message m LEFT JOIN message a ON m.recheck_of = a.id WHERE m.recheck_of IS NOT NULL AND (a.id IS NULL OR a.conversation_id <> m.conversation_id OR a.role <> 'assistant') LIMIT 1",
  'SELECT 1 FROM encounter e LEFT JOIN learner l ON e.learner_id = l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM mastery m LEFT JOIN learner l ON m.learner_id = l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM practice_run r LEFT JOIN learner l ON r.learner_id = l.id WHERE l.id IS NULL LIMIT 1',
  'SELECT 1 FROM practice_item i LEFT JOIN practice_run r ON i.run_id = r.id WHERE r.id IS NULL LIMIT 1',
  'SELECT 1 FROM queue_job q LEFT JOIN conversation c ON q.conversation_id = c.id WHERE q.conversation_id IS NOT NULL AND c.id IS NULL LIMIT 1',
  "SELECT 1 FROM queue_job q LEFT JOIN message m ON q.source_message_id=m.id WHERE q.source_message_id IS NOT NULL AND (m.id IS NULL OR m.conversation_id <> q.conversation_id OR m.role <> 'assistant') LIMIT 1",
  'SELECT 1 FROM encounter e LEFT JOIN conversation c ON e.conversation_id=c.id WHERE e.conversation_id IS NOT NULL AND c.id IS NULL LIMIT 1',
  'SELECT 1 FROM encounter e LEFT JOIN message m ON e.message_id=m.id WHERE e.message_id IS NOT NULL AND (m.id IS NULL OR m.conversation_id <> e.conversation_id) LIMIT 1',
  'SELECT 1 FROM encounter e LEFT JOIN practice_item i ON e.practice_item_id=i.id WHERE e.practice_item_id IS NOT NULL AND i.id IS NULL LIMIT 1',
  "SELECT 1 FROM practice_credit WHERE target_type NOT IN ('scenario','method') OR typeof(question_key)<>'text' OR trim(question_key)='' LIMIT 1",
];

export function validateContents(db) {
  validateColumns(db);
  if (scalar(db, 'PRAGMA integrity_check') !== 'ok' || rows(db, 'PRAGMA foreign_key_check').length) throw invalid();
  if (!scalar(db, 'SELECT count(*) FROM learner')) throw invalid();
  // v1 contains no triggers. Reject unexpected executable schema in a backup.
  if (scalar(db, "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'")) throw invalid();
  for (const query of INVALID_ROW_QUERIES) if (rows(db, query).length) throw invalid();
  const dates = {
    learner: ['created_at'], conversation: ['created_at','updated_at'], message: ['created_at'], image: ['created_at'], document: ['created_at'],
    encounter: ['occurred_at'], mastery: ['updated_at'], practice_run: ['started_at','finished_at'],
    practice_item: ['created_at'], queue_job: ['created_at'], practice_credit: ['created_at'], personal_note: ['created_at', 'updated_at'], starred_question: ['created_at'],
  };
  for (const [table, columns] of Object.entries(dates)) {
    for (const row of rows(db, `SELECT ${columns.join(',')} FROM ${table}`)) {
      for (const [key, value] of Object.entries(row)) {
        if (key === 'finished_at' && value === null) continue;
        if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw invalid();
      }
    }
  }
  for (const { value } of rows(db, "SELECT value FROM setting WHERE key IN ('supports_image','onboarded')")) {
    if (!['true','false'].includes(value)) throw invalid();
  }
  for (const row of rows(db, 'SELECT faces FROM mastery')) if (!isJson(row.faces, true)) throw invalid();
  for (const row of rows(db, 'SELECT method_ids FROM practice_run')) if (row.method_ids !== null && !isJson(row.method_ids, true)) throw invalid();
  for (const row of rows(db, 'SELECT question, answer FROM practice_item')) {
    if (!isJson(row.question) || (row.answer !== null && !isJson(row.answer))) throw invalid();
  }
  for (const row of rows(db, 'SELECT payload FROM queue_job')) if (row.payload !== null && !isJson(row.payload)) throw invalid();
  for (const note of rows(db, 'SELECT content,target_type,target_id FROM personal_note')) {
    if (typeof note.content !== 'string' || !note.content.trim() || note.content.length > 5000) throw invalid();
    if (note.target_type === null && note.target_id === null) continue;
    if (typeof note.target_id !== 'string' || note.target_id.length >= 180 ||
      !(note.target_type === 'scenario' && /^S\.[A-Za-z0-9_.]+$/.test(note.target_id) || note.target_type === 'method' && /^M\.[A-Za-z0-9_.]+$/.test(note.target_id))) throw invalid();
  }
  for (const row of rows(db, 'SELECT mime, substr(blob,1,33) AS header, length(blob) AS size FROM image')) {
    if (inferImageMime(row.header, row.size) !== row.mime) throw invalid();
  }
}
