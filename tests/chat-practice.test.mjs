import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { localTargets, prepareLocalRound } from '../src/core/practice/bank.js';
import { wantsChatPractice, parsePracticeChoice, pickChatPractice } from '../src/core/chat/practice.js';
import { parseChatRouteAnswer } from '../src/core/chat/practiceIntent.js';
import { chatPracticeContext } from '../src/core/chat/practice.js';

const SQL = await initSqlJs(), skeleton = await readActiveSkeleton();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const target = localTargets(skeleton).find(t => t.scenarioId === 'S.limit.0over0');
const questions = await prepareLocalRound(target, skeleton);
const timestamp = '2026-10-13T00:00:00Z';
async function setup(bytes) {
  let record = bytes && { bytes, revision: 1 };
  const storage = { load: async () => record, commit: async (value, revision) => { record = { bytes: value, revision: revision + 1 }; return revision + 1; } };
  const db = new DatabaseEngine({ SQL, schemaSql, storage }); await db.initializeDatabase();
  if (!bytes) await db.saveChanges({ conversations: [{ id: 'chat', title: '极限', createdAt: timestamp, updatedAt: timestamp, messages: [
    { id: 'source', role: 'user', content: '求 sin(3x)/x 的极限', createdAt: timestamp },
    { id: 'answer', role: 'assistant', content: '用重要极限得到3', createdAt: timestamp },
    { id: 'request', role: 'user', content: '考我一下', createdAt: timestamp },
    { id: 'card', role: 'assistant', content: questions[0].question, createdAt: timestamp, status: 'streaming' },
  ] }] });
  return db;
}
const createCard = db => db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: [questions[0]], localPrepared: true,
  chat: { conversationId: 'chat', messageId: 'card', sourceMessageId: 'source' } });
const right = { mode: 'selection', selectedIds: [questions[0].routes.find(r => r.valid).id] };

