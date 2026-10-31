import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const storeUrl = new URL('../src/store/appStore.js', import.meta.url);
const clone = (value) => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function mockDatabase(seed = {}) {
  const disk = { modelConfig: null, onboarded: false, learnerId: 'learner-test', conversations: new Map(), ...seed };
  const calls = [];
  const staged = new Map();
  const api = {
    disk, calls, failSave: false, failClear: false, failImport: false, failInitialize: false, loadGate: null, saveGate: null,
    bootstrap() {
      return {
        modelConfig: clone(disk.modelConfig), onboarded: disk.onboarded, learnerId: disk.learnerId,
        conversations: [...disk.conversations.values()].map((conversation) => ({
          id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
          messageCount: conversation.messages.length, firstImageId: conversation.messages.find((message) => message.image)?.image.id ?? null,
          messages: [], loaded: false,
        })),
      };
    },
    async initializeDatabase() {
      calls.push('initialize');
      if (api.failInitialize) throw new Error('raw key secret');
      return api.bootstrap();
    },
    async saveChanges(changes) {
      calls.push({ save: changes });
      if (api.saveGate) await api.saveGate.promise;
      if (api.failSave) throw new Error('raw key secret');
      if ('modelConfig' in changes) disk.modelConfig = clone(changes.modelConfig);
      if ('onboarded' in changes) disk.onboarded = changes.onboarded;
      for (const conversation of changes.conversations ?? []) {
        // D9：增量保存只带脏消息（每条用 seq 标明它在会话里的下标）。这个测试替身
        // 按位置合并，模拟引擎的增量写入语义；兼容路径仍然整条替换。
        const stored = disk.conversations.get(conversation.id);
        if (conversation.incremental && stored) {
          const messages = [...(stored.messages ?? [])];
          for (const message of conversation.messages ?? []) {
            const at = Number.isInteger(message.seq) ? message.seq : messages.length;
            messages[at] = clone(message);
          }
          disk.conversations.set(conversation.id, clone({ ...stored, ...conversation, messages }));
        } else disk.conversations.set(conversation.id, clone(conversation));
      }
    },
    async loadConversation(id) {
      calls.push({ load: id });
      const result = clone(disk.conversations.get(id));
      if (api.loadGate) await api.loadGate.promise;
      return result;
    },
    async exportDatabase() {
      calls.push('export');
      return new TextEncoder().encode(JSON.stringify({ modelConfig: disk.modelConfig, onboarded: disk.onboarded, conversations: [...disk.conversations.values()] }));
    },
    async prepareImport(bytes) {
      calls.push('prepare');
      const token = randomUUID();
      staged.set(token, JSON.parse(new TextDecoder().decode(bytes)));
      return { token, summary: { conversationCount: 1, messageCount: 2, imageCount: 0, hasModelSettings: true } };
    },
    async commitImport(token, options = {}) {
      calls.push('commit');
      if (api.failImport) throw new Error('raw secret in invalid database');
      const data = staged.get(token);
      disk.modelConfig = clone(options.modelConfig ?? data.modelConfig);
      disk.onboarded = data.onboarded;
      disk.conversations = new Map(data.conversations.map((conversation) => [conversation.id, clone(conversation)]));
      staged.delete(token);
      return api.bootstrap();
    },
    async cancelImport(token) { staged.delete(token); calls.push('cancel'); },
    async clearDatabase() {
      calls.push('clear');
      if (api.failClear) throw new Error('raw secret clear failure');
      disk.modelConfig = null;
      disk.onboarded = false;
      disk.conversations.clear();
      return api.bootstrap();
    },
  };
  return api;
}

