import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { SCHEMA_VERSION } from '../src/core/db/constants.js';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { localTargets, prepareLocalRound } from '../src/core/practice/bank.js';
import { nextHintLevel, practiceEvidenceSummary, targetExecutionComplete } from '../src/core/learning/practiceSummary.js';

const SQL = await initSqlJs(), skeleton = await readActiveSkeleton();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const target = (await localTargets(skeleton)).find(entry => entry.scenarioId === 'S.limit.0over0');
const prepared = await prepareLocalRound(target, skeleton);
const q = structuredClone(prepared[0]);
q.metadata.learning = { familyId: 'qa-family', relation: 'similar', hints: ['先观察结构。', '完成关键变形。'], provenance: { userMessageId: 'source', answerId: 'explanation' } };
const timestamp = '2026-10-28T00:00:00.000Z';
async function setup(bytes, failCommit = () => false) {
  let record = bytes && { bytes, revision: 1 };
  const storage = { load: async () => record, commit: async (value, revision) => {
    if (failCommit()) throw Error('fixture persistence failure');
    record = { bytes: value, revision: revision + 1 }; return revision + 1;
  } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage }); await engine.initializeDatabase();
  if (!bytes) await engine.saveChanges({ conversations: [{ id: 'chat', title: 'QA', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'source', role: 'user', content: '求极限', createdAt: timestamp },
      { id: 'explanation', role: 'assistant', content: '讲解', createdAt: timestamp },
      { id: 'card', role: 'assistant', content: q.question, status: 'streaming', createdAt: timestamp }] }] });
  return engine;
}
function create(engine, question = q, chat = true) { return engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId,
  items: [question], localPrepared: true, preparedTarget: target,
  ...(chat ? { chat: { conversationId: 'chat', messageId: 'card', sourceMessageId: 'source' } } : {}) }); }
const selection = { mode: 'selection', selectedIds: [q.routes.find(entry => entry.valid).id] };
function stepAttempt(question = q, outcome = 'right') {
  const edge = question.allowedEdges[0], steps = '我实际进行了这个恒等变形。';
  return { mode: 'steps', steps, assessment: { outcome, feedback: '具体检查反馈。', methodIds: [edge.methodId],
    executedEdges: [{ ...edge, studentExcerpt: steps }], mathematicallyValid: outcome === 'right',
    mathematicalEvidence: [{ studentExcerpt: steps, explanation: '本题成立的具体数学操作。' }] } };
}

test('staged hints are durable, idempotent, and never become independent by reopening', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.recordPracticeHint(run.id, id, 1); await engine.recordPracticeHint(run.id, id, 1);
  assert.equal(engine.loadPracticeItem(id).answer.helpEvents.length, 1);
  const restored = await setup(await engine.exportBackup());
  assert.equal(restored.loadPracticeItem(id).answer.hintLevel, 1);
  const graded = await restored.gradePracticeItem(run.id, id, stepAttempt());
  assert.equal(graded.items[0].answer.independent, false);
  assert.equal(graded.items[0].answer.attemptHistory[0].assisted, true);
  assert.ok(restored.loadTrail().mastery.every(row => row.successCount === 0));
  engine.close(); restored.close();
});

test('route recognition and supported execution remain distinct observations', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.revealPracticeItem(run.id, id, { kind: 'route_options' });
  const graded = await engine.gradePracticeItem(run.id, id, selection);
  assert.equal(graded.items[0].answer.attemptHistory[0].independent, true);
  assert.match(practiceEvidenceSummary(graded.items[0]).pending, /关键操作/);
  await engine.gradePracticeItem(run.id, id, stepAttempt());
  assert.ok(engine.loadTrail().mastery.filter(row => row.targetType === 'method').every(row => row.successCount === 0));
  engine.close();
});

test('an information request records neither an error nor a consumed independent attempt', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, { mode: 'steps', steps: '结果是1。', assessment: { outcome: 'uncertain', feedback: '请补充关键变形。', methodIds: [], executedEdges: [] } });
  const before = engine.loadPracticeItem(id); assert.equal(before.result, null); assert.equal(before.answer.attemptCounts.steps, 0);
  const graded = await engine.gradePracticeItem(run.id, id, stepAttempt());
  assert.equal(graded.items[0].answer.independent, true);
  assert.ok(engine.loadTrail().mastery.some(row => row.successCount === 1)); engine.close();
});

