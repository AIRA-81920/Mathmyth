import { SCHEMA_VERSION } from './constants.js';
import { DatabaseError, safeDatabaseError } from './errors.js';
import { migrateV1 } from './migrations/v1_initial.js';
import { migrateV2 } from './migrations/v2_location_queue.js';
import { migrateV3 } from './migrations/v3_practice.js';
import { migrateV4 } from './migrations/v4_attachments.js';
import { migrateV5 } from './migrations/v5_conversation_context.js';
import { migrateV6 } from './migrations/v6_private_context.js';
import { migrateV7 } from './migrations/v7_personal_notes.js';
import { migrateV8 } from './migrations/v8_question_stars.js';
import { migrateV9 } from './migrations/v9_chat_practice.js';
import * as personalNotes from './personalNotes.js';
import * as questionStars from './questionStars.js';
import { normalizePreferences } from '../config/preferences.js';
import { normalizeRevisionPaths } from '../chat/revisions.js';
import * as practice from '../mastery/practiceDb.js';
import * as jobs from '../queue/dbJobs.js';
import { loadPatternProgress } from '../knowledge/patternProgressDb.js';
import { inferImageMime, rows, scalar, validateColumns, validateContents, validateIdentity, validateSqliteHeader } from './validation.js';

const configKeys = { apiBase: 'api_base', apiKey: 'api_key', model: 'model', providerId: 'provider_id', supportsImage: 'supports_image', auxiliaryModel: 'auxiliary_model', auxiliaryThinking: 'auxiliary_thinking' };
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function configure(db) { db.run('PRAGMA foreign_keys = ON'); }
function exportBytes(db) {
  // export() frees prepared statements, closes/reopens SQLite and resets pragmas.
  // Keep no statements across this boundary and restore foreign-key enforcement.
  const bytes = db.export();
  configure(db);
  return bytes;
}

function encodeImage(row) {
  const chunks = [];
  for (let offset = 0; offset < row.blob.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...row.blob.subarray(offset, offset + 0x8000)));
  }
  return { id: row.id, name: row.name, mime: row.mime, bytes: row.blob, dataUrl: `data:${row.mime};base64,${btoa(chunks.join(''))}` };
}