async function createHarness(database, { allowBootFailure = false } = {}) {
  const jobs = [];
  const key = randomUUID();
  const mocks = globalThis.__persistenceTestStreams ??= new Map();
  const stream = (kind) => (options) => new Promise((resolve, reject) => jobs.push({ kind, ...options, resolve, reject }));
  mocks.set(key, { text: stream('text') });
  let source = await readFile(storeUrl, 'utf8');
  source = source.replace("import { streamAnswer } from '../core/ai/client.js';", `const streamAnswer = globalThis.__persistenceTestStreams.get('${key}').text;`)
    .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
    .replace(/from '(\.\.?\/[^']+)'/g, (_, relative) => `from '${new URL(relative, storeUrl).href}'`);
  const { useAppStore: store, attachAppPersistence } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  mocks.delete(key);
  const persistence = attachAppPersistence(database, { flushDelay: 60_000, eventTarget: null, visibilityTarget: null });
  const state = () => store.getState();
  const conversation = (id = state().currentConversationId) => state().conversations.find((entry) => entry.id === id);
  const onboard = () => { state().setModelConfig({ apiKey: 'test-key', supportsImage: true }); state().completeOnboarding(); };
  try { await state().initializeStorage(); }
  catch (error) { if (!allowBootFailure) throw error; }
  return { store, state, conversation, jobs, persistence, onboard };
}

test('restart opens a new empty question and loads old images only when selected', async (t) => {
  const database = mockDatabase();
  const first = await createHarness(database);
  t.after(() => first.persistence.dispose());
  first.onboard();
  const image = { id: 'image-first', name: '题目.png', mime: 'image/png', bytes: new Uint8Array([1, 2]), dataUrl: 'data:image/png;base64,AQI=' };
  const solving = first.state().sendMessage('', { image });
  first.jobs[0].resolve('旧回答');
  await solving;
  const oldId = first.state().currentConversationId;
  await first.state().flushStorage();
  const second = await createHarness(database);
  t.after(() => second.persistence.dispose());
  assert.equal(second.state().storageInitialized, true);
  assert.equal(second.state().onboarded, true);
  assert.notEqual(second.state().currentConversationId, oldId);
  assert.deepEqual(second.conversation().messages, []);
  assert.equal(second.conversation(oldId).loaded, false);
  assert.deepEqual(second.conversation(oldId).messages, []);
  assert.equal(database.calls.some((call) => call?.load), false);
  await second.state().selectConversation(oldId);
  assert.equal(second.conversation().loaded, true);
  assert.equal(second.conversation().messages[0].image.dataUrl, image.dataUrl);
  assert.equal(second.conversation().messages[0].content, '');
  assert.equal(second.conversation().messages[1].content, '旧回答');
  assert.deepEqual(second.conversation().messages[0].image.bytes, image.bytes);
});

test('failed saves keep latest streaming data for retry without exposing raw errors', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('题目');
  app.jobs[0].onReasoning('先想一下条件');
  app.jobs[0].onDelta('最初正文');
  database.failSave = true;
  await assert.rejects(app.state().flushStorage(), /本地数据/);
  assert.equal(app.state().storageStatus, 'error');
  assert.equal(app.state().storageInitialized, true);
  assert.ok(!app.state().storageError.includes('secret'));
  app.jobs[0].onDelta('和新正文');
  database.failSave = false;
  await app.state().retryStorage();
  assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].content, '最初正文和新正文');
  assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].reasoningContent, '先想一下条件',
    '未完成的回答保留思考文本，断了还能续写');
  app.jobs[0].resolve('完整正文');
  await answering;
  await app.state().flushStorage();
  assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].status, 'complete');
  assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].reasoningContent, null,
    '回答完成后思考文本不再落库（非 Kimi 系不回传，留着只占体积）');
});

test('export flushes already received answer text before producing a snapshot', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('导出中的题目');
  app.jobs[0].onDelta('已收到的推导');
  const bytes = await app.state().exportData();
  const exported = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(exported.conversations[0].messages[1].content, '已收到的推导');
  assert.equal(database.calls.at(-1), 'export');
  app.jobs[0].resolve('完成');
  await answering;
});