test('a correct final result retains its assessment scope through backup without claiming execution', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, { mode: 'steps', steps: '结果是1。', assessment: {
    outcome: 'uncertain', scope: 'result', resultCorrect: true, feedback: '结果正确，请补充一处关键变形。', methodIds: [], executedEdges: [] } });
  const restored = await setup(await engine.exportBackup());
  for (const current of [engine, restored]) {
    const item = current.loadPracticeItem(id);
    assert.equal(item.answer.assessmentScope, 'result'); assert.equal(item.answer.resultCorrect, true);
    assert.equal(item.answer.attemptHistory[0].assessmentScope, 'result'); assert.equal(item.answer.attemptHistory[0].resultCorrect, true);
    assert.equal(item.answer.outcome, 'uncertain'); assert.equal(item.result, null);
    assert.equal(item.answer.attemptCounts.steps, 0);
    assert.ok(current.loadTrail().mastery.every(entry => entry.successCount === 0));
    const summary = practiceEvidenceSummary(item);
    assert.match(summary.done, /结果正确/); assert.match(summary.done, /尚未检验/);
    assert.doesNotMatch(summary.done, /完成了|辨认出了/);
  }
  engine.close(); restored.close();
});

test('looking at hints later preserves the original independent success snapshot', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, stepAttempt()); await engine.recordPracticeHint(run.id, id, 2);
  const item = engine.loadPracticeItem(id);
  assert.equal(item.answer.attemptHistory[0].assisted, false); assert.equal(item.answer.attemptHistory[0].independent, true);
  assert.match(practiceEvidenceSummary(item).done, /没有使用本题提示/);
  assert.ok(engine.loadTrail().mastery.some(row => row.successCount === 1)); engine.close();
});

test('review choice is explicit, idempotent, cancellable and portable with source and draft', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.savePracticeDraft(run.id, id, '未提交的草稿');
  await engine.finishChatPractice(run.id, id);
  assert.equal(engine.listPracticeReviews().length, 0);
  await engine.setPracticeReview(run.id, id, true); await engine.setPracticeReview(run.id, id, true);
  assert.equal(engine.listPracticeReviews().length, 1);
  const reviewId = engine.listPracticeReviews()[0].id;
  await engine.setPracticeReview(run.id, id, false); assert.equal(engine.listPracticeReviews().length, 0);
  await engine.setPracticeReview(run.id, id, true);
  assert.equal(engine.listPracticeReviews()[0].id, reviewId);
  const restored = await setup(await engine.exportBackup());
  assert.equal(restored.loadPracticeItem(id).answer.draft, '未提交的草稿');
  assert.equal(restored.loadPracticeItem(id).source.sourceMessageId, 'source');
  assert.equal(restored.listPracticeReviews()[0].sourceItemId, id);
  assert.equal(restored.loadPracticeItem(id).result, null);
  engine.close(); restored.close();
});

test('a voluntary review completes only after a new attempt is explicitly ended', async () => {
  const engine = await setup(), original = await create(engine), sourceItemId = original.items[0].id;
  await engine.finishChatPractice(original.id, sourceItemId); await engine.setPracticeReview(original.id, sourceItemId, true);
  const reviewId = engine.listPracticeReviews()[0].id;
  await engine.saveChanges({ conversations: [{ id: 'review-chat', title: '复习', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'review-card', role: 'assistant', content: q.question, status: 'streaming', createdAt: timestamp }] }] });
  const fresh = structuredClone(q); fresh.metadata.learning.reviewId = reviewId; fresh.metadata.learning.provenance.sourceItemId = sourceItemId;
  const run = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: [fresh], localPrepared: true,
    preparedTarget: target, chat: { conversationId: 'review-chat', messageId: 'review-card' } });
  assert.equal(engine.listPracticeReviews().length, 1);
  await engine.gradePracticeItem(run.id, run.items[0].id, selection);
  assert.equal(engine.listPracticeReviews().length, 1);
  await engine.finishChatPractice(run.id, run.items[0].id);
  assert.equal(engine.listPracticeReviews().length, 0);
  assert.equal(engine.loadPracticeItem(sourceItemId).review.status, 'completed');
  await engine.setPracticeReview(original.id, sourceItemId, true); assert.equal(engine.listPracticeReviews().length, 0);
  engine.close();
});

