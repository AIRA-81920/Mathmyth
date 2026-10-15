import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamAnswer, testConnection } from '../src/core/ai/client.js';
import { ASK_SYSTEM_PROMPT } from '../src/core/ai/prompts.js';
import { completionEndpoint, createHttpTransport } from '../src/core/ai/transport.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const config = {
  apiBase: 'https://model.example/v1/',
  apiKey: 'secret-test-key',
  model: 'math-model',
  supportsImage: false,
};
const messages = [{ role: 'user', content: '求极限 $\\sin x/x$。' }];
const jsonAnswer = (content, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] });
const sse = (data) => `data: ${JSON.stringify(data)}\n\n`;
const choice = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] });

function responseFromChunks(chunks, headers = { 'content-type': 'text/event-stream' }) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers });
}

function mockSse(text) {
  const bytes = new TextEncoder().encode(text);
  globalThis.fetch = async () => responseFromChunks([bytes]);
}

test('endpoint appends only once and preserves the supplied provider base path', () => {
  assert.equal(completionEndpoint('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(completionEndpoint(' https://model.example/v1/// '), 'https://model.example/v1/chat/completions');
  assert.equal(completionEndpoint('https://model.example/v1/chat/completions/'), 'https://model.example/v1/chat/completions');
});
test('native streaming transport keeps SSE enabled and shares the public answer decoder', async () => {
  let received;
  const request=createHttpTransport({isNativePlatform:()=>true,hasNativeStream:()=>true,
    streamRequest:async(url,options)=>{received=JSON.parse(options.body);return responseFromChunks([new TextEncoder().encode(sse(choice('逐段', 'stop')))]);},
    nativeRequest:()=>{throw new Error('Buffered fallback must not run');}});
  const value=await request({config,payload:{model:config.model,messages,stream:true},readResponse:async(result)=>{
    assert.equal(result.native,false);assert.match(result.contentType,/event-stream/);return await result.response.text();}});
  assert.equal(received.stream,true);assert.ok(value.includes('逐段'));
});

test('stream decodes split UTF-8, CRLF, multiline data, empty deltas and excludes reasoning', async () => {
  const text = ': heartbeat\r\n\r\n'
    + 'data: {"choices": [\r\ndata: {"delta":{"content":"中文"}}]}\r\n\r\n'
    + sse({ choices: [{ delta: { content: '', reasoning_content: 'PRIVATE' } }] })
    + sse(choice('$x$'))
    + 'data: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  globalThis.fetch = async () => responseFromChunks([...bytes].map((byte) => Uint8Array.of(byte)));
  const deltas = [];
  assert.equal(await streamAnswer({ config, messages, onDelta: (delta) => deltas.push(delta) }), '中文$x$');
  assert.deepEqual(deltas, ['中文', '$x$']);
});

test('one request carries the generic prompt and follow-up history', async () => {
  let count = 0;
  const history = [...messages, { role: 'assistant', content: '先看未定式。' }, { role: 'user', content: '为什么？' }];
  globalThis.fetch = async (url, options) => {
    count += 1;
    assert.equal(url, 'https://model.example/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.stream, true);
    assert.deepEqual(body.messages, [{ role: 'system', content: ASK_SYSTEM_PROMPT }, ...history]);
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key');
    return Response.json(jsonAnswer('因为分子分母都趋于零。'));
  };
  const deltas = [];
  assert.equal(await streamAnswer({ config, messages: history, onDelta: (value) => deltas.push(value) }), '因为分子分母都趋于零。');
  assert.equal(count, 1);
  assert.deepEqual(deltas, ['因为分子分母都趋于零。']);
});

test('finish_reason stop completes a stream without requiring DONE', async () => {
  mockSse(sse(choice('结论。')) + sse(choice(null, 'stop')));
  assert.equal(await streamAnswer({ config, messages }), '结论。');
});

test('abrupt EOF and empty completed answers are failures', async () => {
  mockSse(sse(choice('只讲了一半')));
  await assert.rejects(streamAnswer({ config, messages }), (error) => error.code === 'incomplete_response');
  mockSse('data: [DONE]\n\n');
  await assert.rejects(streamAnswer({ config, messages }), (error) => error.code === 'empty_answer');
});

test('malformed SSE frames are skipped; actual provider errors stop without leaking response text', async () => {
  mockSse(sse(choice('前')) + 'data: {broken}\n\n' + sse(choice('后', 'stop')));
  assert.equal(await streamAnswer({ config, messages }), '前后');
  const deltas = [];
  mockSse(sse(choice('前半段')) + sse({ error: { code: 'rate_limit_exceeded', message: 'secret-test-key' } }) + sse(choice('不得出现')));
  await assert.rejects(streamAnswer({ config, messages, onDelta: (value) => deltas.push(value) }), (error) => {
    assert.equal(error.code, 'rate_limit');
    assert.ok(!error.message.includes('secret-test-key'));
    return true;
  });
  assert.deepEqual(deltas, ['前半段']);
});

test('length limit preserves partial content and reports an incomplete answer', async () => {
  mockSse(sse(choice('部分正文', 'length')));
  const deltas = [];
  await assert.rejects(streamAnswer({ config, messages, onDelta: (value) => deltas.push(value) }), (error) => error.code === 'truncated');
  assert.deepEqual(deltas, ['部分正文']);
});

test('non-stream JSON fallback uses only public content and rejects malformed JSON', async () => {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: [{ type: 'text', text: '答案' }], reasoning_content: 'PRIVATE' }, finish_reason: 'stop' }] });
  assert.equal(await streamAnswer({ config, messages }), '答案');
  globalThis.fetch = async () => new Response('<html>secret-test-key</html>');
  await assert.rejects(streamAnswer({ config, messages }), (error) => {
    assert.equal(error.code, 'invalid_response');
    assert.ok(!error.message.includes('secret-test-key'));
    return true;
  });
});

