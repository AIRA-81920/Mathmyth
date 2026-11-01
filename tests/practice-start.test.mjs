import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { create } from 'zustand';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { practiceChoices } from '../src/core/mastery/choices.js';
import { localTargets, prepareLocalRound, prepareLocalPracticeInput } from '../src/core/practice/bank.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(await Promise.all((await readdir(directory))
  .filter(name => name.endsWith('.json'))
  .map(async name => [name, JSON.parse(await readFile(new URL(name, directory), 'utf8'))]))));
const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const targets = await localTargets(skeleton);
async function freshEngine() {
  const engine = new DatabaseEngine({ SQL, schemaSql,
    storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } });
  await engine.initializeDatabase();
  return engine;
}
async function choiceFor(id) {
  const target = targets.find(target => target.id === id);
  assert.ok(target, `installed pool ${id} must exist`);
  const choices = await practiceChoices(skeleton, { mastery: [], encounters: [{ id: 'seen',
    scenarioId: target.scenarioId, methodId: target.methodId, question: '已接触的题目', occurredAt: '2026-10-28' }] },
  { includePrepared: true });
  const choice = choices.find(choice => choice.id === id);
  assert.ok(choice?.localReady);
  assert.equal(choice.questions, undefined, 'the UI choice stays a lightweight summary');
  return choice;
}

test('a real practice choice summary becomes a complete three-item local run across the Worker clone boundary', async () => {
  const engine = await freshEngine();
  try {
    const choice = await choiceFor('RT.batch1.cancellation');
    const input = await prepareLocalPracticeInput(choice, skeleton);
    assert.equal(input.preparedTarget.id, choice.id);
    assert.equal(input.preparedTarget.questions.length, choice.questionCount);
    assert.equal(input.items.length, 3);
    assert.deepEqual(input.items, await prepareLocalRound(choice, skeleton));
    const run = await engine.createPracticeRun(structuredClone(input));
    assert.equal(run.items.length, 3);
    assert.equal(run.generationStatus, 'complete');
    assert.equal(engine.loadActivePractice().id, run.id);
    assert.deepEqual(run.items.map(item => item.question), input.items);
  } finally { engine.close(); }
});

test('existing mixed-entrance pools and short pools start from summaries with their exact installed target', async () => {
  const engine = await freshEngine();
  try {
    const choice = await choiceFor('RT.batch1.expression');
    const first = await prepareLocalRound(choice, skeleton);
    const history = first.map(question => ({ questionKey: question.questionKey, count: 1, lastPracticedAt: '2026-10-27' }));
    const mixed = await prepareLocalPracticeInput(choice, skeleton, 'multi', history);
    assert.ok(mixed.items.some(question => question.entranceScenarioId !== mixed.scenarioId));
    const run = await engine.createPracticeRun(structuredClone(mixed));
    assert.equal(run.generationStatus, 'complete');
    assert.deepEqual(run.items.map(item => item.question.entranceScenarioId), mixed.items.map(question => question.entranceScenarioId));
    const short = await prepareLocalPracticeInput(await choiceFor('RT.pool.S.multiint.change_order'), skeleton);
    assert.equal(short.items.length, 2);
    assert.equal((await engine.createPracticeRun(structuredClone(short))).generationStatus, 'complete');
  } finally { engine.close(); }
});

test('an unknown or mismatched pool ID cannot silently select a different pool for the same scenario', async () => {
  const choice = await choiceFor('RT.batch1.cancellation');
  assert.equal(await prepareLocalPracticeInput({ ...choice, id: 'missing-pool' }, skeleton), null);
  assert.equal(await prepareLocalRound({ ...choice, id: 'missing-pool' }, skeleton), null);
  assert.equal(await prepareLocalPracticeInput({ ...choice, scenarioId: 'S.deriv.implicit_derivative' }, skeleton), null);
});

test('malformed prepared targets and unreviewed or changed questions fail with a deliberate validation error', async () => {
  const engine = await freshEngine();
  try {
    const input = await prepareLocalPracticeInput(await choiceFor('RT.batch1.cancellation'), skeleton);
    // A touched edge must not allow a broken local request to fall back to the
    // less restrictive AI/unmixed path and accidentally accept its review flag.
    await engine.transaction(db => {
      const learnerId = db.exec('SELECT id FROM learner')[0].values[0][0];
      db.run("INSERT INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at) VALUES('seen',?,?,?,1,'ask',?)",
        [learnerId, input.scenarioId, input.methodId, '2026-10-28']);
    });
    for (const preparedTarget of [null, { ...input.preparedTarget, questions: undefined },
      { ...input.preparedTarget, questions: [] }, { ...input.preparedTarget, questions: 'invalid' },
      { ...input.preparedTarget, questions: [null] }]) {
      await assert.rejects(engine.createPracticeRun({ ...input, preparedTarget }), error => error.code === 'invalid_practice');
    }
    for (const alter of [question => { question.metadata.reviewStatus = 'model_unverified'; },
      question => { question.metadata.motherId = 'forged-mother'; },
      question => { question.routes[0].valid = !question.routes[0].valid; }]) {
      const changed = structuredClone(input);
      alter(changed.items[0]);
      await assert.rejects(engine.createPracticeRun(changed), error => error.code === 'invalid_practice');
    }
    assert.equal(engine.db.exec('SELECT count(*) FROM practice_run')[0].values[0][0], 0);
  } finally { engine.close(); }
});

