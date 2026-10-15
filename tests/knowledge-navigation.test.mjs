import test from 'node:test';
import assert from 'node:assert/strict';

test('scenario exploration returns to its method and supports another method without losing the global outline', async () => {
  const { useAppStore: app } = await import(`../src/store/appStore.js?navigation=${Date.now()}`);
  app.getState().newConversation();
  app.getState().toggleTrailNode('scenario:S.limit.0over0');
  app.getState().openMethod('M.taylor_expansion');
  app.getState().openScenario({ kind: 'scenario', id: 'S.limit.0over0' });
  assert.equal(app.getState().route, 'scenario');
  assert.equal(app.getState().methodId, 'M.taylor_expansion');
  assert.equal(app.getState().knowledgeBack.at(-1).route, 'method');
  app.getState().openMethod('M.lhopital');
  app.getState().closeMethod();
  assert.equal(app.getState().route, 'scenario');
  assert.equal(app.getState().scenarioRef.id, 'S.limit.0over0');
  app.getState().closeScenario();
  assert.equal(app.getState().route, 'method');
  assert.equal(app.getState().methodId, 'M.taylor_expansion');
  assert.deepEqual(app.getState().preferences.trailExpanded, { 'scenario:S.limit.0over0': true });
  app.getState().closeMethod();
  assert.equal(app.getState().route, 'main');
  assert.equal(app.getState().activeArea, 'trail');
});

test('a new main conversation discards an exploration stack, and invalid detail requests leave navigation untouched', async () => {
  const { useAppStore: app } = await import(`../src/store/appStore.js?navigation-reset=${Date.now()}`);
  app.getState().newConversation();
  app.getState().setActiveArea('trail');
  app.getState().openScenario({ kind: 'group', id: 'G.limit.indeterminate' });
  app.getState().openScenario({ kind: 'scenario', id: 'S.limit.0over0' });
  const stack = app.getState().knowledgeBack;
  app.getState().openScenario({ kind: 'unsupported', id: 'none' });
  assert.equal(app.getState().knowledgeBack, stack);
  app.getState().newConversation();
  assert.equal(app.getState().route, 'main');
  assert.equal(app.getState().scenarioRef, null);
  assert.deepEqual(app.getState().knowledgeBack, []);
});