test('failed persistence never shows a successful review arrangement', async () => {
  let fail = false; const engine = await setup(undefined, () => fail), run = await create(engine), id = run.items[0].id;
  fail = true; await assert.rejects(engine.setPracticeReview(run.id, id, true));
  assert.equal(engine.listPracticeReviews().length, 0); engine.close();
});

test('disputes preserve original text and suspend only unsupported independent credits', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, stepAttempt());
  assert.ok(engine.loadTrail().mastery.some(row => row.successCount === 1));
  await engine.disputePracticeItem(run.id, id);
  assert.equal(engine.loadPracticeItem(id).answer.steps, stepAttempt().steps);
  assert.ok(engine.loadTrail().mastery.every(row => row.successCount === 0));
  assert.match(practiceEvidenceSummary(engine.loadPracticeItem(id)).done, /异议/); engine.close();
});

test('deleting chat text keeps review asset; deleting learning records removes its arrangement', async () => {
  for (const includeLearning of [false, true]) {
    const engine = await setup(), run = await create(engine), id = run.items[0].id;
    await engine.finishChatPractice(run.id, id); await engine.setPracticeReview(run.id, id, true);
    await engine.deleteConversation('chat', includeLearning);
    assert.equal(engine.listPracticeReviews().length, includeLearning ? 0 : 1);
    await engine.prepareImport(await engine.exportBackup()); engine.close();
  }
});

test('version ten migrates a complete old file and validation rejects malformed review ownership', async () => {
  const engine = await setup(); engine.db.run('DROP TABLE practice_review; PRAGMA user_version=10');
  const migrated = await setup(await engine.exportDatabase());
  assert.equal(migrated.db.exec('PRAGMA user_version')[0].values[0][0], SCHEMA_VERSION);
  assert.deepEqual(migrated.listPracticeReviews(), []);
  const run = await create(migrated), id = run.items[0].id;
  await migrated.setPracticeReview(run.id, id, true);
  migrated.db.run("UPDATE practice_review SET due_at='not-a-date'");
  await assert.rejects(migrated.prepareImport(await migrated.exportDatabase())); engine.close(); migrated.close();
});

test('hint progression skips only operations explicitly supported by execution evidence', () => {
  const item = { question: { metadata: { learning: { hints: ['A', 'B'], hintSteps: ['M.a', 'M.b'] } } }, answer: { outcome: 'right', executedEdges: [{ methodId: 'M.a' }] } };
  assert.equal(nextHintLevel(item), 2);
  item.answer.outcome = 'wrong'; assert.equal(nextHintLevel(item), 1);
  item.answer = { selectedIds: ['M.a'] }; assert.equal(nextHintLevel(item), 1);
});

test('correct partial operations retain credit but cannot imply completion of a two-step target', () => {
  const first = { scenarioId: 'S.first', methodId: 'M.first' }, last = { scenarioId: 'S.last', methodId: 'M.last' };
  const item = { question: { metadata: { learning: { targetRouteId: 'target' } }, routes: [{ id: 'target', valid: true, steps: [first, last] }] },
    answer: { mode: 'steps', outcome: 'right', independent: true, methodIds: ['M.first'], executedEdges: [first] } };
  assert.equal(targetExecutionComplete(item), false);
  assert.match(practiceEvidenceSummary(item).done, /完成了已提交的关键操作/);
  assert.match(practiceEvidenceSummary(item).pending, /其余关键操作尚未检验/);
  item.answer.executedEdges = [first, { scenarioId: 'S.other', methodId: 'M.last' }];
  assert.equal(targetExecutionComplete(item), false, 'same method in a different scenario is not target execution');
  item.answer.executedEdges = [first, last];
  assert.equal(targetExecutionComplete(item), true);
  assert.match(practiceEvidenceSummary(item).pending, /间隔后/);
});

