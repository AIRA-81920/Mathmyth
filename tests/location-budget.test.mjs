import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createStore } from 'zustand/vanilla';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { startQueue } from '../src/core/queue/runner.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { locateEdges } from '../src/core/ai/locate.js';

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const config = { apiBase: 'https://qa.invalid/v1', apiKey: 'fake-key', model: 'fake-model', supportsImage: false };
const timestamp = '2026-10-09T02:00:00.000Z';
const conversation = { id: 'q1', title: '求极限', createdAt: timestamp, updatedAt: timestamp, messages: [
  { id: 'u1', role: 'user', content: '求 sin(x)/x 的极限。', createdAt: timestamp },
  { id: 'a1', role: 'assistant', content: '检查洛必达条件后求导。', status: 'complete', createdAt: timestamp },
] };
const directory = new URL('../../skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, directory), 'utf8'))])));
const scenario = skeleton.scenarioById.get('S.limit.0over0');
const entries = [{ scenario_id: scenario.id, method_id: scenario.methods[0].method_id, is_main: true }];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function storage() {
  return { record: null, async load() { return this.record; }, async commit(bytes, revision) {
    this.record = { bytes: bytes.slice(), revision: revision + 1 };
    return revision + 1;
  } };
}

async function setup() {
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: storage() });
  await engine.initializeDatabase();
  await engine.saveChanges({ modelConfig: config, onboarded: true, conversations: [conversation] });
  return engine;
}

// 实机上的"整理很久然后失败"：两步共用一份 45 秒预算，第一步慢一点，第二步就只剩残羹。
// 这条守的是"每一步各有一份预算"——两步都不超时，加起来超过单份预算，也必须成功。
test('本题路径的两步各有一份超时预算，第二步不会被第一步吃光', async () => {
  const engine = await setup();
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null, storageStatus: 'ready',
    modelConfig: config, conversations: [conversation] }));
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const database = { onDatabaseChange: () => () => {}, claimNextJob: () => engine.claimNextJob(),
    checkpointJob: (...args) => engine.checkpointJob(...args), failJob: (...args) => engine.failJob(...args),
    completeJob: async (...args) => { const result = await engine.completeJob(...args); finish(); return result; } };
  const stop = startQueue({ store, database, getSkeleton: async () => ({}), pollDelay: 60_000, jobTimeoutMs: 200,
    blocks: async () => { await delay(130); calls.push('blocks'); return ['B.limit']; },
    edges: async () => { await delay(130); calls.push('edges'); return entries; } });
  try {
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('两步各 130ms，单份 200ms 预算下必须跑完')), 2000).unref())]);
    assert.deepEqual(calls, ['blocks', 'edges']);
    assert.equal(engine.loadTrail().encounters.length, 1);
  } finally { stop(); engine.close(); }
});

test('输出被长度上限截断时，救回已经写完整的 encounters，路径留空而不是整份作废', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const partial = '{"encounters":[' + JSON.stringify(entries[0]) + '],"routes":[{"user_message_id":"u1","question_inde';
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: partial }, finish_reason: 'length' }] });
  const result = await locateEdges({ config, source: { answer: '检查洛必达条件后求导。', userMessageId: 'u1' }, skeleton, blockIds: ['B.limit'] });
  assert.deepEqual(result.encounters, entries);
  assert.deepEqual(result.routes, []);
});

test('截断得连 encounters 都没写完时仍然按失败抛出，不用半截数据糊弄', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"encounters":[{"scenario_id":"S.limit.0' }, finish_reason: 'length' }] });
  await assert.rejects(locateEdges({ config, source: { answer: '检查洛必达条件后求导。', userMessageId: 'u1' }, skeleton, blockIds: ['B.limit'] }),
    (error) => error.code === 'truncated');
});
