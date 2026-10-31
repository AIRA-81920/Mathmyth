import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Upload, Trash2 } from 'lucide-react';
import ModelForm from '../components/ModelForm';
import ConfirmDialog from '../components/ConfirmDialog';
import ModalFrame from '../components/ModalFrame.jsx';
import { useAppStore } from '../store/appStore';
import { SUBJECTS } from '../core/config/subject.js';
import { resetTour } from '../components/AppTour.jsx';
import { version } from '../../package.json';
import { exportBackupFile } from '../core/platform/backup.js';
import { transitionTheme } from '../core/ui/themeTransition.js';
import { checkForUpdate, readPendingUpdate, savePendingUpdate } from '../core/update/check.js';

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
            <button type="button" className={'settings-row settings-about-summary' + (aboutOpen ? ' fold-open' : '')} aria-expanded={aboutOpen} aria-label="版本与开发者信息" onClick={() => setAboutOpen((value) => !value)}>
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

function ThemeSettings({ disabled }) {
  const theme = useAppStore((state) => state.preferences.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const temperature = useAppStore((state) => state.preferences.lightTemperature);
  const setTemperature = useAppStore((state) => state.setLightTemperature);
  const [temperatureOpen, setTemperatureOpen] = useState(false);
  const consumed = useRef(false);
  const optionsRef = useRef(null), indicatorRef = useRef(null);
  const themeRef = useRef(theme);
  const openRef = useRef(() => {});
  const settleRef = useRef(() => {});
  const inkCanvas = useRef(null);
  themeRef.current = theme;
  // 指示线：长度直接写 width，不用 scaleX。
  // 1px 宽的元素加 scaleX(26) 时，布局算出来 78 个设备像素、屏幕却画 104 个
  // （合成层按 4/3 拉伸），右边整整多出一截——这就是"偏几像素"的真身。
  // 长度取“字形墨迹”（canvas actualBoundingBox）而不是字框：
  // 中文字体在字框两边留白并不对称，只有墨迹才是眼睛看到的那条边界。
  function measureInk(label) {
    const text = label.textContent || '';
    const box = label.getBoundingClientRect();
    if (!text) return null;
    const canvas = inkCanvas.current || (inkCanvas.current = document.createElement('canvas'));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    // 按屏幕像素密度画，再逐列扫 alpha：actualBoundingBox 会把抗锯齿的外沿
    // 也算进墨迹（实测宽 6 个设备像素），只有扫描才拿到眼睛看到的那条边。
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    context.font = getComputedStyle(label).font;
    const advance = context.measureText(text).width;
    const pad = 6, height = 40;
    canvas.width = Math.ceil((advance + pad * 2) * ratio);
    canvas.height = Math.ceil(height * ratio);
    context.font = getComputedStyle(label).font;
    context.textBaseline = 'middle';
    context.fillStyle = '#000';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, advance + pad * 2, height);
    context.fillText(text, pad, height / 2);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = -1, last = -1;
    for (let x = 0; x < canvas.width; x += 1) {
      let inked = false;
      for (let y = 0; y < canvas.height; y += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 96) { inked = true; break; }
      }
      if (inked) { if (first < 0) first = x; last = x; }
    }
    if (first < 0) return null;
    const left = first / ratio - pad;
    const width = (last - first + 1) / ratio;
    // 画布和 DOM 解析到不同字体时墨迹会离谱地偏；这种时候宁可退回字框。
    if (!Number.isFinite(width) || width <= 0 || width < box.width * 0.55 || width > box.width * 1.15) return null;
    return { left, width };
  }
  function readTarget() {
    const container = optionsRef.current;
    if (!container || !indicatorRef.current) return null;
    const button = [...container.querySelectorAll('button')].find((node) => node.dataset.themeValue === themeRef.current);
    const label = button?.querySelector('.theme-label');
    if (!label) return null;
    const box = container.getBoundingClientRect(), rect = label.getBoundingClientRect();
    const ink = measureInk(label);
    // 绝对定位的 left:0 从“内边距盒”起算，而 getBoundingClientRect 给的是边框盒：
    // 这个卡片有 1px 边框，不减掉 clientLeft，整条线就固定右偏 1px。
    const originX = rect.left - box.left - container.clientLeft;
    return {
      left: originX + (ink ? ink.left : 0),
      width: ink ? ink.width : rect.width,
      top: rect.bottom - box.top - container.clientTop + 6,
    };
  }
  function placeTarget(target) {
    const indicator = indicatorRef.current;
    if (!indicator || !target) return;
    indicator.style.top = target.top + 'px';
    indicator.style.left = target.left + 'px';
    indicator.style.width = target.width + 'px';
  }
  settleRef.current = () => placeTarget(readTarget());
  useLayoutEffect(() => {
    const container = optionsRef.current, indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const target = readTarget();
    if (!target) return;
    // 起点一律读“实际矩形”，不记状态：连续快速切换时上一次动画会被 cancel，
    // 如果拿记下的终点当起点，就会从错误的位置起跳，看起来就是偏。
    const box = container.getBoundingClientRect();
    const currentRect = indicator.getBoundingClientRect();
    const from = currentRect.width > 0
      ? { left: currentRect.left - box.left - container.clientLeft, width: currentRect.width }
      : null;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    indicator.getAnimations().forEach((animation) => animation.cancel());
    if (!from || reduced) { placeTarget(target); return; }
    indicator.style.top = target.top + 'px';
    // 滑动中收到 0.5 倍、抵达再展开：中点那一帧的宽度减半，左右各收一点。
    const centreMid = (from.left + from.width / 2 + target.left + target.width / 2) / 2;
    const widthMid = ((from.width + target.width) / 2) * 0.5;
    const animation = indicator.animate([
      { left: from.left + 'px', width: from.width + 'px' },
      { left: (centreMid - widthMid / 2) + 'px', width: widthMid + 'px', offset: 0.5 },
      { left: target.left + 'px', width: target.width + 'px' },
    ], { duration: 440, easing: 'cubic-bezier(0.34,0.9,0.4,1)', fill: 'both' });
    animation.finished.catch(() => {}).then(() => { animation.cancel(); settleRef.current(); });
  }, [theme, disabled]);
  // 只量一次是不够的：安卓的中文字体回退是异步的，粗细切换也会改变字宽，
  // 文字变了而线没跟上，看起来就是“偏了几像素”。任何一次尺寸变化都重新落位。
  useEffect(() => {
    const container = optionsRef.current, indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const observer = new ResizeObserver(() => {
      if (indicator.getAnimations().length) return; // 正在滑：等它收尾再量
      settleRef.current();
    });
    observer.observe(container);
    for (const node of container.querySelectorAll('button')) observer.observe(node);
    document.fonts?.ready.then(() => { if (!indicator.getAnimations().length) settleRef.current(); }).catch(() => {});
    return () => observer.disconnect();
  }, []);
  function openTemperature() {
    if (disabled) return;
    consumed.current = true;
    // 面板先出来，主题随后直接写。之前是"先跑一圈圆形展开的 View Transition
    // 再开面板"：安卓的 WebView 里那圈全屏快照有把面板压住的风险，
    // 而长按本身已经说明意图，不需要那圈动画。
    setTemperatureOpen(true);
    if (themeRef.current !== 'light') setTheme('light');
  }
  openRef.current = openTemperature;
  // 长按“浅色”打开色温面板。手势挂在 document 上而不是按钮上：
  // 安卓 WebView 按住一会儿会补发 pointercancel（它以为你要选文字），
  // 只要按钮上的 pointer 事件被这一下取消，按住就永远没反应——
  // 之前三次修的正是这里，但每次都在"用 pointer 的取消语义"这条路上。
  // 现在只在"手指真的移动了 14px"或"页面真的滚动了"时才放弃，其余一律等满 500ms。
  useEffect(() => {
    if (disabled) return;
    const HOLD_MS = 500;
    let timer = null, startX = 0, startY = 0, startScroll = 0;
    const onLight = (node) => node instanceof Element && Boolean(node.closest('[data-theme-value="light"]'));
    const scroller = () => document.querySelector('.settings-content');
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const begin = (event) => {
      if (!onLight(event.target)) return;
      const point = event.touches ? event.touches[0] : event;
      if (!point) return;
      stop();
      consumed.current = false;
      startX = point.clientX; startY = point.clientY;
      startScroll = scroller()?.scrollTop ?? 0;
      timer = setTimeout(() => {
        timer = null;
        // 滚动被浏览器接管后就不再发移动事件了，用滚动位置兜住这一种。
        if ((scroller()?.scrollTop ?? 0) !== startScroll) return;
        openRef.current();
      }, HOLD_MS);
    };
    const move = (event) => {
      if (!timer) return;
      const point = event.touches ? event.touches[0] : event;
      if (!point) return;
      if (Math.hypot(point.clientX - startX, point.clientY - startY) > 14) stop();
    };
    const release = () => { stop(); };
    const menu = (event) => {
      if (!onLight(event.target)) return;
      event.preventDefault();
      stop();
      openRef.current();
    };
    document.addEventListener('pointerdown', begin, true);
    document.addEventListener('touchstart', begin, { capture: true, passive: true });
    document.addEventListener('pointermove', move, { capture: true, passive: true });
    document.addEventListener('touchmove', move, { capture: true, passive: true });
    document.addEventListener('pointerup', release, true);
    document.addEventListener('touchend', release, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      stop();
      document.removeEventListener('pointerdown', begin, true);
      document.removeEventListener('touchstart', begin, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('touchend', release, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }, [disabled]);
  return <><div ref={optionsRef} className="settings-card theme-options" role="group" aria-label="主题">
    {[['light','浅色'],['dark','深色'],['system','跟随系统']].map(([value,label]) =>
      <button key={value} type="button" data-theme-value={value} className={theme === value ? 'is-selected' : ''} aria-pressed={theme === value} disabled={disabled}
        aria-haspopup={value === 'light' ? 'dialog' : undefined}
        onKeyDown={value === 'light' ? (event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openTemperature(); } } : undefined}
        onClick={(event) => {
        if (value === 'light' && consumed.current) { consumed.current = false; return; }
        if (theme === value) return;
        const rect = event.currentTarget.getBoundingClientRect();
        transitionTheme(value, setTheme, { x: event.detail ? event.clientX : rect.left + rect.width / 2, y: event.detail ? event.clientY : rect.top + rect.height / 2 });
      }}><span className="theme-label">{label}</span></button>)}
    <span ref={indicatorRef} className="theme-indicator" aria-hidden="true" />
  </div>
  <ModalFrame open={temperatureOpen} titleId="light-temperature-title" className="confirm-dialog light-temperature-dialog" onClose={() => { setTemperatureOpen(false); consumed.current = false; }}>
    <h2 id="light-temperature-title">浅色色温</h2>
    <div className="light-temperature-labels"><span>偏冷</span><span>偏暖</span></div>
    <input aria-label="浅色色温" type="range" min="0" max="100" step="1" value={temperature} disabled={disabled} onChange={event => setTemperature(Number(event.target.value))} />
    <p className="field-hint">拖动预览，自动保存。</p>
    <div className="dialog-actions"><button type="button" className="button button-primary" onClick={() => { setTemperatureOpen(false); consumed.current = false; }}>完成</button></div>
  </ModalFrame></>;
}