test('background flush checkpoints reasoning even when the pending animation frame has not run', async (t) => {
  const original = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  t.after(() => { if (original) globalThis.requestAnimationFrame = original; else delete globalThis.requestAnimationFrame; });
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('先思考再作答');
  app.jobs[0].onReasoning('仅收到思考，正文还没到');
  assert.equal(app.conversation().messages[1].reasoningContent ?? '', '');
  await app.state().flushStorage();
  assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].reasoningContent, '仅收到思考，正文还没到');
  app.jobs[0].resolve('完成'); await answering;
});

test('a save failing while a new delta arrives retries both the original question and latest answer', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('不能丢掉的原题');
  app.jobs[0].onDelta('最初回答');
  database.saveGate = deferred();
  const saving = app.state().flushStorage();
  // Let the first batch leave the dirty map and enter the controlled disk write.
  await new Promise(resolve => setImmediate(resolve));
  app.jobs[0].onDelta('，后续推导');
  database.failSave = true;
  database.saveGate.resolve();
  await assert.rejects(saving, /本地数据/);
  database.saveGate = null; database.failSave = false;
  await app.state().retryStorage();
  const saved = database.disk.conversations.get(app.conversation().id).messages;
  assert.equal(saved[0].content, '不能丢掉的原题');
  assert.equal(saved[1].content, '最初回答，后续推导');
  const retry = database.calls.filter(call => call?.save).at(-1).save;
  assert.deepEqual(retry.conversations[0].messages.map(message => message.role), ['user', 'assistant']);
  app.jobs[0].resolve('完成'); await answering;
});

test('closing the app checkpoints received output as interrupted rather than a manual stop', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('退出时还在回答');
  app.jobs[0].onDelta('退出前已经收到的推导');
  await app.state().prepareForExit();
  const saved = database.disk.conversations.get(app.conversation().id).messages[1];
  assert.equal(saved.content, '退出前已经收到的推导');
  assert.equal(saved.status, 'stopped');
  assert.equal(saved.error, '应用关闭，回答尚未完成。');
  assert.equal(app.jobs[0].signal.aborted, true);
  app.jobs[0].resolve('迟到的回答不能覆盖检查点'); await answering;
  assert.equal(app.conversation().messages[1].content, saved.content);
});

test('opening a saved question restores its exact input even in an older revision', async (t) => {
  const old = { id: 'old', title: '原题', createdAt: '2026-10-01', updatedAt: '2026-10-01', messages: [
    { id: 'u-old', role: 'user', content: '原始题目', superseded: true },
    { id: 'a-old', role: 'assistant', content: '原始解答', status: 'complete', superseded: true },
    { id: 'u-new', role: 'user', content: '修改后的题目', revisionOf: 'u-old' },
    { id: 'a-new', role: 'assistant', content: '修改后的解答', status: 'complete' },
  ] };
  const app = await createHarness(mockDatabase({ onboarded: true, conversations: new Map([['old', old]]) }));
  t.after(() => app.persistence.dispose());
  assert.equal(await app.state().openQuestionSource({ sourceMessageId: 'u-old', sourceConversationId: 'old' }), true);
  assert.equal(app.state().questionFocus.messageId, 'u-old');
  assert.equal(app.state().currentConversationId, 'old');
  assert.equal(app.conversation().messages.find(message => message.id === 'u-old').superseded, false);
  assert.equal(await app.state().openQuestionSource({ sourceMessageId: 'deleted', sourceConversationId: 'missing' }), false);
});

