import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const storeUrl = new URL('../src/store/appStore.js', import.meta.url);

async function createHarness() {
  const jobs = [];
  const key = randomUUID();
  const streams = globalThis.__mathmythStoreTestStreams ??= new Map();
  const request = (kind) => (options) => new Promise((resolve, reject) => {
    // Deliberately allow late callbacks after abort to test the store's guard.
    jobs.push({ kind, ...options, resolve, reject });
  });
  streams.set(key, { text: request('text') });

  let source = await readFile(storeUrl, 'utf8');
  source = source.replace(
    "import { streamAnswer } from '../core/ai/client.js';",
    `const streamAnswer = globalThis.__mathmythStoreTestStreams.get('${key}').text;`,
  ).replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
    .replace(/from '(\.\.?\/[^']+)'/g, (_, relative) => `from '${new URL(relative, storeUrl).href}'`);
  const { useAppStore: store } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  streams.delete(key);
  const state = () => store.getState();
  const conversation = (id = state().currentConversationId) => (
    state().conversations.find((entry) => entry.id === id)
  );
  const start = () => {
    state().setModelConfig({ apiKey: 'test-key' });
    assert.equal(state().completeOnboarding().valid, true);
  };
  return { jobs, state, conversation, start };
}

test('version switching makes no model call, blocks while streaming and supplies only the selected continuation on the next question', async () => {
  const { jobs,state,conversation,start } = await createHarness(); start();
  const original = state().sendMessage('原题'); const firstId = conversation().messages[0].id;
  assert.equal(state().selectMessageRevision(firstId),false);
  jobs[0].resolve('原回答'); await original;
  const follow = state().sendMessage('原追问'); jobs[1].resolve('追问回答'); await follow;
  const revised = state().reviseUserMessage(firstId,'新题'); jobs[2].resolve('新回答'); await revised;
  const newId = conversation().messages.find(m=>m.revisionOf===firstId).id;
  assert.equal(state().selectMessageRevision(firstId),true); assert.equal(jobs.length,3);
  assert.deepEqual(conversation().messages.filter(m=>!m.superseded).map(m=>m.content),['原题','原回答','原追问','追问回答']);
  const continued = state().sendMessage('在原版本继续');
  assert.deepEqual(jobs[3].messages.map(m=>m.content),['原题','原回答','原追问','追问回答','在原版本继续']);
  jobs[3].resolve('原版本的新回答'); await continued;
  assert.equal(state().selectMessageRevision(newId),true);
  assert.deepEqual(conversation().messages.filter(m=>!m.superseded).map(m=>m.content),['新题','新回答']);
  assert.equal(state().selectMessageRevision(firstId),true);
  assert.equal(conversation().messages.filter(m=>!m.superseded).at(-1).content,'原版本的新回答');
  assert.equal(jobs.length,4);
});

test('one request per conversation; navigation and settings cannot redirect an answer', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  const firstId = state().currentConversationId;
  const first = state().sendMessage('求极限');
  assert.equal(conversation().messages.at(-1).status, 'streaming');
  assert.equal(await state().sendMessage('重复点击'), null);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].messages, [{ role: 'user', content: '求极限' }]);
  state().setModelConfig({ apiKey: 'replacement-key' });
  assert.equal(jobs[0].config.apiKey, 'test-key');

  state().newConversation();
  const secondId = state().currentConversationId;
  const second = state().sendMessage('求积分');
  state().setActiveArea('trail');
  jobs[0].onDelta('旧会话的推导');
  jobs[1].onDelta('新会话的推导');
  assert.equal(conversation(firstId).messages.at(-1).content, '旧会话的推导');
  assert.equal(conversation(secondId).messages.at(-1).content, '新会话的推导');
  jobs[0].resolve('旧会话完整回答');
  jobs[1].resolve('新会话完整回答');
  await Promise.all([first, second]);
  assert.equal(state().activeArea, 'trail');
  assert.equal(conversation(firstId).messages.at(-1).status, 'complete');
  assert.equal(conversation(secondId).messages.at(-1).content, '新会话完整回答');
});

