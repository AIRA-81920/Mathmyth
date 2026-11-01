import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createStore } from 'zustand/vanilla';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { startQueue } from '../src/core/queue/runner.js';
import {
  record, readAll, clear, snapshot, breakdownUsable, breakdownBusy, maskSecrets,
  MAX_EVENTS, DIAG_STORAGE_KEY,
} from '../src/core/queue/diagnostics.js';

// 最小 localStorage 替身：诊断模块只要求 getItem/setItem/removeItem。
function fakeStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key), get size() { return map.size; }, _map: map };
}

test('环形缓冲只保留最近 200 条，按时间顺序覆盖最旧的', () => {
  clear();
  for (let index = 0; index < MAX_EVENTS + 25; index += 1) record('test:ring', 'n' + index);
  const events = readAll();
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(events[0].detail, 'n25');
  assert.equal(events.at(-1).detail, 'n' + (MAX_EVENTS + 24));
  assert.ok(events.every((event) => typeof event.at === 'number' && event.level && event.code && typeof event.detail === 'string'));
  clear();
});

test('事件写入 localStorage，重新加载模块后仍能读回', async () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    clear();
    record('test:persist', '重启之前写下的一条');
    assert.ok(storage.getItem(DIAG_STORAGE_KEY).includes('重启之前写下的一条'));
    // 用带查询串的 URL 绕过 ESM 缓存，模拟一次重新启动。
    const fresh = await import('../src/core/queue/diagnostics.js?restart=1');
    const restored = fresh.readAll();
    assert.equal(restored.at(-1).code, 'test:persist');
    assert.equal(restored.at(-1).detail, '重启之前写下的一条');
    fresh.clear();
    assert.equal(storage.getItem(DIAG_STORAGE_KEY), null, '清空后 localStorage 里也不该留东西');
  } finally { delete globalThis.localStorage; }
  clear();
});

test('detail 里的疑似密钥被脱敏：sk- 开头与长度超过 20 的十六进制串', () => {
  clear();
  const hex = '0123456789abcdef01234567';
  record('test:secret', 'sk-live-abcdefghijklmnop ' + hex + ' 普通文本');
  const detail = readAll().at(-1).detail;
  assert.ok(!detail.includes('sk-live'), '不能记录 sk- 开头的 Key');
  assert.ok(!detail.includes(hex), '不能记录长十六进制串');
  assert.ok(detail.includes('***'));
  assert.ok(detail.includes('普通文本'));
  // 对象里带密钥语义的字段即使不是 sk- 前缀也整体置空。
  record('test:secret-obj', { apiKey: 'plain-secret', headers: { authorization: 'Bearer abc' }, model: 'm' });
  const objectDetail = readAll().at(-1).detail;
  assert.ok(!objectDetail.includes('plain-secret'));
  assert.ok(!objectDetail.includes('Bearer abc'));
  assert.ok(objectDetail.includes('"model":"m"'));
  assert.equal(maskSecrets('key=sk-1234567890'), 'key=***');
  clear();
});

test('breakdownUsable 逐项对齐全 6 个条件', () => {
  const base = { storageInitialized: true, onboarded: true, dataOperation: null, route: 'main', storageStatus: 'ready',
    modelConfig: { apiBase: 'https://qa.invalid/v1', apiKey: 'k', model: 'm' } };
  const ok = breakdownUsable(base);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.items.map((item) => item.key),
    ['storageInitialized', 'onboarded', 'dataOperation', 'route', 'storageStatus', 'modelConfigValid']);
  const cases = {
    storageInitialized: { storageInitialized: false }, onboarded: { onboarded: false },
    dataOperation: { dataOperation: 'import' }, route: { route: 'settings' },
    storageStatus: { storageStatus: 'error' }, modelConfigValid: { modelConfig: { ...base.modelConfig, apiKey: '' } },
  };
  for (const [key, patch] of Object.entries(cases)) {
    const broken = breakdownUsable({ ...base, ...patch });
    assert.equal(broken.ok, false, key + ' 为假时整体必须不可用');
    assert.equal(broken.items.find((item) => item.key === key).pass, false, key + ' 必须单独为假');
    assert.equal(broken.items.filter((item) => !item.pass).length, 1, key + ' 只应影响自己');
  }
  assert.equal(breakdownUsable({ ...base, storageStatus: 'error' }).items.find((item) => item.key === 'storageStatus').value, 'error',
    'storageStatus 要带出实际字符串');
  assert.equal(breakdownUsable({ ...base, route: 'settings' }).items.find((item) => item.key === 'route').value, 'settings');
});

