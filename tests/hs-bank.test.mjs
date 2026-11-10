import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createSkeleton } from '../src/core/skeleton/index.js';

const skeletonDir = new URL('../src/assets/skeleton-hs/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(skeletonDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, skeletonDir), 'utf8'))])));
const bankDir = new URL('../src/assets/practice/question-banks/', import.meta.url);

// 全部高中题库统一校验：新增 bankhsN 时无需再复制一份测试
const bankNames = readdirSync(bankDir).filter((name) => /^bankhs\d+\.json$/.test(name)).sort();
const banks = bankNames.map((name) => ({ name, bank: JSON.parse(readFileSync(new URL(name, bankDir), 'utf8')) }));

test('全部高中题库只使用高中骨架节点，路线首步与入口一致', () => {
  assert.ok(banks.length >= 9, `高中题库数量异常：${banks.length}`);
  let totalQuestions = 0;
  for (const { name, bank } of banks) {
    assert.match(bank.bankId, /^bankhs\d+$/, name);
    assert.ok(bank.questions.length > 0, name);
    totalQuestions += bank.questions.length;
    assert.equal(bank.taxonomy.blocks.length, 7, name);
    assert.equal(bank.taxonomy.groups.length, 28, name);
    assert.equal(bank.taxonomy.scenarios.length, 110, name);
    for (const question of bank.questions) {
      assert.ok(skeleton.scenarioById.has(question.entranceScenarioId), `${name}:${question.entranceScenarioId}`);
      assert.match(question.questionKey, /^[a-f0-9]{64}$/);
      assert.ok(question.metadata.motherId.startsWith(`candidate.${bank.bankId}.`));
      assert.equal(question.metadata.source.kind, 'dataset_import');
      assert.ok(question.routes.length >= 3 && question.routes.length <= 5);
      assert.equal(question.routes.filter((route) => route.preferred).length, 1);
      assert.ok(question.routes.some((route) => !route.valid));
      for (const route of question.routes) {
        assert.equal(route.steps[0].scenarioId, question.entranceScenarioId);
        for (const step of route.steps) {
          const scenario = skeleton.scenarioById.get(step.scenarioId);
          assert.ok(scenario, step.scenarioId);
          assert.ok(scenario.methods.some((edge) => edge.method_id === step.methodId), `${step.scenarioId}/${step.methodId}`);
        }
      }
    }
  }
  // 已发布题量至少 60 道，避免题库在重构中被意外清空
  assert.ok(totalQuestions >= 60, `已发布题量异常：${totalQuestions}`);
});

test('高中路由题库能生成练习目标，且全部落在高中骨架内', async () => {
  const { preparedRouteTargets } = await import('../src/assets/practice/route-bank-hs.js');
  // 目标数由实际注册的题库决定；这里只要求覆盖多个板块，防止题库未注册
  assert.ok(preparedRouteTargets.length >= 40, `练习目标过少：${preparedRouteTargets.length}`);
  for (const target of preparedRouteTargets) {
    assert.ok(skeleton.scenarioById.has(target.scenarioId), target.scenarioId);
    assert.ok(target.questions.length > 0);
    for (const question of target.questions) assert.ok(skeleton.scenarioById.has(question.entranceScenarioId));
  }
});
