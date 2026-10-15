import { ASK_SYSTEM_PROMPT } from './prompts.js';
import { readSseStream } from './sse.js';
import { AiRequestError, httpError, requestCompletion, throwIfAborted, waitWithSignal } from './transport.js';

function publicText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text).join('');
  }
  return '';
}

function providerError(value) {
  const code = String(value?.code ?? value?.type ?? '').toLowerCase();
  if (/invalid_api_key|authentication|unauthorized|^401$/.test(code)) return httpError(401);
  if (/permission|forbidden|^403$/.test(code)) return httpError(403);
  if (/model_not_found|not_found|^404$/.test(code)) return httpError(404);
  if (/rate_limit|quota|^429$/.test(code)) return httpError(429);
  return new AiRequestError('服务商在生成过程中返回了错误，请稍后重试。', 'provider_error');
}

function checkFinish(reason) {
  if (reason === 'length') throw new AiRequestError('回答达到模型的长度限制，内容尚未完成。可追问或检查模型设置。', 'truncated');
  if (reason === 'content_filter') throw new AiRequestError('服务商未能完成这次回答，请调整题目后重试。', 'content_filter');
  if (reason === 'tool_calls' || reason === 'function_call') {
    throw new AiRequestError('模型返回了工具调用，当前答疑需要直接返回文字。请更换模型或重试。', 'unsupported_response');
  }
  if (reason && reason !== 'stop') throw new AiRequestError('模型未正常完成回答，请重试。', 'incomplete_response');
}

function ensureAnswer(answer) {
  if (!answer.trim()) throw new AiRequestError('模型没有返回正文，请检查模型设置后重试。', 'empty_answer');
  return answer;
}

function prepareMessages(messages, config, systemPrompt) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new AiRequestError('请先输入题目。', 'invalid_messages');
  }
  const history = messages.map((message) => {
    if (!['user', 'assistant'].includes(message?.role)) {
      throw new AiRequestError('会话消息格式不正确，请重新开始对话。', 'invalid_messages');
    }
    const { content } = message;
    if (typeof content === 'string') {
      if (!content.trim()) throw new AiRequestError('消息内容为空，请先输入题目。', 'invalid_messages');
      return { role: message.role, content, ...(message.role === 'assistant' && typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}) };
    }
    if (!Array.isArray(content) || !content.length) {
      throw new AiRequestError('消息内容格式不正确，请重新输入。', 'invalid_messages');
    }
    for (const part of content) {
      if (part?.type === 'image_url') {
        if (!config.supportsImage) throw new AiRequestError('当前模型未启用图片能力，请在设置中勾选后再发送图片。', 'image_unsupported');
        if (typeof part.image_url?.url !== 'string' || !part.image_url.url.trim()) {
          throw new AiRequestError('图片内容无效，请重新选择图片。', 'invalid_messages');
        }
      } else if (part?.type !== 'text' || typeof part.text !== 'string') {
        throw new AiRequestError('消息内容格式不正确，请重新输入。', 'invalid_messages');
      }
    }
    return { role: message.role, content };
  });
  return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...history] : history;
}

async function jsonPayload(result, signal) {
  try {
    const data = result.native ? result.data : await waitWithSignal(result.response.json(), signal);
    throwIfAborted(signal);
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw new AiRequestError('服务商返回的内容不是有效的模型回答，请检查 API 地址。', 'invalid_response');
  }
}

async function readAnswer(result, signal, onDelta = () => {}, onReasoning = () => {}) {
  if (result.native || !/text\/event-stream/i.test(result.contentType)) {
    const data = await jsonPayload(result, signal);
    if (data?.error) throw providerError(data.error);
    const choice = data?.choices?.[0];
    const answer = ensureAnswer(publicText(choice?.message?.content));
    // Preserve a useful partial answer before reporting a truncated response.
    throwIfAborted(signal);
    if (typeof choice?.message?.reasoning_content === 'string') onReasoning(choice.message.reasoning_content);
    onDelta(answer);
    checkFinish(choice?.finish_reason);
    return answer;
  }

  let answer = '';
  let complete = false;
  await readSseStream(result.response.body, {
    signal,
    onEvent({ event, data }) {
      throwIfAborted(signal);
      if (data.trim() === '[DONE]') {
        complete = true;
        return false;
      }
      if (!data.trim()) return;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        if (event === 'error') throw providerError({});
        return; // A malformed keep-alive frame must not discard useful text.
      }
      if (event === 'error' || chunk?.error) throw providerError(chunk?.error ?? chunk);
      const choice = chunk?.choices?.[0];
      if (typeof choice?.delta?.reasoning_content === 'string') onReasoning(choice.delta.reasoning_content);
      // reasoning_content and all other private/metadata fields stay out of UI.
      const delta = publicText(choice?.delta?.content);
      if (delta) {
        answer += delta;
        onDelta(delta);
      }
      checkFinish(choice?.finish_reason);
      if (choice?.finish_reason === 'stop') {
        complete = true;
        return false;
      }
    },
  });
  throwIfAborted(signal);
  ensureAnswer(answer);
  if (!complete) throw new AiRequestError('回答在完成前中断了，请重试。', 'incomplete_response');
  return answer;
}

export async function streamAnswer({
  config = {},
  messages,
  onDelta,
  onReasoning,
  signal,
  systemPrompt = ASK_SYSTEM_PROMPT,
  parameters = {},
  timeoutMs,
}) {
  const prepared = prepareMessages(messages, config, systemPrompt);
  return requestCompletion({
    config,
    payload: { ...parameters, model: String(config.model).trim(), messages: prepared, stream: true },
    signal,
    ...(timeoutMs ? { timeoutMs } : {}),
    readResponse: (result, activeSignal) => readAnswer(result, activeSignal, onDelta, onReasoning),
  });
}

export async function testConnection(config = {}, { signal } = {}) {
  await requestCompletion({
    config,
    payload: {
      model: String(config.model ?? '').trim(),
      messages: [{ role: 'user', content: '你好，请回复一句简短的中文问候。' }],
      stream: false,
    },
    signal,
    readResponse: (result, activeSignal) => readAnswer(result, activeSignal),
  });
  return { ok: true, message: '连接成功，模型已回复问候。' };
}
