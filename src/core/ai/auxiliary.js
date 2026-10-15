// Verified against provider Chat Completions docs, 2026-10-10.
// extra_body is an SDK option: its fields belong at the JSON body's top level.
export function auxiliaryRequest(config = {}) {
  let host = '';
  try { host = new URL(config.apiBase).hostname.toLowerCase(); } catch { /* Validated by transport. */ }
  let model = String(config.auxiliaryModel || config.model || '').trim();
  const mode = config.auxiliaryThinking ?? 'auto';
  const kimi = /^(api\.)?moonshot\.(cn|ai)$/.test(host);
  const tokenDance = host === 'tokendance.space';
  // K3/K2.7 always think. Use the same-provider switchable model only for
  // auxiliary tasks, unless the user explicitly sets an auxiliary model.
  if ((kimi || tokenDance) && !config.auxiliaryModel && /^kimi-k(?:3|2\.7)/i.test(model)) model = 'kimi-k2.6';
  if (host === 'open.bigmodel.cn' && !config.auxiliaryModel && /^glm-5\.3/i.test(model)) model = 'glm-4.6v-flash';
  if (host === 'api.siliconflow.cn' && !config.auxiliaryModel && /thinking|deepseek-r1/i.test(model)) model = 'Qwen/Qwen3-VL-8B-Instruct';
  if (mode === 'none') return { config: { ...config, model }, parameters: {} };
  const forced = { thinking: { thinking: { type: 'disabled' } }, enable_thinking: { enable_thinking: false },
    chat_template: { chat_template_kwargs: { enable_thinking: false } } };
  if (forced[mode]) return { config: { ...config, model }, parameters: forced[mode] };
  let parameters = {};
  if (host === 'api.deepseek.com') {
    if (/^deepseek-(?:flash|pro|v[34])/i.test(model)) parameters = { thinking: { type: 'disabled' } };
    else if (model === 'deepseek-reasoner') model = 'deepseek-chat';
  } else if (host === 'open.bigmodel.cn' && /^glm-(?:4\.[567]|5)/i.test(model) && !/^glm-5\.3/i.test(model)) {
    parameters = { thinking: { type: 'disabled' } };
  } else if ((kimi || tokenDance) && /^kimi-k2\.[56]$/i.test(model)) {
    parameters = { thinking: { type: 'disabled' } };
  } else if (host === 'api.siliconflow.cn' && !/instruct|thinking|deepseek-r1/i.test(model)
    && /qwen3|deepseek-v[34]|glm-[45]|kimi-k2\.6/i.test(model)) {
    parameters = { enable_thinking: false };
  }
  // A custom gateway's model name does not prove support for native fields.
  // Its explicit settings are available without sending incompatible flags.
  return { config: { ...config, model }, parameters };
}
