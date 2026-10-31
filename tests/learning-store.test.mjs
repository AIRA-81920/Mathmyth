import test from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../src/store/appStore.js';
import { useChatPracticeStore } from '../src/store/chatPracticeStore.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 5));

test('practice drafts flush before desktop close and survive unrelated deletion and conversation switches', async () => {
  const previousWorker = globalThis.Worker, calls = [];
  const item = { id: 'item', runId: 'run', generation: 0, finishedAt: null, question: { question: 'QA' }, answer: null };
  globalThis.Worker = class {
    postMessage(request) {
      calls.push(structuredClone(request));
      let result;
      if (request.method === 'loadPracticeItem') result = structuredClone(item);
      else if (request.method === 'savePracticeDraft') { item.answer = { ...item.answer, draft: request.args[2] }; result = { saved: true }; }
      else result = {};
      queueMicrotask(() => this.onmessage({ data: { id: request.id, ok: true, result, generation: 0 } }));
    }
  };
  try {
    useAppStore.setState({ storageInitialized: true, learnerId: 'qa-drafts', dataOperation: null });
    await useChatPracticeStore.getState().load('item');
    useChatPracticeStore.getState().setDraft('item', '关闭前最后几个字');
    await useAppStore.getState().prepareForExit();
    assert.equal(item.answer.draft, '关闭前最后几个字');
    assert.equal(calls.filter(call => call.method === 'savePracticeDraft').length, 1);
    await useChatPracticeStore.getState().flushDrafts();
    assert.equal(calls.filter(call => call.method === 'savePracticeDraft').length, 1, 'unchanged drafts should not rewrite the whole database');
    useChatPracticeStore.getState().setDraft('item', '删除其他聊天前的草稿');
    useAppStore.setState({ dataOperation: 'deleting' });
    assert.equal(useChatPracticeStore.getState().drafts.item, '删除其他聊天前的草稿');
    useAppStore.setState({ dataOperation: null }); await pause();
    assert.equal(item.answer.draft, '删除其他聊天前的草稿');
    useChatPracticeStore.getState().setDraft('item', '切会话前的草稿');
    useAppStore.setState({ currentConversationId: 'another' }); await pause();
    assert.equal(item.answer.draft, '切会话前的草稿');
    useAppStore.setState({ dataOperation: 'clearing' });
    assert.equal(useChatPracticeStore.getState().drafts.item, '切会话前的草稿');
    assert.ok(useChatPracticeStore.getState().items.item);
    useAppStore.setState({ dataRevision: (useAppStore.getState().dataRevision ?? 0) + 1 });
    assert.deepEqual(useChatPracticeStore.getState().drafts, {});
    assert.deepEqual(useChatPracticeStore.getState().items, {});
  } finally {
    useAppStore.setState({ learnerId: 'qa-drafts-clean', dataOperation: null });
    globalThis.Worker = previousWorker;
  }
});
