import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import katex from 'katex';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { legacyRouteTargets as preparedRouteTargets } from '../src/assets/practice/route-bank.js';
import { prepareLocalRound } from '../src/core/practice/bank.js';
import { prepareRouteQuestion, routeAssessment } from '../src/core/practice/routes.js';
import { assessSteps, generatePractice } from '../src/core/ai/practice.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const files = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).map(async (name) => [name, JSON.parse(await readFile(new URL(name, directory), 'utf8'))]));
const skeleton = createSkeleton(Object.fromEntries(files));
const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const target = preparedRouteTargets[0];
async function setup(level = 'single') {
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } });
  await engine.initializeDatabase();
  const items = await prepareLocalRound(target, skeleton, level);
  const run = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
  return { engine, run, items };
}
const attempt = (id) => ({ mode: 'selection', selectedIds: [id] });

test('all prepared questions resolve real paired edges and render formulae, with honest sample provenance', async () => {
  let questions = 0, transitions = 0;
  for (const goal of preparedRouteTargets) for (const item of await prepareLocalRound(goal, skeleton)) {
    questions++;
    assert.equal(item.metadata.userApprovedClassic, false);
    assert.equal(item.metadata.source.kind, 'self_authored');
    assert.ok(item.routes.some((route) => route.preferred && route.valid));
    for (const route of item.routes) {
      transitions += route.steps.filter((step) => step.scenarioId !== item.entranceScenarioId).length;
      for (const step of route.steps) assert.ok(skeleton.scenarioById.get(step.scenarioId).methods.some((edge) => edge.method_id === step.methodId));
    }
    const strings = [item.question, item.solution, ...item.routes.flatMap((route) => [route.summary, ...route.steps.flatMap((step) => [step.state, step.transformedState, step.condition])])];
    for (const value of strings) for (const match of value.matchAll(/\$([^$]+)\$/g)) assert.doesNotThrow(() => katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' }));
  }
  assert.equal(questions, 27); assert.ok(transitions > 10);
});

test('single-route grading accepts each valid alternative but rejects selecting every option', async () => {
  const q = (await prepareLocalRound(target, skeleton))[1];
  for (const route of q.routes.filter((r) => r.valid)) assert.equal(routeAssessment(q, [route.id]).outcome, 'right');
  assert.equal(routeAssessment(q, q.routes.map((r) => r.id)).outcome, 'wrong');
  assert.match(routeAssessment(q, [q.routes.find((r) => !r.valid).id]).feedback, /转折失效/);
});

test('multi-route grading requires exactly the supplied valid set; a viable nonpreferred comparison is no math error', async () => {
  const multi = (await prepareLocalRound(target, skeleton, 'multi'))[1];
  assert.equal(routeAssessment(multi, multi.routes.filter((r) => r.valid).map((r) => r.id)).outcome, 'right');
  assert.equal(routeAssessment(multi, [multi.routes.find((r) => r.valid).id]).outcome, 'wrong');
  const best = (await prepareLocalRound(target, skeleton, 'best'))[1];
  const result = routeAssessment(best, [best.routes.find((r) => r.valid && !r.preferred).id]);
  assert.equal(result.outcome, 'uncertain'); assert.equal(result.mathematicallyValid, true);
});

test('choosing a route credits only entrance recognition; repeated mother across levels cannot farm mastery', async () => {
  const { engine, run } = await setup();
  try {
    const item = run.items[1];
    await engine.gradePracticeItem(run.id, item.id, attempt(item.question.routes.find((r) => r.valid && !r.preferred).id));
    let mastery = engine.loadTrail().mastery;
    assert.equal(mastery.find((m) => m.targetType === 'scenario').successCount, 1);
    assert.ok(mastery.filter((m) => m.targetType === 'method').every((m) => m.successCount === 0));
    const items = await prepareLocalRound(target, skeleton, 'multi');
    assert.equal(items[1].questionKey, item.question.questionKey);
    const again = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
    await engine.gradePracticeItem(again.id, again.items[1].id, { mode: 'selection', selectedIds: items[1].routes.filter((r) => r.valid).map((r) => r.id) });
    assert.equal(engine.loadTrail().mastery.find((m) => m.targetType === 'scenario').successCount, 1);
  } finally { engine.close(); }
});

test('route snapshots and feedback survive backup, and unrelated chat deletion leaves a prepared run resumable', async () => {
  const { engine, run } = await setup();
  try {
    const at = new Date().toISOString();
    await engine.saveChanges({ conversations: [{ id: 'unrelated', title: '其他题', createdAt: at, updatedAt: at, messages: [{ id: 'unrelated-u', role: 'user', content: '另一个问题', createdAt: at }] }] });
    await engine.deleteConversation('unrelated', true);
    assert.equal(engine.loadActivePractice().id, run.id);
    const route = run.items[0].question.routes.find((r) => r.valid);
    await engine.gradePracticeItem(run.id, run.items[0].id, attempt(route.id));
    const before = engine.listPracticeHistory().items;
    const backup = await engine.prepareImport(await engine.exportDatabase()); await engine.commitImport(backup.token);
    const history = engine.listPracticeHistory().items;
    assert.deepEqual(history, before); assert.equal(history[0].question.routes.length, run.items[0].question.routes.length);
  } finally { engine.close(); }
});

test('unreviewed AI route drafts neither credit mastery nor expose unverified edges when revealed', async () => {
  const { engine, items } = await setup();
  try {
    await engine.transaction((db) => {
      const learner = db.exec('SELECT id FROM learner')[0].values[0][0];
      db.run("INSERT INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at) VALUES('anchor',?,?,?,1,'ask',?)", [learner, target.scenarioId, target.methodId, new Date().toISOString()]);
    });
    const draft = structuredClone(items[0]); draft.metadata.reviewStatus = 'model_unverified'; draft.metadata.source.kind = 'ai_variant';
    const run = await engine.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items: [draft] });
    const before = engine.loadTrail();
    await engine.gradePracticeItem(run.id, run.items[0].id, attempt(draft.routes.find((r) => r.valid).id));
    await engine.revealPracticeItem(run.id, run.items[0].id);
    assert.deepEqual(engine.loadTrail(), before);
  } finally { engine.close(); }
});

