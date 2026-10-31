import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createStore } from 'zustand/vanilla';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { startQueue } from '../src/core/queue/runner.js';
import { createSkeleton } from '../src/core/skeleton/index.js';

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const config = { apiBase: 'https://qa.invalid/v1', apiKey: 'fake-key', model: 'fake-model', supportsImage: false };
const entries = [{ scenario_id: 'S.limit.0over0', method_id: 'M.lhopital', is_main: true }];
const timestamp = '2026-10-09T02:00:00.000Z';
const conversation = { id: 'q1', title: '求极限', createdAt: timestamp, updatedAt: timestamp, messages: [
  { id: 'u1', role: 'user', content: '求 sin(x)/x 的极限。', createdAt: timestamp },
  { id: 'a1', role: 'assistant', content: '检查洛必达条件后求导。', status: 'complete', createdAt: timestamp },
] };
function storage() {
  return { record: null, async load() { return this.record; }, async commit(bytes, revision) {
    assert.equal(revision, this.record?.revision ?? 0);
    this.record = { bytes: bytes.slice(), revision: revision + 1 };
    return revision + 1;
  } };
}
async function setup(sourceConversation = conversation, modelConfig = config) {
  const disk = storage();
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: disk });
  await engine.initializeDatabase();
  await engine.saveChanges({ modelConfig, onboarded: true, conversations: [sourceConversation] });
  return { engine, disk };
}

test('a foreground change during skeleton loading returns the claimed lease without spending an attempt', async (t) => {
  const { engine } = await setup();
  t.after(() => engine.close());
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null,
    storageStatus: 'ready', route: 'main', modelConfig: config, conversations: [] }));
  let loaded, release, failed;
  const loading = new Promise(resolve => { loaded = resolve; });
  const skeleton = new Promise(resolve => { release = resolve; });
  const returned = new Promise(resolve => { failed = resolve; });
  let calls = 0;
  const stop = startQueue({ store, database: { onDatabaseChange: () => () => {},
    claimNextJob: () => engine.claimNextJob(),
    failJob: async (claim, options) => { await engine.failJob(claim, options); failed(options); } },
    getSkeleton: () => { loaded(); return skeleton; },
    blocks: async () => { calls++; return []; }, pollDelay: 60_000 });
  t.after(stop);
  await loading;
  store.setState({ route: 'settings' });
  release({});
  assert.deepEqual(await returned, { cancelled: true });
  assert.equal(calls, 0);
  const claim = await engine.claimNextJob();
  assert.equal(claim.attempts, 1, '取消的那次认领不能消耗重试机会');
});

test('completed answer runs two background phases and writes exposure without practice success', async () => {
  const { engine } = await setup();
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null, storageStatus: 'ready',
    modelConfig: config, conversations: [conversation] }));
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const database = { onDatabaseChange: () => () => {}, claimNextJob: () => engine.claimNextJob(),
    checkpointJob: (...args) => engine.checkpointJob(...args), failJob: (...args) => engine.failJob(...args),
    completeJob: async (...args) => { const result = await engine.completeJob(...args); finish(); return result; } };
  const stop = startQueue({ store, database, getSkeleton: async () => ({}), pollDelay: 1000,
    blocks: async ({ source }) => { assert.equal(source.question, conversation.messages[0].content); calls.push('blocks'); return ['B.limit']; },
    edges: async ({ blockIds }) => { assert.deepEqual(blockIds, ['B.limit']); calls.push('edges'); return entries; } });
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('queue main flow timeout')), 1500).unref())]);
  stop();
  assert.deepEqual(calls, ['blocks', 'edges']);
  assert.equal(engine.loadTrail().encounters.length, 1);
  assert.ok(engine.loadTrail().mastery.every((row) => row.state === 'exposed' && row.successCount === 0 && row.faces.length === 0));
  await engine.saveChanges({ conversations: [conversation] });
  assert.equal(await engine.claimNextJob(), null);
  engine.close();
});

