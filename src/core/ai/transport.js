import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { validateModelConfig } from '../config/providers.js';
import { canNativeStream, nativeStreamRequest } from '../platform/nativeStream.js';

export const AI_REQUEST_TIMEOUT_MS = 120_000;
export const AI_CONNECT_TIMEOUT_MS = 15_000;

export class AiRequestError extends Error {
  constructor(message, code = 'request_failed') {
    super(message);
    this.name = 'AiRequestError';
    this.userMessage = message;
    this.code = code;
  }
}

export function createAbortError(native = false) {
  const error = new AiRequestError(
    native
      ? '已停止接收回答。原生请求可能仍在服务商端继续处理。'
      : '已停止生成。',
    'aborted',
  );
  error.name = 'AbortError';
  error.nativeRequestMayContinue = native;
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof AiRequestError ? signal.reason : createAbortError();
  }
}

// A native HTTP promise has no physical cancellation API. Reject promptly and
// consume its eventual settlement so it cannot update a cancelled conversation.
export function waitWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener('abort', stop);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) stop();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) stop();
        else reject(error);
      },
    );
    if (signal.aborted) stop();
  });
}

export function completionEndpoint(apiBase) {
  const base = String(apiBase).trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

export function httpError(status) {
  if (status === 401) return new AiRequestError('API Key 无效或已失效，请在设置中检查。', 'authentication');
  if (status === 403) return new AiRequestError('服务商拒绝访问，请检查 Key 权限和模型可用范围。', 'permission');
  if (status === 404) return new AiRequestError('API 地址或模型名不存在，请在设置中核对。', 'not_found');
  if (status === 408 || status === 504) return new AiRequestError('模型响应超时，请稍后重试。', 'timeout');
  if (status === 429) return new AiRequestError('请求过于频繁或额度不足，请检查服务商额度后重试。', 'rate_limit');
  if (status >= 500) return new AiRequestError('服务商暂时不可用，请稍后重试。', 'service_unavailable');
  if (status === 400 || status === 422) return new AiRequestError('模型未接受这次请求，请检查模型名和图片能力设置。', 'invalid_request');
  return new AiRequestError(`模型请求失败（HTTP ${Number(status) || '未知'}），请检查设置后重试。`, 'http_error');
}

function safeTransportError(error, native) {
  if (error instanceof AiRequestError) return error;
  if (error?.name === 'AbortError') return createAbortError(native);
  if (/timeout|timed out/i.test(String(error?.message ?? ''))) {
    return new AiRequestError('模型响应超时，请稍后重试。', 'timeout');
  }
  return new AiRequestError(
    native
      ? '连接失败，请检查网络和 API 地址后重试。'
      : '连接失败，请检查网络和 API 地址。浏览器也可能被服务商的 CORS 策略阻止；安卓使用原生 HTTP。',
    'network',
  );
}

// The small factory lets tests exercise native cancellation without a device.
// Production always uses the platform APIs; there is no server or proxy.
export function createHttpTransport({
  isNativePlatform = () => Capacitor.isNativePlatform(),
  nativeRequest = (options) => CapacitorHttp.request(options),
  hasNativeStream = canNativeStream,
  streamRequest = nativeStreamRequest,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return async function requestCompletion({
    config,
    payload,
    signal,
    readResponse,
    timeoutMs = AI_REQUEST_TIMEOUT_MS,
  }) {
    const { valid, errors } = validateModelConfig(config);
    if (!valid) throw new AiRequestError(Object.values(errors)[0], 'configuration');
    const native = isNativePlatform() || Boolean(globalThis.mathmythDesktop);
    const nativeStreaming = native && hasNativeStream() && (payload.stream || Boolean(globalThis.mathmythDesktop));
    const controller = new AbortController();
    const abort = () => controller.abort(createAbortError(native && !nativeStreaming));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      controller.abort(new AiRequestError('模型响应超时，请稍后重试。', 'timeout'));
    }, timeoutMs);

    try {
      throwIfAborted(controller.signal);
      const url = completionEndpoint(config.apiBase);
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(config.apiKey).trim()}`,
        Accept: !payload.stream || (native && !nativeStreaming) ? 'application/json' : 'text/event-stream, application/json',
      };
      let result;
      if (nativeStreaming) {
        const response = await waitWithSignal(streamRequest(url, { headers, body: JSON.stringify(payload), signal: controller.signal,
          connectTimeout: Math.min(AI_CONNECT_TIMEOUT_MS, timeoutMs), readTimeout: timeoutMs }), controller.signal);
        result = { native: false, status: response.status, contentType: response.headers.get('content-type') ?? '', response };
      } else if (native) {
        // CapacitorHttp accepts serializable JSON, not a streaming Response.
        // https://capacitorjs.com/docs/apis/http
        const response = await waitWithSignal(nativeRequest({
          url,
          method: 'POST',
          headers,
          data: { ...payload, stream: false },
          responseType: 'json',
          connectTimeout: Math.min(AI_CONNECT_TIMEOUT_MS, timeoutMs),
          readTimeout: timeoutMs,
        }), controller.signal);
        result = { native: true, status: response.status, data: response.data };
      } else {
        const response = await waitWithSignal(fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }), controller.signal);
        result = {
          native: false,
          status: response.status,
          contentType: response.headers.get('content-type') ?? '',
          response,
        };
      }
      throwIfAborted(controller.signal);
      if (result.status < 200 || result.status >= 300) {
        result.response?.body?.cancel().catch(() => {});
        throw httpError(result.status);
      }
      return await waitWithSignal(readResponse(result, controller.signal), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw safeTransportError(error, native);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export const requestCompletion = createHttpTransport();
