import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { providers, validateModelConfig } from '../core/config/providers';
import { testConnection as requestConnectionTest } from '../core/ai/client';
import { useAppStore } from '../store/appStore';

export default function ModelForm({ onStart }) {
  const modelConfig = useAppStore((state) => state.modelConfig);
  const setModelConfig = useAppStore((state) => state.setModelConfig);
  const selectProvider = useAppStore((state) => state.selectProvider);
  const [showKey, setShowKey] = useState(false);
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const formRef = useRef(null);
  const testVersionRef = useRef(0);
  const testControllerRef = useRef(null);
  const id = useId();
  const configSignature = JSON.stringify(modelConfig);
  const currentSignatureRef = useRef(configSignature);
  currentSignatureRef.current = configSignature;

  useEffect(() => {
    testControllerRef.current?.abort();
    testVersionRef.current += 1;
    setFeedback(null);
    return () => {
      testVersionRef.current += 1;
      testControllerRef.current?.abort();
    };
  }, [configSignature]);

  const provider = providers.find((item) => item.id === modelConfig.providerId);
  let imageHint = '图片能力请按所填模型确认';
  if (modelConfig.model === provider?.defaultModel && provider?.defaultModel) {
    imageHint = provider.imageHint
      || (provider.imageCapability === true
        ? '该预设模型支持图片，可按需勾选'
        : provider.imageCapability === false
          ? '该预设模型仅支持文本'
          : imageHint);
  }

  function updateConfig(patch) {
    testVersionRef.current += 1;
    setFeedback(null);
    setErrors({});
    setModelConfig(patch);
  }

  function checkFields() {
    const result = validateModelConfig(modelConfig);
    setErrors(result.errors);
    if (!result.valid) {
      const firstField = Object.keys(result.errors)[0];
      formRef.current?.elements.namedItem(firstField)?.focus();
    }
    return result.valid;
  }

  async function testConnection() {
    if (!checkFields()) return;
    const testVersion = ++testVersionRef.current;
    const signature = configSignature;
    const controller = new AbortController();
    testControllerRef.current?.abort();
    testControllerRef.current = controller;
    setFeedback({ status: 'testing', message: '正在连接模型…' });

    try {
      const result = await requestConnectionTest({ ...modelConfig }, { signal: controller.signal });
      if (testVersion !== testVersionRef.current || signature !== currentSignatureRef.current) return;
      setFeedback({ status: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      if (testVersion !== testVersionRef.current || signature !== currentSignatureRef.current) return;
      if (controller.signal.aborted) return;
      setFeedback({ status: 'error', message: error.userMessage || '连接失败，请检查网络和模型设置后重试。' });
    } finally {
      if (testControllerRef.current === controller) testControllerRef.current = null;
    }
  }

  function start(event) {
    event.preventDefault();
    if (onStart && checkFields()) onStart();
  }

  return (
    <form className="model-form" ref={formRef} onSubmit={start} noValidate>
      <div className="form-field">
        <label className="field-label" htmlFor={`${id}-provider`}>服务商</label>
        <select
          className="field-control"
          id={`${id}-provider`}
          name="providerId"
          value={modelConfig.providerId}
          onChange={(event) => {
            testVersionRef.current += 1;
            setFeedback(null);
            setErrors({});
            selectProvider(event.target.value);
          }}
        >
          {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>

      {modelConfig.providerId === 'custom' && (
        <div className="form-field">
          <label className="field-label" htmlFor={`${id}-apiBase`}>API 地址</label>
          <input
            className="field-control"
            id={`${id}-apiBase`}
            name="apiBase"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/v1"
            value={modelConfig.apiBase}
            aria-invalid={Boolean(errors.apiBase)}
            aria-describedby={errors.apiBase ? `${id}-apiBase-error` : undefined}
            onChange={(event) => updateConfig({ apiBase: event.target.value })}
          />
          {errors.apiBase && <p className="field-error" id={`${id}-apiBase-error`}>{errors.apiBase}</p>}
        </div>
      )}

      <div className="form-field">
        <label className="field-label" htmlFor={`${id}-model`}>模型名</label>
        <input
          className="field-control"
          id={`${id}-model`}
          name="model"
          autoComplete="off"
          spellCheck={false}
          placeholder="填写模型名"
          value={modelConfig.model}
          aria-invalid={Boolean(errors.model)}
          aria-describedby={`${id}-image-hint${errors.model ? ` ${id}-model-error` : ''}`}
          onChange={(event) => updateConfig({ model: event.target.value })}
        />
        <p className="field-hint muted" id={`${id}-image-hint`}>{imageHint}</p>
        {errors.model && <p className="field-error" id={`${id}-model-error`}>{errors.model}</p>}
      </div>

      <div className="form-field">
        <label className="field-label" htmlFor={`${id}-apiKey`}>API Key</label>
        <div className="secret-field">
          <input
            className="field-control"
            id={`${id}-apiKey`}
            name="apiKey"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="sk-…"
            value={modelConfig.apiKey}
            aria-invalid={Boolean(errors.apiKey)}
            aria-describedby={errors.apiKey ? `${id}-apiKey-error` : undefined}
            onChange={(event) => updateConfig({ apiKey: event.target.value })}
          />
          <button
            className="icon-button secret-toggle"
            type="button"
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            aria-pressed={showKey}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {errors.apiKey && <p className="field-error" id={`${id}-apiKey-error`}>{errors.apiKey}</p>}
      </div>

      <label className="switch-row" htmlFor={`${id}-supportsImage`}>
        <span>这个模型支持图片</span>
        <input
          className="switch-control"
          id={`${id}-supportsImage`}
          name="supportsImage"
          type="checkbox"
          role="switch"
          checked={modelConfig.supportsImage}
          onChange={(event) => updateConfig({ supportsImage: event.target.checked })}
        />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </label>

      {!onStart && <details className="auxiliary-settings">
        <summary>标题与归类</summary>
        <div className="form-field">
          <label className="field-label" htmlFor={`${id}-auxiliary-model`}>辅助模型（可选）</label>
          <input id={`${id}-auxiliary-model`} className="field-control" value={modelConfig.auxiliaryModel || ''} placeholder="留空则自动选择" autoComplete="off" spellCheck={false} onChange={(event) => updateConfig({ auxiliaryModel: event.target.value })} />
          <p className="field-hint muted">与答疑共用服务商和 Key。Kimi K3 的辅助任务默认使用可关闭思考的 K2.6。</p>
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor={`${id}-auxiliary-thinking`}>关闭思考的接口格式</label>
          <select id={`${id}-auxiliary-thinking`} className="field-control" value={modelConfig.auxiliaryThinking || 'auto'} onChange={(event) => updateConfig({ auxiliaryThinking: event.target.value })}>
            <option value="auto">自动适配官方接口</option><option value="thinking">thinking.type = disabled</option>
            <option value="enable_thinking">enable_thinking = false</option><option value="chat_template">chat_template_kwargs.enable_thinking = false</option><option value="none">不附加字段（非思考模型）</option>
          </select>
          <p className="field-hint muted">网关或自定义地址可按其文档选择；纯思考模型可能无法关闭。</p>
        </div>
      </details>}
      <div className="form-actions">
        {onStart && <button className="button button-primary" type="submit">开始使用</button>}
        <button
          className="button button-secondary"
          type="button"
          disabled={feedback?.status === 'testing'}
          onClick={testConnection}
        >
          {feedback?.status === 'testing' ? '正在测试…' : '测试一下'}
        </button>
      </div>
      <div className="form-feedback" role="status" aria-live="polite" aria-atomic="true">
        {feedback && <p>{feedback.message}</p>}
      </div>
    </form>
  );
}
