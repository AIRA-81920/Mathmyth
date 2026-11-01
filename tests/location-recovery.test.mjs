import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createStore } from 'zustand/vanilla';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { parseEncounters, locateEdges } from '../src/core/ai/locate.js';
import { validateQuestionRoutes } from '../src/core/chat/questionRoutes.js';
import { STALL_MS } from '../src/core/chat/answerRoutes.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { startQueue } from '../src/core/queue/runner.js';
import { readAll, clear } from '../src/core/queue/diagnostics.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter(name => name.endsWith('.json'))
  .map(name => [name, JSON.parse(readFileSync(new URL(name, directory), 'utf8'))])));
const edge = { scenario_id: 'S.limit.0over0', method_id: 'M.taylor_expansion', is_main: true };
const source = { userMessageId: 'u', answer: '先用泰勒展开。\n再求极限。', context: [] };
const step = { scenario_id: edge.scenario_id, method_id: edge.method_id, evidence: '先用泰勒展开。' };
const route = { user_message_id: 'u', question_index: 1, paths: [{ steps: [step] }] };
const config = { apiBase: 'https://qa.invalid/v1', apiKey: 'fake-key', model: 'fake-model' };

test('同一连线在多个解法重复出现时去重，主线标记保留', () => {
  const entries = [{ ...edge, is_main: false }, edge, { ...edge, method_id: 'M.taylor' }];
  assert.deepEqual(parseEncounters(JSON.stringify({ encounters: entries }), skeleton, ['B.limit']), [edge]);
});

test('证据只修复空白和全角 ASCII，保存的仍是公开解答逐字原文', () => {
  const answer = '先取极限：\n$$\n\\frac{\\sin x}{x} = 1\n$$\n所以成立。';
  const evidence = '先取极限: $$\\frac{\\sin x}{x}=1$$';
  const clean = validateQuestionRoutes([{ ...route, paths: [{ steps: [{ ...step, evidence }] }] }], [edge], { ...source, answer });
  assert.equal(clean[0].paths[0].steps[0].evidence, '先取极限：\n$$\n\\frac{\\sin x}{x} = 1\n$$');
  assert.ok(answer.includes(clean[0].paths[0].steps[0].evidence));
});

test('证据不得把上下标、符号或模型改写当作排版差异', () => {
  for (const [answer, evidence] of [['x² = 1', 'x2 = 1'], ['x − 1 = 0', 'x + 1 = 0'], ['先求导。', '先求导后取极限。']]) {
    assert.throws(() => validateQuestionRoutes([{ ...route, paths: [{ steps: [{ ...step, evidence }] }] }], [edge], { ...source, answer }));
  }
});

async function withResponse(value, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });
  try { return await run(); } finally { globalThis.fetch = previous; }
}
const locate = () => locateEdges({ config, source, skeleton, blockIds: ['B.limit'] });

test('模型在 encounters 和路径中使用同一合法别名时，两处一起规范为正式 ID', async () => {
  const alias = 'M.taylor';
  const result = await withResponse({ encounters: [{ ...edge, method_id: alias }],
    routes: [{ ...route, paths: [{ steps: [{ ...step, method_id: alias }] }] }] }, locate);
  assert.equal(result.encounters[0].method_id, edge.method_id);
  assert.equal(result.routes[0].paths[0].steps[0].method_id, edge.method_id);
});

test('一个并列解法证据无效时保留另一条完整解法，不拼接残缺步骤', async () => {
  const invalidPath = { steps: [step, { ...step, evidence: '公开解答没有这一步。' }] };
  const result = await withResponse({ encounters: [edge], routes: [{ ...route, paths: [invalidPath, route.paths[0]] }] }, locate);
  assert.deepEqual(result.routes[0].paths, [route.paths[0]]);
});

test('所有解法都无依据时仍然拒绝，不能伪装为成功空结果', async () => {
  await assert.rejects(withResponse({ encounters: [edge], routes: [{ ...route,
    paths: [{ steps: [{ ...step, evidence: '公开解答没有这一步。' }] }] }] }, locate), /依据/);
});

