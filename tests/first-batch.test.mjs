import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import katex from 'katex';
import { firstBatchTargets } from '../src/assets/practice/route-bank.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { prepareRouteQuestion } from '../src/core/practice/routes.js';
import { localTargets, prepareLocalRound } from '../src/core/practice/bank.js';
import { DatabaseEngine } from '../src/core/db/engine.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const files = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).map(async (name) =>
  [name, JSON.parse(await readFile(new URL(name, directory), 'utf8'))]));
const skeleton = createSkeleton(Object.fromEntries(files));
const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
async function engine() {
  const db = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } });
  await db.initializeDatabase(); return db;
}

test('first batch has six four-question roots, checked existing sources and actual transition edges', async () => {
  assert.equal(firstBatchTargets.length, 6);
  const originals = new Map((await readFile(new URL('../../高数题库-402道/question-bank.jsonl', import.meta.url), 'utf8'))
    .trim().split(/\r?\n/).map((line) => { const q = JSON.parse(line); return [q.id, q]; }));
  let imported = 0, publicProblems = 0;
  for (const target of firstBatchTargets) {
    assert.equal(target.questions.length, 4);
    for (const raw of target.questions) {
      const question = await prepareRouteQuestion(raw, skeleton);
      assert.equal(question.metadata.userApprovedClassic, false);
      assert.equal(question.metadata.variantGenerationStage, 3);
      assert.ok(['B.limit', 'B.deriv'].includes(skeleton.scenarioById.get(question.entranceScenarioId).block_id));
      for (const r of question.routes) for (const step of r.steps) {
        assert.ok(['B.limit', 'B.deriv'].includes(skeleton.scenarioById.get(step.scenarioId).block_id));
      }
      if (question.metadata.originalRecord) {
        imported++;
        assert.deepEqual(question.metadata.originalRecord, originals.get(question.metadata.source.originalId));
      }
      if (question.metadata.source.kind === 'public_course_problem') {
        publicProblems++; assert.match(question.metadata.source.url, /^https:\/\/math\.pku\.edu\.cn\//);
      }
      for (const text of [question.question, question.solution, ...question.routes.flatMap((r) =>
        [r.summary, ...r.steps.flatMap((step) => [step.state, step.transformedState, step.condition])])]) {
        for (const match of text.matchAll(/\$([^$]+)\$/g)) katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' });
      }
    }
    assert.ok(target.questions.slice(1).every((q) => q.routes.some((r) => r.valid && r.steps.length >= 2)));
  }
  assert.equal(imported, 17); assert.equal(publicProblems, 1);
});

test('one infinity problem genuinely reaches either infinity/infinity or zero/zero', () => {
  const question = firstBatchTargets.find((t) => t.id.endsWith('.infinity')).questions[0];
  assert.ok(question.routes.some((r) => r.valid && r.steps.some((step) => step.scenarioId === 'S.limit.inf_over_inf')));
  assert.ok(question.routes.some((r) => r.valid && r.steps.some((step) => step.scenarioId === 'S.limit.0over0')));
});

test('four-question selection prioritizes an unused fourth item and retains progressive presentation', async () => {
  const target = firstBatchTargets[0];
  const first = await prepareLocalRound(target, skeleton);
  const history = first.map((question) => ({ questionKey: question.questionKey, count: 1, lastPracticedAt: '2026-10-11T00:00:00Z' }));
  const second = await prepareLocalRound(target, skeleton, 'multi', history);
  assert.equal(first.length, 3); assert.equal(second.length, 3);
  assert.ok(second.some((q) => q.metadata.source.originalId === 13));
  assert.deepEqual(second.map((q) => q.metadata.complexity), [1, 2, 4]);
  assert.equal(second.filter((q) => !q.metadata.repeated).length, 1);
  const visible = localTargets(skeleton);
  assert.equal(visible.filter((t) => t.scenarioId === target.scenarioId).length, 1);
});

test('mixed entrance rounds persist, credit the actual question entrance and survive backup', async () => {
  const db = await engine();
  try {
    const target = firstBatchTargets.find((t) => t.id.endsWith('.expression'));
    const pool = await Promise.all(target.questions.map((q) => prepareRouteQuestion(q, skeleton)));
    const run = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: pool.slice(1), localPrepared: true });
    const item = run.items[2];
    const correct = item.question.routes.find((r) => r.valid);
    await db.gradePracticeItem(run.id, item.id, { mode: 'selection', selectedIds: [correct.id] });
    assert.equal(db.loadTrail().mastery.find((m) => m.targetType === 'scenario').targetId, 'S.deriv.composite_derivative');
    assert.equal(db.loadPracticeItem(item.id).scenarioId, 'S.deriv.composite_derivative');
    assert.equal(db.loadPracticeUsage().find((q) => q.questionKey === item.question.questionKey).count, 1);
    const token = await db.prepareImport(await db.exportDatabase()); await db.commitImport(token.token);
    assert.equal(db.loadPracticeUsage()[0].questionKey, item.question.questionKey);
    assert.ok(db.listPracticeHistory().items.some((i) => i.question.metadata.source.originalId === 68));
  } finally { db.close(); }
});

test('forged checked local routes cannot authorize an untouched mixed-entrance round', async () => {
  const db = await engine();
  try {
    const target = firstBatchTargets.find((t) => t.id.endsWith('.expression'));
    const pool = await prepareLocalRound(target, skeleton);
    pool[0].routes[0].valid = false;
    await assert.rejects(db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: pool, localPrepared: true }));
  } finally { db.close(); }
});

test('correcting a failed route does not turn into an independent success', async () => {
  const db = await engine();
  try {
    const target = firstBatchTargets[0];
    const items = await prepareLocalRound(target, skeleton);
    const run = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
    const item = run.items[0];
    const bad = item.question.routes.find((r) => !r.valid), good = item.question.routes.find((r) => r.valid);
    await db.gradePracticeItem(run.id, item.id, { mode: 'selection', selectedIds: [bad.id] });
    const corrected = await db.gradePracticeItem(run.id, item.id, { mode: 'selection', selectedIds: [good.id] });
    assert.equal(corrected.items[0].result, 'right');
    assert.equal(corrected.items[0].answer.independent, false);
    assert.equal(corrected.items[0].answer.attemptHistory.length, 2);
    assert.equal(db.loadTrail().mastery.find((m) => m.targetType === 'scenario').successCount, 0);
    assert.match(corrected.items[0].answer.feedback, /再次判断/);
  } finally { db.close(); }
});
