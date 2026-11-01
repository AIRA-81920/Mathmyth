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
import { migrateV10 } from './migrations/v10_classification_results.js';
import { migrateV11 } from './migrations/v11_learning_reviews.js';
import { migrateV12 } from './migrations/v12_subject.js';
import * as personalNotes from './personalNotes.js';
import * as questionStars from './questionStars.js';
import { normalizePreferences } from '../config/preferences.js';
import { normalizeSubject } from '../config/subject.js';
import { normalizeRevisionPaths } from '../chat/revisions.js';
import { canResumeAnswer } from '../chat/recovery.js';
import * as practice from '../mastery/practiceDb.js';
import * as jobs from '../queue/dbJobs.js';
import { loadPatternProgress } from '../knowledge/patternProgressDb.js';
import { inferImageMime, rows, scalar, validateColumns, validateContents, validateIdentity, validateSqliteHeader } from './validation.js';
import { reencodeBackupImage } from '../images/reencode.js';

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

// 会话摘要只返回当前学科的条目：历史抽屉、快捷搜索都复用这段 SQL，
// 避免“高数对话出现在高中数学模式”的情况。
const conversationSummarySql = `SELECT c.id, c.title, c.created_at, c.updated_at, c.pinned, c.method_id, c.title_status, c.subject,
  (SELECT count(*) FROM message m WHERE m.conversation_id = c.id AND m.superseded=0) AS message_count,
  (SELECT image_ref FROM message m WHERE m.conversation_id = c.id AND m.superseded=0 AND image_ref IS NOT NULL ORDER BY seq,id LIMIT 1) AS first_image_id
  FROM conversation c WHERE c.learner_id = ? AND c.subject = ? AND EXISTS(SELECT 1 FROM message m WHERE m.conversation_id=c.id)
  ORDER BY c.updated_at DESC,c.id`;

function conversationSummary(row) {
  return {
    id: row.id, title: row.title ?? '', createdAt: row.created_at, updatedAt: row.updated_at, pinned: Boolean(row.pinned),
    messageCount: row.message_count, firstImageId: row.first_image_id,
    methodId: row.method_id, titleStatus: row.title_status, subject: row.subject,
    messages: [], loaded: false,
  };
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
  let preferences;
  try { preferences = normalizePreferences(JSON.parse(settings.ui_preferences ?? '{}')); } catch { preferences = normalizePreferences(); }
  // 启动时只列出当前学科的会话；偏好本身就存在同一个设置表里，无需额外参数。
  const subject = normalizeSubject(preferences.subject);
  const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
  const conversations = rows(db, conversationSummarySql, [learnerId, subject]).map(conversationSummary);
  return { modelConfig, preferences, onboarded: settings.onboarded === 'true', learnerId, conversations };
}

function normalizeInterrupted(db) {
  const count = scalar(db, "SELECT count(*) FROM message WHERE status='streaming'");
  if (count) db.run("UPDATE message SET status='stopped', error='上次回答中断，可继续追问。' WHERE status='streaming'");
  return Boolean(count);
}

// Referenced question sources never expire merely because some text exists.
// Only unreferenced images older than 14 days are eligible for automatic cleanup.
export const IMAGE_TTL_DAYS = 14;
export function pruneImages(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - IMAGE_TTL_DAYS * 86400000).toISOString();
  const expired = `SELECT id FROM image
    WHERE created_at < ?
      AND id NOT IN (SELECT image_ref FROM starred_question_image WHERE image_ref IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM message m WHERE m.image_ref=image.id)
      AND NOT EXISTS (SELECT 1 FROM message_attachment a WHERE a.image_ref=image.id)`;
  db.run(`DELETE FROM image WHERE id IN (${expired})`, [cutoff]);
  return db.getRowsModified();
}

