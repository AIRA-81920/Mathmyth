import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('引导每一步都指向真实控件，且只有"动手"节点才等事件', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const app = await read('../src/app/App.jsx');
  const ask = await read('../src/pages/Ask.jsx');
  const settings = await read('../src/pages/Settings.jsx');
  const routePanel = await read('../src/components/QuestionRoutePanel.jsx');
  const footer = await read('../src/components/AnswerLearningFooter.jsx');
  const outline = await read('../src/components/TrailOutline.jsx');
  const drawer = await read('../src/app/HistoryDrawer.jsx');
  const theme = await read('../src/components/ThemeSettings.jsx');
  const sources = [app, ask, settings, routePanel, footer, outline, drawer, theme].join('\n');

  const targets = [...tour.matchAll(/target: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(targets.length >= 10, '引导应当覆盖主链路与设置页');

  // 每个选择器依赖的标记必须真的在源码里，改 aria-label / class 就会让这一步失效。
  const dependencies = [
    ['.composer .send-button', 'className="composer"'],
    ['button[aria-label="添加附件"]', 'aria-label="添加附件"'],
    ['.answer-learning .question-route-toggle', 'question-route-toggle'],
    ['.question-route-locate', 'question-route-locate'],
    ['.trail-outline', 'trail-outline'],
    ['.trail-row.trail-title', 'trail-title'],
    ['#tab-practice', 'id={`tab-${area.id}`}'],
    ['button[aria-label="历史与设置"]', 'aria-label="历史与设置"'],
    ['.drawer-settings', 'drawer-settings'],
    ['[aria-labelledby$="-subject"] .settings-group-title', 'aria-labelledby={`${id}-subject`}'],
    ['.settings-about-summary', 'settings-about-summary'],
    ['.settings-about-details button', 'settings-about-details'],
    ['[data-theme-value="light"]', 'data-theme-value={value}'],
  ];
  for (const [selector, token] of dependencies) {
    assert.ok(targets.includes(selector), '引导里少了这一步：' + selector);
    assert.ok(sources.includes(token), selector + ' 依赖的标记找不到了：' + token);
  }
});

test('动手节点必须有事件判据，不许模拟点击', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  // 每个 action 节点都要有 done；note 节点只旁注，不需要。
  const blocks = tour.split(/\n  \{\n/).slice(1);
  const actions = blocks.filter((block) => block.includes("kind: 'action'"));
  assert.ok(actions.length >= 8, '动手节点不该只剩几个');
  for (const block of actions) {
    assert.match(block, /done: \(/, '动手节点缺少事件判据');
  }
  // 允许的只有"收掉引导自己打开的浮层"，绝不许替用户点这一步的目标。
  const targets = [...tour.matchAll(/target: '([^']+)'/g)].map((match) => match[1]);
  const leaveLines = tour.split('\n').filter((line) => line.includes('leave:'));
  assert.ok(leaveLines.length >= 1, '打开过浮层的那一步必须自己收尾');
  for (const line of leaveLines) {
    for (const target of targets) assert.ok(!line.includes(`'${target}'`), 'leave 不许点这一步的目标：' + target);
  }
  assert.equal(/targetOf\(step\)[^;]*\.click\(/.test(tour), false, '引导不允许替用户点目标控件');
  // 旧的"下一步"按钮必须消失：推进只能靠事件（注释里提到不算）。
  assert.equal(tour.includes('下一步</button>'), false, '引导不该再有"下一步"按钮');
  assert.match(tour, /setInterval\(check/, '要有轮询兜住 DOM 就绪这类事件');
  assert.match(tour, /useAppStore\.subscribe\(check\)/, '要有 store 订阅兜住状态类事件');
});

test('跳过与看完分开记，重看入口仍然可用', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const app = await read('../src/app/App.jsx');
  const settings = await read('../src/pages/Settings.jsx');
  assert.match(tour, /const KEY = 'mathmyth\.tour\.v2'/);
  assert.match(tour, /status === 'done' \|\| value\?\.status === 'skipped'/);
  assert.match(tour, /finish\('skipped'\)/);
  assert.match(tour, /finish\('done'\)/);
  assert.match(app, /if \(route !== 'main' \|\| !onboarded \|\| !storageInitialized \|\| tourDone\(\)\) return/);
  assert.match(app, /window\.addEventListener\('mathmyth:tour', replay\)/);
  // 重看引导也要把题填好、回到问答区，不能让人对着空输入框
  assert.match(app, /const replay = \(\) => \{ resetTour\(\); primeTour\(\); setTourStart\(0\); setTourOpen\(true\) \}/);
  assert.match(settings, /resetTour\(\); closeSettings\(\); window\.dispatchEvent\(new Event\('mathmyth:tour'\)\)/);
  assert.match(settings, /重新观看使用引导/);
});

test('引导被打断后能接上，且过期不冒充没看过', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const app = await read('../src/app/App.jsx');
  const actions = await read('../src/store/tourActions.js');
  const pool = await read('../src/core/onboarding/questionPool.js');
  // 记下"这次引导发的是哪道题"
  assert.match(pool, /localStorage\.setItem\(PENDING_KEY/);
  assert.match(actions, /writePendingGuide\(question\)/);
  // 下次进来：库里已经有这条用户消息，就从"看附件"接着走，不逼人重发
  assert.match(app, /readPendingGuide\(\)/);
  assert.match(app, /message\.content === pending\.question/);
  assert.match(app, /setTourStart\(sent \? 1 : 0\)/);
  assert.match(tour, /startAt = 0/);
  assert.match(tour, /clearPendingGuide\(\)/);
  // 目标长时间不出现要给出路，不能看起来像卡死
  assert.match(tour, /setStalled\(true\), 30000/);
  assert.match(tour, /可以先跳过这一步/);
});

test('引导是真实使用：预置题面、默认开思考、结束时删掉这次的数据', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const onboarding = await read('../src/pages/Onboarding.jsx');
  const ask = await read('../src/pages/Ask.jsx');
  const store = await read('../src/store/appStore.js');
  const pool = await read('../src/core/onboarding/questionPool.js');
  const actions = await read('../src/store/tourActions.js');

  // 题池分学科，且题面是固定的（不靠 AI 现编）
  assert.match(pool, /advanced: \[/);
  assert.match(pool, /high_school: \[/);
  assert.match(pool, /export function pickTourQuestion/);
  assert.ok((pool.match(/question:/g) ?? []).length >= 6, '两个学科各要有几道验证过的题');

  // 首启：主题可选；开场（预置题 + 思考开 + 新会话）只有一处实现
  assert.match(onboarding, /ThemeSettings/);
  assert.match(onboarding, /import \{ primeTour \} from '..\/store\/tourActions.js'/);
  assert.match(onboarding, /primeTour\(\)/);
  assert.match(actions, /pickTourQuestion\(fresh\.preferences\?\.subject\)/);
  assert.match(actions, /fresh\.setAnswerThinking\('enabled'\)/);
  assert.match(actions, /setGuidedComposer\(question, fresh\.currentConversationId\)/);
  assert.match(actions, /newConversation\(\)/, '开场必须开一个新会话：引导结束要整段删掉');
  assert.match(actions, /writePendingGuide\(question\)/);

  // 输入框锁住预置题，发送后解锁
  assert.match(ask, /readOnly=\{lockedComposer\}/);
  assert.match(ask, /setGuidedComposer\(null\)/);
  assert.match(store, /setGuidedComposer: \(text, conversationId\) =>/);

  // 收尾把这次引导写进去的数据删干净（deep：连掌握度一起），并把预置题的草稿清掉
  assert.match(tour, /deleteConversation\(guidedId, true, true\)/);
  assert.match(tour, /setChatDraft\(guidedId, ''\)/);
});

test('回答期间允许准备下一问：附件与思考开关不再被 busy 拦住', async () => {
  const ask = await read('../src/pages/Ask.jsx');
  assert.match(ask, /disabled=\{blocked \|\| Boolean\(writing\)\} aria-label="添加附件"/);
  assert.match(ask, /disabled=\{!thinking\.switchable \|\| blocked\}/);
  // 发送仍然拦住：回答中点不到第二条发送
  assert.match(ask, /\{busy \? <button key="stop"/);
});

test('主题控件只有一份实现，首启与设置共用', async () => {
  const settings = await read('../src/pages/Settings.jsx');
  const onboarding = await read('../src/pages/Onboarding.jsx');
  const theme = await read('../src/components/ThemeSettings.jsx');
  assert.match(settings, /import ThemeSettings from '\.\.\/components\/ThemeSettings\.jsx'/);
  assert.match(onboarding, /import ThemeSettings from '\.\.\/components\/ThemeSettings\.jsx'/);
  assert.match(theme, /export default function ThemeSettings/);
  // 长按「浅色」调色温：引导里教的就是这一套
  assert.match(theme, /data-theme-value=\{value\}/);
  assert.match(theme, /light-temperature-dialog/);
});
test('气泡不许盖住这一步的目标，浮层留下的一律自己收', async () => {
  const tour = await read('../src/components/AppTour.jsx');
  const ask = await read('../src/pages/Ask.jsx');
  // 位置算法必须带"压没压住目标"的判定，而不是简单的上/下二选一。
  assert.match(tour, /function placeCallout\(ring, height, viewport, prefer\)/);
  assert.match(tour, /const covers = \(spot\) =>/);
  assert.match(tour, /placeCallout\(ring, calloutHeight, viewport, step\.place\)/);
  // 点开之后往下长内容的步骤，气泡固定放上方。
  const blocks = tour.split(/\n  \{\n/).slice(1);
  for (const id of ['routes', 'version']) {
    const block = blocks.find((entry) => entry.includes(`id: '${id}'`));
    assert.ok(block, '找不到这一步：' + id);
    assert.match(block, /place: 'above'/, id + ' 的内容是往下长的，气泡得放上方');
  }
  // 附件面板由第 2 步打开，交给它自己的关闭按钮收掉；不点目标按钮。
  const attach = blocks.find((entry) => entry.includes("id: 'attach'"));
  assert.match(attach, /leave: \(\) => dismiss\('#attachment-panel\.is-open \[aria-label="关闭附件面板"\]'\)/);
  assert.match(ask, /aria-label="关闭附件面板"/);
  assert.match(ask, /<AnimatedDisclosure open=\{pickerOpen\} id="attachment-panel"/);
  // 全程只跑一次收尾：推进和跳过都要清。
  assert.match(tour, /STEPS\[indexRef\.current\]\?\.leave\?\.\(\)/, '推进与跳过都要收掉上一步的浮层');
  // 用户能自己关掉的东西没了，要给一句"怎么找回来"，不能干等。
  assert.match(tour, /waiting: '抽屉被关掉了/);
  assert.match(tour, /waiting: '「版本」又收起来了/);
  assert.match(tour, /waiting: '还没发出去/);
});