test('失败定位保留模型原始题目和解法下标，不因逐解法校验而归零', async () => {
  const bad = { steps: [{ ...step, evidence: '没有这一句。' }] };
  await assert.rejects(withResponse({ encounters: [edge], routes: [route,
    { ...route, question_index: 2, paths: [bad, bad] }] }, locate),
  error => error.location?.routeIndex === 1 && error.location?.pathIndex === 1 && error.location?.stepIndex === 0);
});

test('校验失败保存脱敏且有上限的模型原文，真实 Key 不进入日志', async () => {
  clear();
  const value = { encounters: [{ ...edge, method_id: 'M.not_a_method' }], routes: [],
    reflected: config.apiKey, api_key: 'another-private-value', padding: '中'.repeat(5000) };
  await assert.rejects(withResponse(value, locate));
  const events = readAll().filter(event => event.code.startsWith('locate:'));
  assert.ok(events.some(event => event.code === 'locate:rejected'));
  const raw = events.filter(event => event.code === 'locate:response').map(event => event.detail).join('');
  assert.ok(raw.includes('M.not_a_method'));
  assert.ok(!raw.includes(config.apiKey));
  assert.ok(!raw.includes('another-private-value'));
  assert.ok(raw.length <= 4500);
  clear();
});

test('非法配对仍被拒绝，错误区分 ID 问题和摘录问题并指向具体数据', () => {
  assert.throws(() => parseEncounters(JSON.stringify({ encounters: [{ ...edge, method_id: 'M.not_a_method' }] }), skeleton, ['B.limit']),
    error => error.location?.entryIndex === 0 && error.location?.methodId === 'M.not_a_method');
  assert.throws(() => validateQuestionRoutes([{ ...route, paths: [{ steps: [{ ...step, evidence: '不存在的摘录。' }] }] }], [edge], source),
    error => error.location?.stepIndex === 0 && error.location?.edgePresent === true && error.location?.evidenceMatched === false);
});

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
async function setup(age = 0) {
  const engine = new DatabaseEngine({ SQL, schemaSql,
    storage: { load: async () => null, commit: async (_, revision) => revision + 1 } });
  await engine.initializeDatabase();
  const timestamp = new Date(Date.now() - age).toISOString();
  await engine.saveChanges({ conversations: [{ id: 'c', title: '极限', createdAt: timestamp, updatedAt: timestamp, messages: [
    { id: 'u', role: 'user', content: '求极限。', createdAt: timestamp },
    { id: 'a', role: 'assistant', content: source.answer, status: 'complete', createdAt: timestamp },
  ] }] });
  return engine;
}

test('刚超过面板的 2 分钟阈值就能重排，不再等数据库的 30 分钟', async t => {
  const engine = await setup(STALL_MS + 1000);
  t.after(() => engine.close());
  assert.equal(engine.loadAnswerQuestionRoutes('c')[0].stalled, true);
  assert.equal((await engine.retryQuestionRoutes('u')).retried, 1);
  assert.equal(engine.loadAnswerQuestionRoutes('c')[0].stalled, false, '重新排队后不能沿用原答案时间立刻再次判卡住');
  assert.equal((await engine.retryQuestionRoutes('u')).retried, 0, '刚重排的任务不能连续撤销租约');
});

test('超时的 running 任务也能重排，旧 lease 不再有写入权', async t => {
  const engine = await setup(STALL_MS + 1000);
  t.after(() => engine.close());
  const claim = await engine.claimNextJob();
  assert.equal(engine.loadAnswerQuestionRoutes('c')[0].stalled, true);
  assert.equal((await engine.retryQuestionRoutes('u')).retried, 1);
  assert.throws(() => engine.completeJob(claim, [edge]), /失效/);
});