// The engine is independent of Worker/DOM for real WASM tests. In production,
// only database.worker.js owns an engine and serializes all requests.
export class DatabaseEngine {
  constructor({ SQL, schemaSql, storage, reencodeImage = reencodeBackupImage }) {
    this.SQL = SQL;
    this.schemaSql = schemaSql;
    this.storage = storage;
    // D14 补充：导出档案前把保留下来的图片降采样重编码。留出注入点便于单测替换实现；
    // 真实默认实现在缺少 createImageBitmap / OffscreenCanvas 的环境里返回 null（保持原图）。
    this.reencodeImage = reencodeImage;
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
    migrateV10(db);
    migrateV11(db);
    migrateV12(db);
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
      if (version < 10) migrateV10(db);
      if (version < 11) migrateV11(db);
      if (version < 12) migrateV12(db);
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
      // D2/D8 启动清理：图片 TTL 与队列历史。两个返回值必须并入下面的提交门，
      // 否则启动期的清理只留在内存里，不会随首次提交持久化。
      const prunedImages = pruneImages(candidate);
      const prunedJobs = jobs.pruneJobs(candidate);
      if (migrated || interrupted || recovered || added || preparing || prunedImages || prunedJobs) await this.commitAndSwitch(candidate);
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

  // 把当前内存数据库导出为快照并写入 IndexedDB。SQLite 跑在 WASM 里，"持久化"
  // 天然就是全库导出，因此这里必须被显式调用，而不是每个事务都顺手做一次。
  async persist() {
    const bytes = exportBytes(this.db);
    this.revision = await this.storage.commit(bytes, this.revision);
    this.committedBytes = bytes;
    return bytes;
  }

  // E2：durable=false 表示这次事务只停留在内存里（例如后台任务的 claim）。
  // 后台队列的 claim→checkpoint→complete 原本会产生三次全库导出与 IDB 提交；
  // 把中间态留在内存后，只有作为"恢复锚点"的事务才落盘，导出次数显著下降。
  // 代价：崩溃会让该任务从 pending 重跑一次 blocks 阶段（多花一次模型调用），
  // 但 failJob 仍是持久化的，所以 attempts 计数不会失控。
  async transaction(operation, { durable = true } = {}) {
    const db = this.ensureOpen();
    db.run('BEGIN');
    try {
      const result = operation(db);
      db.run('COMMIT');
      if (durable) await this.persist();
      return result;
    } catch (error) { this.restoreCommitted(); throw safeDatabaseError(error); }
  }

  claimNextJob(now, options) { return jobs.claimNextJob(this, now, options); }
  checkpointJob(claim, blockIds, classification) { return jobs.checkpointJob(this, claim, blockIds, classification); }
  completeJob(claim, entries) { return jobs.completeJob(this, claim, entries); }
  failJob(claim, options) { return jobs.failJob(this, claim, options); }
  loadTrail() { return jobs.loadTrail(this); }
  queueStats() { return jobs.queueStats(this); }
  // 切换学科后，主线程需要按新学科重新取一次会话摘要（启动时 bootstrap 已按偏好过滤）。
  listConversations(subject) {
    const db = this.ensureOpen();
    const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
    return rows(db, conversationSummarySql, [learnerId, normalizeSubject(subject)]).map(conversationSummary);
  }
  loadQuestionRoutes(conversationId) { return jobs.loadQuestionRoutes(this, conversationId); }
  loadAnswerQuestionRoutes(conversationId) { return jobs.loadAnswerQuestionRoutes(this, conversationId); }
  retryQuestionRoutes(messageId) { return jobs.retryQuestionRoutes(this, messageId); }
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
  loadActivePractice(subject) { return practice.loadActivePractice(this, subject); }
  loadPracticeItem(id) { return practice.loadPracticeItem(this, id); }
  listPracticeHistory(options) { return practice.listPracticeHistory(this, options); }
  loadPracticeUsage(subject) { return practice.loadPracticeUsage(this, subject); }
  gradePracticeItem(runId, itemId, attempt) { return practice.gradePracticeItem(this, runId, itemId, attempt); }
  revealPracticeItem(runId, itemId, options) { return practice.revealPracticeItem(this, runId, itemId, options); }
  advancePracticeItem(runId, itemId) { return practice.advancePracticeItem(this, runId, itemId); }
  recordPracticeHint(runId, itemId, level) { return practice.recordPracticeHint(this, runId, itemId, level); }
  savePracticeDraft(runId, itemId, text) { return practice.savePracticeDraft(this, runId, itemId, text); }
  finishChatPractice(runId, itemId) { return practice.finishChatPractice(this, runId, itemId); }
  setPracticeReview(runId, itemId, enabled) { return practice.setPracticeReview(this, runId, itemId, enabled); }
  listPracticeReviews(subject) { return practice.listPracticeReviews(this, subject); }
  disputePracticeItem(runId, itemId) { return practice.disputePracticeItem(this, runId, itemId); }

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

  // 只搜当前学科的会话；显式收学科参数，避免切换瞬间读到尚未落盘的旧偏好。
  searchConversations(value, subject = 'advanced') {
    const query = String(value ?? '').trim().slice(0, 120);
    if (!query) return [];
    return rows(this.ensureOpen(), `SELECT c.id,
      COALESCE((SELECT substr(m.content,MAX(1,instr(lower(m.content),lower(?))-24),160) FROM message m WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(m.content),lower(?))>0 ORDER BY m.seq LIMIT 1),'') AS snippet
      FROM conversation c WHERE c.subject = ? AND (instr(lower(c.title),lower(?))>0
      OR EXISTS(SELECT 1 FROM message m WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(m.content),lower(?))>0)
      OR EXISTS(SELECT 1 FROM message m JOIN message_attachment a ON a.message_id=m.id JOIN document d ON d.id=a.document_ref WHERE m.conversation_id=c.id AND m.superseded=0 AND instr(lower(d.text),lower(?))>0))
      ORDER BY c.pinned DESC,c.updated_at DESC,c.id LIMIT 50`, [query,query,normalizeSubject(subject),query,query,query]);
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
    // E7：练习卡与附件各用一条批量查询取回，替代"每条消息再查两次"的 N+1
    //（250 条消息原本是 500+ 次 SQL）。附件按 (message_id, seq) 排序后分组。
    const cards = new Map(rows(db, 'SELECT message_id, item_id FROM chat_practice WHERE message_id IN (SELECT id FROM message WHERE conversation_id=?)', [id])
      .map((row) => [row.message_id, row.item_id]));
    const attachmentsByMessage = new Map();
    for (const row of rows(db, `SELECT a.message_id, a.image_ref, a.document_ref, d.name AS document_name, d.mime AS document_mime, d.blob AS document_blob, d.text AS document_text
      FROM message_attachment a LEFT JOIN document d ON d.id = a.document_ref
      WHERE a.message_id IN (SELECT id FROM message WHERE conversation_id=?) ORDER BY a.message_id, a.seq`, [id])) {
      const list = attachmentsByMessage.get(row.message_id) ?? [];
      if (row.image_ref) {
        if (!images.has(row.image_ref)) images.set(row.image_ref, { ...this.loadImage(row.image_ref), kind: 'image' });
        list.push(images.get(row.image_ref));
      } else if (row.document_ref) {
        list.push({ id: row.document_ref, kind: 'document', name: row.document_name, mime: row.document_mime, bytes: row.document_blob, text: row.document_text });
      } else list.push(this.loadDocument(row.document_ref)); // 引用损坏时保持原来的报错
      attachmentsByMessage.set(row.message_id, list);
    }
    const messages = rows(db, 'SELECT * FROM message WHERE conversation_id=? ORDER BY seq,id', [id]).map((row) => {
      const item = { id: row.id, role: row.role, content: row.content, status: row.status, createdAt: row.created_at };
      const card = cards.get(row.id);
      if (card) item.practiceItemId = card;
      item.isMathQuestion = row.is_math_question === null ? null : Boolean(row.is_math_question);
      if (row.recognized_question !== null) item.recognizedQuestion = row.recognized_question;
      if (row.question_key !== null) item.questionKey = row.question_key;
      if (row.superseded) item.superseded = true;
      if (row.revision_of !== null) item.revisionOf = row.revision_of;
      if (row.revision_action !== null) item.revisionAction = row.revision_action;
      if (row.error !== null) item.error = row.error;
      if (row.reasoning_content) item.reasoningContent = row.reasoning_content;
      if (canResumeAnswer(item)) item.canRepair = true;
      if (row.recheck_of !== null) item.recheckOf = row.recheck_of;
      if (row.image_corrected) item.imageCorrected = true;
      if (row.image_ref) {
        if (!images.has(row.image_ref)) images.set(row.image_ref, this.loadImage(row.image_ref));
        item.image = images.get(row.image_ref);
      }
      const owned = attachmentsByMessage.get(row.id);
      if (owned?.length) item.attachments = owned;
      return item;
    });
    let revisionPaths = {};
    try { revisionPaths = normalizeRevisionPaths(JSON.parse(rows(db, 'SELECT value FROM setting WHERE key=?', [`chat_branches:${id}`])[0]?.value ?? '{}'), messages); } catch { /* Legacy conversations infer paths on first use. */ }
    return { id, revisionPaths, title: conversation.title ?? '', createdAt: conversation.created_at, updatedAt: conversation.updated_at, pinned: Boolean(conversation.pinned),
      methodId: conversation.method_id, titleStatus: conversation.title_status, subject: conversation.subject ?? 'advanced',
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

  // 单条消息写入（含它自己的附件重建）。seq 由调用方给定：增量路径用消息本身
  // 带的下标，兼容路径用它在完整消息数组里的下标。
  writeMessage(db, conversationId, message, seq) {
    if (message.image) this.saveImage(message.image, message.createdAt);
    db.run(`INSERT INTO message(id,conversation_id,role,content,image_ref,created_at,seq,status,error,recheck_of,image_corrected,reasoning_content,superseded,revision_of,revision_action)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,image_ref=excluded.image_ref,seq=excluded.seq,status=excluded.status,
      error=excluded.error,recheck_of=excluded.recheck_of,image_corrected=excluded.image_corrected,reasoning_content=excluded.reasoning_content,
      superseded=excluded.superseded,revision_of=excluded.revision_of,revision_action=excluded.revision_action`,
    [message.id, conversationId, message.role, message.content ?? '', message.image?.id ?? null, message.createdAt,
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

  // 修订路径的归一化：把已不在会话里的旧路径剔除。增量保存时给不出完整消息数组，
  // 因此以"数据库里已有 + 本次刚写入"的消息 id 为全集——效果与全量数组一致。
  reconcileRevisionPaths(db, conversation, messages) {
    if (conversation.revisionPaths === undefined) return;
    let universe;
    if (conversation.incremental === true) {
      universe = rows(db, 'SELECT id FROM message WHERE conversation_id=?', [conversation.id]).map((row) => row.id);
    } else {
      universe = messages.map((message) => message.id);
    }
    setSetting(db, `chat_branches:${conversation.id}`,
      JSON.stringify(normalizeRevisionPaths(conversation.revisionPaths, universe.map((id) => ({ id })))));
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
        const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        // D9 增量保存：persistence 只带脏消息，每条用 seq 标明它在会话里的下标，
        // 因此常态保存不再需要 seq 重排，也不再重写整个会话。
        const incremental = conversation.incremental === true;
        // 兼容路径保留旧行为：没有任何消息的新建空会话不落库。
        if (!incremental && !messages.length) continue;
        // 会话在创建时归属创建它的学科；旧调用方没有带字段时按高数处理。
        db.run(`INSERT INTO conversation(id,learner_id,title,created_at,updated_at,pinned,method_id,title_status,subject) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at,pinned=excluded.pinned,method_id=excluded.method_id,title_status=excluded.title_status,subject=excluded.subject`,
        [conversation.id, learnerId, conversation.title, conversation.createdAt, conversation.updatedAt, conversation.pinned ? 1 : 0, conversation.methodId ?? null, conversation.titleStatus ?? 'legacy', normalizeSubject(conversation.subject)]);
        if (incremental) {
          for (const message of messages) {
            this.writeMessage(db, conversation.id, message, Number.isInteger(message.seq) ? message.seq : messages.length);
          }
        } else {
          // A new revision can insert in the middle. Move the old sequence range
          // aside before assigning final positions so UNIQUE(conversation_id,seq)
          // never rejects the new user message against its archived predecessor.
          const offset = (rows(db, 'SELECT MAX(seq) AS value FROM message WHERE conversation_id=?', [conversation.id])[0]?.value ?? 0) + messages.length + 1;
          db.run('UPDATE message SET seq=seq+? WHERE conversation_id=?', [offset, conversation.id]);
          for (let seq = 0; seq < messages.length; seq += 1) this.writeMessage(db, conversation.id, messages[seq], seq);
        }
        this.reconcileRevisionPaths(db, conversation, messages);
      }
      jobs.cancelSupersededJobs(db);
      // E8：队列钩子只在本次确有回答进入终态时才跑，避免每个流式批次都空转一次
      // "message LEFT JOIN queue_job" 的全表扫描。
      const settled = (changes.conversations ?? []).filter((conversation) => !conversation.revisionViewOnly
        && (conversation.messages ?? []).some((message) => message.role === 'assistant' && message.status === 'complete'));
      if (settled.length) jobs.enqueueAnswers(db, settled.map((conversation) => conversation.id));
      db.run('COMMIT');
      await this.persist();
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
      // A backup restores every question source, including failed or
      // untranscribed image questions. All image references remain intact.
      // Re-encode backup images when supported; never modify local originals.
      await this.shrinkBackupImages(copy);
      // A row deletion alone is insufficient: old/rotated keys can remain in
      // free pages or unused cells. Rebuild the copied database before export.
      copy.run('VACUUM');
      return exportBytes(copy);
    } catch (error) {
      throw safeDatabaseError(error, '无法安全导出这份数据。原数据仍保留，API Key 不会写入导出文件。');
    } finally { copy?.close(); }
  }

  // 档案里的图片也降采样重编码为 JPEG，
  // 让备份体积不再取决于拍照/裁切的原始分辨率。只有确实变小才替换；
  // 环境不支持或编码失败时保持原图（宁可不压，也不能阻断导出）。
  async shrinkBackupImages(db) {
    let changed = 0;
    for (const row of rows(db, 'SELECT id, blob, mime FROM image')) {
      const result = await this.reencodeImage(row.blob, row.mime);
      if (!result?.bytes?.length || result.bytes.length >= row.blob.length) continue;
      db.run('UPDATE image SET blob=?, mime=? WHERE id=?', [result.bytes, result.mime, row.id]);
      changed += 1;
    }
    return changed;
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

  async commitImport(token, { modelConfig } = {}) {
    const candidate = this.candidates.get(token);
    if (!candidate) throw new DatabaseError('待导入文件已失效，请重新选择文件。', 'import_expired');
    try {
      // Preserve device credentials in the same durable import snapshot.
      if (modelConfig) for (const [property, key] of Object.entries(configKeys)) {
        const value = modelConfig[property];
        if (value === undefined || value === null) candidate.run('DELETE FROM setting WHERE key=?', [key]);
        else setSetting(candidate, key, String(value));
      }
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