test('stop preserves received text and stale completion cannot unlock a new request', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  const stopped = state().sendMessage('第一题');
  jobs[0].onDelta('部分答案');
  assert.equal(state().stopGenerating(), true);
  assert.equal(jobs[0].signal.aborted, true);
  assert.equal(conversation().messages[1].content, '部分答案');
  assert.equal(conversation().messages[1].status, 'stopped');
  assert.equal(conversation().messages[1].error, '已停止接收回答。');
  assert.equal(state().stopGenerating(), false);

  const next = state().sendMessage('追问');
  jobs[0].onDelta('应忽略的迟到增量');
  jobs[0].resolve('应忽略的迟到完成');
  await stopped;
  assert.equal(conversation().messages[1].content, '部分答案');
  assert.equal(await state().sendMessage('重复追问'), null);
  assert.equal(jobs.length, 2);
  jobs[1].resolve('追问完整回答');
  await next;
  assert.equal(conversation().messages.at(-1).status, 'complete');
});
test('stopping in a burst flushes all already received tokens and deleting one chat leaves another answer running', async () => {
  const {jobs,state,conversation,start}=await createHarness();start();
  const firstId=state().currentConversationId,first=state().sendMessage('第一题');
  jobs[0].onDelta('a');jobs[0].onDelta('b');jobs[0].onDelta('c');state().stopGenerating();
  assert.equal(conversation(firstId).messages.at(-1).content,'abc');jobs[0].resolve('abc');await first;
  const second=state().sendMessage('第二题');
  state().newConversation();const otherId=state().currentConversationId,other=state().sendMessage('另一题');
  await state().deleteConversation(firstId,false);assert.equal(jobs[2].signal.aborted,false);
  jobs[1].resolve('旧回答');jobs[2].onDelta('继续');jobs[2].resolve('继续');await Promise.all([second,other]);
  assert.equal(conversation(otherId).messages.at(-1).content,'继续');
});

test('clear aborts every conversation and late results cannot restore cleared data', async () => {
  const { jobs, state, start } = await createHarness();
  start();
  const first = state().sendMessage('第一题');
  state().newConversation();
  const second = state().sendMessage('第二题');
  state().clearAllData();
  assert.ok(jobs.every((job) => job.signal.aborted));
  jobs[0].onDelta('清空后的旧增量');
  jobs[0].resolve('清空后的旧答案');
  jobs[1].reject(new Error('迟到的网络失败'));
  await Promise.all([first, second]);
  assert.deepEqual(state().conversations, []);
  assert.equal(state().currentConversationId, null);
  assert.equal(state().modelConfig.apiKey, '');
  assert.equal(state().route, 'onboarding');
});

test('failed answers keep their partial text but never become answer context', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  const first = state().sendMessage('原题');
  jobs[0].onDelta('中断的错误回答');
  jobs[0].reject(new Error('raw error contains test-key'));
  await first;
  assert.equal(conversation().messages.at(-1).content, '中断的错误回答');
  assert.equal(conversation().messages.at(-1).status, 'error');
  assert.ok(!conversation().messages.at(-1).error.includes('test-key'));
  const second = state().sendMessage('重新说明');
  assert.deepEqual(jobs[1].messages, [
    { role: 'user', content: '原题' },
    { role: 'user', content: '重新说明' },
  ]);
  jobs[1].reject(Object.assign(new Error('raw error'), { userMessage: '请检查模型设置。' }));
  await second;
  assert.equal(conversation().messages.at(-1).error, '请检查模型设置。');
});

test('recheck targets an older answer while its visible user message stays short', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  const original = '第一条回答：' + '较长的原推导。'.repeat(80);
  const first = state().sendMessage('第一道题');
  jobs[0].resolve(original);
  await first;
  const targetId = conversation().messages[1].id;
  const second = state().sendMessage('追问别的一步');
  jobs[1].resolve('第二条不同回答');
  await second;

  const recheck = state().recheckMessage(targetId);
  const visible = conversation().messages.at(-2);
  assert.equal(visible.content, '这题不对，请重新检查并解释修正。');
  assert.equal(visible.recheckOf, targetId);
  assert.ok(jobs[2].messages.at(-1).content.includes(original));
  assert.ok(!jobs[2].messages.at(-1).content.includes('第二条不同回答'));
  assert.ok(!JSON.stringify(jobs[2].messages).includes(targetId));
  assert.equal(await state().sendMessage('无效核查', { recheckOf: visible.id }), null);
  assert.equal(state().recheckMessage(conversation().messages.at(-1).id), null);
  jobs[2].resolve('已核查，修正如下');
  await recheck;

  const followup = state().sendMessage('为什么要这样修正？');
  assert.ok(jobs[3].messages.at(-3).content.includes(original));
  assert.equal(conversation().messages.at(-4).content, visible.content);
  jobs[3].resolve('修正依据');
  await followup;
});