test('execution credit requires an exact excerpt and a valid paired edge; revealed work cannot count again', async () => {
  const { engine, run } = await setup();
  try {
    const item = run.items[1], steps = 'e^x=1+x+x^2/2+o(x^2)，消去一次项。';
    const assessment = { outcome: 'right', methodIds: ['M.taylor_expansion'], feedback: '二阶展开和抵消正确。', executedEdges: [{ methodId: 'M.taylor_expansion', scenarioId: target.scenarioId, studentExcerpt: steps }] };
    assert.throws(() => engine.gradePracticeItem(run.id, item.id, { mode: 'steps', steps, assessment: { ...assessment, executedEdges: [{ ...assessment.executedEdges[0], studentExcerpt: '学生没有写过的操作' }] } }));
    await engine.gradePracticeItem(run.id, item.id, { mode: 'steps', steps, assessment });
    assert.equal(engine.loadTrail().mastery.find((m) => m.targetType === 'method' && m.targetId === 'M.taylor_expansion').successCount, 1);
    await engine.revealPracticeItem(run.id, run.items[2].id);
    await engine.gradePracticeItem(run.id, run.items[2].id, { mode: 'steps', steps, assessment });
    assert.equal(engine.loadTrail().mastery.find((m) => m.targetType === 'method' && m.targetId === 'M.taylor_expansion').successCount, 1);
  } finally { engine.close(); }
});

test('route validation rejects an existing method paired with an unrelated scene', async () => {
  const sample = structuredClone(target.questions[0]); sample.routes[0].steps[0].methodId = 'M.integration_by_parts';
  await assert.rejects(prepareRouteQuestion(sample, skeleton));
});

test('actual step checking retains the chosen answer model rather than forcing the title/classification fast model', async () => {
  const question = (await prepareLocalRound(target, skeleton))[1], steps = 'e^x=1+x+x^2/2+o(x^2)';
  const original = globalThis.fetch; let request;
  globalThis.fetch = async (_address, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: 'right', method_ids: ['M.taylor_expansion'], feedback: '保留二阶项正确。', evidence: [{ method_id: 'M.taylor_expansion', scenario_id: target.scenarioId, student_excerpt: steps }] }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await assessSteps({ config: { apiBase: 'https://api.deepseek.com', apiKey: 'qa-only', model: 'deepseek-reasoner', supportsImage: false }, question, steps, skeleton });
    assert.equal(request.model, 'deepseek-reasoner'); assert.equal(request.thinking, undefined);
    assert.equal(result.executedEdges[0].studentExcerpt, steps);
  } finally { globalThis.fetch = original; }
});

test('streamed generated route items arrive one by one and can never declare themselves reviewed classics', async () => {
  const original = globalThis.fetch, output = target.questions.map((q) => ({ ...q, invariants: q.metadata.invariants, allowedVariations: ['仅用于测试的受控变化'] }));
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ items: output }) } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  const delivered = [];
  try {
    const items = await generatePractice({ config: { apiBase: 'https://qa.example.com', apiKey: 'qa-only', model: 'qa', supportsImage: false }, skeleton,
      scenarioId: target.scenarioId, methodId: target.methodId, anchor: '用户实际原题', onItem: (item) => delivered.push(item) });
    assert.equal(delivered.length, 3); assert.equal(items.length, 3);
    assert.ok(items.every((q) => q.metadata.reviewStatus === 'model_unverified' && !q.metadata.userApprovedClassic && q.metadata.sourceQuestion === '用户实际原题'));
  } finally { globalThis.fetch = original; }
});
