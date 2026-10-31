import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionExtractor } from '../src/core/practice/draftStream.js';

const payload = JSON.stringify({
  question: '求 $\\displaystyle\\lim_{x\\to\\infty}\\frac{2x^2+3}{5x+1}\\sin\\frac{4}{x}$。',
  solution: 'sin(4/x) ~ 4/x，所以趋于 8/5。',
  comparisonCriterion: '按最高次项系数比',
  routes: [{ id: 'r1', summary: '等价无穷小', valid: true, preferred: true, reason: 'x', condition: 'x', steps: [] }],
});
const expected = JSON.parse(payload).question;
const feed = (chunks) => { const ex = createQuestionExtractor(); let last = ''; for (const chunk of chunks) last = ex.push(chunk); return { value: last, complete: ex.complete }; };

test('整段 JSON 一次喂进去也能取出题面', () => {
  const { value, complete } = feed([payload]);
  assert.equal(value, expected);
  assert.equal(complete, true);
});

test('逐字符喂进去，任何时刻得到的都是题面的前缀', () => {
  const ex = createQuestionExtractor(); let seen = '';
  for (const ch of payload) {
    seen = ex.push(ch);
    assert.ok(expected.startsWith(seen), '出现了不属于题面的内容：' + seen);
  }
  assert.equal(seen, expected);
});

test('截断在转义符中间、unicode 转义中间都不会出错', () => {
  const tricky = JSON.stringify({ question: 'a\\"b\\\\c\\u4e2d\\n尾', solution: '', comparisonCriterion: 'x', routes: [] });
  const target = JSON.parse(tricky).question;
  for (let cut = 1; cut < tricky.length; cut += 1) {
    const { value } = feed([tricky.slice(0, cut), tricky.slice(cut)]);
    assert.ok(target.startsWith(value), '第 ' + cut + ' 位截断后有脏字符：' + value);
  }
  assert.equal(feed([tricky]).value, target);
});

test('带 markdown 围栏、题面排在后面时也能找到', () => {
  const fenced = '\u0060\u0060\u0060json\n' + payload + '\n\u0060\u0060\u0060';
  assert.equal(feed([fenced]).value, expected);
  const reordered = JSON.stringify({ solution: '先写解答', question: '后写题面', comparisonCriterion: 'x', routes: [] });
  assert.equal(feed([reordered]).value, '后写题面');
});

test('没有 question 字段时返回空字符串，不会抛出', () => {
  const { value, complete } = feed(['{"solution":"只有解答","routes":[]}']);
  assert.equal(value, '');
  assert.equal(complete, false);
});
