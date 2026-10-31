import test from 'node:test';
import assert from 'node:assert/strict';
import { providers, validateModelConfig } from '../src/core/config/providers.js';
import { createModelListRequest, modelsEndpoint } from '../src/core/ai/transport.js';
import { listModels } from '../src/core/ai/client.js';

const config = { apiBase: 'https://tokenrhythm.studio/v1', apiKey: 'secret-test-key', model: 'deepseek-v4-flash' };

test('missing or malformed restored model settings yield field errors instead of crashing the queue', () => {
  for (const input of [null, undefined, [], 3, 'invalid']) {
    const result = validateModelConfig(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.apiBase);
  }
});

test('火山引擎与 Token Rhythm 是按官方地址接入的预设', () => {
  const volcano = providers.find((item) => item.id === 'volcano');
  const rhythm = providers.find((item) => item.id === 'tokenrhythm');
  assert.equal(volcano?.name, '火山引擎');
  assert.equal(volcano?.apiBase, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.equal(rhythm?.name, 'Token Rhythm');
  assert.equal(rhythm?.apiBase, 'https://tokenrhythm.studio/v1');
  // 空模型名的预设等于把校验失败甩给用户，默认值必须能直接拿去测。
  assert.ok(volcano?.defaultModel?.trim());
  assert.ok(rhythm?.defaultModel?.trim());
  assert.deepEqual(providers.at(-1), { ...providers.at(-1), id: 'custom' });
});

test('modelsEndpoint 只在缺少 /models 时补一次', () => {
  assert.equal(modelsEndpoint('https://tokenrhythm.studio/v1/'), 'https://tokenrhythm.studio/v1/models');
  assert.equal(modelsEndpoint(' https://ark.cn-beijing.volces.com/api/v3/// '), 'https://ark.cn-beijing.volces.com/api/v3/models');
  assert.equal(modelsEndpoint('https://model.example/v1/models'), 'https://model.example/v1/models');
});

test('查询模型列表是带 Bearer 的 GET，解析 data[].id', async () => {
  const seen = [];
  const request = createModelListRequest({
    isNativePlatform: () => false,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, {}] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const payload = await request({ config });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://tokenrhythm.studio/v1/models');
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer secret-test-key');
  assert.deepEqual(await listModels(config, { request: async () => payload }), { models: ['a', 'b'] });
});

test('安卓/桌面走原生 GET，不经过被 CORS 挡住的 fetch', async () => {
  let captured;
  const request = createModelListRequest({
    isNativePlatform: () => true,
    nativeRequest: async (options) => { captured = options; return { status: 200, data: { data: [{ id: 'doubao-seed' }] } }; },
  });
  assert.deepEqual(await request({ config }), { data: [{ id: 'doubao-seed' }] });
  assert.equal(captured.method, 'GET');
  assert.equal(captured.url, 'https://tokenrhythm.studio/v1/models');
  assert.equal(captured.responseType, 'json');
});

test('服务商不提供模型列表时给出可操作的说法', async () => {
  const request = createModelListRequest({
    isNativePlatform: () => false,
    fetchImpl: async () => new Response('nope', { status: 404 }),
  });
  await assert.rejects(request({ config }), (error) => error.code === 'not_found');
  await assert.rejects(
    listModels(config, { request: () => request({ config }) }),
    (error) => error.code === 'no_model_list' && /手动填写/.test(error.userMessage),
  );
});

test('空列表也算失败，不会弹出一个空下拉', async () => {
  await assert.rejects(
    listModels(config, { request: async () => ({ object: 'list', data: [] }) }),
    (error) => error.code === 'empty_model_list',
  );
  await assert.rejects(listModels(config, { request: async () => ({}) }), (error) => error.code === 'empty_model_list');
});

test('没填 API 地址时先报字段问题，不发请求', async () => {
  let called = false;
  const request = createModelListRequest({ isNativePlatform: () => false, fetchImpl: async () => { called = true; return new Response('{}'); } });
  await assert.rejects(request({ config: { ...config, apiBase: '' } }), (error) => error.code === 'configuration' && /API 地址/.test(error.userMessage));
  assert.equal(called, false);
});

test('还没填 Key 也能查列表：不带 Authorization', async () => {
  const seen = [];
  const request = createModelListRequest({
    isNativePlatform: () => false,
    fetchImpl: async (url, options) => {
      seen.push(options.headers);
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const payload = await request({ config: { ...config, apiKey: '' } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].Authorization, undefined);
  assert.deepEqual(await listModels({ ...config, apiKey: '' }, { request: async () => payload }), { models: ['m1'] });
});

test('列表真需要 Key 时，提示先填 Key 而不是“地址不对”', async () => {
  const request = createModelListRequest({
    isNativePlatform: () => false,
    fetchImpl: async () => new Response('unauthorized', { status: 401 }),
  });
  await assert.rejects(
    listModels({ ...config, apiKey: '' }, { request: () => request({ config: { ...config, apiKey: '' } }) }),
    (error) => error.code === 'api_key_required' && /先填 API Key/.test(error.userMessage),
  );
});
