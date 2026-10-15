import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import katex from 'katex';
import initSqlJs from 'sql.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { knowledgeMarkdown, methodLearningContent, getKnowledgeNode } from '../src/core/skeleton/content.js';
import { createPatternIndex, compilePatternLinks, matchingPatternLinks } from '../src/core/knowledge/patternSchema.js';
import { patternsForScenario, patternsForMethod, reviewedPatternLinks, validPatternEvidence, summarizePatternProgress } from '../src/core/knowledge/patterns.js';
import { methodDiscussionPrompt } from '../src/core/ai/methodContext.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { assessSteps } from '../src/core/ai/practice.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const directory = new URL('../src/assets/skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => [name, read(`../src/assets/skeleton/${name}`)])));
const source = read('../../knowledge/patterns.json'), runtime = read('../src/assets/knowledge/patterns.json');
const banks = [read('../src/assets/practice/question-banks/bank402.json'), read('../src/assets/practice/question-banks/bank2027a.json')];
const questions = banks.flatMap((bank) => bank.questions);
const question = questions.find((q) => q.metadata.motherId === 'candidate.bank402.30');
const patternId = 'P.limit.product.half_angle', methodId = 'M.product_telescoping';
const recognition = { mode: 'selection', selectedIds: ['r-0'], outcome: 'right', independent: true, revealed: false };
const steps = '用二倍角恒等式得到有限乘积P=sin1/[2^n sin(2^(-n))]，再算剩下的极限。';
const edge = { methodId, scenarioId: 'S.limit.n_term_sum', studentExcerpt: steps };
const evidence = { patternId, routeId: 'r-0', stepIndex: 0, studentExcerpt: steps, explanation: '已经建立有限乘积的二倍角恒等式。' };

test('optional structures cover the first twelve scenarios and share content rather than creating universal children', () => {
  const priority = ['S.limit.n_term_sum', 'S.indefint.first_substitution', 'S.indefint.sqrt_integrand', 'S.indefint.trig_rational',
    'S.indefint.rational_function', 'S.indefint.by_parts_product', 'S.deriv.higher_order', 'S.mvt.rolle_equality',
    'S.multivar.binary_limit', 'S.ode.reducible_higher_order', 'S.ode.second_order_nonhomogeneous', 'S.series.positive_term_test'];
  const index = createPatternIndex(skeleton, runtime);
  for (const id of priority) assert.ok(index.byScenario.get(id)?.length >= 2, id);
  assert.equal(index.byId.size, 49);
  assert.deepEqual(patternsForScenario(skeleton, 'S.ode.second_order_homogeneous'), []);
  assert.deepEqual(patternsForScenario(skeleton, 'S.deriv.composite_derivative'), []);
  const cycle = patternsForScenario(skeleton, 'S.indefint.by_parts_product').find((entry) => entry.id === 'P.integral.parts.cycle');
  assert.equal(cycle, patternsForScenario(skeleton, 'S.indefint.recurrence').find((entry) => entry.id === cycle.id));
  assert.equal(getKnowledgeNode(skeleton, { kind: 'scenario', id: 'S.limit.n_term_sum' }).patterns.length, 7);
});

test('compiled links match reviewed valid steps and reject distractors, missing methods and duplicate IDs', () => {
  assert.deepEqual(compilePatternLinks(skeleton, source, questions), runtime.questionLinks);
  assert.ok(runtime.questionLinks.length > 70);
  const broken = structuredClone(source);
  broken.questionLinks[0].routeId = question.routes.find((route) => !route.valid).id;
  assert.throws(() => compilePatternLinks(skeleton, broken, questions), /有效步骤/);
  const duplicate = structuredClone(source); duplicate.patterns.push(duplicate.patterns[0]);
  assert.throws(() => createPatternIndex(skeleton, duplicate), /核对资料/);
  const wrongPair = structuredClone(source); wrongPair.patterns[0].methodIds = ['M.lhopital'];
  assert.throws(() => createPatternIndex(skeleton, wrongPair), /配对/);
});

test('all pattern math and newly exposed method cues/examples render with KaTeX', () => {
  const texts = [];
  const gather = (value) => { if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(gather);
    else if (value && typeof value === 'object') Object.values(value).forEach(gather); };
  runtime.patterns.forEach(gather);
  for (const method of skeleton.methodById.values()) {
    const content = methodLearningContent(method); gather(content.signals); gather(content.examples);
  }
  for (const text of texts) for (const match of knowledgeMarkdown(text).matchAll(/\$([^$]+)\$/gu)) {
    assert.doesNotThrow(() => katex.renderToString(match[1], { throwOnError: true, strict: 'ignore', trust: false }), text);
  }
});

test('recognition belongs to the selected entrance pattern, not sibling structures or later steps', () => {
  const result = summarizePatternProgress([{ question, answer: { attemptHistory: [recognition] } }]);
  assert.equal(result.length, 1); assert.equal(result[0].patternId, patternId);
  assert.equal(result[0].recognitionKeys.length, 1); assert.equal(result[0].executionKeys.length, 0);
  const chained = questions.find((q) => q.metadata.motherId === 'candidate.bank402.120');
  const root = summarizePatternProgress([{ question: chained, answer: { attemptHistory: [{ ...recognition, selectedIds: ['r-checked'] }] } }]);
  assert.ok(root.some((entry) => entry.patternId === 'P.integral.root.linear'));
  assert.ok(!root.some((entry) => entry.patternId === 'P.integral.parts.lower_degree'));
});

test('repeat, assisted, revealed and unreviewed attempts do not manufacture independent recognition', () => {
  for (const patch of [{ independent: false }, { revealed: true }, { assisted: true }, { outcome: 'wrong' }]) {
    const result = summarizePatternProgress([{ question, answer: { attemptHistory: [{ ...recognition, ...patch }] } }]);
    assert.ok(result.every((entry) => entry.recognitionKeys.length === 0));
  }
  const repeated = summarizePatternProgress([1, 2].map(() => ({ question, answer: { attemptHistory: [recognition, recognition] } })));
  assert.equal(repeated[0].recognitionKeys.length, 1);
  const draft = structuredClone(question); draft.metadata.reviewStatus = 'model_unverified';
  assert.deepEqual(summarizePatternProgress([{ question: draft, answer: { attemptHistory: [recognition] } }]), []);
});

test('historical snapshots with changed steps are not reinterpreted from only a mother ID or fingerprint', () => {
  const old = structuredClone(question); old.routes.find((route) => route.id === 'r-0').steps[0].transformedState = '旧标签下的不同操作';
  assert.equal(reviewedPatternLinks(question).length, 1);
  assert.deepEqual(matchingPatternLinks(old, runtime.questionLinks), []);
  assert.deepEqual(summarizePatternProgress([{ question: old, answer: { attemptHistory: [recognition] } }]), []);
});

test('execution requires literal evidence for a reviewed pattern step, beyond a generic method edge', () => {
  assert.equal(validPatternEvidence(question, [evidence], [edge], steps).length, 1);
  assert.deepEqual(validPatternEvidence(question, [{ ...evidence, patternId: 'P.limit.product.power_chain' }], [edge], steps), []);
  assert.deepEqual(validPatternEvidence(question, [{ ...evidence, studentExcerpt: '没有写过的操作' }], [edge], steps), []);
  const attempt = { mode: 'steps', outcome: 'right', independent: true, steps, executedEdges: [edge], patternEvidence: [evidence] };
  const result = summarizePatternProgress([{ question, answer: { attemptHistory: [attempt] } }]);
  assert.equal(result[0].executionKeys.length, 1); assert.equal(result[0].recognitionKeys.length, 0);
  const legacy = summarizePatternProgress([{ question, answer: { attemptHistory: [{ ...attempt, patternEvidence: [] }] } }]);
  assert.ok(legacy.every((entry) => !entry.executionKeys.length));
});

test('method discussion receives distinct structure cues, worked examples and counterexamples', () => {
  const content = methodDiscussionPrompt(skeleton, methodId);
  assert.match(content, /recognition_patterns/); assert.match(content, /指数倍增/); assert.match(content, /角度逐次减半/);
  assert.match(content, /累计/); // Other method context still includes its scenario signals.
  assert.equal(patternsForMethod(skeleton, methodId).length, 4);
});

test('AI assessment passes literal pattern evidence and drops invented labels without changing mathematical judgment', async () => {
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: 'right', method_ids: [methodId],
      feedback: '有限乘积恒等式正确。', mathematical_evidence: [{ student_excerpt: steps, explanation: '二倍角逐项连接。' }],
      evidence: [{ method_id: methodId, scenario_id: edge.scenarioId, student_excerpt: steps }],
      pattern_evidence: [
        null,
        { pattern_id: patternId, route_id: 'r-0', step_index: 0, student_excerpt: steps, explanation: '原文实际写出二倍角相消。' },
        { pattern_id: 'P.limit.product.power_chain', route_id: 'r-0', step_index: 0, student_excerpt: steps, explanation: '不应从同一方法猜出其它结构。' },
      ] }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await assessSteps({ question, steps, skeleton, config: { apiBase: 'https://model.example/v1', apiKey: 'qa-only', model: 'qa' } });
    assert.equal(result.outcome, 'right'); assert.equal(result.patternEvidence.length, 1);
    assert.equal(result.patternEvidence[0].patternId, patternId);
    assert.equal(JSON.parse(request.messages[1].content).available_patterns[0].pattern_id, patternId);
    assert.match(request.messages[0].content, /不为结构标签改变数学判断/);
  } finally { globalThis.fetch = previous; }
});

