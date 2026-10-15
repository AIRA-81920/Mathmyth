import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileReviewedBank, readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { firstBatchTargets, legacyRouteTargets } from '../src/assets/practice/route-bank.js';
import { extendPreparedTargets } from '../src/assets/practice/importedTargets.js';
import { prepareLocalRound } from '../src/core/practice/bank.js';

const skeleton = await readActiveSkeleton();
const original = JSON.parse(await readFile(new URL('../src/assets/practice/first-batch-originals.json', import.meta.url), 'utf8')).find((q) => q.id === 17);
const question = firstBatchTargets.flatMap((target) => target.questions).find((q) => q.metadata.source.originalId === 17);
const review = { originalId: 17, disposition: 'ready', entranceScenarioId: question.entranceScenarioId, normalizedQuestion: question.question,
  classificationReason: '0/0且一次项相消', blockers: [], audit: { status: 'checked', reasoning: '内外层展开到三阶，分子x³/6+o(x³)，结果1/6。', originalAnswerVerdict: 'retained' }, question };
const compile = (reviews, originals = [original]) => compileReviewedBank({ bankId: 'bank402', originalRecords: originals, reviews, skeleton });

test('compiler preserves the full original and produces a source trace without approving classic status', async () => {
  const result = await compile([review]);
  assert.deepEqual(result.audit[0].original, original);
  assert.deepEqual(result.questions[0].metadata.originalRecord, original);
  assert.equal(result.questions[0].metadata.userApprovedClassic, false);
  assert.equal(result.audit[0].groupId, 'G.limit.indeterminate');
});
test('compiler rejects missing reviews, changed originals, fake source identity and a false paired edge', async () => {
  await assert.rejects(compile([]), /no review/);
  const changed = structuredClone(review); changed.question.metadata.originalRecord.text = '篡改'; await assert.rejects(compile([changed]), /modified/);
  const fake = structuredClone(review); fake.question.metadata.source.originalId = 19; await assert.rejects(compile([fake]), /source identity/);
  const edge = structuredClone(review); edge.question.routes[0].steps[0].methodId = 'M.newton_leibniz'; await assert.rejects(compile([edge]));
});
test('quarantine and duplicates retain the source but never become learner questions', async () => {
  const second = { ...original, id: 18 };
  const duplicate = { originalId: 18, disposition: 'duplicate', duplicateOf: 17, entranceScenarioId: review.entranceScenarioId,
    classificationReason: '同题重复来源', blockers: ['保留来源，不重复训练身份'], audit: { status: 'blocked', reasoning: '同样题面与所求', originalAnswerVerdict: 'unverified' }, question: null };
  const result = await compile([review, duplicate], [original, second]);
  assert.equal(result.questions.length, 1); assert.equal(result.audit.length, 2);
  assert.deepEqual(result.audit[1].original, second);
  await assert.rejects(compile([{ ...duplicate, duplicateOf: 99 }], [second]), /absent/);
});
test('a new dataset appends a reviewed problem without changing curated target identity or multiplying sources', async () => {
  const bank = await compile([review]);
  const expanded = extendPreparedTargets([...legacyRouteTargets, ...firstBatchTargets], [bank, bank], skeleton);
  const target = expanded.find((entry) => entry.id === 'RT.batch1.cancellation');
  assert.equal(target.questions.filter((q) => q.metadata.source.originalId === 17).length, 1);
  assert.equal(target.questions[0].metadata.motherId, 'own.limit.sin-ratio');
  assert.equal((await prepareLocalRound(firstBatchTargets.find((t) => t.id === target.id), skeleton)).length, 3);
});
test('a future bank can point a duplicate at an earlier reviewed bank without republishing or renaming it', async () => {
  const old = await compile([review]);
  const duplicate = { ...review, disposition: 'duplicate', question: null, blockers: ['同题新来源，保留原始记录'], duplicateOf: { bankId: 'bank402', originalId: 17 } };
  const future = await compileReviewedBank({ bankId: 'bank2027a', originalRecords: [original], reviews: [duplicate], skeleton, existingBanks: [old] });
  assert.equal(future.questions.length, 0); assert.deepEqual(future.audit[0].duplicateOf, duplicate.duplicateOf);
  const wrongNamespace = structuredClone(review);
  await assert.rejects(compileReviewedBank({ bankId: 'bank2027a', originalRecords: [original], reviews: [wrongNamespace], skeleton }), /namespace/);
});
