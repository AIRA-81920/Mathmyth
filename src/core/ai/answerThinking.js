// Foreground control is independent of auxiliaryRequest and never sends flags
// to an unknown gateway unless the user asked for it — and if an unknown
// gateway rejects the flag, we retry once without it and remember that.
// Protocols verified against provider docs:
//   DeepSeek  thinking: {type: enabled|disabled}      (api-docs.deepseek.com)
//   火山方舟   thinking: {type: enabled|disabled}      (volcengine 深度思考)
//   Kimi      thinking: {type, keep}；K3 用 reasoning_effort (moonshot 文档)
//   智谱      thinking.type（GLM-5.3 系列不能关闭）
//   硅基流动   enable_thinking: boolean
//   其它网关  退回 OpenAI 标准 reasoning_effort，失败自动降级
export const REJECTED_KEY = 'mathmyth.reasoning-unsupported.v1';

function hostOf(config) {
  try { return new URL(config.apiBase).hostname.toLowerCase(); } catch { return ''; }
}

export function thinkingCapability(config = {}) {
  const host = hostOf(config);
  const model = String(config.model ?? '').trim();
  if (host === 'api.deepseek.com') {
    if (/^deepseek-(?:flash|pro|v[34])/i.test(model)) return { switchable: true, protocol: 'thinking', defaultOn: true };
    if (/^deepseek-(?:chat|reasoner)$/.test(model)) return { switchable: true, protocol: 'deepseek-model', defaultOn: model === 'deepseek-reasoner' };
  }
  if (host === 'ark.cn-beijing.volces.com' && /^(?:doubao|deepseek)/i.test(model)) {
    return { switchable: true, protocol: 'thinking', defaultOn: true };
  }
  if (/^(?:api\.)?moonshot\.(?:cn|ai)$/.test(host)) {
    if (/^kimi-k2\.[56]$/i.test(model)) return { switchable: true, protocol: 'thinking', defaultOn: true };
    if (/^kimi-k2\.7-code$/i.test(model)) return { switchable: false, defaultOn: true, reason: '这个模型固定开启思考' };
    if (/^kimi-k3/i.test(model)) return { switchable: false, defaultOn: true, reason: 'K3 始终开启思考，只能用强度调节' };
  }
  if (host === 'open.bigmodel.cn') {
    if (/^glm-5\.3/i.test(model)) return { switchable: false, defaultOn: true, reason: 'GLM-5.3 系列不支持关闭思考' };
    if (/^glm-(?:4\.[567]|5)/i.test(model)) return { switchable: true, protocol: 'thinking', defaultOn: true };
  }
  if (host === 'api.siliconflow.cn' && /(?:qwen3|glm|deepseek|kimi|reason)/i.test(model)) {
    return { switchable: true, protocol: 'enable_thinking', defaultOn: false };
  }
  // 文档没写的网关（Token Dance、Token Rhythm、自定义……）：按 OpenAI 标准字段试一次。
  // defaultOn=false 表示默认仍是"自动"——不勾就不发任何字段，只有用户明确开关时才发。
  return { switchable: true, protocol: 'reasoning_effort', defaultOn: false, unverified: true };
}

// 只有 Kimi 这一系在官方协议里要求把上一条回答的 reasoning_content 传回多轮。
export function preservesReasoning(config = {}) {
  const host = hostOf(config);
  return /^(?:api\.)?moonshot\.(?:cn|ai)$/.test(host)
    ? /^kimi-k(?:3|2\.7)/i.test(String(config.model ?? ''))
    : false;
}

function rejectionKey(config) {
  return hostOf(config) + '|' + String(config.model ?? '').trim().toLowerCase();
}

function readRejected(storage = globalThis.localStorage) {
  try { return new Set(JSON.parse(storage?.getItem(REJECTED_KEY) || '[]')); } catch { return new Set(); }
}

export function isReasoningRejected(config, storage = globalThis.localStorage) {
  return readRejected(storage).has(rejectionKey(config));
}

export function markReasoningRejected(config, storage = globalThis.localStorage) {
  const set = readRejected(storage);
  set.add(rejectionKey(config));
  try { storage?.setItem(REJECTED_KEY, JSON.stringify([...set])); } catch { /* 存不下就下次再试 */ }
}

export function clearReasoningRejected(config, storage = globalThis.localStorage) {
  const set = readRejected(storage);
  set.delete(rejectionKey(config));
  try { storage?.setItem(REJECTED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

const PARAMETER_FOR = {
  thinking: (mode) => ({ thinking: { type: mode } }),
  enable_thinking: (mode) => ({ enable_thinking: mode === 'enabled' }),
  reasoning_effort: (mode) => ({ reasoning_effort: mode === 'enabled' ? 'high' : 'none' }),
};

export function answerRequest(config, mode = 'auto', { storage } = {}) {
  const capability = thinkingCapability(config);
  if (!capability.switchable || !['enabled', 'disabled'].includes(mode)) return { config, parameters: {} };
  if (capability.protocol === 'deepseek-model') {
    return { config: { ...config, model: mode === 'enabled' ? 'deepseek-reasoner' : 'deepseek-chat' }, parameters: {} };
  }
  // 这个网关曾经拒绝过该字段：不再发，用户至少能正常问答。
  if (capability.unverified && isReasoningRejected(config, storage)) return { config, parameters: {} };
  const build = PARAMETER_FOR[capability.protocol];
  return build ? { config, parameters: build(mode) } : { config, parameters: {} };
}

// 第一次带上思考字段发送；若网关用 400 拒绝，就退回"不发该字段"再试一次，
// 并把这个 host|model 记住——以后不再拿同一个错误烦用户。
export function sendWithReasoningFallback({ config, mode, send, storage }) {
  const first = answerRequest(config, mode, { storage });
  const carried = Object.keys(first.parameters ?? {});
  const pending = send(first);
  // 没带思考字段时原样返回这个 promise：不额外加一个 await/microtask，
  // 否则"续写完成后立刻落成 complete"这类时序会被推后一拍。
  if (!carried.length) return pending;
  return pending.catch((error) => {
    const rejectedFlag = error?.code === 'invalid_request' || error?.code === 'provider_error';
    if (!rejectedFlag) throw error;
    markReasoningRejected(config, storage);
    return send(answerRequest(config, mode, { storage }));
  });
}