test('当前会话的最新回答优先于旧会话积压，其余任务保留', async t => {
  const engine = await setup();
  t.after(() => engine.close());
  const old = '2020-01-01T00:00:00.000Z';
  await engine.saveChanges({ conversations: [{ id: 'backlog', title: '旧题', createdAt: old, updatedAt: old, messages: [
    { id: 'old-u', role: 'user', content: '旧题', createdAt: old },
    { id: 'old-a', role: 'assistant', content: '旧回答', status: 'complete', createdAt: old },
  ] }] });
  const claim = await engine.claimNextJob(undefined, { conversationId: 'c' });
  assert.equal(claim.id, 'locate:a');
  assert.equal(engine.queueStats().pending, 1);
});

test('同一会话有多个积压时先归位最新回答，其他会话仍按原顺序', async t => {
  const engine = await setup();
  t.after(() => engine.close());
  const timestamp = new Date().toISOString();
  await engine.saveChanges({ conversations: [{ id: 'c', title: '极限', createdAt: timestamp, updatedAt: timestamp, messages: [
    { id: 'u', role: 'user', content: '求极限。', createdAt: timestamp },
    { id: 'a', role: 'assistant', content: source.answer, status: 'complete', createdAt: timestamp },
    { id: 'u2', role: 'user', content: '求另一个极限。', createdAt: timestamp },
    { id: 'a2', role: 'assistant', content: source.answer, status: 'complete', createdAt: timestamp },
  ] }] });
  assert.equal((await engine.claimNextJob(undefined, { conversationId: 'c' })).id, 'locate:a2');
});

test('后台期限能结束不响应 abort 的模型 Promise，并拒绝迟到的结果', async t => {
  const engine = await setup();
  t.after(() => engine.close());
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null,
    storageStatus: 'ready', route: 'main', modelConfig: config, conversations: [], streamingCount: 0 }));
  let release, failed, failureOptions;
  const settled = new Promise(resolve => { failed = resolve; });
  const stop = startQueue({ store, pollDelay: 60_000, jobTimeoutMs: 25,
    database: { onDatabaseChange: () => () => {}, claimNextJob: () => engine.claimNextJob(),
      checkpointJob: (...args) => engine.checkpointJob(...args), completeJob: (...args) => engine.completeJob(...args),
      failJob: async (claim, options) => { failureOptions = options; await engine.failJob(claim, options); failed(); } },
    getSkeleton: async () => skeleton, blocks: async () => ['B.limit'],
    edges: () => new Promise(resolve => { release = resolve; }) });
  t.after(stop);
  const finished = await Promise.race([settled.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))]);
  assert.equal(finished, true, '期限到达必须释放 running，不能靠模型自行响应 abort');
  assert.deepEqual(failureOptions, { cancelled: false });
  const row = engine.db.exec('SELECT status,attempts FROM queue_job')[0].values[0];
  assert.deepEqual(row, ['pending', 1], '超时消耗失败预算，不能无限退回零次');
  release({ encounters: [edge], routes: [route] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(engine.loadTrail().encounters.length, 0);
});

test('后台期限不能被持续到达的真实思考 SSE 帧续期', async t => {
  const engine = await setup();
  t.after(() => engine.close());
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let interval, aborted = false, failed;
  t.after(() => clearInterval(interval));
  const settled = new Promise(resolve => { failed = resolve; });
  globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      const frame = new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"继续思考"}}]}\n\n');
      interval = setInterval(() => controller.enqueue(frame), 5);
      signal.addEventListener('abort', () => { aborted = true; clearInterval(interval); controller.close(); }, { once: true });
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null,
    storageStatus: 'ready', route: 'main', modelConfig: config, conversations: [], streamingCount: 0 }));
  const stop = startQueue({ store, pollDelay: 60_000, jobTimeoutMs: 30,
    database: { onDatabaseChange: () => () => {}, claimNextJob: () => engine.claimNextJob(),
      checkpointJob: (...args) => engine.checkpointJob(...args), completeJob: (...args) => engine.completeJob(...args),
      failJob: async (claim, options) => { await engine.failJob(claim, options); failed(options); } },
    getSkeleton: async () => skeleton, blocks: async () => ['B.limit'] });
  t.after(stop);
  const options = await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve(null), 150))]);
  assert.deepEqual(options, { cancelled: false });
  assert.equal(aborted, true);
});
