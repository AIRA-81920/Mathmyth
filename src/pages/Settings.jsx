import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Download, Upload, Trash2 } from 'lucide-react';
import ModelForm from '../components/ModelForm';
import ConfirmDialog from '../components/ConfirmDialog';
import ModalFrame from '../components/ModalFrame.jsx';
import { useAppStore } from '../store/appStore';
import { version } from '../../package.json';
import { exportBackupFile } from '../core/platform/backup.js';
import { transitionTheme } from '../core/ui/themeTransition.js';

export default function Settings() {
  const closeSettings = useAppStore((state) => state.closeSettings);
  const clearAllData = useAppStore((state) => state.clearAllData);
  const exportData = useAppStore((state) => state.exportData);
  const prepareImport = useAppStore((state) => state.prepareImport);
  const confirmImport = useAppStore((state) => state.confirmImport);
  const cancelImport = useAppStore((state) => state.cancelImport);
  const retryStorage = useAppStore((state) => state.retryStorage);
  const storageStatus = useAppStore((state) => state.storageStatus);
  const storageError = useAppStore((state) => state.storageError);
  const storageInitialized = useAppStore((state) => state.storageInitialized);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const fileRef = useRef(null);
  const operationRef = useRef({ version: 0, importToken: null });
  const id = useId();

  useEffect(() => () => {
    operationRef.current.version += 1;
    if (operationRef.current.importToken) {
      Promise.resolve(cancelImport(operationRef.current.importToken)).catch(() => {});
    }
  }, [cancelImport]);

  async function runOperation(action, successMessage) {
    if (busy) return;
    const current = ++operationRef.current.version;
    setBusy(true);
    setFeedback('');
    try {
      const result = await action();
      if (operationRef.current.version === current) setFeedback(typeof result === 'string' ? result : successMessage);
    } catch (error) {
      if (operationRef.current.version === current) {
        setFeedback(error?.userMessage || '本地数据操作没有完成，请重试。');
      }
    } finally {
      if (operationRef.current.version === current) setBusy(false);
    }
  }

  async function chooseBackup(file) {
    if (!file || busy) return;
    const current = ++operationRef.current.version;
    setBusy(true);
    setFeedback('正在检查备份…');
    try {
      const result = await prepareImport(new Uint8Array(await file.arrayBuffer()));
      if (operationRef.current.version !== current) {
        await cancelImport(result.token);
        return;
      }
      operationRef.current.importToken = result.token;
      setPendingImport(result);
      setFeedback('');
    } catch (error) {
      if (operationRef.current.version === current) {
        setFeedback(error?.userMessage || '这个文件无法导入，请选择 Mathmyth 导出的备份。');
      }
    } finally {
      if (operationRef.current.version === current) setBusy(false);
    }
  }

  function discardImport() {
    const token = operationRef.current.importToken;
    operationRef.current.importToken = null;
    setPendingImport(null);
    if (token) Promise.resolve(cancelImport(token)).catch(() => {});
  }

  return (
    <main className="page settings-page">
      <header className="page-header">
        <button className="icon-button" type="button" aria-label="返回" disabled={busy} onClick={closeSettings}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="page-title">设置</h1>
        <span className="header-spacer" aria-hidden="true" />
      </header>

      <div className="settings-content">
        <section className="settings-group" aria-labelledby={`${id}-appearance`}>
          <h2 className="settings-group-title" id={`${id}-appearance`}>外观</h2>
          <ThemeSettings disabled={busy || !storageInitialized} />
        </section>
        <section className="settings-group" aria-labelledby={`${id}-model`}>
          <h2 className="settings-group-title" id={`${id}-model`}>模型</h2>
          <div className="settings-card">
            <fieldset className="model-settings-fieldset" disabled={busy || storageInitialized === false}>
              <ModelForm />
            </fieldset>
          </div>
          <p className="field-hint muted">建议用支持图片、数学能力强的模型</p>
        </section>

        <section className="settings-group" aria-labelledby={`${id}-data`}>
          <h2 className="settings-group-title" id={`${id}-data`}>数据</h2>
          <div className="settings-card settings-list">
            <button className="settings-row" type="button" disabled={busy} onClick={() => runOperation(async () => exportBackupFile(await exportData()), '备份已导出。')}>
              <Download size={18} aria-hidden="true" />
              <span>导出到文件</span>
            </button>
            <button className="settings-row" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload size={18} aria-hidden="true" />
              <span>从文件导入</span>
            </button>
            <button className="settings-row danger-text" type="button" disabled={busy} onClick={() => setConfirmClear(true)}>
              <Trash2 size={18} aria-hidden="true" />
              <span>清空所有数据</span>
            </button>
          </div>
          <p className="field-hint muted">备份包含会话、原图、学习记录、收藏、个人易错点和模型设置，不包含 API Key。导入到其他设备后需重新填写 API Key。</p>
          <p className="field-hint muted" role="status" aria-live="polite">
            {busy && !feedback ? '正在处理本地数据…' : feedback || storageError || (storageStatus === 'saving' ? '正在保存…' : '')}
          </p>
          {storageStatus === 'error' && <button className="button button-secondary storage-retry" type="button" disabled={busy} onClick={() => runOperation(retryStorage, '本地数据已重新读取或保存。')}>重试</button>}
          <input ref={fileRef} type="file" accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream" hidden onChange={(event) => { chooseBackup(event.target.files?.[0]); event.target.value = ''; }} />
        </section>

        <section className="settings-group" aria-labelledby={`${id}-about`}>
          <h2 className="settings-group-title" id={`${id}-about`}>关于</h2>
          <details className="settings-card settings-list settings-about">
            <summary className="settings-row settings-about-summary" aria-label="版本与开发者信息">
              <span>版本</span>
              <span className="muted settings-row-value">{version}</span>
            </summary>
            <div className="settings-about-details">
            <div className="settings-row">
              <span>开发者</span>
              <span className="muted settings-row-value">AIRA</span>
            </div>
            <a className="settings-row settings-about-link" href="https://github.com/AIRA-81920" target="_blank" rel="noopener noreferrer" aria-label="查看开发者 AIRA 的 GitHub">
              <span>GitHub</span>
              <span className="muted settings-row-value">AIRA-81920</span>
            </a>
            </div>
          </details>
        </section>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空所有数据？"
        description="将清空本机的会话、原图、作答记录、收藏、个人易错点和模型配置，回到首启界面。App 内置题库保留；此前的练习次数和进度会清零。"
        confirmLabel="清空所有数据"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          runOperation(clearAllData, '');
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="导入并替换本机数据？"
        description={`备份里有 ${pendingImport?.summary?.conversationCount ?? 0} 个会话、${pendingImport?.summary?.imageCount ?? 0} 张原图、${pendingImport?.summary?.personalNoteCount ?? 0} 条个人易错点。导入会替换本机数据和模型设置。`}
        confirmLabel="导入并替换"
        onCancel={discardImport}
        onConfirm={() => {
          const token = operationRef.current.importToken;
          operationRef.current.importToken = null;
          setPendingImport(null);
          runOperation(async () => {
            try { await confirmImport(token); }
            catch (error) { await cancelImport(token); throw error; }
          }, '备份已导入。');
        }}
      />
    </main>
  );
}

