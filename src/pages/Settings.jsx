import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Download, Upload, Trash2 } from 'lucide-react';
import ModelForm from '../components/ModelForm';
import ConfirmDialog from '../components/ConfirmDialog';
import ThemeSettings from '../components/ThemeSettings.jsx';
import { useAppStore } from '../store/appStore';
import { SUBJECTS } from '../core/config/subject.js';
import { resetTour } from '../components/AppTour.jsx';
import { version } from '../../package.json';
import { exportBackupFile } from '../core/platform/backup.js';
import { checkForUpdate, readPendingUpdate, savePendingUpdate } from '../core/update/check.js';
import QueueDiagnostics from '../components/QueueDiagnostics.jsx';

export default function Settings({ onClose }) {
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
  const [aboutOpen, setAboutOpen] = useState(false);
  // 隐藏诊断入口：2 秒内在版本号那一行连点 5 次。只数点击，不改任何判定。
  const [diagOpen, setDiagOpen] = useState(false);
  const versionTaps = useRef({ count: 0, at: 0 });
  // 已知的新版本：启动时的静默检查会先落盘，这里一进设置就能看到，不必再联网。
  const [update, setUpdate] = useState(() => readPendingUpdate());
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState('');
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

  async function checkUpdate() {
    if (checking) return;
    setChecking(true);
    setCheckNote('');
    const result = await checkForUpdate({ current: version });
    setChecking(false);
    if (result.status === 'available') {
      setUpdate(result.release);
      savePendingUpdate(result.release);
      return;
    }
    if (result.status === 'current') {
      setUpdate(null);
      savePendingUpdate(null);
      setCheckNote('已是最新');
      return;
    }
    // 还没有发布过 Release、被限流、或单纯的网络问题：都说同一句话，不吓人。
    setCheckNote(result.status === 'none' ? '暂无新版本' : '暂时无法检查');
  }

  return (
    <main className="page settings-page">
      <header className="page-header">
        <button className="icon-button" type="button" aria-label="返回" disabled={busy} onClick={onClose || closeSettings}>
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
            <button className="settings-row" type="button" data-tour="backup" disabled={busy} onClick={() => runOperation(async () => exportBackupFile(await exportData()), '备份已导出。')}>
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
          <p className="field-hint muted">备份含会话、题图、学习记录、收藏和个人易错点，不含 API Key。导入时保留本机已有配置，新设备需填写 Key。</p>
          <p className="field-hint muted" role="status" aria-live="polite">
            {busy && !feedback ? '正在处理本地数据…' : feedback || storageError || (storageStatus === 'saving' ? '正在保存…' : '')}
          </p>
          {storageStatus === 'error' && <button className="button button-secondary storage-retry" type="button" disabled={busy} onClick={() => runOperation(retryStorage, '本地数据已重新读取或保存。')}>重试</button>}
          <input ref={fileRef} type="file" accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream" hidden onChange={(event) => { chooseBackup(event.target.files?.[0]); event.target.value = ''; }} />
        </section>

        <section className="settings-group" aria-labelledby={`${id}-subject`}>
          <h2 className="settings-group-title" id={`${id}-subject`}>学科</h2>
          <SubjectSettings disabled={busy || !storageInitialized} />
        </section>

        <section className="settings-group" aria-labelledby={`${id}-about`}>
          <h2 className="settings-group-title" id={`${id}-about`}>关于</h2>
          <div className="settings-card settings-list settings-about">
            <button className="settings-row" type="button" disabled={busy} onClick={() => {
              // 重看引导：先清标记再让外层打开引导层，设置页同时收起。
              resetTour(); closeSettings(); window.dispatchEvent(new Event('mathmyth:tour'))
            }}><span>重新观看使用引导</span></button>
            <button type="button" className={'settings-row settings-about-summary' + (aboutOpen ? ' fold-open' : '')} aria-expanded={aboutOpen} aria-label="版本与开发者信息" onClick={() => {
              // 连点 5 次（每次间隔 <2s）打开队列诊断页；正常点一次仍然只是展开/收起。
              const now = Date.now();
              const taps = versionTaps.current;
              taps.count = now - taps.at <= 2000 ? taps.count + 1 : 1;
              taps.at = now;
              if (taps.count >= 5) { taps.count = 0; setDiagOpen(true); return; }
              setAboutOpen((value) => !value);
            }}>
              <span>版本</span>
              <span className="muted settings-row-value">{version}{update ? ' · 可更新到 ' + update.version : ''}<span className="fold-chevron" aria-hidden="true">›</span></span>
            </button>
            <div className={'fold' + (aboutOpen ? ' is-open' : '')}><div className="settings-about-details">
            <button type="button" className="settings-row" disabled={checking} onClick={checkUpdate}>
              <span>检查更新</span>
              <span className="muted settings-row-value">{checking ? '检查中…' : checkNote || (update ? 'v' + update.version : '')}</span>
            </button>
            {update && (update.downloadUrl || update.pageUrl) && <a className="settings-row settings-about-link" href={update.downloadUrl || update.pageUrl} target="_blank" rel="noopener noreferrer" aria-label={'下载 ' + update.version}>
              <span>下载 {update.version}</span>
              <span className="muted settings-row-value">APK</span>
            </a>}
            {update && update.notes && <p className="field-hint muted update-notes">{update.notes}</p>}
            <div className="settings-row">
              <span>开发者</span>
              <span className="muted settings-row-value">AIRA</span>
            </div>
            <a className="settings-row settings-about-link" href="https://github.com/AIRA-81920" target="_blank" rel="noopener noreferrer" aria-label="查看开发者 AIRA 的 GitHub">
              <span>GitHub</span>
              <span className="muted settings-row-value">AIRA-81920</span>
            </a>
            </div></div>
          </div>
        </section>
      </div>

      {/* 诊断页不受 storageStatus 限制：存储错误时它更要能打开，只是数据库统计会显示读取失败。 */}
      {diagOpen && <QueueDiagnostics onClose={() => setDiagOpen(false)} />}
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
        description={`备份里有 ${pendingImport?.summary?.conversationCount ?? 0} 个会话、${pendingImport?.summary?.imageCount ?? 0} 张原图、${pendingImport?.summary?.personalNoteCount ?? 0} 条个人易错点。导入只替换对话与学习记录，这台设备上已填好的模型设置保持不变。`}
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

// 学科切换只改偏好，不改数据库结构：两套骨架的节点 ID 自带命名空间，
// 学习记录按 ID 自然分开；会话历史仍是共享的。
function SubjectSettings({ disabled }) {
  const subject = useAppStore((state) => state.preferences.subject);
  const setSubject = useAppStore((state) => state.setSubject);
  return <>
    <div className="settings-card settings-list" role="group" aria-label="学科">
      {SUBJECTS.map((entry) => (
        <button key={entry.id} type="button" className={'settings-row' + (subject === entry.id ? ' is-selected' : '')}
          aria-pressed={subject === entry.id} disabled={disabled}
          onClick={() => { if (subject !== entry.id) setSubject(entry.id); }}>
          <span>{entry.name}</span>
          <span className="muted settings-row-value">{subject === entry.id ? '当前' : entry.description}</span>
        </button>
      ))}
    </div>
    <p className="field-hint muted">切换后，知识骨架、方法讲解与练习入口都会换成对应学科。</p>
  </>;
}

