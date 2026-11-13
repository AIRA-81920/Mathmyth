import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { buildReviewedManifest } from '../scripts/build-reviewed-manifest.mjs';
import { relatedPracticeTargets } from '../src/assets/practice/related-bank.js';
import { findRelatedPractice, generateRelatedPractice } from '../src/core/practice/related.js';
import { isInstalledReviewedQuestion } from '../src/core/practice/reviewedIdentity.js';
import { prepareRouteQuestion } from '../src/core/practice/routes.js';
import { localTargets } from '../src/core/practice/bank.js';
import { DatabaseEngine } from '../src/core/db/engine.js';

const s = String.raw;
const skeleton = await readActiveSkeleton();
const zero = 'S.limit.0over0';
const path = (...methods) => ({ steps: methods.map(method_id => ({ scenario_id: zero, method_id })) });
const rootRoute = path('M.rationalization', 'M.important_limit');
const original = s`求 $\displaystyle\lim_{x\to0}\frac{\sqrt{1+\sin x}-1}{x}$。`;
const base = { sourceRoute: rootRoute, sourceQuestion: original, skeleton };
const config = { apiBase: 'https://qa.invalid/v1', apiKey: 'test-only', model: 'mock', supportsImage: false };
async function withModel(raw, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] });
  try { return await callback(); } finally { globalThis.fetch = previous; }
}
const rootSine = () => structuredClone(relatedPracticeTargets.find(target => target.questions[0].metadata.learning.familyId === 'limit.root-sine').questions[0]);

test('本地同链命中：全程零模型请求，候选链与源链逐项一致', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('本地检索不允许联网'); };
  try {
    const result = await findRelatedPractice(base);
    assert.ok(result.question, result.reason);
    assert.equal(calls, 0);
    assert.deepEqual(result.match.candidate.steps, rootRoute.steps.map(step => ({ scenarioId: step.scenario_id, methodId: step.method_id })));
    assert.equal(result.match.verified, true);
    assert.equal(result.question.metadata.learning.relation, 'similar');
    assert.ok(result.question.metadata.learning.hints.length === 2);
    assert.ok(result.target.questions.length > 0);
  } finally { globalThis.fetch = previous; }
});

test('只剩同链一种关系：对照与迁移被明确拒绝，而不是悄悄降级', async () => {
  for (const relation of ['contrast', 'transfer']) {
    const result = await findRelatedPractice({ ...base, relation });
    assert.equal(result.code, 'relation_unknown', relation);
  }
});

test('结果不再携带任何结构判据：只有链一致 + 来源可信', async () => {
  const result = await findRelatedPractice(base);
  assert.ok(result.question, result.reason);
  assert.equal('structureChecked' in result.match, false);
  assert.equal(Object.keys(result.match).some(key => /structure|shape|instance/i.test(key)), false);
  assert.equal(result.match.familyId, 'derived.ai-chain');
  assert.deepEqual(result.match.basis, ['有序情景与方法连线逐项一致', '题目取自人工核对过的题库，不是 AI 生成']);
});

test('链不同、路线缺失、多解或无序时都拒绝，并给出能指路的文案', async () => {
  const wrongChain = await findRelatedPractice({ ...base, sourceRoute: path('M.important_limit', 'M.rationalization') });
  assert.equal(wrongChain.question, undefined);
  assert.equal(wrongChain.code, 'no_exact_match');
  assert.match(wrongChain.reason, /AI|其他练习/);
  assert.equal((await findRelatedPractice({ ...base, sourceRoute: path('M.missing') })).code, 'route_unresolved');
  assert.equal((await findRelatedPractice({ ...base, sourceRoute: { paths: [rootRoute.steps, rootRoute.steps] } })).code, 'ambiguous_route');
  assert.equal((await findRelatedPractice({ ...base, sourceRoute: { ordered: false, steps: rootRoute.steps } })).code, 'route_unordered');
  assert.equal((await findRelatedPractice({ ...base, sourceRoute: {} })).code, 'route_missing');
});

test('路径依据与回答对不上时拒绝匹配', async () => {
  const steps = rootRoute.steps.map((step, index) => index === 0 ? { ...step, evidence: '回答里并不存在的原文' } : step);
  const result = await findRelatedPractice({ ...base, sourceRoute: { steps }, sourceAnswer: '这段回答没有那句原文' });
  assert.equal(result.code, 'source_evidence_mismatch');
});

test('用得最少的先给，排除过的题不再出现', async () => {
  const first = await findRelatedPractice(base);
  assert.ok(first.question, first.reason);
  const used = await findRelatedPractice({ ...base, usage: [{ questionKey: first.question.questionKey, count: 4 }] });
  assert.notEqual(used.question.questionKey, first.question.questionKey);
  const excluded = await findRelatedPractice({ ...base, excludeQuestionKeys: [first.question.questionKey] });
  assert.notEqual(excluded.question.questionKey, first.question.questionKey);
});

