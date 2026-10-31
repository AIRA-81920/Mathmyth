import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp, createCore, createDb, sleep } from './practice-store-harness.mjs';
import { useAppStore } from '../src/store/appStore.js';

// lifecycle.js 的 store 依赖在 node 下不可直接 import（skeleton/load.js 用 import.meta.glob），
// 与 tests/release-safety.test.mjs 同一手法：读源码替换 import 后注入假 store。
async function loadLifecycle({ app, practice, chat }) {
  const url = new URL('../src/core/platform/lifecycle.js', import.meta.url);
  let source = await readFile(url, 'utf8');
  const patches = [
    ["import { Capacitor } from '@capacitor/core';", 'const Capacitor = { isNativePlatform: () => false };'],
    ["import { useAppStore } from '../../store/appStore.js';", 'const useAppStore = globalThis.__lifecycleProbe.app;'],
    ["import { usePracticeStore } from '../../store/practiceStore.js';", 'const usePracticeStore = globalThis.__lifecycleProbe.practice;'],
    ["import { useChatPracticeStore } from '../../store/chatPracticeStore.js';", 'const useChatPracticeStore = globalThis.__lifecycleProbe.chat;'],
    ["import { receiveRestoredPhoto } from './photos.js';", 'const receiveRestoredPhoto = () => {};'],
  ];
  for (const [from, to] of patches) {
    if (!source.includes(from)) throw new Error('注入点未命中: ' + from);
    source = source.replace(from, to);
  }
  globalThis.__lifecycleProbe = { app, practice, chat };
  return await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const pageStub = () => {
  const listeners = new Map();
  return { visibilityState: 'visible', listeners,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type) };
};

async function session() {
  const db = createDb(), core = createCore();
  const { app, practice } = await createApp({ db, core });
  await practice.getState().initialize();
  await practice.getState().start();
  return { db, core, app, practice };
}
const saves = (db) => db.calls.filter((call) => call.method === 'savePracticeDraft');
const itemId = (db) => db.runs[0].items[0].id;

test('写关键步骤：第一个字就按 itemId 落 answer.draft（不等防抖）', async () => {
  const { db, practice } = await session();
  practice.getState().setMode('steps');
  practice.getState().setSteps('先通分，再求导');
  await sleep(10);
  assert.equal(saves(db).length, 1, '第一笔输入应立刻落库');
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '先通分，再求导');
});

test('写关键步骤：350ms 内连续输入只落一次，停止后补写最后一次', async () => {
  const { db, practice } = await session();
  practice.getState().setSteps('第一版');
  await sleep(10);
  assert.equal(saves(db).length, 1);
  practice.getState().setSteps('第二版');
  practice.getState().setSteps('第三版');
  assert.equal(saves(db).length, 1, '节流窗口内不应连续写库');
  await sleep(420);
  assert.equal(saves(db).length, 2, '停止输入后补写最后一次');
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '第三版');
});

test('关闭应用重开：未提交的关键步骤从 answer.draft 恢复', async () => {
  const db = createDb(), core = createCore();
  const first = await createApp({ db, core });
  await first.practice.getState().initialize();
  await first.practice.getState().start();
  first.practice.getState().setMode('steps');
  first.practice.getState().setSteps('关闭前没提交的关键步骤');
  await sleep(10);
  const second = await createApp({ db, core: createCore() });
  await second.practice.getState().initialize();
  second.practice.getState().resume();
  assert.equal(second.practice.getState().steps, '关闭前没提交的关键步骤');
  assert.equal(second.practice.getState().mode, 'steps');
});

test('已判分的题不恢复草稿：库里残留的草稿不回填到作答框', async () => {
  const db = createDb(), core = createCore();
  const first = await createApp({ db, core });
  await first.practice.getState().initialize();
  await first.practice.getState().start();
  first.practice.getState().setMode('steps');
  first.practice.getState().setSteps('写了一半又改用选路线');
  await sleep(10);
  first.practice.getState().retryItem();
  first.practice.getState().setMode('selection');
  first.practice.getState().toggleMethod('M.a');
  await first.practice.getState().submit();
  const run = db.runs[0];
  assert.equal(db.draftOf(run.id, run.items[0].id).draft, '写了一半又改用选路线', '库里的草稿只作为草稿存在');
  const second = await createApp({ db, core: createCore() });
  await second.practice.getState().initialize();
  second.practice.getState().resume();
  assert.equal(second.practice.getState().steps, '', '已判分的题不能用草稿回填');
  assert.deepEqual(second.practice.getState().selectedIds, ['M.a'], '判分内容照常来自 answer');
});

