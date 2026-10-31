import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('AI 出题边流边显示：占位消息必须建在请求之前，题面走纯文本分支', async () => {
  const actions = await read('../src/store/relatedPracticeActions.js');
  const placeholderAt = actions.indexOf("content: '正在准备相关练习…'");
  const generateAt = actions.indexOf('generateRelatedPractice(');
  assert.ok(placeholderAt > 0 && generateAt > 0, '两处都要在');
  assert.ok(placeholderAt < generateAt, '占位消息必须先建，否则拿不到流里的题面');
  assert.match(actions, /onQuestionPartial: \(text\) =>/);
  assert.match(actions, /partial: true/);

  const ask = await read('../src/pages/Ask.jsx');
  assert.match(ask, /message\.partial/, '流式题面要走单独分支');
  const branch = ask.slice(ask.indexOf('message.partial'), ask.indexOf('message.partial') + 400);
  assert.ok(branch.includes('message-partial'), '半截 LaTeX 用纯文本渲染');
  assert.equal(/message\.partial[\s\S]{0,80}<MathMarkdown/.test(branch), false, '半截 $…$ 不能交给 KaTeX');
});

test('只有一条路线时不出现"选路线"（AI 草稿就是这样）', async () => {
  const card = await read('../src/components/ChatPracticeCard.jsx');
  assert.match(card, /const routeBased = \(q\.routes\?\.length \?\? 0\) > 1/);
  assert.match(card, /const routesVisible = routeBased &&/);
});

test('草稿的路线数量放宽只作用于未核对草稿，人工库题仍是 3 条起', async () => {
  const routes = await read('../src/core/practice/routes.js');
  assert.match(routes, /question\.metadata\?\.reviewStatus === 'model_unverified' \? 1 : 3/);
  assert.match(routes, /\(!draft && !question\.routes\.some\(\(route\) => !route\.valid\)\)/);
  const db = await read('../src/core/mastery/practiceDb.js');
  assert.match(db, /const minRoutes = question\.metadata\?\.reviewStatus === 'model_unverified' \? 1 : 3;/);
});
