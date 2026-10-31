import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createCore, createDb, question, sleep } from './practice-store-harness.mjs';

// run=false：只备好选题，不先开一轮本地题（AI 出题用例要从空白状态开始）。
async function session({ run = true, core: overrides } = {}) {
  const db = createDb(), core = createCore(overrides);
  const { app, practice } = await createApp({ db, core });
  await practice.getState().initialize();
  if (run) await practice.getState().start();
  return { db, core, app, practice };
}

test('下一道：未提交时先要求确认，确认后才把这道题标成已跳过', async () => {
  const { db, practice } = await session();
  practice.getState().setMode('steps');
  practice.getState().setSteps('还没提交的关键步骤');
  await practice.getState().next();
  const asked = practice.getState();
  assert.equal(asked.itemIndex, 0, '未提交的「下一道」不能直接推进');
  assert.equal(asked.pendingNext, true, '应当弹确认');
  assert.equal(db.runs[0].items[0].answer?.advanced, undefined, '这道题不能被标成已跳过');
  await practice.getState().confirmNext();
  const after = practice.getState();
  assert.equal(after.itemIndex, 1);
  assert.equal(after.pendingNext, false);
  assert.equal(db.runs[0].items[0].answer?.advanced, true, '确认后这道题记为已跳过');
});

test('开练：还有没练完的一轮时先要求确认，确认前不结束旧轮也不建新轮', async () => {
  const { db, practice } = await session();
  practice.getState().toggleMethod('M.b');
  const oldRunId = practice.getState().session.id;
  practice.getState().showEntry();
  await practice.getState().start();
  assert.equal(db.runs.length, 1, '确认前不能创建新的练习轮');
  assert.equal(db.runs[0].finishedAt, null, '旧轮不能被静默结束');
  assert.deepEqual(practice.getState().pendingStart, { ai: false });
  assert.notEqual(practice.getState().error, '', '入口页要给出可见提示');
  await practice.getState().confirmStart();
  assert.equal(db.runs.length, 2);
  assert.notEqual(db.runs[0].finishedAt, null, '确认后旧轮才结束');
  assert.notEqual(practice.getState().session.id, oldRunId);
  assert.deepEqual(practice.getState().selectedIds, [], '新轮不继承旧轮的未提交输入');
});

test('取消：同时推进 generationEpoch，迟到的 onItem 不再被接受', async () => {
  const { core, practice } = await session({ run: false });
  core.generateImpl = async ({ onItem }) => {
    await onItem(question('late-1'));
    await sleep(30);
    await onItem(question('late-2'));
  };
  const running = practice.getState().start({ ai: true });
  await sleep(10);
  assert.equal(practice.getState().session.items.length, 1);
  practice.getState().cancel();
  await running;
  await sleep(10);
  const after = practice.getState();
  assert.equal(after.session.items.length, 1, '取消后迟到的题目不能被写入');
  assert.equal(after.screen, 'run', '取消后不能再改 screen');
  assert.equal(after.error, '已停止出题，已生成的题目仍可练。', '取消提示不能被迟到回调覆盖');
});

test('取消：已生成的题目保留，本轮标为 failed', async () => {
  const { core, practice } = await session({ run: false });
  core.generateImpl = async ({ onItem, signal }) => {
    await onItem(question('abort-1'));
    await sleep(40);
    if (signal.aborted) throw Object.assign(new Error(), { name: 'AbortError' });
  };
  const running = practice.getState().start({ ai: true });
  await sleep(10);
  practice.getState().cancel();
  await running;
  const after = practice.getState();
  assert.equal(after.session.items.length, 1);
  assert.equal(after.session.generationStatus, 'failed');
  assert.equal(after.error, '已停止出题，已生成的题目仍可练。');
});

