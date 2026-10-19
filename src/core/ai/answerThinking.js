// Foreground control is independent of auxiliaryRequest and never sends flags
// to an unknown gateway. Protocols checked against provider docs 2026-10-17.
export function thinkingCapability(config = {}) {
  let host = ''; try { host = new URL(config.apiBase).hostname.toLowerCase() } catch { /* Incomplete settings. */ }
  const model = String(config.model ?? '').trim();
  if (host === 'api.deepseek.com') {
    if (/^deepseek-(?:flash|pro|v[34])/i.test(model)) return { switchable: true, protocol: 'thinking', defaultOn: true };
    if (/^deepseek-(chat|reasoner)$/.test(model)) return { switchable: true, protocol: 'deepseek-model', defaultOn: model === 'deepseek-reasoner' };
  }
  if (/^(?:api\.)?moonshot\.(?:cn|ai)$/.test(host) || host === 'tokendance.space') {
    if (/^kimi-k2\.[56]$/i.test(model)) return { switchable: true, protocol: 'thinking', defaultOn: true };
    if (/^kimi-k(?:3|2\.7)|thinking/i.test(model)) return { switchable: false, defaultOn: true, reason: '当前模型固定开启思考' };
  }
  if (host === 'open.bigmodel.cn' && /^glm-(?:4\.[567]|5)/i.test(model) && !/^glm-5\.3/i.test(model)) {
    return { switchable: true, protocol: 'thinking', defaultOn: true };
  }
  return { switchable: false, defaultOn: false, reason: '当前模型尚未确认支持思考切换' };
}

export function answerRequest(config, mode = 'auto') {
  const capability = thinkingCapability(config);
  if (!capability.switchable || !['enabled', 'disabled'].includes(mode)) return { config, parameters: {} };
  if (capability.protocol === 'deepseek-model') return { config: { ...config, model: mode === 'enabled' ? 'deepseek-reasoner' : 'deepseek-chat' }, parameters: {} };
  return { config, parameters: { thinking: { type: mode } } };
}