test('SQLite derives pattern evidence without migrating broad mastery and survives export/import', async () => {
  const SQL = await initSqlJs(), schemaSql = readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
  const db = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision+1 } });
  const { learnerId } = await db.initializeDatabase();
  const now = new Date().toISOString();
  try {
    await db.transaction((engine) => {
      engine.run('INSERT INTO mastery(id,learner_id,target_type,target_id,state,success_count,faces,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        ['broad', learnerId, 'method', methodId, 'mastered', 5, '[]', now]);
      engine.run('INSERT INTO practice_run(id,learner_id,scenario_id,method_ids,started_at,generation_status) VALUES(?,?,?,?,?,?)',
        ['pattern-run', learnerId, question.entranceScenarioId, JSON.stringify([methodId]), now, 'complete']);
      engine.run('INSERT INTO practice_item(id,run_id,seq,step,question,created_at) VALUES(?,?,?,?,?,?)',
        ['pattern-item', 'pattern-run', 1, 1, JSON.stringify(question), now]);
    });
    assert.deepEqual(db.loadPatternProgress(), []);
    await db.gradePracticeItem('pattern-run', 'pattern-item', { mode: 'selection', selectedIds: ['r-0'] });
    await db.gradePracticeItem('pattern-run', 'pattern-item', { mode: 'steps', steps,
      assessment: { outcome: 'right', methodIds: [methodId], executedEdges: [edge], patternEvidence: [evidence], feedback: '有限恒等式建立正确。' } });
    const progress = db.loadPatternProgress();
    assert.equal(progress.length, 1); assert.equal(progress[0].recognitionKeys.length, 1); assert.equal(progress[0].executionKeys.length, 1);
    await db.revealPracticeItem('pattern-run', 'pattern-item');
    assert.deepEqual(db.loadPatternProgress(), progress); // Looking later does not erase earlier independent evidence.
    const backup = await db.prepareImport(await db.exportDatabase()); await db.commitImport(backup.token);
    assert.deepEqual(db.loadPatternProgress(), progress);
    await db.transaction((engine) => engine.run('DELETE FROM practice_item WHERE id=?', ['pattern-item']));
    assert.deepEqual(db.loadPatternProgress(), []);
  } finally { db.close(); }
});
