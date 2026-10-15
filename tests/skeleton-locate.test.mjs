import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { parseBlocks, parseBlockLocation, parseEncounters } from '../src/core/ai/locate.js';

const directory = new URL('../../skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, directory), 'utf8'))])));

test('real skeleton has no broken active edges and keeps missing additions explicit', () => {
  assert.equal(skeleton.blocks.length, 11);
  assert.equal(skeleton.scenarioById.size, 111);
  assert.equal(skeleton.methodById.size, 111);
  assert.equal(skeleton.pendingAdditions.length, 4);
  assert.equal(skeleton.aliases.get('M.taylor'), 'M.taylor_expansion');
  for (const scenario of skeleton.scenarioById.values()) {
    for (const edge of scenario.methods) assert.ok(skeleton.methodById.has(edge.method_id));
  }
});

test('question classification requires a boolean and accepts false independently of previous math context', () => {
  assert.deepEqual(parseBlockLocation('{"block_ids":["B.limit"],"is_math_question":false,"recognized_question":null}', skeleton),
    { blockIds: ['B.limit'], isMathQuestion: false, recognizedQuestion: null });
  for (const is_math_question of ['true', 1, null]) assert.throws(() => parseBlockLocation(JSON.stringify({ block_ids: [], is_math_question }), skeleton));
  assert.throws(() => parseBlockLocation('{"block_ids":[]}', skeleton));
});

test('location accepts an actual edge and rejects an existing but unrelated method', () => {
  const scenario = skeleton.scenarioById.get('S.limit.0over0');
  const entry = { scenario_id: scenario.id, method_id: scenario.methods[0].method_id, is_main: true };
  const blocks = parseBlocks('{"block_ids":["B.limit"]}', skeleton);
  assert.deepEqual(parseEncounters(JSON.stringify({ encounters: [entry] }), skeleton, blocks), [entry]);
  const unrelated = [...skeleton.methodById.keys()].find((id) => !scenario.methods.some((edge) => edge.method_id === id));
  assert.throws(() => parseEncounters(JSON.stringify({ encounters: [{ ...entry, method_id: unrelated }] }), skeleton, blocks));
});
