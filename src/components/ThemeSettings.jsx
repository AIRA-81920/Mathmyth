import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';
import { useAppStore } from '../store/appStore';
import { transitionTheme } from '../core/ui/themeTransition.js';

// 主题三档 + 长按「浅色」调色温。首启页与设置页共用同一份实现：
// 引导里教的那套控件，必须就是设置里那一套，否则"实机"就不成立。
export default function ThemeSettings({ disabled }) {
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