test('invalid recheck cannot create a new conversation or call a model', async () => {
  const { jobs, state } = await createHarness();
  assert.equal(await state().sendMessage('重新检查', { recheckOf: 'missing-answer' }), null);
  assert.deepEqual(state().conversations, []);
  assert.equal(jobs.length, 0);
});

test('editing a user question preserves old IDs but removes the replaced suffix from model context', async () => {
  const { jobs, state, conversation, start } = await createHarness(); start();
  const first = state().sendMessage('求 x 的导数'); jobs[0].resolve('原回答是1'); await first;
  const followup = state().sendMessage('再解释原题'); jobs[1].resolve('原题的追问回答'); await followup;
  const original = [...conversation().messages];
  const edited = state().reviseUserMessage(original[0].id, '求 x^2 的导数');
  assert.deepEqual(jobs[2].messages, [{ role: 'user', content: '求 x^2 的导数' }]);
  assert.ok(conversation().messages.slice(0, 4).every((message, index) => message.superseded && message.id === original[index].id && message.content === original[index].content));
  assert.equal(conversation().messages.at(-2).revisionOf, original[0].id);
  assert.equal(conversation().messages.at(-2).revisionAction, 'edit');
  assert.equal(state().reviseUserMessage(original[0].id, '重复编辑旧版本'), null);
  jobs[2].resolve('新答案为2x'); await edited;
  const next = state().sendMessage('解释新答案');
  assert.deepEqual(jobs[3].messages.map((message) => message.content), ['求 x^2 的导数', '新答案为2x', '解释新答案']);
  jobs[3].resolve('新依据'); await next;
});

test('retrying a later user question keeps its earlier context and never supplies its failed reply', async () => {
  const { jobs, state, conversation, start } = await createHarness(); start();
  const first = state().sendMessage('原题'); jobs[0].resolve('最初解答'); await first;
  const later = state().sendMessage('请解释第二步'); jobs[1].reject(new Error('network')); await later;
  const user = conversation().messages.at(-2), failed = conversation().messages.at(-1);
  const retry = state().reviseUserMessage(user.id, undefined, { action: 'retry' });
  assert.deepEqual(jobs[2].messages.map((message) => message.content), ['原题', '最初解答', '请解释第二步']);
  assert.equal(conversation().messages.find((message) => message.id === failed.id).superseded, true);
  assert.equal(conversation().messages.at(-2).revisionAction, 'retry');
  jobs[2].resolve('第二步的新说明'); await retry;
});

test('editing a photo question preserves its image and gives priority to the corrected text', async () => {
  const { jobs, state, conversation, start } = await createHarness(); start(); state().setModelConfig({ supportsImage: true });
  const image = testImage('revision-photo');
  const initial = state().sendMessage('图片中的原题', { image }); jobs[0].resolve('旧解答'); await initial;
  const oldUser = conversation().messages[0];
  const edited = state().reviseUserMessage(oldUser.id, '实际题目是求 x^3 的导数');
  assert.equal(jobs[1].messages.at(-1).content[1].image_url.url, image.dataUrl);
  assert.ok(jobs[1].messages.at(-1).content[0].text.includes('请以用户修正的题面为准'));
  assert.equal(conversation().messages.at(-2).image, image);
  jobs[1].onDelta('新推导'); jobs[1].resolve('新答案'); await edited;
  assert.equal(conversation().messages.at(-2).content, '实际题目是求 x^3 的导数');
  assert.equal(conversation().messages[0].content, oldUser.content);
});

function testImage(id = 'test-image') {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6y8AAAAASUVORK5CYII=';
  return { id, name: '题目.png', mime: 'image/png', bytes: Uint8Array.from(Buffer.from(encoded, 'base64')), dataUrl: `data:image/png;base64,${encoded}` };
}

