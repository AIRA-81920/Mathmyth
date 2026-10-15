import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import katex from 'katex';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { getKnowledgeNode, knowledgeMarkdown, methodLearningContent, scenarioLearningContent } from '../src/core/skeleton/content.js';
import { methodDiscussionPrompt } from '../src/core/ai/methodContext.js';
import { readKnowledgeView, saveKnowledgeView } from '../src/core/skeleton/viewState.js';

const directory = new URL('../src/assets/skeleton/', import.meta.url);
const skeleton = createSkeleton(Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => [name, JSON.parse(readFileSync(new URL(name, directory), 'utf8'))])));

test('every real scenario exposes its definition and only canonical related methods and boundaries', () => {
  for (const scenario of skeleton.scenarioById.values()) {
    const detail = getKnowledgeNode(skeleton, { kind: 'scenario', id: scenario.id });
    assert.equal(detail.name, scenario.name);
    assert.ok(detail.definition); assert.ok(detail.signals.length); assert.ok(detail.examples.length);
    assert.deepEqual(detail.methods.map((method) => method.id), scenario.methods.map((edge) => edge.method_id));
    for (const boundary of detail.boundaries) assert.ok(skeleton.scenarioById.has(boundary.scenarioId));
  }
  assert.equal(getKnowledgeNode(skeleton, { kind: 'scenario', id: 'S.limit.parametric_limit' }), null);
  assert.equal(getKnowledgeNode(skeleton, { kind: 'method', id: 'M.lhopital' }), null);
});

test('group and block explanations resolve all children, including unseen scenarios, without inventing nodes', () => {
  for (const group of skeleton.groups) {
    const detail = getKnowledgeNode(skeleton, { kind: 'group', id: group.id });
    assert.ok(detail.definition && !detail.definition.startsWith('这一组把'), group.id);
    assert.deepEqual(detail.children.map((child) => child.id), group.scenario_ids);
  }
  for (const block of skeleton.blocks) {
    const detail = getKnowledgeNode(skeleton, { kind: 'block', id: block.id });
    assert.equal(detail.definition, block.summary);
    assert.equal(detail.children.length, skeleton.scenariosForBlock(block.id).length);
  }
  const indeterminate = getKnowledgeNode(skeleton, { kind: 'group', id: 'G.limit.indeterminate' });
  assert.match(indeterminate.definition, /不足以确定/);
  assert.ok(indeterminate.definition.includes('$0/0$'));
});

test('method foundations keep conditions, distinguish identities from theorems, and do not fake source text', () => {
  for (const method of skeleton.methodById.values()) {
    const content = methodLearningContent(method);
    assert.ok(content.definition); assert.deepEqual(content.conditions, method.preconditions ?? []);
    if (content.source) assert.match(content.source.url, /^https:\/\/openstax\.org\/books\/calculus-volume-/);
  }
  const lhopital = methodLearningContent(skeleton.methodById.get('M.lhopital'));
  assert.match(lhopital.principle, /分母导数非零/);
  assert.match(lhopital.basis, /不是对整个分式求导/);
  const factor = methodLearningContent(skeleton.methodById.get('M.factor_cancel'));
  assert.match(factor.principle, /去心邻域/);
  const composite = scenarioLearningContent(skeleton.scenarioById.get('S.deriv.composite_derivative'));
  assert.match(composite.boundaries[0].how, /也可以/);
});

test('knowledge text renders supplied math fragments and curated formulas through KaTeX', () => {
  assert.equal(knowledgeMarkdown('求 lim_{x→0} (sin x)/x'), '求 $\\lim _{x\\to 0} (\\sin  x)/x$');
  assert.equal(knowledgeMarkdown('已写好 $x^2$ 的内容'), '已写好 $x^2$ 的内容');
  const values = [];
  for (const scenario of skeleton.scenarioById.values()) {
    const content = scenarioLearningContent(scenario);
    values.push(content.definition, content.note, ...content.examples, ...content.signals, ...content.boundaries.map((entry) => entry.how));
  }
  for (const method of skeleton.methodById.values()) {
    const content = methodLearningContent(method);
    values.push(content.definition, content.principle, ...content.conditions, ...content.pitfalls, ...content.steps);
  }
  for (const value of values) for (const match of knowledgeMarkdown(value).matchAll(/\$([^$]+)\$/gu)) {
    assert.doesNotThrow(() => katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' }), value);
  }
});

test('method conversation includes explained scene transitions and accurate shared foundations', () => {
  const prompt = methodDiscussionPrompt(skeleton, 'M.log_transform');
  assert.match(prompt, /不能先假设原极限存在/);
  assert.match(prompt, /新的情景/);
  assert.match(prompt, /正值条件/);
  assert.match(prompt, /不编造教材原文或页码/);
});

test('nested knowledge exploration remembers each reading state until the next trail lifecycle', () => {
  saveKnowledgeView('method:A', 101, { expanded: true, questionsOpen: true, scroll: 270 });
  saveKnowledgeView('scenario:S', 101, { scroll: 140 });
  saveKnowledgeView('method:B', 101, { stepsOpen: true, scroll: 90 });
  assert.deepEqual(readKnowledgeView('method:A', 101), { expanded: true, questionsOpen: true, scroll: 270 });
  assert.equal(readKnowledgeView('scenario:S', 101).scroll, 140);
  assert.deepEqual(readKnowledgeView('method:A', 102), {});
  assert.deepEqual(readKnowledgeView('method:B', 102), {});
});