test('late history loads never navigate back or restore data after clear', async (t) => {
  const old = { id: 'old', title: '旧题', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [{ id: 'u', role: 'user', content: '旧题' }] };
  const database = mockDatabase({ onboarded: true, conversations: new Map([['old', old]]) });
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  database.loadGate = deferred();
  const loading = app.state().selectConversation('old');
  assert.equal(app.state().conversationLoading, true);
  assert.equal(await app.state().sendMessage('加载中不得发题'), null);
  app.state().newConversation();
  const newId = app.state().currentConversationId;
  database.loadGate.resolve();
  await loading;
  assert.equal(app.state().currentConversationId, newId);
  assert.equal(app.state().conversationLoading, false);
  assert.equal(app.conversation('old').loaded, true);

  app.store.setState((state) => ({ conversations: state.conversations.map((entry) => entry.id === 'old' ? { ...entry, loaded: false, messages: [] } : entry) }));
  database.loadGate = deferred();
  const obsolete = app.state().selectConversation('old');
  await app.state().clearAllData();
  database.loadGate.resolve();
  await obsolete;
  assert.deepEqual(app.state().conversations, []);
  assert.equal(app.state().route, 'onboarding');
});

test('会话在读取途中被移除时，不能留下"正在读取"把输入框永久锁死', async (t) => {
  const old = { id: 'gone', title: '会被删掉的题', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [{ id: 'u', role: 'user', content: '旧题' }] };
  const database = mockDatabase({ onboarded: true, conversations: new Map([['gone', old]]) });
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  database.loadGate = deferred();
  const loading = app.state().selectConversation('gone');
  assert.equal(app.state().conversationLoading, true);
  // 读取还没回来，这条会话就先从列表里消失了（删除、导入替换都会这样）。
  app.store.setState((state) => ({ conversations: state.conversations.filter((entry) => entry.id !== 'gone') }));
  database.loadGate.resolve();
  await loading;
  assert.equal(app.state().conversationLoading, false, '输入框的 block 条件必须被清掉');
});

test('prepare import does not cancel answering; failed replacement preserves old disk and content', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('当前题');
  app.jobs[0].onDelta('当前正文');
  const imported = new TextEncoder().encode(JSON.stringify({ modelConfig: { apiKey: 'new-key' }, onboarded: true, conversations: [{ id: 'imported', title: '导入题', messages: [] }] }));
  const prepared = await app.state().prepareImport(imported);
  assert.equal(app.jobs[0].signal.aborted, false);
  assert.equal(prepared.summary.conversationCount, 1);
  database.failImport = true;
  await assert.rejects(app.state().confirmImport(prepared.token), /本地数据/);
  assert.equal(app.jobs[0].signal.aborted, true);
  assert.equal(app.conversation().messages[1].content, '当前正文');
  assert.equal(app.conversation().messages[1].status, 'stopped');
  assert.equal(database.disk.modelConfig.apiKey, 'test-key');
  assert.ok(database.disk.conversations.has(app.conversation().id));
  app.jobs[0].onDelta('不能恢复');
  app.jobs[0].resolve('不能恢复的结果');
  await answering;
  assert.equal(app.conversation().messages[1].content, '当前正文');

  database.failImport = false;
  await app.state().confirmImport(prepared.token);
  // 本机已有可用配置：导入只换数据，不动这台设备的模型设置。
  assert.equal(app.state().modelConfig.apiKey, 'test-key');
  assert.equal(app.conversation('imported').loaded, false);
  assert.deepEqual(app.conversation().messages, []);
  await app.state().flushStorage();
  assert.deepEqual([...database.disk.conversations.keys()], ['imported']);
});

test('clear waits for queued saves and failure leaves the current application intact', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const answering = app.state().sendMessage('不能丢的题');
  app.jobs[0].onDelta('不能丢的正文');
  database.saveGate = deferred();
  const saving = app.state().flushStorage();
  await Promise.resolve();
  database.failClear = true;
  const clearing = app.state().clearAllData();
  assert.equal(app.state().dataOperation, 'clearing');
  assert.equal(await app.state().sendMessage('操作中不得发送'), null);
  database.saveGate.resolve();
  await saving;
  await assert.rejects(clearing, /本地数据/);
  assert.equal(app.state().route, 'main');
  assert.equal(app.conversation().messages[1].content, '不能丢的正文');
  assert.equal(database.disk.modelConfig.apiKey, 'test-key');
  assert.equal(database.disk.conversations.size, 1);
  app.jobs[0].resolve('迟到答案');
  await answering;
  database.failClear = false;
  await app.state().clearAllData();
  assert.equal(app.state().route, 'onboarding');
  assert.equal(app.state().storageInitialized, true);
  assert.equal(app.state().modelConfig.apiKey, '');
  assert.equal(database.disk.conversations.size, 0);
});