function ThemeSettings({ disabled }) {
  const theme = useAppStore((state) => state.preferences.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const temperature = useAppStore((state) => state.preferences.lightTemperature);
  const setTemperature = useAppStore((state) => state.setLightTemperature);
  const [temperatureOpen, setTemperatureOpen] = useState(false);
  const press = useRef(null), consumed = useRef(false);
  const clearPress = () => { clearTimeout(press.current?.timer); press.current = null; };
  useEffect(() => () => clearPress(), []);
  function openTemperature(point) {
    if (disabled) return;
    consumed.current = true;
    clearPress();
    if (theme !== 'light') transitionTheme('light', setTheme, point);
    setTemperatureOpen(true);
  }
  return <><div className="settings-card theme-options" role="group" aria-label="主题">
    {[['light','浅色'],['dark','深色'],['system','跟随系统']].map(([value,label]) =>
      <button key={value} type="button" className={theme === value ? 'is-selected' : ''} aria-pressed={theme === value} disabled={disabled}
        aria-haspopup={value === 'light' ? 'dialog' : undefined}
        onPointerDown={value === 'light' ? (event) => {
          if (event.button !== 0 || disabled) return;
          clearPress(); consumed.current = false;
          const point = { x: event.clientX, y: event.clientY };
          press.current = { ...point, timer: setTimeout(() => openTemperature(point), 500) };
        } : undefined}
        onPointerMove={(event) => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) clearPress(); }}
        onPointerUp={clearPress} onPointerCancel={clearPress}
        onContextMenu={value === 'light' ? (event) => { event.preventDefault(); openTemperature({ x: event.clientX, y: event.clientY }); } : undefined}
        onKeyDown={value === 'light' ? (event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openTemperature(); } } : undefined}
        onClick={(event) => {
        if (value === 'light' && consumed.current) { consumed.current = false; return; }
        if (theme === value) return;
        const rect = event.currentTarget.getBoundingClientRect();
        transitionTheme(value, setTheme, { x: event.detail ? event.clientX : rect.left + rect.width / 2, y: event.detail ? event.clientY : rect.top + rect.height / 2 });
      }}>{label}</button>)}
  </div>
  <ModalFrame open={temperatureOpen} titleId="light-temperature-title" className="confirm-dialog light-temperature-dialog" onClose={() => { setTemperatureOpen(false); consumed.current = false; }}>
    <h2 id="light-temperature-title">浅色色温</h2>
    <div className="light-temperature-labels"><span>偏冷</span><span>偏暖</span></div>
    <input aria-label="浅色色温" type="range" min="0" max="100" step="1" value={temperature} disabled={disabled} onChange={event => setTemperature(Number(event.target.value))} />
    <p className="field-hint">拖动预览，自动保存。所有档位都保持浅色。</p>
    <div className="dialog-actions"><button type="button" className="button button-primary" onClick={() => { setTemperatureOpen(false); consumed.current = false; }}>完成</button></div>
  </ModalFrame></>;
}