test('HTTP errors are actionable and do not expose provider bodies', async () => {
  for (const [status, code] of [[401, 'authentication'], [403, 'permission'], [404, 'not_found'], [429, 'rate_limit'], [503, 'service_unavailable']]) {
    globalThis.fetch = async () => new Response('secret-test-key', { status });
    await assert.rejects(streamAnswer({ config, messages }), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('secret-test-key'));
      return true;
    });
  }
});

test('connection test performs one small greeting call without the answer system prompt', async () => {
  let count = 0;
  globalThis.fetch = async (_url, options) => {
    count += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.equal(Object.hasOwn(body, 'max_tokens'), false);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    return Response.json(jsonAnswer('你好！'));
  };
  assert.deepEqual(await testConnection(config), { ok: true, message: '连接成功，模型已回复问候。' });
  assert.equal(count, 1);
});

test('missing config reports a safe user-facing configuration error', async () => {
  globalThis.fetch = async () => { assert.fail('invalid config must not send a request'); };
  await assert.rejects(streamAnswer({ messages }), (error) => {
    assert.equal(error.code, 'configuration');
    assert.equal(error.userMessage, error.message);
    return true;
  });
  await assert.rejects(testConnection(), (error) => error.code === 'configuration' && Boolean(error.userMessage));
});

test('custom system prompt and enabled image parts are sent unchanged; disabled images never call fetch', async () => {
  const imageMessages = [{ role: 'user', content: [{ type: 'text', text: '识别这道题' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }];
  let count = 0;
  globalThis.fetch = async (_url, options) => {
    count += 1;
    assert.deepEqual(JSON.parse(options.body).messages, [{ role: 'system', content: '只识别题干' }, ...imageMessages]);
    return Response.json(jsonAnswer('题面'));
  };
  await assert.rejects(streamAnswer({ config, messages: imageMessages }), (error) => error.code === 'image_unsupported');
  assert.equal(count, 0);
  assert.equal(await streamAnswer({ config: { ...config, supportsImage: true }, messages: imageMessages, systemPrompt: '只识别题干' }), '题面');
  assert.equal(count, 1);
});

test('abort before sending prevents a request; abort during a pending read emits no later deltas', async () => {
  const before = new AbortController();
  before.abort();
  globalThis.fetch = async () => { assert.fail('request must not start'); };
  await assert.rejects(streamAnswer({ config, messages, signal: before.signal }), (error) => error.name === 'AbortError');

  const controller = new AbortController();
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode(sse(choice('开头')))); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const deltas = [];
  const answer = streamAnswer({ config, messages, signal: controller.signal, onDelta(value) {
    deltas.push(value);
    controller.abort();
  } });
  await assert.rejects(answer, (error) => error.name === 'AbortError');
  assert.deepEqual(deltas, ['开头']);
  assert.ok(cancelled);
});

test('network and timeout errors are friendly; a timeout aborts the browser request', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch secret-test-key'); };
  await assert.rejects(streamAnswer({ config, messages }), (error) => {
    assert.equal(error.code, 'network');
    assert.match(error.message, /CORS/);
    assert.ok(!error.message.includes('secret-test-key'));
    return true;
  });
  let requestSignal;
  const transport = createHttpTransport({ isNativePlatform: () => false, fetchImpl: (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(transport({ config, payload: { stream: true }, timeoutMs: 5, readResponse: () => '' }), (error) => error.code === 'timeout');
  assert.ok(requestSignal.aborted);
});

test('native transport uses direct JSON HTTP and forces non-streaming', async () => {
  const transport = createHttpTransport({ isNativePlatform: () => true, nativeRequest: async (options) => {
    assert.equal(options.url, 'https://model.example/v1/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.data.stream, false);
    assert.equal(options.responseType, 'json');
    assert.ok(options.readTimeout > 0);
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key');
    return { status: 200, data: jsonAnswer('原生回答') };
  } });
  assert.equal(await transport({ config, payload: { stream: true }, readResponse: (result) => {
    assert.equal(result.native, true);
    return result.data.choices[0].message.content;
  } }), '原生回答');
});

test('native cancellation rejects promptly and ignores eventual HTTP completion', async () => {
  let settle;
  let read = false;
  const transport = createHttpTransport({ isNativePlatform: () => true, nativeRequest: () => new Promise((resolve) => { settle = resolve; }) });
  const controller = new AbortController();
  const operation = transport({ config, payload: { stream: true }, signal: controller.signal, readResponse: () => { read = true; } });
  controller.abort();
  await assert.rejects(operation, (error) => error.name === 'AbortError' && error.nativeRequestMayContinue);
  settle({ status: 200, data: jsonAnswer('迟到回答') });
  await Promise.resolve();
  assert.equal(read, false);
});
