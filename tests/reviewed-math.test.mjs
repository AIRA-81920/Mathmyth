import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { reviewedMathMarkdown } from '../src/core/practice/reviewedMath.js';

test('review notation renders negative powers, nested radicals, derivative primes and integral bounds through KaTeX', () => {
  for (const source of ['积分 ∫y⁻²dy=-1/y。', '通解 y=C₁e^((-1+√3)x)。', '得到 ∫₁^√2r⁴dr。', '二阶 y″+2y′=0。', '候选 ①F′(x)=x。']) {
    const display = reviewedMathMarkdown(source); assert.ok(display.includes('$'));
    for (const match of display.matchAll(/\$([^$]+)\$/g)) assert.doesNotThrow(() => katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' }));
  }
});
test('existing delimited math is preserved and ordinary explanatory text is not made into a formula', () => {
  assert.equal(reviewedMathMarkdown('保留二阶项 $x^2/2$。'), '保留二阶项 $x^2/2$。');
  assert.equal(reviewedMathMarkdown('先检查条件，再判断这条路线能否走通。'), '先检查条件，再判断这条路线能否走通。');
});
