import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';

// 这条测试比"钉死 sha256"更根本：钉 hash 只能事后发现产物变了，看不懂到底哪里变了。
// 这里直接拿 skeleton 当基准，逐组比 id / 名称 / 顺序 / 成员情景。
// 改过 src/assets/skeleton/*.json 却没重新生成题库时，这里会立刻红。
const skeleton = await readActiveSkeleton();
const bank = JSON.parse(await readFile(new URL('../src/assets/practice/question-banks/bank402.json', import.meta.url), 'utf8'));

test('题库的分组结构与 skeleton 完全一致（改骨架必须重新生成题库）', () => {
  const expected = new Map(skeleton.groups.map((group) => [group.id, group]));
  const actual = new Map((bank.taxonomy?.groups ?? []).map((group) => [group.id, group]));
  assert.ok(actual.size > 0, '题库里没有 taxonomy.groups');
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), '分组 id 集合不一致');
  for (const [id, want] of expected) {
    const got = actual.get(id);
    assert.equal(got.name, want.name, id + ' 的名称不一致');
    assert.equal(got.order, want.order, id + ' 的顺序不一致');
    assert.deepEqual([...got.scenario_ids].sort(), [...want.scenario_ids].sort(), id + ' 的成员情景不一致');
  }
});

test('题库里出现的情景都存在于 skeleton，且入口情景都有方法', () => {
  for (const scenario of bank.taxonomy?.scenarios ?? []) {
    const known = skeleton.scenarioById.get(scenario.id);
    assert.ok(known, '题库里有 skeleton 不存在的情景：' + scenario.id);
    assert.ok(known.methods.length > 0, scenario.id + ' 在 skeleton 里没有任何方法');
  }
});
