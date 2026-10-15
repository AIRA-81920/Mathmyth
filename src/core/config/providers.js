// These addresses are the presets supplied by the product owner.
// Image capability is guidance only: the user controls supportsImage explicitly.
export const providers = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiBase: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    imageCapability: true,
    imageHint: '此预设模型支持图片；是否启用由你勾选。',
    sourceUrl: 'https://api-docs.deepseek.com/guides/vision/',
    verifiedAt: '2026-10-08',
  },
  {
    id: 'zhipu',
    name: '智谱清言',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModel: 'glm-4.6v-flash',
    imageCapability: true,
    imageHint: '此预设模型支持图片；是否启用由你勾选。',
    sourceUrl: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash',
    verifiedAt: '2026-10-08',
  },
  {
    id: 'tokendance',
    name: 'Token Dance',
    apiBase: 'https://tokendance.space/gateway/v1',
    // The gateway has its own catalog; native Moonshot retirement dates do not
    // determine whether a model remains available through Token Dance.
    defaultModel: 'kimi-k2.5',
    imageCapability: true,
    imageHint: '此预设模型支持图片；是否启用由你勾选。',
    sourceUrl: 'https://tokendance.space/models/kimi-k2.5',
    verifiedAt: '2026-10-08',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    apiBase: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    imageCapability: true,
    imageHint: '此预设模型支持图片；是否启用由你勾选。',
    sourceUrl: 'https://platform.kimi.ai/docs/models',
    verifiedAt: '2026-10-08',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    apiBase: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen3-VL-8B-Instruct',
    imageCapability: true,
    imageHint: '此预设模型支持图片；是否启用由你勾选。',
    sourceUrl: 'https://www.siliconflow.com/zh/blog/qwen3-vl-8b-now-on-siliconflow-small-model-big-vision',
    verifiedAt: '2026-10-08',
  },
  {
    id: 'custom',
    name: '自定义',
    apiBase: '',
    defaultModel: '',
    imageCapability: null,
    imageHint: '图片能力请按所填模型确认。',
    sourceUrl: '',
    verifiedAt: '',
  },
];

export function createDefaultModelConfig() {
  const provider = providers[0];

  return {
    providerId: provider.id,
    apiBase: provider.apiBase,
    model: provider.defaultModel,
    apiKey: '',
    supportsImage: false,
    auxiliaryModel: '',
    auxiliaryThinking: 'auto',
  };
}

export function validateModelConfig(config = {}) {
  const errors = {};
  const apiBase = String(config.apiBase ?? '').trim();

  if (!apiBase) {
    errors.apiBase = '请填写 API 地址。';
  } else {
    try {
      const url = new URL(apiBase);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) {
        errors.apiBase = 'API 地址需要以 https:// 或 http:// 开头。';
      } else if (url.username || url.password || url.search || url.hash) {
        errors.apiBase = '请填写不含账号、参数或锚点的 API 基础地址。';
      }
    } catch {
      errors.apiBase = '请填写完整、有效的 API 地址。';
    }
  }

  if (!String(config.model ?? '').trim()) {
    errors.model = '请填写模型名。';
  }

  if (!String(config.apiKey ?? '').trim()) {
    errors.apiKey = '请填写 API Key。';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