test('a correct alternative remains mathematical success while the chosen target is untested', () => {
  const item = { question: { metadata: { learning: { targetRouteId: 'chosen' } }, routes: [{ id: 'chosen', valid: true,
    steps: [{ scenarioId: 'S.target', methodId: 'M.target' }] }] }, answer: {
    mode: 'steps', outcome: 'right', independent: true, methodIds: [], executedEdges: [], mathematicallyValid: true } };
  assert.equal(targetExecutionComplete(item), false);
  assert.match(practiceEvidenceSummary(item).done, /数学上成立的解法/);
  assert.match(practiceEvidenceSummary(item).pending, /原来选择的目标思路尚未检验/);
});


test('disputing a later retry does not retract an earlier independent success', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, stepAttempt());
  await engine.recordPracticeHint(run.id, id, 1);
  await engine.gradePracticeItem(run.id, id, stepAttempt(q, 'wrong'));
  await engine.disputePracticeItem(run.id, id);
  const item = engine.loadPracticeItem(id);
  assert.equal(item.answer.attemptHistory[0].disputed, undefined);
  assert.equal(item.answer.attemptHistory[1].disputed, true);
  assert.ok(engine.loadTrail().mastery.some(row => row.successCount === 1)); engine.close();
});

test('a caller-supplied prepared target cannot mark edited mathematics as reviewed', async () => {
  const engine = await setup(), edited = structuredClone(q), claimed = structuredClone(target);
  edited.solution = '被篡改的答案。';
  claimed.questions = claimed.questions.map(entry => entry.metadata.motherId === edited.metadata.motherId ? { ...entry, solution: edited.solution } : entry);
  await assert.rejects(engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId,
    items: [edited], localPrepared: true, preparedTarget: claimed }));
  engine.close();
});

test('skipped, uncertain and disputed reviews remain available instead of pretending a completed check', async () => {
  for (const outcome of ['skip', 'uncertain', 'disputed']) {
    const engine = await setup(), original = await create(engine), sourceItemId = original.items[0].id;
    await engine.finishChatPractice(original.id, sourceItemId); await engine.setPracticeReview(original.id, sourceItemId, true);
    const reviewId = engine.listPracticeReviews()[0].id;
    await engine.saveChanges({ conversations: [{ id: 'later', title: '复习', createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: 'later-card', role: 'assistant', content: q.question, status: 'streaming', createdAt: timestamp }] }] });
    const fresh = structuredClone(q); fresh.metadata.learning.reviewId = reviewId; fresh.metadata.learning.provenance.sourceItemId = sourceItemId;
    const run = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: [fresh], localPrepared: true,
      preparedTarget: target, chat: { conversationId: 'later', messageId: 'later-card' } });
    const id = run.items[0].id;
    assert.equal(engine.listPracticeReviews()[0].activeItemId, id);
    if (outcome === 'uncertain') await engine.gradePracticeItem(run.id, id, { mode: 'steps', steps: '不知道',
      assessment: { outcome: 'uncertain', feedback: '需要再补一步。', methodIds: [], executedEdges: [] } });
    if (outcome === 'disputed') { await engine.gradePracticeItem(run.id, id, selection); await engine.disputePracticeItem(run.id, id); }
    await engine.finishChatPractice(run.id, id);
    assert.equal(engine.listPracticeReviews().length, 1);
    assert.equal(engine.listPracticeReviews()[0].activeItemId, null);
    engine.close();
  }
});


test('many retries keep the first independent observation and its later credit', async () => {
  const engine = await setup(), run = await create(engine), id = run.items[0].id;
  await engine.gradePracticeItem(run.id, id, stepAttempt());
  await engine.recordPracticeHint(run.id, id, 1);
  for (let index = 0; index < 42; index++) await engine.gradePracticeItem(run.id, id, stepAttempt(q, 'wrong'));
  const item = engine.loadPracticeItem(id);
  assert.equal(item.answer.attemptHistory.length, 40);
  assert.equal(item.answer.attemptHistory[0].outcome, 'right');
  assert.equal(item.answer.attemptHistory[0].independent, true);
  await engine.disputePracticeItem(run.id, id);
  assert.ok(engine.loadTrail().mastery.some(row => row.successCount === 1)); engine.close();
});
