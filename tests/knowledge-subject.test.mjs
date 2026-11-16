import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { createKnowledgeIndex, locationScenarios, methodConnections } from '../src/core/knowledge/index.js';
import { createPatternIndex } from '../src/core/knowledge/patternSchema.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
async function loadSkeleton(subject) {
  const dir = new URL(subject === 'high_school' ? '../src/assets/skeleton-hs/' : '../src/assets/skeleton/', import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const files = await Promise.all(names.map(async (name) => [name, JSON.parse(await readFile(new URL(name, dir), 'utf8'))]));
  const skeleton = createSkeleton(Object.fromEntries(files));
  skeleton.subject = subject;
  return skeleton;
}
const loadKnowledge = (subject, kind) => readJson('../src/assets/knowledge/' + subject + '/' + kind + '.json');

// 4.3.2 实机：高中数学提问时本题路径永远出不来、足迹永远空。根因是跨节点知识资产只有高数一份，
// 却被拿去校验高中数学骨架，第一条关系就断链。这个测试用真实骨架守住两个学科都能跑通。
test('高中数学的知识关系与具体结构都能在自己的骨架上建索引', async () => {
  const skeleton = await loadSkeleton('high_school');
  const relations = await loadKnowledge('high_school', 'relations');
  const patterns = await loadKnowledge('high_school', 'patterns');
  const blockId = skeleton.blocks[0].id;

  assert.ok(relations.relations.length >= 10, '高中至少要有成体系的知识关系');
  const index = createKnowledgeIndex(skeleton, relations);
  assert.equal(index.relations.length, relations.relations.length);

  const candidates = locationScenarios(skeleton, [blockId]);
  assert.ok(candidates.length > 0, '归位候选不能为空，否则 edges 阶段没有情景可选');
  const own = skeleton.scenariosForBlock(blockId).map((scenario) => scenario.id);
  assert.ok(candidates.some((scenario) => own.includes(scenario.id)), '候选里必须包含本板块情景');

  const scenario = skeleton.scenariosForBlock(blockId)[0];
  const methodId = scenario.methods[0].method_id;
  assert.doesNotThrow(() => methodConnections(skeleton, methodId));

  assert.ok(patterns.patterns.length >= 5, '高中至少要有一批具体结构');
  const patternIndex = createPatternIndex(skeleton, patterns);
  assert.equal(patternIndex.byId.size, patterns.patterns.length);
});

test('两个学科的知识资产各自闭合，不互相串味', async () => {
  const hs = await loadSkeleton('high_school');
  const adv = await loadSkeleton('advanced');
  const hsRelations = await loadKnowledge('high_school', 'relations');
  const hsPatterns = await loadKnowledge('high_school', 'patterns');
  const advRelations = await loadKnowledge('advanced', 'relations');
  const advPatterns = await loadKnowledge('advanced', 'patterns');

  const endpointsOf = (relations) => relations.relations.flatMap((r) => [r.from, r.to]);
  for (const [name, skeleton, relations, patterns] of [
    ['高数', adv, advRelations, advPatterns], ['高中', hs, hsRelations, hsPatterns],
  ]) {
    for (const node of endpointsOf(relations)) {
      const map = node.kind === 'method' ? skeleton.methodById : skeleton.scenarioById;
      assert.ok(map.has(node.id), name + ' 的关系端点必须在本学科骨架里：' + node.id);
    }
    for (const pattern of patterns.patterns) {
      for (const id of pattern.scenarioIds) assert.ok(skeleton.scenarioById.has(id), name + ' 具体结构情景无效：' + id);
      for (const id of pattern.methodIds) assert.ok(skeleton.methodById.has(id), name + ' 具体结构方法无效：' + id);
    }
  }

  const text = (value) => JSON.stringify(value);
  assert.equal(/hs_/.test(text(advRelations)), false, '高数关系里不该出现高中 id');
  assert.equal(/hs_/.test(text(advPatterns.patterns)), false, '高数具体结构里不该出现高中 id');
  assert.equal(/S\.limit|M\.equiv_infinitesimal/.test(text(hsRelations)), false, '高中关系里不该出现高数 id');
});

test('高数的知识关系仍保持严格校验（坏数据必须报错）', async () => {
  const adv = await loadSkeleton('advanced');
  const broken = { schema: 'mathmyth-knowledge-relations/v1', relations: [{ id: 'K.broken.test', type: 'continues_into',
    from: { kind: 'method', id: 'M.not_exists' }, to: { kind: 'scenario', id: 'S.limit.0over0' }, task: ['compute'],
    inputState: 'a', operation: 'b', output: 'c', boundary: 'd', conditions: ['e'], evidence: ['f'], review: 'verified' }] };
  assert.throws(() => createKnowledgeIndex(adv, broken), /知识关系断链/);
});