import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { practiceChoices, nextPreparedChoiceIndex } from '../src/core/mastery/choices.js';
import { prepareLocalRound, localTargets } from '../src/core/practice/bank.js';

const dir = new URL('../src/assets/skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(await Promise.all((await readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => [name, JSON.parse(await readFile(new URL(name, dir), 'utf8'))]))));
const preparedEncounters = localTargets(skeleton).map((target, index) => ({ id: `seen-${index}`, scenarioId: target.scenarioId, methodId: target.methodId, question: '已接触的题', occurredAt: '2026-10-12T00:00:00Z' }));
const choices = practiceChoices(skeleton, { mastery: [], encounters: [...preparedEncounters] }, { includePrepared: true });

test('an installed question bank does not unlock any topics for a new learner', () => {
  assert.deepEqual(practiceChoices(skeleton, { mastery: [], encounters: [] }, { includePrepared: true }), []);
});

test('only valid encountered scenarios unlock recommendations and manual targets, not unrelated Fourier topics', () => {
  const encounter = { id: 'limit-question', messageId: 'same-question', scenarioId: 'S.limit.0over0', methodId: 'M.important_limit', question: '求 sin(3x)/x 的极限', occurredAt: '2026-10-13T00:00:00Z' };
  const list = practiceChoices(skeleton, { mastery: [], encounters: [encounter, { ...encounter, id: 'other-method', methodId: 'M.lhopital' }, { ...encounter, id: 'bad-pair', scenarioId: 'S.defint.physics_application' }] }, { includePrepared: true });
  assert.ok(list.length > 0); assert.ok(list.some(choice => choice.localReady));
  assert.ok(list.every(choice => choice.scenarioId === 'S.limit.0over0' && choice.count === 1));
  assert.ok(list.every(choice => !choice.scenarioName.includes('傅里叶')));
});

// 供题完整性与骨架覆盖分别检查。已知仍缺三个后来加入的入口，不能因
// 每个现有题池都可用就宣称全部骨架都有题；新增缺口应触发显式复核。
test('every local pool stays ready with complete rounds across levels', async () => {
  const targets = localTargets(skeleton);
  assert.ok(targets.length >= 26);
  const missing = [...skeleton.scenarioById.keys()].filter(id => !targets.some(t => t.scenarioId === id)).sort();
  assert.deepEqual(missing, ['S.limit.bounded_times_zero', 'S.multiint.polar', 'S.multiint.symmetry_simplify']);
  for (const target of targets) {
    assert.equal(target.localReady, true);
    assert.ok(target.questionCount >= 1, `${target.scenarioId} 本地题池为空`);
    for (const level of ['single', 'multi', 'best']) {
      assert.equal((await prepareLocalRound(target, skeleton, level)).length, Math.min(3, target.questionCount));
    }
  }
});

test('shuffle always lands on another ready pool from any current index', () => {
  assert.ok(choices.every((choice) => choice.localReady === true));
  for (const currentIndex of [0, choices.length - 1]) for (const value of [0, .1, .5, .999]) {
    const next = nextPreparedChoiceIndex(choices, currentIndex, () => value);
    assert.equal(choices[next].localReady, true); assert.notEqual(next, currentIndex);
  }
});

test('a sole ready pool is reachable from an unavailable choice and stays stable when already selected', () => {
  const list = [{ key: 'ready', localReady: true }, { key: 'missing' }];
  assert.equal(nextPreparedChoiceIndex(list, 1), 0);
  assert.equal(nextPreparedChoiceIndex(list, 0), 0);
  assert.equal(nextPreparedChoiceIndex([], 0), 0);
});
