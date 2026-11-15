import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const num = (value) => Number(String(value).replace('px', ''));

// 「回到题目」是一颗绝对定位的竖排按钮，压在足迹列表左边那条缩进带上。
// 它的盒子一旦比 .trail-outline 的左内边距宽，就会盖住每一行行首的三角。
// 4.3.2 实机就是这样糊在一起的：question-routes.css 里多了一条 padding: 10px 22px。
test('回到题目的盒子必须待在足迹列表的左内边距里，不许压住行首三角', async () => {
  const app = await read('../src/styles/app.css');
  const routes = await read('../src/styles/question-routes.css');

  // 只允许一份定义：第二个选择器就是下一次「糊在一起」的种子
  const definitions = [...app.matchAll(/\.trail-return\s*\{([^}]*)\}/g), ...routes.matchAll(/\.trail-return\s*\{([^}]*)\}/g)];
  assert.equal(definitions.length, 1, '.trail-return 只能有一处定义');

  const rule = definitions[0][1];
  const padding = /\.trail-return[^}]*padding:\s*([\d.]+)px\s+([\d.]+)px/.exec(app + routes);
  assert.ok(padding, '要写明左右内边距，才能算出盒子宽度');
  const minWidth = /min-width:\s*([\d.]+)px/.exec(rule);
  assert.ok(minWidth, '要有 min-width，否则窄屏下宽度会随字数变');
  const fontSize = /font-size:\s*([\d.]+)px/.exec(rule);

  const outline = /\.trail-outline\s*\{[^}]*padding:\s*[\d.]+px\s+[\d.]+px\s+[\d.]+px\s+([\d.]+)px/.exec(app);
  assert.ok(outline, '.trail-outline 要写四值 padding，左内边距才是可算的');

  const gutter = num(outline[1]);
  const boxWidth = Math.max(num(minWidth[1]), num(padding[2]) * 2 + num(fontSize[1]));
  assert.ok(boxWidth <= gutter, '盒子 ' + boxWidth + 'px 比左内边距 ' + gutter + 'px 宽，会压住行首三角');

  assert.match(app, /\.trail-row \{[^}]*padding: 8px 4px/);
  assert.match(app, /\.trail-arrow-space \{[^}]*width: 15px/);
});