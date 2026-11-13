import test from 'node:test';
import assert from 'node:assert/strict';

// 与 related.js 里的签名完全一致。
const signatureOf = (steps) => JSON.stringify(steps.map((step) => [step.scenarioId, step.methodId]));

// 索引是生成物：题库改了但忘记重新生成时，这里必须变红。
async function coverage(bankUrl, indexUrl) {
  const [{ preparedRouteTargets }, index] = await Promise.all([import(bankUrl), import(indexUrl)]);
  let routes = 0;
  for (const target of preparedRouteTargets) {
    for (const question of target.questions ?? []) {
      if (question?.metadata?.reviewStatus !== 'worked_example_checked') continue;
      for (const route of question.routes ?? []) {
        if (!route?.valid) continue;
        routes += 1;
        const hits = index.entries[signatureOf(route.steps)];
        assert.ok(Array.isArray(hits) && hits.length, `缺少索引：${question.metadata.motherId}/${route.id}`);
        assert.ok(hits.some(([, motherId]) => motherId === question.metadata.motherId), `索引没有指向这道题：${question.metadata.motherId}`);
      }
    }
  }
  return routes;
}

test('高数思路索引覆盖全部已核对题的有效路线', async () => {
  const routes = await coverage('../src/assets/practice/route-bank.js', '../src/assets/practice/related-index.js');
  assert.ok(routes > 1000, `有效路线过少：${routes}`);
});

test('高中思路索引覆盖全部已核对题的有效路线', async () => {
  const routes = await coverage('../src/assets/practice/route-bank-hs.js', '../src/assets/practice/related-index-hs.js');
  assert.ok(routes > 500, `有效路线过少：${routes}`);
});
