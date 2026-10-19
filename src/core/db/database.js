import { DatabaseError } from './errors.js';
import { dataUrlToBytes } from '../images/input.js';

let worker;
let nextRequest = 0;
let generation = 0;
const pending = new Map();
const knownImages = new Set();
const listeners = new Set();

function rejectPending(message) {
  for (const { reject } of pending.values()) reject(new DatabaseError(message, 'worker_failed'));
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker !== 'function') throw new DatabaseError('当前环境无法启动本地数据库，请检查浏览器或 App 版本。', 'worker_unavailable');
  worker = new Worker(new URL('./database.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'changed') {
      listeners.forEach((listener) => { try { listener(data); } catch { /* Independent subscribers cannot break storage. */ } });
      return;
    }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.ok) {
      generation = data.generation;
      request.resolve(data.result);
    } else request.reject(new DatabaseError(data.error.userMessage, data.error.code));
  };
  const fail = () => {
    rejectPending('本地数据库暂时无法运行，请重新打开 App 后重试。');
    worker?.terminate();
    worker = undefined;
    generation = 0;
    knownImages.clear();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return worker;
}

function rpcAt(epoch, method, ...args) {
  return new Promise((resolve, reject) => {
    let id;
    try {
      const target = getWorker();
      id = ++nextRequest;
      pending.set(id, { resolve, reject });
      target.postMessage({ id, method, args, epoch });
    } catch (error) {
      if (id !== undefined) pending.delete(id);
      reject(error instanceof DatabaseError ? error : new DatabaseError('无法提交本地数据操作，请重试。', 'worker_failed'));
    }
  });
}

const rpc = (method, ...args) => rpcAt(generation, method, ...args);
export function onDatabaseChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export const claimNextJob = () => rpc('claimNextJob');
export const checkpointJob = (claim, blockIds, classification) => rpcAt(claim.generation, 'checkpointJob', claim, blockIds, classification);
export const completeJob = (claim, entries) => rpcAt(claim.generation, 'completeJob', claim, entries);
export const failJob = (claim, options) => rpcAt(claim.generation, 'failJob', claim, options);
export const loadTrail = () => rpc('loadTrail');
export const loadQuestionRoutes = (conversationId) => rpc('loadQuestionRoutes', conversationId);
export const retryQuestionRoutes = (messageId) => rpc('retryQuestionRoutes', messageId);
export const loadPatternProgress = () => rpc('loadPatternProgress');
export const listPersonalNotes = () => rpc('listPersonalNotes');
export const savePersonalNote = (input) => rpc('savePersonalNote', input);
export const deletePersonalNote = (id) => rpc('deletePersonalNote', id);
export const listStarredQuestions = (options) => rpc('listStarredQuestions', options);
export const loadStarredQuestion = (id) => rpc('loadStarredQuestion', id);
export async function setQuestionStar(input) {
  const result = await rpc('setQuestionStar', input);
  if (!result.starred) knownImages.clear();
  return result;
}
export async function removeStarredQuestion(id) {
  const result = await rpc('removeStarredQuestion', id);
  knownImages.clear();
  return result;
}
export const getMessageQuestionClassification = (id) => rpc('getMessageQuestionClassification', id);
export const requestMessageQuestionClassification = (id) => rpc('requestMessageQuestionClassification', id);
export const createPracticeRun = (input) => rpc('createPracticeRun', input);
export const appendPracticeItems = (run, items, status) => rpcAt(run.generation, 'appendPracticeItems', run.id, items, status);
export const updateConversation = (id, patch) => rpc('updateConversation', id, patch);
export async function deleteConversation(id, includeLearning) {
  const result = await rpc('deleteConversation', id, includeLearning);
  knownImages.clear();
  return result;
}
export const loadActivePractice = () => rpc('loadActivePractice');
export const loadPracticeItem = (id) => rpc('loadPracticeItem', id);
export const listPracticeHistory = (options) => rpc('listPracticeHistory', options);
export const loadPracticeUsage = () => rpc('loadPracticeUsage');
export const searchConversations = (query) => rpc('searchConversations', query);
export const gradePracticeItem = (run, itemId, attempt) => rpcAt(run.generation, 'gradePracticeItem', run.id, itemId, attempt);
export const revealPracticeItem = (run, itemId, options) => rpcAt(run.generation, 'revealPracticeItem', run.id, itemId, options);
export const advancePracticeItem = (run, itemId) => rpcAt(run.generation, 'advancePracticeItem', run.id, itemId);

