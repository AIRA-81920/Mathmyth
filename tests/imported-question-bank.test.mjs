import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { questionBanks } from '../src/assets/practice/question-banks/index.js';
import { preparedRouteTargets, firstBatchTargets } from '../src/assets/practice/route-bank.js';
import { localTargets, prepareLocalRound } from '../src/core/practice/bank.js';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { DatabaseEngine } from '../src/core/db/engine.js';

const skeleton = await readActiveSkeleton();
const targets = localTargets(skeleton);
const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
async function db() { const engine = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } }); await engine.initializeDatabase(); return engine; }

test('every published original is actually reachable from a local target with real paired routes', async () => {
  const mothers = new Set(targets.flatMap((target) => target.questions.map((question) => question.metadata.motherId)));
  for (const bank of questionBanks) for (const question of bank.questions) {
    assert.ok(mothers.has(question.metadata.motherId), `Unreachable ${question.metadata.originalId}`);
    assert.equal(question.metadata.originalRecord.id, question.metadata.source.originalId);
    for (const route of question.routes) for (const step of route.steps) assert.ok(skeleton.scenarioById.get(step.scenarioId).methods.some((edge) => edge.method_id === step.methodId));
  }
});
test('product-limit pool always keeps its selected scenario even when related unused peers rank ahead', async () => {
  const target = targets.find((target) => target.scenarioId === 'S.limit.zero_times_inf');
  assert.ok(target); assert.ok(target.questions.length >= 3);
  const used = target.questions.filter((q) => q.entranceScenarioId === target.scenarioId).map((q) => ({ questionKey: q.questionKey, count: 10, lastPracticedAt: '2026-10-12T00:00:00Z' }));
  const items = await prepareLocalRound(target, skeleton, 'multi', used);
  assert.equal(items.length, 3); assert.ok(items.some((question) => question.entranceScenarioId === target.scenarioId));
});
test('curated identities survive appends, and newer semantic reviews replace future route labels', () => {
  for (const original of firstBatchTargets) {
    const target = preparedRouteTargets.find((t) => t.id === original.id);
    for (const old of original.questions) {
      const current = target.questions.find((q) => q.metadata.motherId === old.metadata.motherId);
      assert.equal(current.question, old.question); assert.equal(current.solution, old.solution);
      assert.equal(current.metadata.motherId, old.metadata.motherId);
      if ((current.metadata.contentVersion ?? 1) > (old.metadata.contentVersion ?? 1)) assert.equal(current.metadata.semanticReview.status, 'rechecked');
      else assert.deepEqual(current.routes, old.routes);
    }
  }
});
test('a real one/two-question reviewed local pool finishes instead of waiting for a nonexistent third question', async () => {
  const target = targets.find((target) => target.questions.length < 3);
  assert.ok(target);
  const engine = await db();
  try {
    const items = await prepareLocalRound(target, skeleton);
    let run = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
    assert.equal(run.generationStatus, 'complete');
    for (const item of run.items) run = await engine.advancePracticeItem(run.id, item.id);
    assert.ok(run.finishedAt);
    const restored = await engine.prepareImport(await engine.exportDatabase()); await engine.commitImport(restored.token);
    assert.equal(engine.listPracticeHistory().items.length, items.length);
  } finally { engine.close(); }
});