test('判分后不再把已提交内容当草稿重写，提交内容本身就是草稿', async () => {
  const { db, practice } = await session();
  practice.getState().setMode('steps');
  practice.getState().setSteps('提交用的关键步骤');
  await sleep(10);
  await practice.getState().submit();
  const afterSubmit = saves(db).length;
  await sleep(420);
  assert.equal(saves(db).length, afterSubmit, '提交时留下的定时器不能把已提交内容再写一遍');
  const answer = db.draftOf(db.runs[0].id, itemId(db));
  assert.equal(answer.steps, '提交用的关键步骤');
  assert.equal(answer.draft, '提交用的关键步骤');
});

test('草稿保存失败：保留内存输入并给出可见提示', async () => {
  const { db, practice } = await session();
  db.state.failDraft = true;
  practice.getState().setSteps('存储写失败时的输入');
  await sleep(10);
  assert.equal(practice.getState().steps, '存储写失败时的输入', '内存里的输入不能被清掉');
  assert.equal(practice.getState().error, '草稿暂未保存，请稍后重试。');
  db.state.failDraft = false;
  practice.getState().setSteps('存储恢复后的输入');
  await sleep(10);
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '存储恢复后的输入');
});

test('返回入口会立刻冲掉未到点的草稿', async () => {
  const { db, practice } = await session();
  practice.getState().setSteps('v1');
  await sleep(10);
  practice.getState().setSteps('v2');
  practice.getState().showEntry();
  await sleep(10);
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, 'v2', '离开做题页时不丢最后几个字');
  assert.equal(saves(db).length, 2);
});
// 关闭/隐藏应用：最后 350ms 内的输入必须靠退出钩子写掉，不能等定时器。
test('关闭应用：prepareForExit 立刻写掉还没到 350ms 的独立练习草稿', async () => {
  const { db, practice } = await session();
  practice.getState().setMode('steps');
  practice.getState().setSteps('退出前写的第一个字');
  await sleep(5);
  practice.getState().setSteps('退出前最后几个字');
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '退出前写的第一个字', '第二笔还在 350ms 窗口内，尚未落库');
  await useAppStore.getState().prepareForExit();
  assert.equal(useAppStore.getState().exitError, '');
  assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '退出前最后几个字', '退出时必须补写最新一笔');
  assert.equal(saves(db).at(-1).text, '退出前最后几个字');
});

test('关闭应用：退出时草稿补写失败，prepareForExit 照样抛错', async () => {
  const { db, practice } = await session();
  practice.getState().setSteps('能写进去的一笔');
  await sleep(5);
  db.state.failDraft = true;
  practice.getState().setSteps('写不下去的一笔');
  await assert.rejects(() => useAppStore.getState().prepareForExit(), /草稿或本地数据尚未保存/);
  assert.notEqual(useAppStore.getState().exitError, '', '失败要留在 exitError 上，不能吞掉');
  db.state.failDraft = false;
});

test('切后台：visibilitychange 隐藏时也会把独立练习草稿写掉', async () => {
  const { db, practice } = await session();
  practice.getState().setMode('steps');
  practice.getState().setSteps('隐藏前的第一个字');
  await sleep(5);
  practice.getState().setSteps('隐藏前的最后几个字');
  const page = pageStub();
  const { startVisibilityLifecycle } = await loadLifecycle({ app: useAppStore, practice,
    chat: { getState: () => ({ flushDrafts: async () => true }) } });
  const stop = startVisibilityLifecycle(page);
  try {
    page.visibilityState = 'hidden';
    page.listeners.get('visibilitychange')();
    await sleep(10);
    assert.equal(db.draftOf(db.runs[0].id, itemId(db)).draft, '隐藏前的最后几个字', '隐藏时要 flush 独立练习草稿');
    assert.equal(saves(db).at(-1).text, '隐藏前的最后几个字');
  } finally { stop(); }
});
