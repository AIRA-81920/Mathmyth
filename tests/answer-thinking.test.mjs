import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REJECTED_KEY, answerRequest, clearReasoningRejected, isReasoningRejected, markReasoningRejected,
  preservesReasoning, sendWithReasoningFallback, thinkingCapability,
} from '../src/core/ai/answerThinking.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}
const cfg = (apiBase, model) => ({ apiBase, model, apiKey: 'k', providerId: 'custom', supportsImage: false });

test('有文档依据的四家：开着、参数也对得上', () => {
  assert.deepEqual(
    [thinkingCapability(cfg('https://api.deepseek.com', 'deepseek-flash')).protocol, thinkingCapability(cfg('https://api.deepseek.com', 'deepseek-flash')).switchable],
    ['thinking', true]);
  // 火山方舟（官方深度思考文档：thinking: {type}）
  const ark = thinkingCapability(cfg('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-0-lite-260428'));
  assert.equal(ark.switchable, true);
  assert.equal(ark.protocol, 'thinking');
  // 硅基流动（官方 enable_thinking）
  const sf = thinkingCapability(cfg('https://api.siliconflow.cn/v1', 'Qwen/Qwen3-VL-8B-Instruct'));
  assert.equal(sf.protocol, 'enable_thinking');
  assert.deepEqual(answerRequest(cfg('https://api.siliconflow.cn/v1', 'Qwen/Qwen3-VL-8B-Instruct'), 'disabled').parameters, { enable_thinking: false });
});

test('Kimi 与智谱的"不能关"要显示固定开启，而不是不可切换', () => {
  for (const model of ['kimi-k3', 'kimi-k3-mini', 'kimi-k2.7-code']) {
    const cap = thinkingCapability(cfg('https://api.moonshot.cn/v1', model));
    assert.equal(cap.switchable, false, model);
    assert.equal(cap.defaultOn, true, model);
    assert.match(cap.reason, /固定开启|始终开启/, model);
  }
  // k2.6 可以关
  assert.equal(thinkingCapability(cfg('https://api.moonshot.cn/v1', 'kimi-k2.6')).switchable, true);
  // GLM-5.3 官方明说不能关；5.3 以下可以
  const glm53 = thinkingCapability(cfg('https://open.bigmodel.cn/api/paas/v4/', 'glm-5.3'));
  assert.equal(glm53.switchable, false);
  assert.match(glm53.reason, /不支持关闭/);
  assert.equal(thinkingCapability(cfg('https://open.bigmodel.cn/api/paas/v4/', 'glm-4.6v-flash')).switchable, true);
});

test('文档没写的网关：退回 OpenAI 标准 reasoning_effort，而不是直接锁死', () => {
  for (const [host, model] of [['https://tokendance.space/gateway/v1', 'kimi-k2.5'], ['https://tokenrhythm.studio/v1', 'deepseek-v4-flash'], ['http://127.0.0.1:9999/v1', 'any']]) {
    const cap = thinkingCapability(cfg(host, model));
    assert.equal(cap.switchable, true, host + ' 应当可切换');
    assert.equal(cap.protocol, 'reasoning_effort', host);
    assert.equal(cap.unverified, true, host);
  }
  const config = cfg('https://tokendance.space/gateway/v1', 'kimi-k2.5');
  assert.deepEqual(answerRequest(config, 'enabled').parameters, { reasoning_effort: 'high' });
  assert.deepEqual(answerRequest(config, 'disabled').parameters, { reasoning_effort: 'none' });
  // 默认(auto)什么都不发：用户没动开关就不冒险
  assert.deepEqual(answerRequest(config, 'auto').parameters, {});
});

test('网关拒绝思考字段：退回一次并记住，之后不再发', async () => {
  const storage = memoryStorage();
  const config = cfg('https://tokendance.space/gateway/v1', 'kimi-k2.5');
  const sent = [];
  const send = async (request) => {
    sent.push(request.parameters);
    if (Object.keys(request.parameters).length) { const e = new Error('400'); e.code = 'invalid_request'; throw e; }
    return 'ok';
  };
  assert.equal(await sendWithReasoningFallback({ config, mode: 'disabled', send, storage }), 'ok');
  assert.deepEqual(sent, [{ reasoning_effort: 'none' }, {}], '第一次带字段、第二次不带');
  assert.equal(isReasoningRejected(config, storage), true);
  // 之后直接不发字段了
  sent.length = 0;
  await sendWithReasoningFallback({ config, mode: 'disabled', send, storage });
  assert.deepEqual(sent, [{}]);
  // 记录是按 host|model 分开的，别的模型不受影响
  assert.equal(isReasoningRejected(cfg('https://tokendance.space/gateway/v1', 'kimi-k2.6'), storage), false);
  clearReasoningRejected(config, storage);
  assert.equal(isReasoningRejected(config, storage), false);
  assert.ok(storage.getItem(REJECTED_KEY));
});

test('不是参数原因的错误不重试、不记仇', async () => {
  const storage = memoryStorage();
  const config = cfg('https://tokendance.space/gateway/v1', 'kimi-k2.5');
  let calls = 0;
  const send = async () => { calls += 1; const e = new Error('offline'); e.code = 'network'; throw e; };
  await assert.rejects(sendWithReasoningFallback({ config, mode: 'enabled', send, storage }), /offline/);
  assert.equal(calls, 1, '网络错误不该再发第二次');
  assert.equal(isReasoningRejected(config, storage), false);
});

test('reasoning_content 仍然只对 Kimi 那几款回传', () => {
  assert.equal(preservesReasoning(cfg('https://api.moonshot.cn/v1', 'kimi-k3')), true);
  assert.equal(preservesReasoning(cfg('https://api.moonshot.cn/v1', 'kimi-k2.6')), false);
  assert.equal(preservesReasoning(cfg('https://tokendance.space/gateway/v1', 'kimi-k3')), false, '网关不经手就不回传');
});