test('a broken initial database can be cleared safely from recovery settings', async (t) => {
  const database = mockDatabase();
  database.failInitialize = true;
  const app = await createHarness(database, { allowBootFailure: true });
  t.after(() => app.persistence.dispose());
  assert.equal(app.state().storageInitialized, false);
  assert.equal(app.state().storageStatus, 'error');
  assert.ok(!app.state().storageError.includes('secret'));
  app.state().openSettings();
  await app.state().clearAllData();
  assert.equal(app.state().storageInitialized, true);
  assert.equal(app.state().route, 'onboarding');
});

test('a failed pending save does not prevent an explicitly confirmed atomic clear', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  database.failSave = true;
  await app.state().clearAllData();
  assert.ok(database.calls.includes('clear'));
  assert.equal(database.disk.conversations.size, 0);
  assert.equal(app.state().storageStatus, 'ready');
  assert.equal(app.state().route, 'onboarding');
});

for (const kind of ['clear', 'import']) {
  test(`failed save and ${kind} preserve pending data for retry`, async (t) => {
    const database = mockDatabase();
    const app = await createHarness(database);
    t.after(() => app.persistence.dispose());
    app.onboard();
    await app.state().flushStorage();
    const answering = app.state().sendMessage('尚未保存的新题目');
    app.jobs[0].onDelta('尚未保存的新正文');
    let operation;
    if (kind === 'import') {
      const bytes = new TextEncoder().encode(JSON.stringify({ modelConfig: { apiKey: 'replacement-key' }, onboarded: true, conversations: [] }));
      const prepared = await app.state().prepareImport(bytes);
      operation = () => app.state().confirmImport(prepared.token);
      database.failImport = true;
    } else {
      operation = () => app.state().clearAllData();
      database.failClear = true;
    }
    database.failSave = true;
    await assert.rejects(operation(), /本地数据/);
    assert.equal(database.disk.modelConfig.apiKey, 'test-key');
    assert.equal(app.conversation().messages[1].content, '尚未保存的新正文');
    assert.equal(app.conversation().messages[1].status, 'stopped');
    app.jobs[0].resolve('应丢弃的完成结果');
    await answering;
    database.failSave = false;
    await app.state().retryStorage();
    assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].content, '尚未保存的新正文');
    assert.equal(database.disk.conversations.get(app.conversation().id).messages[1].status, 'stopped');
  });
}

test('safe database errors survive boot and invalid import does not change storage status', async (t) => {
  const database = mockDatabase();
  database.initializeDatabase = async () => { throw Object.assign(new Error('raw secret'), { userMessage: '数据由更新版本创建，请先更新应用。' }); };
  const app = await createHarness(database, { allowBootFailure: true });
  t.after(() => app.persistence.dispose());
  assert.equal(app.state().storageError, '数据由更新版本创建，请先更新应用。');
  database.prepareImport = async () => { throw Object.assign(new Error('raw secret'), { userMessage: '这份备份来自更新版本，请先更新应用。' }); };
  const status = app.state().storageStatus;
  await assert.rejects(app.state().prepareImport(new Uint8Array([1])), /更新版本/);
  assert.equal(app.state().storageStatus, status);
  assert.equal(app.state().storageError, '数据由更新版本创建，请先更新应用。');
});