test('clicking the production practice-store start action persists a local run using the summary-to-target bridge', async () => {
  const engine = await freshEngine();
  const sourceUrl = new URL('../src/store/practiceStore.js', import.meta.url);
  const registry = globalThis.__practiceStartTests ??= new Map();
  const key = crypto.randomUUID();
  try {
    const choice = await choiceFor('RT.batch1.cancellation');
    const learnerId = engine.db.exec('SELECT id FROM learner')[0].values[0][0];
    await engine.transaction(db => db.run("INSERT INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at) VALUES('seen',?,?,?,1,'ask',?)",
      [learnerId, choice.scenarioId, choice.methodId, '2026-10-28']));
    const app = create(() => ({ learnerId, storageInitialized: true, dataOperation: null, modelConfig: {} }));
    let captured;
    const database = { loadTrail: async () => engine.loadTrail(), loadActivePractice: async () => engine.loadActivePractice(),
      loadPracticeUsage: async () => engine.loadPracticeUsage(), createPracticeRun: async input => {
        captured = structuredClone(input);
        return engine.createPracticeRun(captured);
      } };
    registry.set(key, { app, database, skeleton });
    let source = await readFile(sourceUrl, 'utf8');
    source = source.replace("import { useAppStore } from './appStore.js';", `const useAppStore = globalThis.__practiceStartTests.get('${key}').app;`)
      .replace("import * as database from '../core/db/database.js';", `const database = globalThis.__practiceStartTests.get('${key}').database;`)
      .replace("import { loadSkeleton } from '../core/skeleton/load.js';", `const loadSkeleton = async () => globalThis.__practiceStartTests.get('${key}').skeleton;`)
      .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
      .replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path, sourceUrl).href}'`);
    const { usePracticeStore: practice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await practice.getState().initialize();
    assert.equal(practice.getState().selectChoice(choice.key), true);
    assert.equal(practice.getState().choices[practice.getState().choiceIndex].questions, undefined);
    await practice.getState().start();
    assert.equal(practice.getState().error, '');
    assert.equal(practice.getState().screen, 'run');
    assert.equal(practice.getState().session.items.length, 3);
    assert.equal(captured.preparedTarget.id, choice.id);
    assert.equal(captured.preparedTarget.questions.length, choice.questionCount);
    assert.equal(engine.loadActivePractice().id, practice.getState().session.id);
  } finally { registry.delete(key); engine.close(); }
});

// 回归：AI 现场出题按契约只给一条正确路线。入库校验曾经错误地套用"人工库题必须
// 带一条错误路线"，导致 AI 出题 100% 失败（invalid_practice）。这里同时钉住豁免的边界：
// 只对 model_unverified 生效，伪装成人工库题的同一份数据仍然必须被拒。
test('an AI draft with a single valid route can start a practice run, but the same data forged as a reviewed pool question is still rejected', async () => {
  const engine = await freshEngine();
  try {
    const { prepareRouteQuestion } = await import('../src/core/practice/routes.js');
    const input = await prepareLocalPracticeInput(await choiceFor('RT.batch1.cancellation'), skeleton);
    const review = structuredClone(input.items[0]);
    const validRoute = review.routes.find((route) => route.valid);
    const draft = await prepareRouteQuestion({ ...structuredClone(review), routes: [structuredClone(validRoute)],
      metadata: { ...review.metadata, reviewStatus: 'model_unverified',
        source: { ...review.metadata.source, kind: 'ai_variant' },
        learning: { ...(review.metadata.learning ?? {}), provenance: { userMessageId: 'user-1' } } } }, skeleton);
    const learnerId = engine.db.exec('SELECT id FROM learner')[0].values[0][0];
    await engine.transaction((db) => {
      db.run('INSERT INTO conversation(id,learner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
        ['c1', learnerId, '原题', '2026-11-01', '2026-11-01']);
      db.run("INSERT INTO message(id,conversation_id,role,content,created_at,seq,status) VALUES(?,?,'assistant',?,?,1,'complete')",
        ['m1', 'c1', '解答正文', '2026-11-01']);
    });
    const run = await engine.createPracticeRun({ scenarioId: draft.entranceScenarioId, methodId: input.methodId,
      items: [draft], chat: { conversationId: 'c1', messageId: 'm1' } });
    assert.equal(run.items.length, 1, 'AI 草稿应当能建出练习轮');
    assert.equal(run.items[0].question.metadata.reviewStatus, 'model_unverified');
    const forged = structuredClone(draft);
    forged.metadata.reviewStatus = 'worked_example_checked';
    await assert.rejects(engine.createPracticeRun({ scenarioId: forged.entranceScenarioId, methodId: input.methodId,
      items: [forged], chat: { conversationId: 'c1', messageId: 'm1' } }), (error) => error.code === 'invalid_practice');
  } finally { engine.close(); }
});
