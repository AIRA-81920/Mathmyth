// 队列诊断埋点：只观察、不改变任何业务判定。
//
// 用途：手机端"本题路径"永远停在「整理中」时，需要在屏幕上区分三种可能——
// ① 启动时 import 链失败（startQueue 从未被调用）；② usable() 的某个条件为假；
// ③ foregroundBusy() 长期为真。这里只记录这些事实，不参与任何判断。
//
// 摘除方式：删除本文件，并删掉各处 record() / 状态上报调用即可，业务代码不受影响。
import { validateModelConfig } from '../config/providers.js';

export const DIAG_STORAGE_KEY = 'mathmyth.queue.diag.v1';
export const MAX_EVENTS = 200;
const MAX_DETAIL = 600;

// 懒加载：没有 localStorage 的环境（node 测试、Worker）也不要紧。
let events = null;
let lastPersisted = '';

function emptyQueue() {
  return { startedAt: null, lastActivityAt: null, disposedAt: null, running: false, hasTimer: false, lastExit: null };
}
let queue = emptyQueue();
let usable = null;
let busy = null;

// 疑似密钥一律脱敏：sk- 开头的 Key、长度超过 20 的十六进制串（如哈希/ID）。
export function maskSecrets(text) {
  return String(text ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '***')
    .replace(/\b[0-9a-fA-F]{21,}\b/g, '***');
}

const SECRET_KEY = /api[_-]?key|token|secret|authorization/i;

// 对象里带密钥语义的字段直接置空，比事后正则更可靠。
function redact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (typeof value === 'string') return maskSecrets(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = SECRET_KEY.test(key) ? '***' : redact(item, depth + 1);
  return result;
}

function describe(detail) {
  if (detail === undefined || detail === null) return '';
  if (typeof detail === 'string') return maskSecrets(detail).slice(0, MAX_DETAIL);
  try { return maskSecrets(JSON.stringify(redact(detail))).slice(0, MAX_DETAIL); }
  catch { return '[detail 无法序列化]'; }
}