function rememberImages(conversation) {
  for (const message of conversation.messages ?? []) if (message.image?.id) knownImages.add(message.image.id);
  for (const message of conversation.messages ?? []) for (const attachment of message.attachments ?? []) knownImages.add(attachment.id);
  return conversation;
}

function prepareChanges(changes) {
  const prepared = {};
  if (changes.modelConfig !== undefined) prepared.modelConfig = { ...changes.modelConfig };
  if (changes.onboarded !== undefined) prepared.onboarded = changes.onboarded;
  if (changes.preferences !== undefined) prepared.preferences = { ...changes.preferences, trailExpanded: { ...changes.preferences.trailExpanded } };
  if (changes.conversations !== undefined) prepared.conversations = changes.conversations.map((conversation) => ({
    id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, pinned: conversation.pinned,
    methodId: conversation.methodId, titleStatus: conversation.titleStatus,
    revisionPaths: conversation.revisionPaths, revisionViewOnly: conversation.revisionViewOnly,
    messages: (conversation.messages ?? []).map((message) => {
      const result = {
        id: message.id, role: message.role, content: message.content, createdAt: message.createdAt,
        status: message.status, error: message.error, recheckOf: message.recheckOf, imageCorrected: message.imageCorrected,
        reasoningContent: message.reasoningContent,
        superseded: message.superseded, revisionOf: message.revisionOf, revisionAction: message.revisionAction,
      };
      if (message.image) {
        const image = message.image;
        result.image = { id: image.id, name: image.name, mime: image.mime };
        if (!knownImages.has(image.id)) {
          result.image.bytes = image.bytes instanceof Uint8Array ? image.bytes : dataUrlToBytes(image.dataUrl);
          // RPCs are serial: a later reference follows this image insertion.
          // If a save fails, clear this cache so a retry sends original bytes.
          knownImages.add(image.id);
        }
      }
      if (message.attachments) result.attachments = message.attachments.map((attachment) => {
        const item = { id: attachment.id, kind: attachment.kind, name: attachment.name, mime: attachment.mime, text: attachment.text };
        if (!knownImages.has(item.id)) {
          item.bytes = attachment.bytes instanceof Uint8Array ? attachment.bytes : dataUrlToBytes(attachment.dataUrl);
          knownImages.add(item.id);
        }
        return item;
      });
      return result;
    }),
  }));
  return prepared;
}

export const initializeDatabase = () => rpc('initializeDatabase');
export async function loadConversation(id) { return rememberImages(await rpc('loadConversation', id)); }
export async function loadImage(id) {
  const image = await rpc('loadImage', id);
  knownImages.add(image.id);
  return image;
}
export async function saveChanges(changes = {}) {
  try { return await rpc('saveChanges', prepareChanges(changes)); }
  catch (error) { knownImages.clear(); throw error; }
}
// Preserve callers' API name while allowing only a credential-free file export.
export const exportDatabase = () => rpc('exportBackup');
export const prepareImport = (bytes) => rpc('prepareImport', bytes);
export const cancelImport = (token) => rpc('cancelImport', token);
export async function commitImport(token) {
  const result = await rpc('commitImport', token);
  knownImages.clear();
  return result;
}
export async function clearDatabase() {
  const result = await rpc('clearDatabase');
  knownImages.clear();
  return result;
}
