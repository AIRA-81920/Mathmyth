import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8');

function blockZIndex(selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, selector + ' 的规则不见了');
  const body = css.slice(start, css.indexOf('}', start));
  const match = /z-index:\s*(-?\d+)/.exec(body);
  assert.ok(match, selector + ' 没有 z-index');
  return Number(match[1]);
}

test('对话框必须排在设置页外壳之上，否则从设置页弹出的面板会被整页盖住', () => {
  // 设置页是一层铺满屏幕的不透明外壳。对话框若排在它下面，DOM 里存在、
  // 屏幕上什么都没有——"长按浅色没反应"的真正原因，三层回归都是栽在这里。
  assert.ok(
    blockZIndex('.dialog-layer') > blockZIndex('.settings-layer'),
    '对话框 z-index 必须大于 .settings-layer(' + blockZIndex('.settings-layer') + ')',
  );
});

test('主题指示线用 width 定长，不许用 scaleX', () => {
  // 1px 宽的元素加 scaleX(26) 时布局算 78 设备像素、屏幕画 104（合成层按 4/3 拉伸），
  // 右边整整多出一截。这是"横线偏几像素"的真身。
  // 注释里会解释这件事，比对前先去掉行注释，只检查真正的代码。
  const code = settings.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/scaleX\(/.test(code), '指示线不能再靠 scaleX 定长');
  assert.ok(/indicator\.style\.width/.test(settings), '指示线应当直接写 width');
  assert.ok(/measureInk/.test(settings), '指示线长度应当按字形墨迹量');
});