function levelFor(code) {
  if (/:(fail|error)$/.test(code)) return 'error';
  if (/not-usable|aborted|:warn$/.test(code)) return 'warn';
  return 'info';
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function ensureLoaded() {
  if (events) return events;
  events = [];
  const target = storage();
  if (!target) return events;
  try {
    const raw = target.getItem(DIAG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) events = parsed.slice(-MAX_EVENTS);
  } catch { events = []; }
  return events;
}

function persist() {
  const target = storage();
  if (!target) return;
  try {
    const payload = JSON.stringify(events);
    if (payload === lastPersisted) return;
    target.setItem(DIAG_STORAGE_KEY, payload);
    lastPersisted = payload;
  } catch { /* 诊断写入失败绝不能影响业务 */ }
}

export function record(code, detail) {
  const list = ensureLoaded();
  list.push({ at: Date.now(), level: levelFor(String(code)), code: String(code), detail: describe(detail) });
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  persist();
}

// Only a rejected classification response is captured, never a request/config.
// Scrub the exact active credential even if it has an unfamiliar key format.
export function recordLocationFailure({ phase, text, error, apiKey }) {
  let safe = String(text ?? '');
  if (apiKey) safe = safe.split(String(apiKey)).join('***');
  try { safe = JSON.stringify(redact(JSON.parse(safe))); }
  catch { safe = safe.replace(/("(?:api[_-]?key|token|secret|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"***"'); }
  safe = maskSecrets(safe).slice(0, 4000);
  record('locate:rejected', { phase, reason: error?.message, ...error?.location,
    responseChars: String(text ?? '').length, capturedChars: safe.length });
  const count = Math.ceil(safe.length / 500);
  for (let index = 0; index < count; index += 1) {
    record('locate:response', `${index + 1}/${count} ${safe.slice(index * 500, (index + 1) * 500)}`);
  }
}

export function readAll() {
  return ensureLoaded().slice();
}

export function clear() {
  events = [];
  lastPersisted = '';
  queue = emptyQueue();
  usable = null;
  busy = null;
  try { storage()?.removeItem(DIAG_STORAGE_KEY); } catch { /* 同上 */ }
}

// 队列自身状态：由 runner 上报（启动/活动/退出/dispose/running/timer）。
export function markQueueStart(detail) {
  queue = { ...emptyQueue(), startedAt: Date.now() };
  record('queue:start', detail);
}
export function markQueueDispose() {
  queue = { ...queue, disposedAt: Date.now(), running: false, hasTimer: false };
  record('queue:dispose', 'startQueue 返回的 stop 被调用');
}
export function markActivity() { queue = { ...queue, lastActivityAt: Date.now() }; }
export function setQueueState(patch) { queue = { ...queue, ...patch }; }
export function noteBreakdown({ usable: nextUsable, busy: nextBusy }) {
  if (nextUsable) usable = nextUsable;
  if (nextBusy) busy = nextBusy;
}

export function snapshot() {
  const list = readAll();
  return {
    queue: {
      ...queue,
      idleMs: queue.lastActivityAt ? Date.now() - queue.lastActivityAt : null,
      sinceStartMs: queue.startedAt ? Date.now() - queue.startedAt : null,
    },
    usable,
    busy,
    eventCount: list.length,
    events: list.slice(-30),
  };
}

// usable() 的逐项拆解：与 runner 里 usable() 完全同构（只读，不参与判断）。
export function breakdownUsable(state = {}) {
  const config = state.modelConfig ?? {};
  const validation = validateModelConfig(config);
  const items = [
    { key: 'storageInitialized', label: '数据库已初始化', pass: Boolean(state.storageInitialized), value: state.storageInitialized ?? null },
    { key: 'onboarded', label: '已完成首启', pass: Boolean(state.onboarded), value: state.onboarded ?? null },
    { key: 'dataOperation', label: '没有正在进行的导入/导出', pass: !state.dataOperation, value: state.dataOperation ?? null },
    { key: 'route', label: '不在设置页', pass: state.route !== 'settings', value: state.route ?? null },
    { key: 'storageStatus', label: '存储状态不是 error', pass: state.storageStatus !== 'error', value: state.storageStatus ?? null },
    { key: 'modelConfigValid', label: '模型配置有效', pass: validation.valid,
      value: validation.valid ? true : Object.keys(validation.errors ?? {}) },
  ];
  return { ok: items.every((item) => item.pass), items,
    text: items.map((item) => item.key + '=' + item.pass + '(' + describe(item.value) + ')').join(' ') };
}

// foregroundBusy() 的逐项拆解：practice.generating / practice.modelBusy / chat.checking / streamingCount。
export function breakdownBusy(stores = {}) {
  const practice = stores.practice ?? {};
  const checking = stores.chat?.checking ?? {};
  const checkingIds = Object.keys(checking).filter((id) => Boolean(checking[id]));
  const streaming = stores.streamingCount;
  const items = [
    { key: 'practice.generating', label: '正在生成练习', pass: Boolean(practice.generating), value: practice.generating ?? null },
    { key: 'practice.modelBusy', label: '练习正在占用模型', pass: Boolean(practice.modelBusy), value: practice.modelBusy ?? null },
    { key: 'chat.checking', label: '对话练习检查中', pass: checkingIds.length > 0, value: checkingIds },
    { key: 'streamingCount', label: '正在流式作答的消息数', pass: typeof streaming === 'number' ? streaming > 0 : false,
      value: typeof streaming === 'number' ? streaming : null },
    { key: 'signalBusy', label: '前台信号判定为忙', pass: Boolean(stores.signal), value: stores.signal ?? null },
  ];
  return { busy: items.some((item) => item.pass), items,
    text: items.map((item) => item.key + '=' + item.pass + '(' + describe(item.value) + ')').join(' ') };
}
