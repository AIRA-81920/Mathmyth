import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { MAX_CANCELS } from '../src/core/queue/dbJobs.js';
import { STALL_MS, answerRouteSnapshots } from '../src/core/chat/answerRoutes.js';

const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const old = '2020-01-01T00:00:00.000Z';
const config = { providerId: 'custom', apiBase: 'https://t.example/v1', apiKey: 'k', model: 'm', supportsImage: false };

function storage() {
  return { record: null, async load() { return this.record && { bytes: this.record.bytes.slice(), revision: this.record.revision }; },
    async commit(bytes, expected) { this.record = { bytes: bytes.slice(), revision: expected + 1 }; return expected + 1; } };
}
async function fresh() {
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: storage() });
  await engine.initializeDatabase();
  await engine.saveChanges({ modelConfig: config, onboarded: true, conversations: [{ id: 'c', title: 't', createdAt: old, updatedAt: old, messages: [
    { id: 'u', role: 'user', content: '求含参极限的间断点。', createdAt: old },
    { id: 'a', role: 'assistant', content: '固定 x 按模分类。', status: 'complete', createdAt: old },
  ] }] });
  return engine;
}
const jobRow = (engine) => engine.db.exec("SELECT status,attempts,payload FROM queue_job WHERE kind='locate'")[0]?.values?.[0];
const uiStatus = async (engine) => (await engine.loadAnswerQuestionRoutes('c')).map((item) => ({ status: item.status, stalled: item.stalled }));

test('反复被取消也不会永远 pending：到上限就判失败，界面给出可重试状态', async () => {
  const engine = await fresh();
  assert.equal((await uiStatus(engine))[0].status, 'pending');
  for (let i = 1; i <= MAX_CANCELS; i += 1) {
    const claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
    assert.ok(claim, '第 ' + i + ' 次仍应能取到任务');
    const result = await engine.failJob(claim, { cancelled: true });
    if (i < MAX_CANCELS) {
      assert.equal(result.terminal, false);
      assert.equal(jobRow(engine)[0], 'pending');
    }
  }
  const [row] = jobRow(engine);
  assert.equal(row, 'failed', '取消到上限必须落成 failed');
  const shown = await uiStatus(engine);
  assert.equal(JSON.stringify(shown), JSON.stringify([{ status: 'failed', stalled: false }]), '界面状态：' + JSON.stringify(shown));
  // 停止条件：再 claim 拿不到任务了
  assert.equal(await engine.claimNextJob('2099-01-01T00:00:00.000Z'), null);
});

test('真失败仍然是 3 次上限，取消次数不占这 3 次预算', async () => {
  const engine = await fresh();
  // 先取消 2 次，再真失败 3 次：应到第 3 次真失败才判 failed
  for (let i = 0; i < 2; i += 1) await engine.failJob(await engine.claimNextJob('2099-01-01T00:00:00.000Z'), { cancelled: true });
  let claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
  assert.equal((await engine.failJob(claim, {})).terminal, false);
  claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
  assert.equal((await engine.failJob(claim, {})).terminal, false);
  claim = await engine.claimNextJob('2099-01-01T00:00:00.000Z');
  assert.equal((await engine.failJob(claim, {})).terminal, true);
});

test('pending 卡太久会标成 stalled，界面据此给出"重新整理"', async () => {
  const engine = await fresh();
  const now = Date.parse(old) + STALL_MS + 60_000;
  // fixture 的 created_at 是 2020 年，所以默认时钟下它本来就算"卡住"
  assert.deepEqual(await uiStatus(engine), [{ status: 'pending', stalled: true }]);
  const snapshots = answerRouteSnapshots(
    [{ id: 'locate:a', payload: JSON.stringify({ source: { userMessageId: 'u' } }), status: 'pending', created_at: old, source_message_id: 'a', seq: 2 }],
    [{ id: 'u', is_math_question: 1 }], [], now);
  assert.equal(snapshots[0].status, 'pending');
  assert.equal(snapshots[0].stalled, true);
  // 还没到时间的要保持 false
  const fresh2 = answerRouteSnapshots(
    [{ id: 'locate:a', payload: JSON.stringify({ source: { userMessageId: 'u' } }), status: 'pending', created_at: new Date().toISOString(), source_message_id: 'a', seq: 2 }],
    [{ id: 'u', is_math_question: 1 }], []);
  assert.equal(fresh2[0].stalled, false);
  // done / failed 永远不算 stalled
  for (const status of ['done', 'failed']) {
    const item = answerRouteSnapshots([{ id: 'locate:a', payload: JSON.stringify({ source: { userMessageId: 'u' } }), status, created_at: old, source_message_id: 'a', seq: 2 }], [{ id: 'u', is_math_question: 1 }], [], now);
    assert.equal(item[0].stalled, false);
  }
});

test('卡住的 pending 也能被"重新整理"救回来', async () => {
  const engine = await fresh();
  // 把任务改成"很久以前创建的 pending"，模拟卡住
  engine.db.run("UPDATE queue_job SET status='pending',attempts=0,created_at=? WHERE kind='locate'", [old]);
  const before = jobRow(engine);
  assert.equal(before[0], 'pending');
  const result = await engine.retryQuestionRoutes('u');
  assert.equal(result.retried, 1, '卡住的 pending 必须能被重排');
  assert.equal(jobRow(engine)[0], 'pending');
  assert.ok(await engine.claimNextJob('2099-01-01T00:00:00.000Z'), '重排后应当能再次被取到');
});