test('breakdownBusy 逐项对齐 4 个来源，并列出为 true 的 itemId', () => {
  const idle = breakdownBusy({ practice: { generating: false, modelBusy: false }, chat: { checking: {} }, streamingCount: 0 });
  assert.equal(idle.busy, false);
  assert.deepEqual(idle.items.map((item) => item.key),
    ['practice.generating', 'practice.modelBusy', 'chat.checking', 'streamingCount', 'signalBusy']);
  assert.equal(breakdownBusy({ practice: { generating: true } }).busy, true);
  assert.equal(breakdownBusy({ practice: { modelBusy: true } }).busy, true);
  const checking = breakdownBusy({ chat: { checking: { 'message-1': true, 'message-2': false } } });
  assert.equal(checking.busy, true);
  assert.deepEqual(checking.items.find((item) => item.key === 'chat.checking').value, ['message-1'], '只列出为 true 的 itemId');
  const streaming = breakdownBusy({ streamingCount: 2 });
  assert.equal(streaming.busy, true);
  assert.equal(streaming.items.find((item) => item.key === 'streamingCount').value, 2, '数值要原样带出');
  assert.equal(breakdownBusy({ streamingCount: undefined }).busy, false, '没有该字段的旧 store 不能算忙');
  assert.equal(breakdownBusy({ signal: true }).busy, true);
  assert.equal(idle.text.includes('practice.generating=false'), true);
});

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const config = { apiBase: 'https://qa.invalid/v1', apiKey: 'fake-key', model: 'fake-model', supportsImage: false };
const timestamp = '2026-10-09T02:00:00.000Z';
const conversation = (id) => ({ id, title: '求极限', createdAt: timestamp, updatedAt: timestamp, messages: [
  { id: id + '-u', role: 'user', content: '求 sin(x)/x 的极限。', createdAt: timestamp },
  { id: id + '-a', role: 'assistant', content: '检查洛必达条件后求导。', status: 'complete', createdAt: timestamp },
] });

async function setup() {
  const disk = { record: null, async load() { return this.record; }, async commit(bytes, revision) {
    this.record = { bytes: bytes.slice(), revision: revision + 1 }; return revision + 1; } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: disk });
  await engine.initializeDatabase();
  await engine.saveChanges({ modelConfig: config, onboarded: true, conversations: [conversation('d1'), conversation('d2')] });
  return engine;
}

test('queueStats 只读地统计 pending/running/failed 与最旧 pending 的年龄', async (t) => {
  const engine = await setup();
  t.after(() => engine.close());
  let stats = engine.queueStats();
  assert.equal(stats.pending, 2);
  assert.equal(stats.running, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.claimable, 2, '两个任务都应当可领取');
  assert.ok(stats.createdAtOfOldestPending);
  assert.ok(stats.ageOfOldestPendingMs >= 0);
  const claim = await engine.claimNextJob();
  stats = engine.queueStats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.running, 1);
  assert.equal(stats.claimable, 1);
  await engine.failJob(claim, { cancelled: false });
  stats = engine.queueStats();
  assert.equal(stats.running, 0);
  assert.equal(stats.pending, 2, '非终态失败会退回 pending');
  assert.equal(stats.claimable, 1, '刚失败的那个还在退避窗口里，不可领取');
  assert.equal(engine.db.exec('SELECT count(*) FROM queue_job')[0].values[0][0], 2, '统计不得增删任务');
});

test('runner 记录 pump 入口与出口原因，snapshot 能读出 usable/busy 与最后活动时间', async () => {
  clear();
  const store = createStore(() => ({ storageInitialized: false, onboarded: true, dataOperation: null,
    storageStatus: 'memory', route: 'main', modelConfig: config, conversations: [], streamingCount: 0 }));
  const stop = startQueue({ store, database: { onDatabaseChange: () => () => {} }, getSkeleton: async () => ({}), pollDelay: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  stop();
  const codes = readAll().map((event) => event.code);
  assert.ok(codes.includes('queue:start'), '必须记录启动');
  assert.ok(codes.includes('pump:enter'), '必须记录 pump 进入');
  assert.ok(codes.includes('pump:not-usable'), '不可用时必须记录出口原因');
  assert.ok(codes.includes('queue:dispose'), '必须记录 dispose');
  const snap = snapshot();
  assert.ok(snap.queue.startedAt, '启动时间要能读到');
  assert.ok(snap.queue.lastActivityAt, '最后活动时间要能读到');
  assert.ok(snap.queue.disposedAt, 'dispose 时间要能读到');
  assert.equal(snap.queue.running, false);
  assert.equal(snap.usable.ok, false);
  assert.equal(snap.usable.items.find((item) => item.key === 'storageInitialized').pass, false);
  assert.ok(snap.events.length > 0);
  clear();
});
