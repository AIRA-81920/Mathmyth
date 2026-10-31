import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { SCHEMA_VERSION } from '../src/core/db/constants.js';
import { DatabaseError } from '../src/core/db/errors.js';
import { enqueueAnswers, pruneJobs } from '../src/core/queue/dbJobs.js';

const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const old = '2020-01-01T00:00:00.000Z';
const now = new Date('2026-10-28T00:00:00.000Z');
const answer = '固定 x 按模分类；比较左右极限。';
const entries = [{ scenario_id: 'S.limit.function_sequence_limit', method_id: 'M.pointwise_limit', is_main: true },
  { scenario_id: 'S.limit.piecewise_continuity', method_id: 'M.one_sided_limit', is_main: false }];
const value = (engine, sql, params = []) => engine.db.exec(sql, params)[0]?.values[0]?.[0];
const config = { providerId: 'custom', apiBase: 'https://test.example/v1', apiKey: 'fixture-only-key', model: 'fixture-model', supportsImage: true };
function memoryStorage(bytes) {
  return {
    record: bytes ? { bytes: bytes.slice(), revision: 0 } : null,
    rejectNext: false,
    async load() { return this.record && { bytes: this.record.bytes.slice(), revision: this.record.revision }; },
    async commit(bytes, expected) {
      if (this.rejectNext) { this.rejectNext = false; throw new DatabaseError('模拟存储空间不足。', 'storage_quota'); }
      assert.equal(expected, this.record?.revision ?? 0);
      this.record = { bytes: bytes.slice(), revision: expected + 1 };
      return expected + 1;
    },
  };
}
async function open(storage = memoryStorage()) {
  const engine = new DatabaseEngine({ SQL, schemaSql, storage });
  await engine.initializeDatabase();
  return engine;
}
async function fixture() {
  const storage = memoryStorage();
  const engine = await open(storage);
  const conversation = { id: 'c', title: '题目路径', createdAt: old, updatedAt: old, messages: [
    { id: 'u', role: 'user', content: '求含参极限定义函数的间断点。', createdAt: old },
    { id: 'a', role: 'assistant', content: answer, status: 'complete', createdAt: old },
  ] };
  await engine.saveChanges({ modelConfig: config, onboarded: true, conversations: [conversation] });
  return { storage, engine, conversation };
}
async function complete(engine, result = { encounters: entries, routes: [{ user_message_id: 'u', question_index: 1,
  steps: [{ ...entries[0], evidence: '固定 x 按模分类' }, { ...entries[1], evidence: '比较左右极限' }] }] }) {
  const claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
  assert.ok(claim);
  await engine.checkpointJob(claim, ['B.limit'], { isMathQuestion: true, recognizedQuestion: '求含参极限定义函数的间断点。' });
  await engine.completeJob(claim, result);
  return engine.loadQuestionRoutes('c');
}

test('terminal task cleanup preserves ordered routes through repeated restarts and never re-enqueues old answers', async () => {
  const data = await fixture();
  let engine = data.engine;
  try {
    const before = await complete(engine);
    assert.equal(before[0].routes[0].steps.length, 2);
    assert.equal(value(engine, 'SELECT count(*) FROM classification_result'), 1);
    const archived = JSON.parse(value(engine, 'SELECT payload FROM classification_result'));
    assert.deepEqual(Object.keys(archived.source), ['userMessageId'], 'archive omits duplicated answer and conversation text');
    assert.equal(await engine.transaction(db => pruneJobs(db, now)), 1);
    assert.equal(value(engine, 'SELECT count(*) FROM queue_job'), 0);
    assert.deepEqual(engine.loadQuestionRoutes('c'), before);
    assert.equal(await engine.transaction(db => enqueueAnswers(db)), 0);
    for (let index = 0; index < 2; index += 1) {
      engine.close(); engine = await open(data.storage);
      assert.deepEqual(engine.loadQuestionRoutes('c'), before);
      assert.equal(value(engine, 'SELECT count(*) FROM queue_job'), 0);
    }
    await engine.saveChanges({ conversations: [{ ...data.conversation, updatedAt: now.toISOString(), messages: [
      ...data.conversation.messages,
      { id: 'u2', role: 'user', content: '再求另一个极限。', createdAt: now.toISOString() },
      { id: 'a2', role: 'assistant', content: '另一题的解答。', status: 'complete', createdAt: now.toISOString() },
    ] }] });
    assert.equal(value(engine, "SELECT count(*) FROM queue_job WHERE source_message_id='a'"), 0);
    assert.equal(value(engine, "SELECT count(*) FROM queue_job WHERE source_message_id='a2' AND status='pending'"), 1);
  } finally { engine.close(); }
});

test('a completed empty classification is still a durable completion marker after cleanup', async () => {
  const data = await fixture();
  let engine = data.engine;
  try {
    await complete(engine, { encounters: [], routes: [] });
    await engine.transaction(db => pruneJobs(db, now));
    engine.close(); engine = await open(data.storage);
    assert.deepEqual(engine.loadQuestionRoutes('c'), []);
    assert.equal(value(engine, "SELECT count(*) FROM classification_result WHERE status='done'"), 1);
    assert.equal(value(engine, 'SELECT count(*) FROM queue_job'), 0);
    assert.equal(await engine.transaction(db => enqueueAnswers(db)), 0);
  } finally { engine.close(); }
});

