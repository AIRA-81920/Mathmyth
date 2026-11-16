import test from 'node:test';
import assert from 'node:assert/strict';

const { useAppStore } = await import('../src/store/appStore.js');
const s = () => useAppStore.getState();
// 真实运行到引导第 6 步时，route 已经是 main（首启配置早就过了）。
const reset = () => useAppStore.setState({ route: 'main', activeArea: 'ask', drawerOpen: false,
  scenarioRef: null, methodId: null, knowledgeBack: [], dataOperation: null });

// 实机反馈：引导第 6 步长按打开过某个情景后，第 7 步（由引导代劳切到练习）不会跳转；
// 没长按过就正常。根因是 route 停在 'scenario' 时分页容器根本不渲染，改 activeArea 看不见。
test('长按打开情景后要求切分页，必须先退回主界面再切', () => {
  reset();
  s().openScenario({ id: 'S.limit.0over0', kind: 'scenario' });
  assert.equal(s().route, 'scenario');
  s().setActiveArea('practice');
  assert.equal(s().route, 'main', '情景页必须收掉，否则练习页根本不会渲染');
  assert.equal(s().activeArea, 'practice');
  assert.deepEqual(s().knowledgeBack, []);
});

test('情景 → 方法 → 情景 叠了几层也一次退回主界面', () => {
  reset();
  s().openScenario({ id: 'S.limit.0over0', kind: 'scenario' });
  s().openMethod('M.lhopital');
  assert.equal(s().route, 'method');
  s().openScenario({ id: 'S.deriv.basic_definition', kind: 'scenario' });
  assert.equal(s().route, 'scenario');
  s().setActiveArea('trail');
  assert.equal(s().route, 'main');
  assert.equal(s().activeArea, 'trail');
  assert.deepEqual(s().knowledgeBack, []);
});

test('已经在主界面时切分页不碰别的状态', () => {
  reset();
  s().openScenario({ id: 'S.limit.0over0', kind: 'scenario' });
  s().closeScenario();
  assert.equal(s().route, 'main');
  s().setActiveArea('practice');
  assert.equal(s().route, 'main');
  assert.equal(s().activeArea, 'practice');
  assert.equal(s().drawerOpen, false);
  assert.equal(s().scenarioRef, null);
});