test('successful confirmed import discards unsavable old dirty data', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  app.onboard();
  const oldId = app.conversation().id;
  const bytes = new TextEncoder().encode(JSON.stringify({
    modelConfig: { ...app.state().modelConfig, apiKey: 'restored-key' }, onboarded: true,
    conversations: [{ id: 'restored', title: '恢复的题', messages: [] }],
  }));
  const prepared = await app.state().prepareImport(bytes);
  database.failSave = true;
  await app.state().confirmImport(prepared.token);
  // 导入的是数据，不是这台设备的模型配置：本机已经填好，就必须保留本机的。
  assert.equal(app.state().modelConfig.apiKey, 'test-key');
  assert.equal(app.state().storageStatus, 'ready');
  assert.equal(app.conversation(oldId), undefined);
  assert.deepEqual([...database.disk.conversations.keys()], ['restored']);
  const saveCount = database.calls.filter((call) => call?.save).length;
  await app.state().flushStorage();
  assert.equal(database.calls.filter((call) => call?.save).length, saveCount);
});

test('本机还没有配置时，导入才采用备份里的模型设置', async (t) => {
  const database = mockDatabase();
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  const bytes = new TextEncoder().encode(JSON.stringify({
    modelConfig: { ...app.state().modelConfig, apiKey: 'restored-key' }, onboarded: true,
    conversations: [{ id: 'restored', title: '恢复的题', messages: [] }],
  }));
  const prepared = await app.state().prepareImport(bytes);
  await app.state().confirmImport(prepared.token);
  assert.equal(app.state().modelConfig.apiKey, 'restored-key', '空配置时应当采用备份里的设置');
});

test('repeated history selections share a load and cannot overwrite a new answer', async (t) => {
  const old = { id: 'old', title: '旧题', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [{ id: 'old-user', role: 'user', content: '旧题' }] };
  const database = mockDatabase({ onboarded: true, conversations: new Map([['old', old]]) });
  const app = await createHarness(database);
  t.after(() => app.persistence.dispose());
  database.loadGate = deferred();
  const first = app.state().selectConversation('old');
  const duplicate = app.state().selectConversation('old');
  assert.equal(database.calls.filter((call) => call?.load === 'old').length, 1);
  database.loadGate.resolve();
  await Promise.all([first, duplicate]);
  const answering = app.state().sendMessage('新的追问');
  app.jobs[0].resolve('新的回答');
  await answering;
  await app.state().selectConversation('old');
  assert.equal(app.conversation().messages.at(-1).content, '新的回答');
  assert.equal(database.calls.filter((call) => call?.load === 'old').length, 1);
});

test('方法讨论只在内存里，点过存进历史才整条落库', async () => {
  const database = mockDatabase();
  const app = await createHarness(database);
  app.onboard();
  app.state().openMethod('method-chain');
  app.state().sendMethodMessage('这个方法为什么成立？');
  const discussion = () => app.state().conversations.find((entry) => entry.methodId === 'method-chain');
  assert.equal(discussion().ephemeral, true, '讨论必须是内存态');
  assert.ok(discussion().messages.length > 0, '讨论里应该有刚发出的提问');

  // 普通落盘完全看不到它。
  await app.persistence.flush();
  const saved = database.calls.filter((call) => call?.save?.conversations?.some((item) => item.id === discussion().id));
  assert.equal(saved.length, 0, '内存态讨论不能被写进数据库');
  assert.equal(database.disk.conversations.has(discussion().id), false);

  // 用户显式留档：整条写入，包括全部消息。
  const id = discussion().id;
  assert.equal(await app.state().saveMethodConversation(id), true);
  assert.equal(discussion().ephemeral, false);
  await app.persistence.flush();
  const stored = database.disk.conversations.get(id);
  assert.ok(stored, '存进历史之后库里必须有这条会话');
  assert.ok((stored.messages ?? []).length >= 1, '存进历史必须带上已有消息');
  assert.equal(saved.length, 0);
  assert.equal(await app.state().saveMethodConversation(id), false, '已经存过的不再重复写');
});
