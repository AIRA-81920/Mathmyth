import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { firstBatchTargets } from '../src/assets/practice/route-bank.js';
import { prepareLocalRound } from '../src/core/practice/bank.js';
import { prepareRouteQuestion, routeAssessment } from '../src/core/practice/routes.js';
import { assessSteps } from '../src/core/ai/practice.js';
import { DatabaseEngine } from '../src/core/db/engine.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const files = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).map(async (name) =>
  [name, JSON.parse(await readFile(new URL(name, directory), 'utf8'))]));
const skeleton = createSkeleton(Object.fromEntries(files));
const target = firstBatchTargets.find((t) => t.id.endsWith('.cancellation'));
const items = await prepareLocalRound(target, skeleton), question = items[0];
const steps = '我会把前面再把它变成3*sin(3x)/3x，然后让它出现一个重要极限，直接用这个重要极限解，等于3×1=3';
const correct = { outcome: 'right', method_ids: ['M.important_limit'], feedback: '凑成3·sin(3x)/(3x)是正确的，重要极限给出3×1=3；分母3x建议加括号。',
  mathematical_evidence: [{ student_excerpt: steps, explanation: '补回外面的3后恒等，3x趋于0，所以正弦比趋于1。' }],
  evidence: [{ method_id: 'M.important_limit', scenario_id: 'S.limit.0over0', student_excerpt: steps }] };
async function modelResult(output, task, inputSteps = steps, inputQuestion = question) {
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await assessSteps({ config: { apiBase: 'https://model.example/v1', apiKey: 'qa-only', model: 'qa' }, skeleton,
      question: inputQuestion, steps: inputSteps });
    await task(result, request);
  } finally { globalThis.fetch = previous; }
}

test('plain-language important-limit operation has a real zero-over-zero edge and can credit execution', async () => {
  assert.ok(question.routes.some((r) => r.valid && r.steps.some((step) => step.methodId === 'M.important_limit')));
  await modelResult(correct, async (assessment, request) => {
    assert.equal(assessment.outcome, 'right'); assert.equal(assessment.methodIds[0], 'M.important_limit');
    assert.match(request.messages[0].content, /支持大白话/);
    const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
    const db = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision+1 } });
    await db.initializeDatabase();
    try {
      const run = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
      await db.gradePracticeItem(run.id, run.items[0].id, { mode: 'steps', steps, assessment });
      assert.equal(db.loadTrail().mastery.find((m) => m.targetId === 'M.important_limit').successCount, 1);
    } finally { db.close(); }
  });
});

test('important-limit route is valid in all three selection modes, including the equal-cost comparison', async () => {
  const raw = target.questions[0];
  for (const mode of ['single','multi','best']) {
    const q = await prepareRouteQuestion(raw, skeleton, mode);
    const selected = mode === 'multi' ? q.routes.filter((r) => r.valid).map((r) => r.id) : ['r-important'];
    assert.equal(routeAssessment(q, selected).outcome, 'right');
  }
});

test('a correct alternative on an old snapshot is not rejected because its execution edge is missing', async () => {
  const old = structuredClone(question);
  old.allowedEdges = old.allowedEdges.filter((e) => e.methodId !== 'M.important_limit');
  old.candidateMethodIds = old.candidateMethodIds.filter((id) => id !== 'M.important_limit');
  old.routes = old.routes.filter((r) => !r.steps.some((step) => step.methodId === 'M.important_limit'));
  await modelResult(correct, async (assessment, request) => {
    assert.equal(assessment.outcome, 'right'); assert.deepEqual(assessment.methodIds, []);
    assert.equal(assessment.mathematicalEvidence[0].studentExcerpt, steps);
    assert.ok(JSON.parse(request.messages[1].content).methods.some((m) => m.id === 'M.important_limit'));
  }, steps, old);
});

test('mathematical success without mapped execution evidence can be saved without creating mastery', async () => {
  const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
  const db = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision+1 } });
  await db.initializeDatabase();
  try {
    const run = await db.createPracticeRun({ scenarioId: target.scenarioId, methodId: target.methodId, items, localPrepared: true });
    const assessment = { outcome: 'right', methodIds: [], executedEdges: [], mathematicalEvidence: [{ studentExcerpt: steps, explanation: '正确恒等改写后使用重要极限。' }], mathematicallyValid: true, feedback: '这条路线正确。' };
    const graded = await db.gradePracticeItem(run.id, run.items[0].id, { mode: 'steps', steps, assessment });
    assert.equal(graded.items[0].result, 'right'); assert.equal(db.loadTrail().mastery.length, 0);
    assert.throws(() => db.gradePracticeItem(run.id, run.items[1].id, { mode: 'steps', steps,
      assessment: { ...assessment, mathematicalEvidence: [{ studentExcerpt: '用户没有写过的推导', explanation: '伪造。' }] } }));
  } finally { db.close(); }
});

test('an actual missing coefficient keeps the specific mathematical error rather than generic uncertainty', async () => {
  const wrongSteps = '把它换成sin(3x)/(3x)，重要极限等于1，所以原题是1';
  await modelResult({ outcome: 'wrong', method_ids: [], evidence: [], feedback: '漏了外面的3，改分母后必须乘回3，原式才保持相等。',
    mathematical_evidence: [{ student_excerpt: wrongSteps, explanation: '仅将分母乘3而不补系数会改变原表达式。' }] },
    (assessment) => { assert.equal(assessment.outcome, 'wrong'); assert.match(assessment.feedback, /漏了外面的3/); }, wrongSteps);
});

test('method name alone stays uncertain and keeps an actionable request', async () => {
  await modelResult({ outcome: 'uncertain', method_ids: [], evidence: [], mathematical_evidence: [], feedback: '请说明怎样凑成sin u/u，以及外面的系数是多少。' },
    (assessment) => { assert.equal(assessment.outcome, 'uncertain'); assert.match(assessment.feedback, /系数/); }, '使用重要极限');
});