test('出题：用户已退回入口时，迟到结果不把用户弹回做题页', async () => {
  const { core, practice } = await session({ run: false });
  core.generateImpl = async ({ onItem }) => { await sleep(20); await onItem(question('slow-1')); };
  const running = practice.getState().start({ ai: true });
  practice.getState().showEntry();
  assert.equal(practice.getState().screen, 'entry');
  await running;
  await sleep(10);
  assert.equal(practice.getState().screen, 'entry', '用户停在入口页');
  assert.equal(practice.getState().session.items.length, 1, '题目照样准备好');
});

test('再试一次：清空输入与隐藏反馈在返回入口后仍被保留', async () => {
  const { practice } = await session();
  practice.getState().toggleMethod('M.a');
  await practice.getState().submit();
  assert.equal(practice.getState().feedbackHidden, false);
  practice.getState().retryItem();
  practice.getState().showEntry();
  practice.getState().resume();
  assert.deepEqual(practice.getState().selectedIds, [], '「再试一次」的清空不能被 resume 撤销');
  assert.equal(practice.getState().feedbackHidden, true, '「再试一次」的隐藏不能被 resume 撤销');
});

test('关闭应用：prepareForExit 先取消练习判定再 flush 草稿', async () => {
  const { useChatPracticeStore } = await import('../src/store/chatPracticeStore.js');
  const { useAppStore } = await import('../src/store/appStore.js');
  const item = { id: 'item', runId: 'run', generation: 0, finishedAt: null, question: { question: 'Q' }, answer: null };
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(request) {
      const reply = (result) => this.onmessage({ data: { id: request.id, ok: true, result, generation: 0 } });
      // 判定响应故意晚到：用来观察关闭流程有没有先把它取消掉。
      if (request.method === 'gradePracticeItem') { setTimeout(() => reply(structuredClone(item)), 60); return; }
      const result = request.method === 'loadPracticeItem' ? structuredClone(item) : request.method === 'savePracticeDraft' ? { saved: true } : {};
      queueMicrotask(() => reply(result));
    }
  };
  useAppStore.setState({ storageInitialized: true, dataOperation: null });
  try {
    await useChatPracticeStore.getState().load('item');
    const running = useChatPracticeStore.getState().submit('item', { mode: 'selection', selectedIds: ['M.a'] });
    await sleep(5);
    assert.equal(useChatPracticeStore.getState().checking.item, true, '判定应当在进行中');
    await useAppStore.getState().prepareForExit();
    assert.equal(useChatPracticeStore.getState().checking.item, false, '关闭前要先取消练习判定');
    assert.equal(useChatPracticeStore.getState().busy.item, false);
    await running;
  } finally {
    globalThis.Worker = previousWorker;
    useAppStore.setState({ learnerId: 'learner-exit-clean', dataOperation: null });
    useChatPracticeStore.setState({ items: {}, busy: {}, checking: {}, drafts: {}, errors: {} });
  }
});

test('数据操作期间输入的草稿不被静默丢弃', async () => {
  const { useChatPracticeStore } = await import('../src/store/chatPracticeStore.js');
  const { useAppStore } = await import('../src/store/appStore.js');
  useChatPracticeStore.setState({ items: { item: { id: 'item', runId: 'run', generation: 0, finishedAt: null, question: {}, answer: null } },
    drafts: {}, busy: {}, checking: {}, errors: {} });
  useAppStore.setState({ dataOperation: 'exporting' });
  try {
    useChatPracticeStore.getState().setDraft('item', '这段时间打的字');
    assert.equal(useChatPracticeStore.getState().drafts.item, '这段时间打的字', '操作期间的输入要留在内存里');
    useAppStore.getState().setChatDraft('conv-1', '这段时间打的字');
    assert.equal(useAppStore.getState().chatDrafts['conv-1'], '这段时间打的字', '会话草稿也不能被吞');
  } finally {
    useAppStore.setState({ dataOperation: null, chatDrafts: {} });
    useChatPracticeStore.setState({ items: {}, drafts: {} });
  }
});