function setSetting(db, key, value) {
  db.run('INSERT INTO setting(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}

function bootstrap(db) {
  const settings = Object.fromEntries(rows(db, 'SELECT key,value FROM setting').map(({ key, value }) => [key, value]));
  const hasModel = Object.values(configKeys).some((key) => Object.hasOwn(settings, key));
  const modelConfig = hasModel ? {
    apiBase: settings.api_base ?? '', apiKey: settings.api_key ?? '', model: settings.model ?? '',
    providerId: settings.provider_id ?? 'custom', supportsImage: settings.supports_image === 'true',
    ...(settings.auxiliary_model ? { auxiliaryModel: settings.auxiliary_model } : {}),
    ...(settings.auxiliary_thinking ? { auxiliaryThinking: settings.auxiliary_thinking } : {}),
  } : null;
  const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
  const conversations = rows(db, `SELECT c.id, c.title, c.created_at, c.updated_at, c.pinned, c.method_id, c.title_status,
    (SELECT count(*) FROM message m WHERE m.conversation_id = c.id AND m.superseded=0) AS message_count,
    (SELECT image_ref FROM message m WHERE m.conversation_id = c.id AND m.superseded=0 AND image_ref IS NOT NULL ORDER BY seq,id LIMIT 1) AS first_image_id
    FROM conversation c WHERE c.learner_id = ? AND EXISTS(SELECT 1 FROM message m WHERE m.conversation_id=c.id)
    ORDER BY c.updated_at DESC,c.id`, [learnerId]).map((row) => ({
    id: row.id, title: row.title ?? '', createdAt: row.created_at, updatedAt: row.updated_at, pinned: Boolean(row.pinned),
    messageCount: row.message_count, firstImageId: row.first_image_id,
    methodId: row.method_id, titleStatus: row.title_status,
    messages: [], loaded: false,
  }));
  let preferences;
  try { preferences = normalizePreferences(JSON.parse(settings.ui_preferences ?? '{}')); } catch { preferences = normalizePreferences(); }
  return { modelConfig, preferences, onboarded: settings.onboarded === 'true', learnerId, conversations };
}

function normalizeInterrupted(db) {
  const count = scalar(db, "SELECT count(*) FROM message WHERE status='streaming'");
  if (count) db.run("UPDATE message SET status='stopped', error='上次回答中断，可继续追问。' WHERE status='streaming'");
  return Boolean(count);
}

// The engine is independent of Worker/DOM for real WASM tests. In production,
// only database.worker.js owns an engine and serializes all requests.
export class DatabaseEngine {
  constructor({ SQL, schemaSql, storage }) {
    this.SQL = SQL;
    this.schemaSql = schemaSql;
    this.storage = storage;
    this.db = null;
    this.revision = 0;
    this.committedBytes = null;
    this.storageReady = false;
    this.candidates = new Map();
  }

  async readStorage() {
    if (this.storageReady) return;
    const record = await this.storage.load();
    if (record) {
      this.committedBytes = new Uint8Array(record.bytes);
      this.revision = record.revision;
      if (!Number.isInteger(this.revision) || this.revision < 0) {
        throw new DatabaseError('本地存储记录无效，请先导出文件或从备份恢复。', 'storage_record_invalid');
      }
    }
    this.storageReady = true;
  }

  createFresh() {
    const db = new this.SQL.Database();
    configure(db);
    migrateV1(db, this.schemaSql, inferImageMime);
    migrateV2(db);
    migrateV3(db);
    migrateV4(db);
    migrateV5(db);
    migrateV6(db);
    migrateV7(db);
    migrateV8(db);
    migrateV9(db);
    db.run('INSERT INTO learner(id,display_name,created_at) VALUES(?,?,?)', [`learner-${uuid()}`, null, new Date().toISOString()]);
    setSetting(db, 'onboarded', 'false');
    return db;
  }

  openCandidate(bytes) {
    validateSqliteHeader(bytes);
    let db;
    try {
      db = new this.SQL.Database(bytes);
      configure(db);
      const version = validateIdentity(db);
      validateColumns(db, version);
      if (version < 1) migrateV1(db, this.schemaSql, inferImageMime);
      if (version < 2) migrateV2(db);
      if (version < 3) migrateV3(db);
      if (version < 4) migrateV4(db);
      if (version < 5) migrateV5(db);
      if (version < 6) migrateV6(db);
      if (version < 7) migrateV7(db);
      if (version < 8) migrateV8(db);
      if (version < 9) migrateV9(db);
      validateContents(db);
      return db;
    } catch (error) {
      db?.close();
      throw safeDatabaseError(error, '这个文件不是完整、有效的 Mathmyth 备份，原数据未被更改。');
    }
  }

  async initializeDatabase() {
    await this.readStorage();
    if (this.db) return bootstrap(this.db);
    if (!this.committedBytes) {
      const fresh = this.createFresh();
      try { await this.commitAndSwitch(fresh); }
      catch (error) { fresh.close(); throw safeDatabaseError(error); }
      return bootstrap(this.db);
    }
    let candidate;
    try {
      candidate = this.openCandidate(this.committedBytes);
      const originalVersion = new DataView(this.committedBytes.buffer, this.committedBytes.byteOffset, this.committedBytes.byteLength).getUint32(60);
      const migrated = scalar(candidate, 'PRAGMA user_version') !== originalVersion;
      const interrupted = normalizeInterrupted(candidate);
      const recovered = jobs.recoverJobs(candidate);
      const preparing = scalar(candidate, "SELECT count(*) FROM practice_run WHERE generation_status='preparing'");
      candidate.run("UPDATE practice_run SET generation_status='failed' WHERE generation_status='preparing'");
      const added = jobs.enqueueAnswers(candidate);
      if (migrated || interrupted || recovered || added || preparing) await this.commitAndSwitch(candidate);
      else { this.db = candidate; }
      return bootstrap(this.db);
    } catch (error) {
      candidate?.close();
      throw safeDatabaseError(error, '本地数据无法打开。原文件已保留，可导出文件或从备份恢复。');
    }
  }

  ensureOpen() {
    if (!this.db) throw new DatabaseError('本地数据尚未打开，请重试或从备份恢复。', 'database_not_ready');
    return this.db;
  }

  async commitAndSwitch(candidate) {
    const bytes = exportBytes(candidate);
    const revision = await this.storage.commit(bytes, this.revision);
    const previous = this.db;
    this.db = candidate;
    this.committedBytes = bytes;
    this.revision = revision;
    if (previous && previous !== candidate) previous.close();
  }

  restoreCommitted() {
    this.db?.close();
    this.db = this.committedBytes ? new this.SQL.Database(this.committedBytes) : null;
    if (this.db) configure(this.db);
  }

  async transaction(operation) {
    const db = this.ensureOpen();
    db.run('BEGIN');
    try {
      const result = operation(db);
      db.run('COMMIT');
      const bytes = exportBytes(db);
      this.revision = await this.storage.commit(bytes, this.revision);
      this.committedBytes = bytes;
      return result;
    } catch (error) { this.restoreCommitted(); throw safeDatabaseError(error); }
  }

  claimNextJob(now) { return jobs.claimNextJob(this, now); }
  checkpointJob(claim, blockIds, classification) { return jobs.checkpointJob(this, claim, blockIds, classification); }
  completeJob(claim, entries) { return jobs.completeJob(this, claim, entries); }
  failJob(claim, options) { return jobs.failJob(this, claim, options); }
  loadTrail() { return jobs.loadTrail(this); }
  loadPatternProgress() { return loadPatternProgress(this); }
  listPersonalNotes() { return personalNotes.listPersonalNotes(this); }
  savePersonalNote(input) { return personalNotes.savePersonalNote(this, input); }
  deletePersonalNote(id) { return personalNotes.deletePersonalNote(this, id); }
  listStarredQuestions(options) { return questionStars.listStarredQuestions(this, options); }
  loadStarredQuestion(id) { return questionStars.loadStarredQuestion(this, id); }
  setQuestionStar(input) { return questionStars.setQuestionStar(this, input); }
  removeStarredQuestion(id) { return questionStars.removeStarredQuestion(this, id); }
  getMessageQuestionClassification(id) { return questionStars.getMessageQuestionClassification(this, id); }
  requestMessageQuestionClassification(id) { return questionStars.requestMessageQuestionClassification(this, id); }
  createPracticeRun(input) { return practice.createPracticeRun(this, input); }
  appendPracticeItems(runId, items, status) { return practice.appendPracticeItems(this, runId, items, status); }
  loadActivePractice() { return practice.loadActivePractice(this); }
  loadPracticeItem(id) { return practice.loadPracticeItem(this, id); }
  listPracticeHistory(options) { return practice.listPracticeHistory(this, options); }
  loadPracticeUsage() { return practice.loadPracticeUsage(this); }
  gradePracticeItem(runId, itemId, attempt) { return practice.gradePracticeItem(this, runId, itemId, attempt); }
  revealPracticeItem(runId, itemId, options) { return practice.revealPracticeItem(this, runId, itemId, options); }
  advancePracticeItem(runId, itemId) { return practice.advancePracticeItem(this, runId, itemId); }

  loadImage(id) {
    const row = rows(this.ensureOpen(), 'SELECT id,name,mime,blob FROM image WHERE id = ?', [id])[0];
    if (!row) throw new DatabaseError('这张图片已不存在，请重新选择。', 'image_not_found');
    return encodeImage(row);
  }

  loadDocument(id) {
    const row = rows(this.ensureOpen(), 'SELECT * FROM document WHERE id=?', [id])[0];
    if (!row) throw new DatabaseError('文件已不存在。', 'document_not_found');
    return { id: row.id, kind: 'document', name: row.name, mime: row.mime, bytes: row.blob, text: row.text };
  }

  searchConversations(value) {
    const query = String(value ?? '').trim().slice(0, 120);
    if (!query) return [];
    return rows(this.ensureOpen(), `SELECT c.id,
      COALESCE((SELECT substr(m.content,MAX(1,instr(lower(m.content),lower(?))-24),160) FROM message m WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(m.content),lower(?))>0 ORDER BY m.seq LIMIT 1),'') AS snippet
      FROM conversation c WHERE instr(lower(c.title),lower(?))>0
      OR EXISTS(SELECT 1 FROM message m WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(m.content),lower(?))>0)
      OR EXISTS(SELECT 1 FROM message m JOIN message_attachment a ON a.message_id=m.id JOIN document d ON d.id=a.document_ref WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(d.text),lower(?))>0)
      ORDER BY c.pinned DESC,c.updated_at DESC,c.id LIMIT 50`, [query,query,query,query,query]);
  }

  updateConversation(id, patch) {
    return this.transaction((db) => {
      if (typeof patch.title === 'string') db.run("UPDATE conversation SET title=?,title_status='manual' WHERE id=?", [patch.title.trim().slice(0,80), id]);
      if (typeof patch.pinned === 'boolean') db.run('UPDATE conversation SET pinned=? WHERE id=?', [patch.pinned ? 1 : 0,id]);
      return { updated: true };
    });
  }

  deleteConversation(id, includeLearning = false) {
    return this.transaction((db) => {
      if (!rows(db,'SELECT id FROM conversation WHERE id=?',[id]).length) throw new DatabaseError('这个会话已不存在。','conversation_not_found');
      // The store aborts generation during this data operation; leave no run
      // falsely marked as still generating after its request has been stopped.
      db.run("UPDATE practice_run SET generation_status='failed' WHERE generation_status='preparing'");
      if (includeLearning) practice.deleteChatPracticeRecords(db, id);
      if (!includeLearning) {
        const source = jobs.sourceQuestion(db, rows(db, "SELECT * FROM message WHERE conversation_id=? AND role='user' ORDER BY seq LIMIT 1", [id])[0]) || '图片题目';
        db.run('UPDATE encounter SET question_snapshot=COALESCE(question_snapshot,?),conversation_id=NULL,message_id=NULL WHERE conversation_id=?', [source,id]);
      }
      db.run('DELETE FROM conversation WHERE id=?', [id]);
      db.run('DELETE FROM setting WHERE key=?', [`chat_branches:${id}`]);
      db.run(`UPDATE practice_run SET finished_at=? WHERE finished_at IS NULL AND (
        (NOT EXISTS(SELECT 1 FROM encounter e WHERE e.scenario_id=practice_run.scenario_id AND e.method_id=json_extract(practice_run.method_ids,'$[0]'))
          AND NOT EXISTS(SELECT 1 FROM practice_item p WHERE p.run_id=practice_run.id AND json_extract(p.question,'$.format')='route-v1'))
        OR (generation_status='failed' AND NOT EXISTS(SELECT 1 FROM practice_item p WHERE p.run_id=practice_run.id AND COALESCE(json_extract(p.answer,'$.advanced'),0)=0)))`, [new Date().toISOString()]);
      if (includeLearning) {
        // Remove only targets with no remaining evidence. Practice achievements
        // shared by other conversations/runs must survive deleting one chat.
        db.run(`DELETE FROM mastery WHERE success_count=0 AND NOT EXISTS(SELECT 1 FROM encounter e WHERE e.learner_id=mastery.learner_id
          AND ((mastery.target_type='scenario' AND e.scenario_id=mastery.target_id) OR (mastery.target_type='method' AND e.method_id=mastery.target_id)))`);
      }
      db.run('DELETE FROM image WHERE id NOT IN(SELECT image_ref FROM message WHERE image_ref IS NOT NULL) AND id NOT IN(SELECT image_ref FROM message_attachment WHERE image_ref IS NOT NULL) AND id NOT IN(SELECT image_ref FROM starred_question_image)');
      db.run('DELETE FROM document WHERE id NOT IN(SELECT document_ref FROM message_attachment WHERE document_ref IS NOT NULL)');
      return { deleted: true };
    });
  }

  loadConversation(id) {
    const db = this.ensureOpen();
    const conversation = rows(db, 'SELECT * FROM conversation WHERE id=?', [id])[0];
    if (!conversation) throw new DatabaseError('这个会话已不存在，请从历史中重新选择。', 'conversation_not_found');
    const images = new Map();
    const messages = rows(db, 'SELECT * FROM message WHERE conversation_id=? ORDER BY seq,id', [id]).map((row) => {
      const item = { id: row.id, role: row.role, content: row.content, status: row.status, createdAt: row.created_at };
      const card = rows(db, 'SELECT item_id FROM chat_practice WHERE message_id=?', [row.id])[0];
      if (card) item.practiceItemId = card.item_id;
      item.isMathQuestion = row.is_math_question === null ? null : Boolean(row.is_math_question);
      if (row.recognized_question !== null) item.recognizedQuestion = row.recognized_question;
      if (row.question_key !== null) item.questionKey = row.question_key;
      if (row.superseded) item.superseded = true;
      if (row.revision_of !== null) item.revisionOf = row.revision_of;
      if (row.revision_action !== null) item.revisionAction = row.revision_action;
      if (row.error !== null) item.error = row.error;
      if (row.reasoning_content) item.reasoningContent = row.reasoning_content;
      if (row.recheck_of !== null) item.recheckOf = row.recheck_of;
      if (row.image_corrected) item.imageCorrected = true;
      if (row.image_ref) {
        if (!images.has(row.image_ref)) images.set(row.image_ref, this.loadImage(row.image_ref));
        item.image = images.get(row.image_ref);
      }
      const attachments = rows(db, 'SELECT * FROM message_attachment WHERE message_id=? ORDER BY seq', [row.id]);
      if (attachments.length) item.attachments = attachments.map((entry) => entry.image_ref
        ? { ...this.loadImage(entry.image_ref), kind: 'image' } : this.loadDocument(entry.document_ref));
      return item;
    });
    let revisionPaths = {};
    try { revisionPaths = normalizeRevisionPaths(JSON.parse(rows(db, 'SELECT value FROM setting WHERE key=?', [`chat_branches:${id}`])[0]?.value ?? '{}'), messages); } catch { /* Legacy conversations infer paths on first use. */ }
    return { id, revisionPaths, title: conversation.title ?? '', createdAt: conversation.created_at, updatedAt: conversation.updated_at, pinned: Boolean(conversation.pinned),
      methodId: conversation.method_id, titleStatus: conversation.title_status,
      messageCount: messages.filter((message) => !message.superseded).length, firstImageId: messages.find((message) => !message.superseded && message.image)?.image.id ?? null, messages, loaded: true };
  }

  saveImage(image, createdAt) {
    const db = this.ensureOpen();
    if (!image?.id) throw new DatabaseError('图片记录不完整，请重新选择图片。', 'invalid_image');
    if (rows(db, 'SELECT id FROM image WHERE id=?', [image.id]).length) return;
    if (!(image.bytes instanceof Uint8Array) || !image.bytes.length) {
      throw new DatabaseError('图片尚未保存，请重新选择图片后重试。', 'missing_image');
    }
    const mime = inferImageMime(image.bytes);
    if (image.mime !== mime) throw new DatabaseError('图片类型与内容不一致，请重新选择图片。', 'invalid_image');
    db.run('INSERT INTO image(id,blob,created_at,name,mime) VALUES(?,?,?,?,?)', [image.id, image.bytes, createdAt, image.name || '图片', mime]);
  }

  async saveChanges(changes = {}) {
    const db = this.ensureOpen();
    const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
    db.run('BEGIN');
    try {
      if (changes.modelConfig !== undefined) {
        for (const [domainKey, key] of Object.entries(configKeys)) {
          const value = changes.modelConfig[domainKey];
          setSetting(db, key, domainKey === 'supportsImage' ? String(Boolean(value)) : String(value ?? ''));
        }
      }
      if (changes.onboarded !== undefined) setSetting(db, 'onboarded', String(Boolean(changes.onboarded)));
      if (changes.preferences !== undefined) setSetting(db, 'ui_preferences', JSON.stringify(normalizePreferences(changes.preferences)));
      for (const conversation of changes.conversations ?? []) {
        if (!Array.isArray(conversation.messages) || !conversation.messages.length) continue;
        db.run(`INSERT INTO conversation(id,learner_id,title,created_at,updated_at,pinned,method_id,title_status) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at,pinned=excluded.pinned,method_id=excluded.method_id,title_status=excluded.title_status`,
        [conversation.id, learnerId, conversation.title, conversation.createdAt, conversation.updatedAt, conversation.pinned ? 1 : 0, conversation.methodId ?? null, conversation.titleStatus ?? 'legacy']);
        if (conversation.revisionPaths !== undefined) setSetting(db, `chat_branches:${conversation.id}`, JSON.stringify(normalizeRevisionPaths(conversation.revisionPaths, conversation.messages)));
        // A new revision can insert in the middle. Move the old sequence range
        // aside before assigning final positions so UNIQUE(conversation_id,seq)
        // never rejects the new user message against its archived predecessor.
        const offset = (rows(db, 'SELECT MAX(seq) AS value FROM message WHERE conversation_id=?', [conversation.id])[0]?.value ?? 0) + conversation.messages.length + 1;
        db.run('UPDATE message SET seq=seq+? WHERE conversation_id=?', [offset, conversation.id]);
        for (let seq = 0; seq < conversation.messages.length; seq += 1) {
          const message = conversation.messages[seq];
          if (message.image) this.saveImage(message.image, message.createdAt);
          db.run(`INSERT INTO message(id,conversation_id,role,content,image_ref,created_at,seq,status,error,recheck_of,image_corrected,reasoning_content,superseded,revision_of,revision_action)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            content=excluded.content,image_ref=excluded.image_ref,seq=excluded.seq,status=excluded.status,
            error=excluded.error,recheck_of=excluded.recheck_of,image_corrected=excluded.image_corrected,reasoning_content=excluded.reasoning_content,
            superseded=excluded.superseded,revision_of=excluded.revision_of,revision_action=excluded.revision_action`,
          [message.id, conversation.id, message.role, message.content ?? '', message.image?.id ?? null, message.createdAt,
            seq, message.status ?? 'complete', message.error ?? null, message.recheckOf ?? null, message.imageCorrected ? 1 : 0, message.reasoningContent ?? null,
            message.superseded ? 1 : 0, message.revisionOf ?? null, message.revisionAction ?? null]);
          if (Array.isArray(message.attachments)) {
            db.run('DELETE FROM message_attachment WHERE message_id=?', [message.id]);
            message.attachments.forEach((attachment, index) => {
              if (attachment.kind === 'image') this.saveImage(attachment, message.createdAt);
              else if (!rows(db, 'SELECT id FROM document WHERE id=?', [attachment.id]).length) {
                if (!(attachment.bytes instanceof Uint8Array) || !attachment.bytes.length) throw new DatabaseError('文件尚未保存，请重新选择。', 'missing_document');
                db.run('INSERT INTO document(id,name,mime,blob,text,created_at) VALUES(?,?,?,?,?,?)', [attachment.id,attachment.name,attachment.mime,attachment.bytes,attachment.text ?? '',message.createdAt]);
              }
              db.run('INSERT INTO message_attachment(message_id,seq,image_ref,document_ref) VALUES(?,?,?,?)', [message.id,index,
                attachment.kind === 'image' ? attachment.id : null, attachment.kind === 'document' ? attachment.id : null]);
            });
          }
        }
      }
      jobs.cancelSupersededJobs(db);
      jobs.enqueueAnswers(db, (changes.conversations ?? []).filter(conversation => !conversation.revisionViewOnly).map((conversation) => conversation.id));
      db.run('COMMIT');
      const bytes = exportBytes(db);
      this.revision = await this.storage.commit(bytes, this.revision);
      this.committedBytes = bytes;
      return { saved: true };
    } catch (error) {
      // A SQLite commit alone is not durable. Roll back to the last successful
      // IDB snapshot if SQL validation, quota or revision compare-and-swap fails.
      this.restoreCommitted();
      throw safeDatabaseError(error, '本地数据尚未保存，请重试。');
    }
  }

  async exportDatabase() {
    await this.readStorage();
    if (this.db) return exportBytes(this.db);
    if (this.committedBytes) return this.committedBytes.slice();
    throw new DatabaseError('还没有可导出的本地文件。', 'no_database');
  }

  // Only this sanitized export is exposed to the browser Worker. The full
  // snapshot above is used internally for storage/recovery and engine tests.
  async exportBackup() {
    await this.readStorage();
    let copy;
    try {
      if (this.db) copy = new this.SQL.Database(exportBytes(this.db));
      else if (this.committedBytes) copy = this.openCandidate(this.committedBytes);
      else throw new DatabaseError('还没有可导出的本地文件。', 'no_database');
      copy.run('PRAGMA secure_delete = ON');
      copy.run("DELETE FROM setting WHERE key='api_key'");
      // A row deletion alone is insufficient: old/rotated keys can remain in
      // free pages or unused cells. Rebuild the copied database before export.
      copy.run('VACUUM');
      return exportBytes(copy);
    } catch (error) {
      throw safeDatabaseError(error, '无法安全导出这份数据。原数据仍保留，API Key 不会写入导出文件。');
    } finally { copy?.close(); }
  }

  async prepareImport(bytes) {
    await this.readStorage();
    let candidate;
    try {
      candidate = this.openCandidate(new Uint8Array(bytes));
      normalizeInterrupted(candidate);
      candidate.run("UPDATE practice_run SET generation_status='failed' WHERE generation_status='preparing'");
      jobs.recoverJobs(candidate);
      jobs.enqueueAnswers(candidate);
      for (const db of this.candidates.values()) db.close();
      this.candidates.clear();
      const token = `import-${uuid()}`;
      this.candidates.set(token, candidate);
      return { token, summary: {
        conversationCount: scalar(candidate, 'SELECT count(*) FROM conversation'),
        messageCount: scalar(candidate, 'SELECT count(*) FROM message'),
        imageCount: scalar(candidate, 'SELECT count(*) FROM image'),
        personalNoteCount: scalar(candidate, 'SELECT count(*) FROM personal_note'),
        starredQuestionCount: scalar(candidate, 'SELECT count(*) FROM starred_question'),
        hasModelSettings: bootstrap(candidate).modelConfig !== null,
      } };
    } catch (error) {
      candidate?.close();
      throw safeDatabaseError(error, '这个文件不是完整、有效的 Mathmyth 备份，原数据未被更改。');
    }
  }

  async commitImport(token) {
    const candidate = this.candidates.get(token);
    if (!candidate) throw new DatabaseError('待导入文件已失效，请重新选择文件。', 'import_expired');
    try {
      await this.commitAndSwitch(candidate);
      this.candidates.delete(token);
      return bootstrap(this.db);
    } catch (error) {
      throw safeDatabaseError(error, '备份尚未导入，原数据未被更改。请重试。');
    }
  }

  cancelImport(token) {
    this.candidates.get(token)?.close();
    this.candidates.delete(token);
    return { cancelled: true };
  }

  async clearDatabase() {
    await this.readStorage();
    const candidate = this.createFresh();
    try {
      await this.commitAndSwitch(candidate);
      for (const db of this.candidates.values()) db.close();
      this.candidates.clear();
      return bootstrap(this.db);
    } catch (error) {
      candidate.close();
      throw safeDatabaseError(error, '本地数据尚未清空，原数据未被更改。请重试。');
    }
  }

  close() {
    this.db?.close();
    this.db = null;
    for (const db of this.candidates.values()) db.close();
    this.candidates.clear();
  }
}
