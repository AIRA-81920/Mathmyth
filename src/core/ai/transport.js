import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { validateModelConfig } from '../config/providers.js';
import { canNativeStream, nativeStreamRequest } from '../platform/nativeStream.js';

// D10：不再有"总时长"超时。连接阶段用 AI_CONNECT_TIMEOUT_MS，拿到响应后换成
// 空闲计时——每收到一段真实数据就重置，只有累计 AI_IDLE_TIMEOUT_MS 没有任何
// 字节才 abort。思考模式长时间不出 token 不会再被误杀。
export const AI_CONNECT_TIMEOUT_MS = 15_000;
export const AI_IDLE_TIMEOUT_MS = 180_000;

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

function timeoutError() {
  return new AiRequestError('模型响应超时，请稍后重试。', 'timeout');
}

function connectionError(native) {
  return new AiRequestError(
    native
      ? '连接失败，请检查网络和 API 地址后重试。'
      : '连接失败，请检查网络和 API 地址。浏览器也可能被服务商的 CORS 策略阻止；安卓使用原生 HTTP。',
    'network',
  );
}

function safeTransportError(error, native) {
  if (error instanceof AiRequestError) return error;
  if (error?.name === 'AbortError') return createAbortError(native);
  if (/timeout|timed out/i.test(String(error?.message ?? ''))) return timeoutError();
  return connectionError(native);
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
    connectTimeoutMs = AI_CONNECT_TIMEOUT_MS,
    idleTimeoutMs = AI_IDLE_TIMEOUT_MS,
    // 兼容旧调用：历史上这里传的是"总时长"。现在它只作为空闲窗口的别名，
    // 不会再按总时长掐表。
    timeoutMs,
  }) {
    const { valid, errors } = validateModelConfig(config);
    if (!valid) throw new AiRequestError(Object.values(errors)[0], 'configuration');
    const native = isNativePlatform() || Boolean(globalThis.mathmythDesktop);
    const nativeStreaming = native && hasNativeStream() && (payload.stream || Boolean(globalThis.mathmythDesktop));
    const controller = new AbortController();
    const abort = () => controller.abort(createAbortError(native && !nativeStreaming));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();

    const idleWindow = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : idleTimeoutMs;
    const connectWindow = Math.min(connectTimeoutMs, idleWindow);
    let phase = 'connect';
    let timer;
    const stopTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const arm = (ms, reason) => { stopTimer(); timer = setTimeout(() => controller.abort(reason), ms); };
    // 只统计"真实数据帧"：SSE 心跳/空帧不算活动，避免连接被保活帧吊住不超时。
    const touch = () => { if (phase === 'stream') arm(idleWindow, timeoutError()); };
    arm(connectWindow, connectionError(native));

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
          connectTimeout: connectWindow, readTimeout: idleWindow }), controller.signal);
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
          connectTimeout: connectWindow,
          readTimeout: idleWindow,
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
      // 响应已到手：连接阶段结束，转入空闲计时。此后每个真实数据帧都会重置它。
      phase = 'stream';
      arm(idleWindow, timeoutError());
      return await waitWithSignal(readResponse(result, controller.signal, touch), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw safeTransportError(error, native);
    } finally {
      stopTimer();
      signal?.removeEventListener('abort', abort);
    }
  };
}

export const requestCompletion = createHttpTransport();

export function modelsEndpoint(apiBase) {
  const base = String(apiBase).trim().replace(/\/+$/, '');
  return /\/models$/i.test(base) ? base : base + '/models';
}

// 查询可用模型：一次 GET，只关心列表本身。跨域在安卓/桌面都走原生 HTTP，
// 和问答共用同一套错误文案，避免出现第二种"失败原因"的说法。
export function createModelListRequest({
  isNativePlatform = () => Capacitor.isNativePlatform(),
  nativeRequest = (options) => CapacitorHttp.request(options),
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return async function requestModelList({ config = {}, signal, connectTimeoutMs = 8_000 } = {}) {
    // 只查列表：模型名还没定、Key 也可能还没填——很多网关的 /v1/models 是公开的，
    // 不给 Key 也该能查；真需要 Key 的，等它回 401 再提示。
    const check = validateModelConfig({ ...config, model: '-', apiKey: '-' });
    if (check.errors.apiBase) throw new AiRequestError(check.errors.apiBase, 'configuration');
    const native = isNativePlatform() || Boolean(globalThis.mathmythDesktop);
    const controller = new AbortController();
    const abort = () => controller.abort(createAbortError(native));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new AiRequestError('查询模型列表超时，请检查网络后重试。', 'timeout')), connectTimeoutMs);
    const url = modelsEndpoint(config.apiBase);
    const apiKey = String(config.apiKey ?? '').trim();
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    try {
      throwIfAborted(controller.signal);
      let data;
      if (native) {
        const response = await waitWithSignal(nativeRequest({
          url, method: 'GET', headers, responseType: 'json',
          connectTimeout: connectTimeoutMs, readTimeout: connectTimeoutMs,
        }), controller.signal);
        if (response.status < 200 || response.status >= 300) throw httpError(response.status);
        data = response.data;
      } else {
        const response = await waitWithSignal(fetchImpl(url, {
          method: 'GET', headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
        }), controller.signal);
        if (response.status < 200 || response.status >= 300) {
          response.body?.cancel?.().catch(() => {});
          throw httpError(response.status);
        }
        data = await waitWithSignal(response.json(), controller.signal);
      }
      throwIfAborted(controller.signal);
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof AiRequestError) throw error;
      throw safeTransportError(error, native);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export const requestModelList = createModelListRequest();