test('restart keeps the checkpoint and invalidates the old lease; clear cannot receive old writes', async () => {
  const { engine, disk } = await setup();
  const oldClaim = await engine.claimNextJob();
  await engine.checkpointJob(oldClaim, ['B.limit']);
  engine.close();
  const reopened = new DatabaseEngine({ SQL, schemaSql, storage: disk });
  await reopened.initializeDatabase();
  const current = await reopened.claimNextJob();
  assert.equal(current.payload.phase, 'edges');
  assert.deepEqual(current.payload.blockIds, ['B.limit']);
  assert.notEqual(current.leaseToken, oldClaim.leaseToken);
  assert.throws(() => reopened.completeJob(oldClaim, entries), /失效/);
  await reopened.clearDatabase();
  assert.throws(() => reopened.completeJob(current, entries), /失效/);
  assert.deepEqual(reopened.loadTrail(), { mastery: [], encounters: [] });
  reopened.close();
});
test('foreground answer immediately preempts background HTTP and returns its job without spending a retry', async () => {
  const { engine } = await setup();
  const store = createStore(() => ({ storageInitialized:true,onboarded:true,dataOperation:null,storageStatus:'ready',modelConfig:config,conversations:[conversation] }));
  let started, failed;
  const hasStarted = new Promise(resolve=>{started=resolve}), hasFailed = new Promise(resolve=>{failed=resolve});
  const database = { onDatabaseChange:()=>()=>{},claimNextJob:()=>engine.claimNextJob(), checkpointJob:(...args)=>engine.checkpointJob(...args),completeJob:(...args)=>engine.completeJob(...args),
    failJob:async(...args)=>{const result=await engine.failJob(...args);failed();return result;} };
  const stop=startQueue({store,database,getSkeleton:async()=>({}),pollDelay:1000,
    blocks:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});started();}),edges:async()=>entries});
  await hasStarted;
  store.setState({conversations:[{...conversation,messages:[{...conversation.messages[1],status:'streaming'}]}]});
  await hasFailed;stop();
  assert.equal(engine.loadTrail().encounters.length,0);
  assert.equal(engine.db.exec('SELECT attempts FROM queue_job')[0].values[0][0],0);engine.close();
});
test('practice foreground signals preempt background work independently of chat messages', async () => {
  const {engine}=await setup();
  const store=createStore(()=>({storageInitialized:true,onboarded:true,dataOperation:null,storageStatus:'ready',modelConfig:config,conversations:[conversation]}));
  let notify,busy=false,started,failed;
  const ready=new Promise(resolve=>{started=resolve}),returned=new Promise(resolve=>{failed=resolve});
  const database={onDatabaseChange:()=>()=>{},claimNextJob:()=>engine.claimNextJob(),checkpointJob:(...args)=>engine.checkpointJob(...args),completeJob:(...args)=>engine.completeJob(...args),
    failJob:async(...args)=>{await engine.failJob(...args);failed();}};
  const stop=startQueue({store,database,getSkeleton:async()=>({}),isForegroundBusy:()=>busy,subscribeForeground:callback=>{notify=callback;return()=>{};},
    blocks:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});started();}),edges:async()=>entries});
  await ready;busy=true;notify();await returned;stop();
  assert.equal(engine.db.exec('SELECT attempts FROM queue_job')[0].values[0][0],0);assert.equal(engine.loadTrail().encounters.length,0);engine.close();
});

test('image answer is classified asynchronously from its transcribed text and never sends the image again', async () => {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC';
  const image = { id: 'original-photo', mime: 'image/png', name: '题目.png', bytes: new Uint8Array(Buffer.from(encoded, 'base64')) };
  // D6 把转写题面写进用户消息正文，D7 让后台归位只吃这段文本。
  const photoConversation = { ...conversation, messages: [{ ...conversation.messages[0], content: '<mathmyth_question>求 $\\lim_{x\\to0}\\sin x/x$。</mathmyth_question>\n\n请解第一题', image }, conversation.messages[1]] };
  const visionConfig = { ...config, supportsImage: true };
  const { engine } = await setup(photoConversation, visionConfig);
  const directory = new URL('../../skeleton/', import.meta.url);
  const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(new URL(name, directory), 'utf8'))])));
  const store = createStore(() => ({ storageInitialized: true, onboarded: true, dataOperation: null, storageStatus: 'ready', modelConfig: visionConfig, conversations: [photoConversation] }));
  const originalFetch = globalThis.fetch;
  let finish, stop, calls = 0;
  const done = new Promise((resolve) => { finish = resolve; });
  globalThis.fetch = async (_url, options) => {
    const messages = JSON.parse(options.body).messages;
    // D7：请求体里不再有 image_url 分片，后台任务不再为图片付 token。
    assert.equal(typeof messages[1].content, 'string');
    assert.ok(!JSON.stringify(messages).includes('image_url'));
    const payload = JSON.parse(messages[1].content.split('\n')[0]);
    assert.ok(payload.source.question.includes('sin x/x'));
    assert.equal(payload.source.imageId, undefined);
    calls += 1;
    return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { block_ids: ['B.limit'], is_math_question: true, recognized_question: null } : { encounters: entries }) }, finish_reason: 'stop' }] });
  };
  const database = { onDatabaseChange: () => () => {}, claimNextJob: () => engine.claimNextJob(), loadImage: (id) => engine.loadImage(id),
    checkpointJob: (...args) => engine.checkpointJob(...args), failJob: (...args) => engine.failJob(...args),
    completeJob: async (...args) => { const result = await engine.completeJob(...args); finish(); return result; } };
  try {
    stop = startQueue({ store, database, getSkeleton: async () => skeleton, pollDelay: 1000 });
    await Promise.race([done, new Promise((_,reject) => setTimeout(() => reject(new Error('image queue timed out')),1500).unref())]);
    assert.equal(calls,2);
    assert.equal(engine.loadTrail().encounters.length,1);
    assert.equal(engine.getMessageQuestionClassification('u1').isMathQuestion,true);
    assert.ok(engine.loadTrail().mastery.every((row) => row.successCount === 0));
  } finally { stop?.(); globalThis.fetch = originalFetch; engine.close(); }
});