test('返回的 target 描述被服务的那道题：题组入口与题目入口不同也能真正建成练习', async () => {
  const targets = await localTargets(skeleton), cases = [];
  for (const target of targets) for (const source of target.questions ?? []) {
    if (source.entranceScenarioId === target.scenarioId) continue;
    const route = (source.routes ?? []).find(item => item.valid && item.steps?.length);
    if (route) cases.push({ source, route });
  }
  assert.ok(cases.length > 0, '题库里必须有"题组入口 ≠ 题目入口"的题，否则这条回归没有意义');
  const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } });
  await engine.initializeDatabase();
  try {
    let built = 0;
    for (const { source, route } of cases.slice(0, 8)) {
      const result = await findRelatedPractice({ skeleton, sourceQuestion: source.question, sourceAnswer: source.solution, sourceRoute: { steps: route.steps } });
      if (!result.question) continue;
      assert.equal(result.target.scenarioId, result.question.entranceScenarioId, source.metadata.motherId);
      const run = await engine.createPracticeRun({ scenarioId: result.target.scenarioId, methodId: result.target.methodId,
        items: [structuredClone(result.question)], localPrepared: true, preparedTarget: structuredClone(result.target) });
      assert.equal(run.items.length, 1);
      built += 1;
    }
    assert.ok(built > 0, '至少要用真实题库建出一道练习');
  } finally { engine.close(); }
});

test('AI 草稿：链一致才采用，始终标未核对且不算进掌握度', async () => {
  const result = await withModel(rootSine(), () => generateRelatedPractice({ ...base, config }));
  assert.ok(result.question, result.reason);
  assert.equal(result.draft, true);
  assert.equal(result.question.metadata.reviewStatus, 'model_unverified');
  assert.equal(result.question.metadata.source.kind, 'ai_variant');
  assert.deepEqual(result.question.metadata.learning.verification, { status: 'model_unverified', kind: 'chain_checked_only' });
  assert.equal(result.match.verified, false);
  assert.equal(await isInstalledReviewedQuestion(result.question), false);
  assert.equal(result.target.localReady, false);
});

test('AI 草稿不需要题面结构也能落地（原来只认 4 个结构族，等于永远出不来）', async () => {
  const raw = rootSine();
  delete raw.structure;
  raw.question = s`求 $\lim_{x\to0}\frac{e^x-1-x}{x^2}$。`;
  const result = await withModel(raw, () => generateRelatedPractice({ ...base, config }));
  assert.ok(result.question, result.reason);
  assert.equal(result.question.structure ?? null, null);
  assert.match(result.question.faceKey, /^[a-f0-9]{64}$/);
  assert.notEqual(result.question.faceKey, result.question.questionKey);
});

test('AI 草稿被改了链、被截断或与原题重复时一律拒绝', async () => {
  const reversed = rootSine(); reversed.routes[0].steps.reverse();
  assert.equal((await withModel(reversed, () => generateRelatedPractice({ ...base, config }))).code, 'draft_chain_mismatch');
  const shortened = rootSine(); shortened.routes[0].steps.pop();
  assert.equal((await withModel(shortened, () => generateRelatedPractice({ ...base, config }))).code, 'draft_chain_mismatch');
  const prepared = await prepareRouteQuestion(rootSine(), skeleton);
  assert.equal((await withModel(rootSine(), () => generateRelatedPractice({ ...base, config, excludeQuestionKeys: [prepared.questionKey] }))).code, 'draft_repeated');
});

test('人工核对的清单可复现，调用方改不动它的核验结果', async () => {
  const expected = JSON.parse(await readFile(new URL('../src/assets/practice/reviewed-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(await buildReviewedManifest(), expected);
  const question = await prepareRouteQuestion(rootSine(), skeleton);
  assert.equal(await isInstalledReviewedQuestion(question), true);
  for (const alter of [q => q.solution = '答案是999', q => q.question += '另求一个参数',
    q => q.routes[0].steps.reverse(), q => q.metadata.source.kind = 'ai_variant', q => q.metadata.motherId = 'uninstalled']) {
    const changed = structuredClone(question); alter(changed);
    assert.equal(await isInstalledReviewedQuestion(changed), false);
  }
});

test('思路索引命中的题库题能真正建成练习（不是只返回一个摘要）', async () => {
  const targets = await localTargets(skeleton);
  const source = targets.flatMap((target) => (target.questions ?? []).map((question) => ({ target, question })))
    .find(({ question }) => question.metadata?.bankId && question.routes?.some((route) => route.valid && route.steps?.length));
  assert.ok(source, '题库里必须有带官方标识的题');
  const route = source.question.routes.find((item) => item.valid && item.steps.length);
  // 把作者题全部排除，强制走索引里的题库题，才能验证索引返回的 target 是可建练习的。
  const authoredKeys = relatedPracticeTargets.flatMap((target) => (target.questions ?? []).map((question) => question.questionKey));
  const result = await findRelatedPractice({ sourceRoute: { steps: route.steps }, sourceQuestion: source.question.question,
    skeleton, excludeQuestionKeys: authoredKeys });
  assert.ok(result.question, result.reason);
  assert.ok(result.question.metadata.bankId, '应当命中题库题');
  const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
  const engine = new DatabaseEngine({ SQL, schemaSql, storage: { load: async () => null, commit: async (_bytes, revision) => revision + 1 } });
  await engine.initializeDatabase();
  try {
    await engine.saveChanges({ conversations: [{ id: 'indexed-chat', title: '索引题', createdAt: '2026-11-13T00:00:00Z',
      updatedAt: '2026-11-13T00:00:00Z', messages: [{ id: 'indexed-card', role: 'assistant', content: '准备练习', createdAt: '2026-11-13T00:00:00Z' }] }] });
    const run = await engine.createPracticeRun({ scenarioId: result.target.scenarioId, methodId: result.target.methodId,
      items: [result.question], localPrepared: true, preparedTarget: result.target,
      chat: { conversationId: 'indexed-chat', messageId: 'indexed-card' } });
    assert.equal(run.items.length, 1);
    assert.equal(run.items[0].question.questionKey, result.question.questionKey);
  } finally { engine.close(); }
});