test('practice requests are explicit; quotes, negations, answer requests and ordinary maths do not trigger', () => {
  for (const text of ['考我一下', '来道类似题', '练一练', '换个条件考我，别只换数字', '/练习 极限', '再来一题']) assert.equal(wantsChatPractice(text), true, text);
  for (const text of ['不要考我', '我不想练习', '“考我一下”是什么意思', '给我这道题的答案', '求 sin(3x)/x 的极限', '这个功能如何实现', '换一种解法做这道题', '请给出这道题的解法', '给我这道题的具体步骤', '把x换成t后，这题怎么做']) assert.equal(wantsChatPractice(text), false, text);
});
test('structured selection rejects invented pools/questions and supports honest clarification', () => {
  assert.throws(() => parsePracticeChoice('{"action":"practice","target_id":"made-up"}', [target]));
  assert.throws(() => parsePracticeChoice(JSON.stringify({ action: 'practice', target_id: target.id, question_id: 'fiction' }), [target], [{ id: 'real', targetId: target.id }]));
  assert.deepEqual(parsePracticeChoice('{"action":"clarify","message":"想练哪一类极限？"}', [target]), { clarification: '想练哪一类极限？' });
});
test('chat can accept option letters, while prose and unknown options remain ordinary text', () => {
  const q = { options: [{ id: 'r1' }, { id: 'r2' }] };
  assert.deepEqual(parseChatRouteAnswer('我选B', q), ['r2']);
  assert.deepEqual(parseChatRouteAnswer('A、B', q), ['r1', 'r2']);
  assert.equal(parseChatRouteAnswer('为什么B不对？', q), null);
  assert.equal(parseChatRouteAnswer('选E', q), null);
});
test('chat help receives actual student work, and simple thanks does not mark a new card as assisted', async () => {
  const history = [{ id: 'card', role: 'assistant', content: '题面', practiceItemId: 'item' }];
  const item = { id: 'item', runId: 'run', question: { options: [{ id: 'r', name: '有理化' }] }, answer: { steps: '乘共轭', feedback: '操作成立', selectedIds: ['r'], outcome: 'right' } };
  const context = await chatPracticeContext(history, { loadPracticeItem: async () => item, revealPracticeItem: async () => {} }, '为什么这步成立？');
  assert.match(context[0].content, /乘共轭/); assert.match(context[0].content, /有理化/);
  let reveals = 0;
  const db = { loadPracticeItem: async () => ({ ...item, answer: null }), revealPracticeItem: async () => { reveals++; } };
  await chatPracticeContext(history, db, '谢谢'); assert.equal(reveals, 0);
  await chatPracticeContext(history, db, '这题先怎么做？'); assert.equal(reveals, 1);
});
test('a known topic selects a real bank question in one request and supplies no solutions to the selector', async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body), payload = JSON.parse(body.messages[1].content); calls.push(payload);
    const q = payload.questions.find(q => !q.question.includes('sin(3x)'));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ action: 'practice', target_id: q.target_id, question_id: q.id, level: 'single' }) }, finish_reason: 'stop' }] });
  };
  try {
    const selected = await pickChatPractice({ config: { apiBase: 'https://mock.invalid/v1', apiKey: 'fixture-only', model: 'mock' },
      conversation: { id: 'chat', messages: [{ id: 'source', role: 'user', content: '求 sin(3x)/x 的极限' }, { id: 'answer', role: 'assistant', content: '结果为3' }] }, text: '考我一下', skeleton,
      trail: { encounters: [{ conversationId: 'chat', messageId: 'answer', scenarioId: 'S.limit.0over0' }] }, usage: [] });
    assert.equal(calls.length, 1); assert.equal(selected.question.entranceScenarioId, 'S.limit.0over0');
    assert.ok(!selected.question.question.includes('sin(3x)')); assert.equal(selected.sourceMessageId, 'source');
    assert.ok(!JSON.stringify(calls[0]).includes('solution')); assert.ok(!JSON.stringify(calls[0]).includes('"valid"'));
  } finally { globalThis.fetch = previous; }
});
test('chat cards survive restart/backup, use normal grading, and never replace the practice-page run', async () => {
  const db = await setup();
  const regular = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: questions, localPrepared: true });
  const card = await createCard(db);
  assert.equal(db.loadActivePractice().id, regular.id); assert.equal(card.origin, 'chat');
  await db.gradePracticeItem(card.id, card.items[0].id, right);
  const old = db.loadConversation('chat'); assert.equal(old.messages.at(-1).practiceItemId, card.items[0].id);
  const restored = await setup(await db.exportBackup());
  assert.equal(restored.loadConversation('chat').messages.at(-1).practiceItemId, card.items[0].id);
  assert.equal(restored.loadPracticeItem(card.items[0].id).answer.outcome, 'right');
  assert.equal(restored.loadActivePractice().id, regular.id); assert.equal(restored.listPracticeHistory().items.length, 4);
  db.close(); restored.close();
});
test('AI help on an unanswered chat card blocks independent mastery credit', async () => {
  const db = await setup(), card = await createCard(db), item = card.items[0];
  await db.revealPracticeItem(card.id, item.id, { assisted: true });
  const graded = await db.gradePracticeItem(card.id, item.id, right);
  assert.match(graded.items[0].answer.feedback, /答疑帮助/);
  assert.ok(db.loadTrail().mastery.every(m => m.successCount === 0)); db.close();
});
test('deleting only chat retains practice; deleting both removes its independent credits and records', async () => {
  for (const includeLearning of [false, true]) {
    const db = await setup(), card = await createCard(db);
    await db.gradePracticeItem(card.id, card.items[0].id, right);
    assert.ok(db.loadTrail().mastery.some(m => m.successCount === 1));
    await db.deleteConversation('chat', includeLearning);
    assert.equal(db.listPracticeHistory().items.length, includeLearning ? 0 : 1);
    assert.equal(db.loadActivePractice(), null);
    if (includeLearning) assert.ok(db.loadTrail().mastery.every(m => m.successCount === 0));
    await db.prepareImport(await db.exportBackup()); db.close();
  }
});
test('shared question credit survives deletion of a chat card when another practice earned it', async () => {
  const db = await setup();
  const regular = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: questions, localPrepared: true });
  await db.gradePracticeItem(regular.id, regular.items[0].id, right);
  const card = await createCard(db); await db.gradePracticeItem(card.id, card.items[0].id, right);
  await db.deleteConversation('chat', true);
  assert.equal(db.listPracticeHistory().items.length, 3); assert.ok(db.loadTrail().mastery.some(m => m.successCount === 1)); db.close();
});
test('version 8 migrates without changing messages and rejects linking a card to a user message', async () => {
  const db = await setup(); db.db.run('DROP TABLE chat_practice; PRAGMA user_version=8');
  const old = await db.exportDatabase(); db.close();
  const migrated = await setup(old); assert.equal(migrated.loadConversation('chat').messages[0].content, '求 sin(3x)/x 的极限');
  await assert.rejects(migrated.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: [questions[0]], localPrepared: true, chat: { conversationId: 'chat', messageId: 'source' } }));
  migrated.close();
});