test('a failed archived classification remains visible, is retried only explicitly and can finish normally', async () => {
  const data = await fixture();
  let engine = data.engine;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
      if (attempt === 1) await engine.checkpointJob(claim, ['B.limit'], { isMathQuestion: true });
      assert.equal((await engine.failJob(claim)).terminal, attempt === 3);
    }
    await engine.transaction(db => pruneJobs(db, now));
    engine.close(); engine = await open(data.storage);
    assert.equal(engine.loadQuestionRoutes('c')[0].status, 'failed');
    assert.equal(value(engine, 'SELECT count(*) FROM queue_job'), 0);
    assert.equal(await engine.transaction(db => enqueueAnswers(db)), 0);
    assert.equal((await engine.retryQuestionRoutes('unrelated-message')).retried, 0);
    assert.equal((await engine.retryQuestionRoutes('u')).retried, 1);
    assert.equal(engine.loadQuestionRoutes('c')[0].status, 'pending');
    assert.equal(value(engine, "SELECT attempts FROM queue_job WHERE source_message_id='a'"), 0);
    const result = await complete(engine);
    assert.equal(result[0].status, 'done');
    await engine.transaction(db => pruneJobs(db, now));
    engine.close(); engine = await open(data.storage);
    assert.deepEqual(engine.loadQuestionRoutes('c'), result);
    assert.equal(value(engine, 'SELECT count(*) FROM queue_job'), 0);
  } finally { engine.close(); }
});

test('version 9 migration archives existing task routes before old task cleanup', async () => {
  const data = await fixture();
  let migrated;
  try {
    const before = await complete(data.engine);
    data.engine.db.run('DROP TABLE practice_review; DROP TABLE classification_result; PRAGMA user_version=9');
    const storage = memoryStorage(await data.engine.exportDatabase());
    migrated = await open(storage);
    assert.equal(value(migrated, 'PRAGMA user_version'), SCHEMA_VERSION);
    assert.equal(value(migrated, 'SELECT count(*) FROM practice_review'), 0);
    assert.deepEqual(migrated.loadQuestionRoutes('c'), before);
    assert.equal(value(migrated, 'SELECT count(*) FROM classification_result'), 1);
    assert.equal(value(migrated, 'SELECT count(*) FROM queue_job'), 0);
    migrated.close(); migrated = await open(storage);
    assert.deepEqual(migrated.loadQuestionRoutes('c'), before);
    assert.equal(value(migrated, 'SELECT count(*) FROM queue_job'), 0);
  } finally { migrated?.close(); data.engine.close(); }
});

test('version 9 encounters whose task was already deleted migrate as unordered links without inventing paths or paid work', async () => {
  const data = await fixture();
  let migrated;
  try {
    await complete(data.engine);
    data.engine.db.run('DELETE FROM queue_job; DROP TABLE practice_review; DROP TABLE classification_result; PRAGMA user_version=9');
    migrated = await open(memoryStorage(await data.engine.exportDatabase()));
    const route = migrated.loadQuestionRoutes('c')[0];
    assert.equal(route.status, 'done');
    assert.equal(route.ordered, false, 'encounters establish involvement, not a sequential solution');
    assert.deepEqual(route.routes[0].steps, entries.map(({ scenario_id, method_id }) => ({ scenario_id, method_id })));
    assert.equal(value(migrated, 'SELECT count(*) FROM queue_job'), 0);
    assert.equal(await migrated.transaction(db => enqueueAnswers(db)), 0);
  } finally { migrated?.close(); data.engine.close(); }
});

test('import atomically preserves device settings and archived paths through a failed commit, retry and immediate restart', async () => {
  const data = await fixture();
  const storage = memoryStorage();
  let target = await open(storage);
  const local = { ...config, apiBase: 'https://device.example/v1', apiKey: 'device-only-test-key', model: 'device-model',
    auxiliaryModel: 'device-fast-model', auxiliaryThinking: 'none' };
  try {
    const paths = await complete(data.engine);
    await data.engine.transaction(db => pruneJobs(db, now));
    const bytes = await data.engine.exportBackup();
    const backup = new SQL.Database(bytes);
    assert.equal(backup.exec("SELECT count(*) FROM setting WHERE key='api_key'")[0].values[0][0], 0);
    backup.close();
    await target.saveChanges({ modelConfig: local, onboarded: true, conversations: [{ id: 'local', title: '本机题目',
      createdAt: old, updatedAt: old, messages: [{ id: 'local-u', role: 'user', content: '本机原题', createdAt: old }] }] });
    const candidate = await target.prepareImport(bytes);
    storage.rejectNext = true;
    await assert.rejects(target.commitImport(candidate.token, { modelConfig: local }), error => error.code === 'storage_quota');
    assert.equal(target.loadConversation('local').messages[0].content, '本机原题');
    assert.equal(value(target, "SELECT value FROM setting WHERE key='api_key'"), local.apiKey);
    assert.equal(value(target, 'SELECT count(*) FROM classification_result'), 0);
    const imported = await target.commitImport(candidate.token, { modelConfig: local });
    assert.deepEqual(imported.modelConfig, local);
    target.close(); target = await open(storage);
    assert.deepEqual((await target.initializeDatabase()).modelConfig, local);
    assert.deepEqual(target.loadQuestionRoutes('c'), paths);
    assert.equal(value(target, 'SELECT count(*) FROM queue_job'), 0);
    assert.equal(target.loadConversation('c').messages[0].content, data.conversation.messages[0].content);
  } finally { target.close(); data.engine.close(); }
});
