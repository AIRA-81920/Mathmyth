import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create } from 'zustand';
import { useAppStore, attachAppPersistence } from '../src/store/appStore.js';
import { useChatPracticeStore } from '../src/store/chatPracticeStore.js';
import { registerPracticeDraftFlush } from '../src/core/learning/draftFlush.js';

let learner = 0;
async function boot(t, options = {}) {
  const bootstrap = { learnerId: `release-${++learner}`, onboarded: true, conversations: [] };
  const saves = [];
  const db = { fail: false, saves,
    initializeDatabase: async () => bootstrap,
    saveChanges: async changes => { if (db.fail) throw new Error('fixture'); saves.push(changes); },
    clearDatabase: async () => { if (db.fail) throw new Error('fixture'); return bootstrap; },
    commitImport: async () => { if (db.fail) throw new Error('fixture'); return bootstrap; },
  };
  const p = attachAppPersistence(db, { flushDelay: 60000, eventTarget: null, visibilityTarget: null, ...options });
  t.after(() => { p.dispose(); registerPracticeDraftFlush(() => useChatPracticeStore.getState().flushDrafts()); });
  await useAppStore.getState().initializeStorage();
  await p.flush();
  return { db, p, store: useAppStore, state: () => useAppStore.getState() };
}
for (const kind of ['clear', 'import']) for (const fail of [true, false]) {
  test(`${kind} ${fail ? 'failure preserves' : 'success clears'} both question and chat-practice drafts`, async t => {
    const { db, state, store } = await boot(t);
    const id = state().currentConversationId;
    store.setState({ chatDrafts: { [id]: 'question draft' } });
    useChatPracticeStore.setState({ drafts: { item: 'practice draft' } });
    db.fail = fail;
    const task = kind === 'clear' ? state().clearAllData() : state().confirmImport('token');
    if (fail) {
      await assert.rejects(task);
      assert.equal(state().chatDrafts[id], 'question draft');
      assert.equal(useChatPracticeStore.getState().drafts.item, 'practice draft');
      assert.equal(state().storageStatus, 'error'); assert.ok(state().storageError);
    } else {
      await task;
      assert.deepEqual(state().chatDrafts, {}); assert.deepEqual(useChatPracticeStore.getState().drafts, {});
    }
  });
}
test('changing learner still clears both draft stores immediately', async t => {
  const { store } = await boot(t);
  store.setState({ chatDrafts: { c: 'question' } }); useChatPracticeStore.setState({ drafts: { i: 'steps' } });
  store.setState({ learnerId: 'different-user' });
  assert.deepEqual(store.getState().chatDrafts, {}); assert.deepEqual(useChatPracticeStore.getState().drafts, {});
});
test('failed draft flush rejects desktop close and exposes an actionable error', async t => {
  const { state } = await boot(t);
  registerPracticeDraftFlush(async () => false);
  await assert.rejects(state().prepareForExit(), /草稿.*保存/);
  assert.equal(state().storageStatus, 'error'); assert.match(state().storageError, /草稿.*保存/);
});
test('successful draft flush permits normal desktop close', async t => {
  const { state } = await boot(t);
  registerPracticeDraftFlush(async () => true);
  await assert.doesNotReject(state().prepareForExit());
});
test('throwing draft flush rejects desktop close and exposes a safe error', async t => {
  const { state } = await boot(t);
  registerPracticeDraftFlush(async () => { throw new Error('raw fixture'); });
  await assert.rejects(state().prepareForExit());
  assert.ok(state().storageError); assert.doesNotMatch(state().storageError, /raw fixture/);
});
for (const fail of [true, false]) test(`method discussion ${fail ? 'failed save remains retryable' : 'successful save is retained'}`, async t => {
  const { state, store, db } = await boot(t);
  const now = new Date().toISOString();
  store.setState({ conversations: [{ id: 'method', title: 'method', methodId: 'M.test', ephemeral: true, loaded: true,
    createdAt: now, updatedAt: now, messages: [{ id: 'u', role: 'user', content: 'why', createdAt: now }] }] });
  db.fail = fail;
  assert.equal(await state().saveMethodConversation('method'), !fail);
  assert.equal(state().conversations[0].ephemeral, fail);
  if (fail) assert.ok(state().storageError);
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('30 continuous trail scroll changes write nothing until leaving the trail', async t => {
  const { state, db } = await boot(t, { flushDelay: 5 });
  state().setActiveArea('trail'); await pause(20);
  db.saves.length = 0;
  for (let index = 1; index <= 30; index++) { state().setTrailScroll(index * 10, state().trailEpoch); await pause(10); }
  await pause(650);
  // 浏览足迹期间不再整库保存；位置只在离开这一页时落盘一次。
  assert.equal(db.saves.length, 0);
  state().setActiveArea('ask');
  await pause(40);
  assert.equal(db.saves.length, 1);
  assert.equal(db.saves[0].preferences.trailScroll, 300);
});
test('leaving the trail immediately flushes its final scroll position once', async t => {
  const { state, db } = await boot(t, { flushDelay: 5 });
  state().setActiveArea('trail'); await pause(20); db.saves.length = 0;
  state().setTrailScroll(231, state().trailEpoch); state().setActiveArea('ask');
  await pause(40);
  assert.equal(db.saves.length, 1); assert.equal(db.saves[0].preferences.trailScroll, 231);
  await pause(600); assert.equal(db.saves.length, 1);
});
test('explicit close flush preserves the latest trail position before the idle timer', async t => {
  const { state, db } = await boot(t);
  state().setTrailScroll(422, state().trailEpoch);
  await state().flushStorage();
  assert.equal(db.saves.at(-1).preferences.trailScroll, 422);
});
test('disposing the persistence listener flushes a pending final scroll position', async t => {
  const { state, db, p } = await boot(t, { flushDelay: 5 });
  db.saves.length = 0; state().setTrailScroll(512, state().trailEpoch);
  p.dispose(); await pause(40);
  assert.equal(db.saves.length, 1); assert.equal(db.saves[0].preferences.trailScroll, 512);
});
test('pagehide flushes pending scroll immediately without waiting for idle', async t => {
  const events = new EventTarget();
  const { state, db } = await boot(t, { eventTarget: events, flushDelay: 5 });
  db.saves.length = 0; state().setTrailScroll(616, state().trailEpoch);
  events.dispatchEvent(new Event('pagehide')); await pause(40);
  assert.equal(db.saves.length, 1); assert.equal(db.saves[0].preferences.trailScroll, 616);
});
test('a new question discards delayed scroll from the previous trail epoch', async t => {
  const { state } = await boot(t);
  const old = state().trailEpoch;
  state().setTrailScroll(777, old); state().newConversation(); state().setTrailScroll(999, old);
  await pause(600); await state().flushStorage();
  assert.equal(state().preferences.trailScroll, 0);
});

async function practiceHarness() {
  const app = create(() => ({ learnerId: 'practice-user', storageInitialized: true, dataOperation: null, modelConfig: {} }));
  const database = { gradePracticeItem: async session => ({ ...session, items: session.items.map(item => ({ ...item, answer: { mode: 'selection', selectedIds: ['r1'], outcome: 'right' } })) }) };
  const registry = globalThis.__releasePractice ??= new Map();
  const key = crypto.randomUUID(); registry.set(key, { app, database });
  const url = new URL('../src/store/practiceStore.js', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = source.replace("import { useAppStore } from './appStore.js';", `const useAppStore = globalThis.__releasePractice.get('${key}').app;`)
    .replace("import * as database from '../core/db/database.js';", `const database = globalThis.__releasePractice.get('${key}').database;`)
    .replace("import { loadSkeleton } from '../core/skeleton/load.js';", 'const loadSkeleton = async () => ({});')
    .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
    .replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
  const { usePracticeStore: practice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  registry.delete(key);
  const session = { id: 'run', finishedAt: null, items: [{ id: 'item', answer: null, question: { format: 'route-v1', selectionMode: 'single' } }] };
  practice.setState({ session, screen: 'run', itemIndex: 0 });
  return { practice, app, session };
}
test('returning to an independent practice restores unsubmitted steps and mode', async () => {
  const { practice: p } = await practiceHarness();
  p.getState().setMode('steps'); p.getState().setSteps('unfinished derivation'); p.getState().showEntry(); p.getState().resume();
  assert.equal(p.getState().steps, 'unfinished derivation'); assert.equal(p.getState().mode, 'steps');
});
test('returning to an independent practice restores unsubmitted route choices', async () => {
  const { practice: p } = await practiceHarness();
  p.getState().toggleMethod('r2'); p.getState().showEntry(); p.getState().resume();
  assert.deepEqual(p.getState().selectedIds, ['r2']);
});
test('grading an independent practice invalidates its unsent input cache', async () => {
  const { practice: p } = await practiceHarness();
  p.getState().setSteps('old unsent input'); p.getState().toggleMethod('r1'); await p.getState().submit();
  p.getState().showEntry(); p.getState().resume();
  assert.equal(p.getState().steps, ''); assert.deepEqual(p.getState().selectedIds, ['r1']);
});
test('a new practice run cannot restore cached input even for a reused item id', async () => {
  const { practice: p, session } = await practiceHarness();
  p.getState().setMode('steps'); p.getState().setSteps('old run input'); p.getState().showEntry();
  p.setState({ session: { ...session, id: 'new-run' } }); p.getState().resume();
  assert.equal(p.getState().steps, ''); assert.equal(p.getState().mode, 'selection');
});
test('a learner change removes independent-practice cached input', async () => {
  const { practice: p, app, session } = await practiceHarness();
  p.getState().setSteps('old user'); app.setState({ learnerId: 'new-user' });
  p.setState({ session }); p.getState().resume(); assert.equal(p.getState().steps, '');
});

test('chat practice checking participates in foreground busy signals', async () => {
  const { createForegroundSignals } = await import('../src/core/queue/foreground.js');
  const practice = create(() => ({ generating: false, modelBusy: false }));
  const chat = create(() => ({ checking: {}, drafts: {} }));
  const signals = createForegroundSignals(practice, chat);
  let calls = 0; const stop = signals.subscribeForeground(() => { calls++; });
  assert.equal(signals.isForegroundBusy(), false);
  chat.setState({ checking: { item: true } }); assert.equal(signals.isForegroundBusy(), true); assert.equal(calls, 1);
  chat.setState({ drafts: { item: 'typing' } }); assert.equal(calls, 1);
  chat.setState({ checking: { item: false } }); assert.equal(signals.isForegroundBusy(), false); assert.equal(calls, 2);
  practice.setState({ generating: true }); assert.equal(signals.isForegroundBusy(), true); assert.equal(calls, 3);
  stop(); chat.setState({ checking: { item: true } }); assert.equal(calls, 3);
});
