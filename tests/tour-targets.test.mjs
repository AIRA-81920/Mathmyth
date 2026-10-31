import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('新手引导的每一步都指向真实存在的控件，不会指到不存在的选择器', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const targets = [...tour.matchAll(/target: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(targets.length, 7, '引导应当是 7 步');

  const app = await read('../src/app/App.jsx');
  const ask = await read('../src/pages/Ask.jsx');
  const settings = await read('../src/pages/Settings.jsx');
  const practice = await read('../src/pages/Practice.jsx');
  const sources = { app, ask, settings, practice, tour };

  const find = (token) => Object.values(sources).some((text) => text.includes(token));
  const expectations = [
    ['[aria-label="主要区域"]', 'aria-label="主要区域"'],
    ['.composer textarea', 'className="composer"'],
    ['button[aria-label="添加附件"]', 'aria-label="添加附件"'],
    ['.practice-entry', 'className="practice-entry"'],
    ['.tour-demo', 'className="tour-demo"'],
    ['[aria-label="历史与设置"]', 'aria-label="历史与设置"'],
    ['[data-tour="backup"]', 'data-tour="backup"'],
  ];
  for (const [selector, token] of expectations) {
    assert.ok(targets.includes(selector), '引导里少了这一步：' + selector);
    assert.ok(find(token), selector + ' 依赖的标记在源码里找不到：' + token);
  }
  // 三步之外的换页动作必须走应用自己的动作，不许模拟点击。
  assert.ok(tour.includes("useAppStore.getState().openSettings()"), '备份那一步要自己打开设置');
  assert.ok(tour.includes("useAppStore.getState().closeSettings()"), '退出时要能把设置收起来');
  assert.equal(tour.includes('.click()'), false, '引导不允许模拟点击真实控件');
  // 练习 / 足迹 两步必须真的切页，而不是只高亮那个切换按钮
  assert.match(tour, /setActiveArea\('practice'\)/);
  assert.match(tour, /setActiveArea\('trail'\)/);
  // 足迹那一步给的是"示例"，不是用户数据
  assert.match(tour, /示例 · 不是你的数据/);
  assert.match(tour, /DEMO_NOTE/);
});

test('引导只跑一次：跑完/跳过写标记，设置里能重看', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const app = await read('../src/app/App.jsx');
  const settings = await read('../src/pages/Settings.jsx');
  assert.match(tour, /localStorage\.setItem\(KEY, 'done'\)/);
  assert.match(app, /if \(route !== 'main' \|\| !onboarded \|\| !storageInitialized \|\| tourDone\(\)\) return/);
  assert.match(app, /window\.addEventListener\('mathmyth:tour', replay\)/);
  assert.match(settings, /resetTour\(\); closeSettings\(\); window\.dispatchEvent\(new Event\('mathmyth:tour'\)\)/);
  assert.match(settings, /重新观看使用引导/);
});
