import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStreamingMarkdown } from '../src/components/streamingMarkdown.js';
import { splitImageTranscript } from '../src/core/ai/imageTranscript.js';
import { completeJsonItems } from '../src/core/ai/partialJson.js';
import { inspectAsset } from '../scripts/credential-guard.mjs';
import { practiceChoices } from '../src/core/mastery/choices.js';

test('stream checkpoints keep unfinished formulas, fences, inline marks and links as escaped tails', () => {
  const prefix = '已完成 $x$。\n\n';
  for (const tail of ['$$\\frac{1}{x}\n\n', '```js\n\nconst x=1;', '**加粗\n\n', '[链接\n\n', '\\[x\n\n']) {
    assert.deepEqual(splitStreamingMarkdown(prefix + tail), { blocks: [prefix], pending: tail });
  }
  assert.deepEqual(splitStreamingMarkdown('$$x\n\n+y$$\n\n尾部'), { blocks: ['$$x\n\n+y$$\n\n'], pending: '尾部' });
  assert.deepEqual(splitStreamingMarkdown('```\n\n$x$\n```\n\n尾部'), { blocks: ['```\n\n$x$\n```\n\n'], pending: '尾部' });
  assert.deepEqual(splitStreamingMarkdown('a | b\n---|---\n1|2\n\n尾部'), { blocks: ['a | b\n---|---\n1|2\n\n'], pending: '尾部' });
  assert.equal(splitStreamingMarkdown('1. 第一项\n\n2. 第二项\n').blocks.length,0);
});
test('image transcript tags split across packets never appear in an answer', () => {
  const value = '<mathmyth_question>求 $x$。</mathmyth_question>\n\n答案。';
  for (let length = 1; length < value.indexOf('</mathmyth_question>') + 20; length++) {
    assert.equal(splitImageTranscript(value.slice(0,length)).answer, '');
  }
  assert.deepEqual(splitImageTranscript(value), { question: '求 $x$。', answer: '答案。', pending: false });
  assert.equal(splitImageTranscript('模型直接解答。').answer, '模型直接解答。');
});
test('JSON checkpoints require closed objects and preserve quotes, braces and LaTeX strings', () => {
  const item = { question: '含 } 和 " 的题 $\\frac{1}{x}$', structure: { op: 'divide', args: [] } };
  const value = `{"items":[${JSON.stringify(item)},{"question":"未完成`;
  assert.deepEqual(completeJsonItems(value), [item]);
});
test('practice choices merge methods of one scenario and count a source question once', () => {
  const skeleton = { scenarioById: new Map([['s',{ name:'同一个情景', methods:[{method_id:'m1',priority:1},{method_id:'m2',priority:2}] }]]) };
  const data = { mastery:[], encounters:[{id:'a',scenarioId:'s',methodId:'m1',messageId:'q',question:'题',occurredAt:'2026-10-10'},
    {id:'b',scenarioId:'s',methodId:'m2',messageId:'q',question:'题',occurredAt:'2026-10-10'}] };
  const choices = practiceChoices(skeleton,data); assert.equal(choices.length,1); assert.equal(choices[0].count,1);
});
test('APK guard rejects keys and data assets, while public field names and empty settings pass', () => {
  assert.doesNotThrow(() => inspectAsset('assets/app.js', Buffer.from('apiKey:"",Authorization:`Bearer ${config.apiKey}`')));
  for (const [name,value] of [['assets/backup.sqlite','abc'],['assets/.env','API_KEY=abc'],['assets/app.js','sk-abcdefghijklmnopqrstuvwxyz'],['assets/app.js','my-private-value']])
    assert.throws(() => inspectAsset(name,Buffer.from(value),['my-private-value']));
});