test('image and text use one ordinary stream; follow-up corrections keep the original image context', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  state().setModelConfig({ supportsImage: true });
  const image = { ...testImage(), role: 'assistant' };
  const solving = state().sendMessage('请解释思路', { image });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'text');
  assert.equal(conversation().messages[0].role, 'user');
  assert.equal(conversation().messages[0].image, image);
  assert.equal(conversation().messages[1].content, '');
  assert.deepEqual(jobs[0].messages.at(-1), {
    role: 'user', content: [
      { type: 'text', text: '请解释思路' },
      { type: 'image_url', image_url: { url: image.dataUrl } },
    ],
  });
  assert.equal(await state().sendMessage('', { image: testImage('duplicate') }), null);
  jobs[0].onDelta('导数为 ');
  assert.equal(conversation().messages[1].content, '导数为 ');
  jobs[0].resolve('导数为 $2x$。');
  await solving;
  assert.equal(conversation().messages[0].content, '请解释思路');
  assert.equal(conversation().messages[1].content, '导数为 $2x$。');
  assert.equal(jobs.length, 1);

  const corrected = state().sendMessage('实际题面是求 $x^3$ 的导数。');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].kind, 'text');
  assert.equal(jobs[1].messages[0].content[1].image_url.url, image.dataUrl);
  assert.equal(jobs[1].messages.at(-1).content, '实际题面是求 $x^3$ 的导数。');
  assert.equal(conversation().messages.at(-2).content, '实际题面是求 $x^3$ 的导数。');
  jobs[1].resolve('修正后为 $3x^2$。');
  await corrected;
});

test('image-only messages stream to their source conversation after navigation', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  state().setModelConfig({ supportsImage: true });
  const originalId = state().currentConversationId;
  const imageRequest = state().sendMessage('', { image: testImage() });
  assert.equal(conversation(originalId).messages[0].content, '');
  assert.equal(conversation(originalId).title, '图片题目');
  assert.equal(jobs[0].messages[0].content[0].text, '请解答图片中的题目。');
  state().newConversation();
  const newId = state().currentConversationId;
  const newText = state().sendMessage('新会话的文字题');
  jobs[0].resolve('旧图片解答');
  await imageRequest;
  assert.equal(conversation(originalId).messages[0].content, '');
  assert.equal(conversation(originalId).messages[1].content, '旧图片解答');
  assert.equal(conversation(newId).messages[0].content, '新会话的文字题');
  assert.equal(conversation(newId).messages[1].content, '');
  assert.equal(conversation(newId).messages[1].status, 'streaming');
  jobs[1].resolve('新会话解答');
  await newText;
});

test('stopped or cleared image streams preserve partial text and reject late deltas', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  state().setModelConfig({ supportsImage: true });
  const first = state().sendMessage('', { image: testImage() });
  jobs[0].onDelta('已接收到的推导');
  assert.equal(state().stopGenerating(), true);
  jobs[0].onDelta('不应出现的后续');
  jobs[0].resolve('迟到答案');
  await first;
  assert.equal(conversation().messages[0].content, '');
  assert.equal(conversation().messages[1].content, '已接收到的推导');
  assert.equal(conversation().messages[1].status, 'stopped');

  const second = state().sendMessage('', { image: testImage('second') });
  state().newConversation();
  const third = state().sendMessage('', { image: testImage('third') });
  state().clearAllData();
  assert.ok(jobs.slice(1).every((job) => job.signal.aborted));
  jobs[1].resolve('已清空答案');
  jobs[2].reject(new Error('清空后失败'));
  await Promise.all([second, third]);
  assert.deepEqual(state().conversations, []);
});

test('image capability rejects new images and old image history degrades to text', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  const image = testImage();
  assert.equal(await state().sendMessage('', { image }), null);
  assert.equal(await state().sendMessage('修正题面', { image, correctedImage: true }), null);
  assert.deepEqual(state().conversations, []);
  assert.equal(jobs.length, 0);
  start();
  state().setModelConfig({ supportsImage: true });
  const first = state().sendMessage('', { image });
  jobs[0].resolve('对应解答');
  await first;
  state().setModelConfig({ supportsImage: false });
  const followup = state().sendMessage('请再解释一次');
  assert.deepEqual(jobs[1].messages, [
    { role: 'user', content: '之前发送了一张题目图片。' },
    { role: 'assistant', content: '对应解答' },
    { role: 'user', content: '请再解释一次' },
  ]);
  assert.equal(conversation().messages[0].image, image);
  jobs[1].resolve('文字追问解答');
  await followup;
});

test('image failure retains the original and exposes only a friendly error', async () => {
  const { jobs, state, conversation, start } = await createHarness();
  start();
  state().setModelConfig({ supportsImage: true });
  const image = testImage();
  const solving = state().sendMessage('', { image });
  jobs[0].reject(Object.assign(new Error('{raw:key:test-key}'), { userMessage: '服务商暂时不可用，请稍后重试。' }));
  await solving;
  assert.equal(conversation().messages[0].image, image);
  assert.equal(conversation().messages[0].content, '');
  assert.equal(conversation().messages[1].content, '');
  assert.equal(conversation().messages[1].status, 'error');
  assert.equal(conversation().messages[1].error, '服务商暂时不可用，请稍后重试。');
});
