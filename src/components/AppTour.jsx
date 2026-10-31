import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

// 只跑一次的标记放在 localStorage：它属于"这台设备的界面状态"，
// 不该进数据库、也不该跟着备份跑到另一台机器上。
const KEY = 'mathmyth.tour.v1';
export const tourDone = () => { try { return localStorage.getItem(KEY) === 'done'; } catch { return true; } };
export const resetTour = () => { try { localStorage.removeItem(KEY); } catch { /* 隐私模式：跳过即可 */ } };
const markDone = () => { try { localStorage.setItem(KEY, 'done'); } catch { /* 同上 */ } };

// 每一步只做两件事：高亮一个真实控件 + 说一句话。需要换页的那几步先把界面
// 切过去，再测量位置——所有操作都是应用自己的动作，不模拟点击。
// 示例题面用 String.raw，避免转义被 JS 吃掉
const DEMO_NOTE = '例：一道 x→0 的根式差题（√(1+sin x)−1 比 x），走过上面这条路径。';
const STEPS = [
  { target: '[aria-label="主要区域"]', title: '三个区域：问答 / 练习 / 足迹',
    body: '提问在「问答」，练题在「练习」，复习走「足迹」。顶部这一排随时切换。' },
  { target: '.composer textarea', title: '把题发进来',
    body: '文字直接输入，也可以拍照、截图或传文件。', note: '答完可以在回答下面接着练这道题。' },
  { target: 'button[aria-label="添加附件"]', title: '图片从这里上传',
    body: '点这个 ＋，会出现最近图片、拍照、相册和文件。', note: '带图片的题，模型会同时看到图和文字。' },
  { target: '.practice-entry', title: '同一道题，练到会',
    body: '练习页里可以直接拿这道题练：写完整步骤，或先判断该怎么下手。', note: '卡住有分级提示；用过提示会被记录下来。',
    before: () => useAppStore.getState().setActiveArea('practice'), cleanup: () => useAppStore.getState().setActiveArea('ask') },
  { target: '.tour-demo', title: '足迹：找回用过的思路',
    body: '每道题都留下"题 → 方法 → 情景"的路径，复习时从这里进。',
    note: '下面是示例（一道极限题走过的路）；你自己的足迹要问过题之后才会长出来。',
    demo: true,
    before: () => useAppStore.getState().setActiveArea('trail'),
    cleanup: () => useAppStore.getState().setActiveArea('ask') },
  { target: '[aria-label="历史与设置"]', title: '历史与设置都在左上角',
    body: '这里能看到所有对话，也能进设置。', note: '对话长按可以改标题、删除。' },
  { target: '[data-tour="backup"]', title: '别忘了备份',
    body: '设置 → 数据 → 导出到文件，会把整库存成一个文件。', note: '换手机或重装前导出一次，导入后学习和练习记录都还在。',
    before: () => useAppStore.getState().openSettings(), cleanup: () => useAppStore.getState().closeSettings() },
];

const PAD = 8;
const CALLOUT_WIDTH = 320;

export default function AppTour({ onDone }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const calloutRef = useRef(null);
  const [calloutHeight, setCalloutHeight] = useState(190);
  const step = STEPS[index];

  const scrolledRef = useRef(-1);
  const measure = useCallback(() => {
    const element = document.querySelector(STEPS[index].target);
    if (!element) { setRect(null); return; }
    let box = element.getBoundingClientRect();
    // 目标可能在折叠线以下（设置页的"数据"那一段）：先滚到视野中间再测量，
    // 否则聚光圈会画在屏幕外面，用户只看到一块黑。
    if ((box.top < 8 || box.bottom > window.innerHeight - 8) && scrolledRef.current !== index) {
      scrolledRef.current = index;
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      box = element.getBoundingClientRect();
    }
    if (!box.width && !box.height) { setRect(null); return; }
    setRect({ x: box.left, y: box.top, w: box.width, h: box.height });
  }, [index]);

  // 目标控件可能刚被切页/开设置挂载出来，所以先立刻量一次，再在 1.2s 内补量。
  useEffect(() => {
    measure();
    let frames = 0;
    const tick = () => { measure(); if (++frames < 45) requestAnimationFrame(tick); };
    const handle = requestAnimationFrame(tick);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => { cancelAnimationFrame(handle); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  }, [measure]);

  useEffect(() => { if (calloutRef.current) setCalloutHeight(calloutRef.current.offsetHeight || 190); }, [index, rect]);
  useEffect(() => { scrolledRef.current = -1; }, [index]);

  const finish = useCallback(() => { markDone(); step.cleanup?.(); onDone?.(); }, [onDone, step]);

  const go = useCallback((next) => {
    if (next < 0 || next >= STEPS.length) return;
    STEPS[index].cleanup?.();
    setRect(null);
    setIndex(next);
    STEPS[next].before?.();
  }, [index]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); index === STEPS.length - 1 ? finish() : go(index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, go, index]);

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const ring = rect ? { left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 } : null;
  let placement = { left: viewport.width / 2 - CALLOUT_WIDTH / 2, top: viewport.height / 2 - calloutHeight / 2 };
  if (ring) {
    const below = ring.top + ring.height + 12;
    const above = ring.top - calloutHeight - 12;
    const top = below + calloutHeight < viewport.height - 12 || above < 12 ? below : above;
    const left = Math.min(Math.max(12, ring.left + ring.width / 2 - CALLOUT_WIDTH / 2), viewport.width - CALLOUT_WIDTH - 12);
    placement = { left, top: Math.min(Math.max(12, top), viewport.height - calloutHeight - 12) };
  }

  return <div className="tour-root">
    <div className="tour-blocker" aria-hidden="true" />
    {step.demo && <div className="tour-demo" aria-label="足迹示例（不是你的数据）">
      <p className="tour-demo-tag">示例 · 不是你的数据</p>
      <p className="tour-demo-row"><span>极限</span><span>未定式极限</span><span>0/0 型未定式</span><span>等价无穷小替换</span></p>
      <p className="tour-demo-note">{DEMO_NOTE}</p>
    </div>}
    {ring && <div className="tour-ring" style={ring} aria-hidden="true" />}
    <div className="tour-callout" ref={calloutRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" style={placement}>
      <p className="tour-progress">第 {index + 1} / {STEPS.length} 步</p>
      <h2 id="tour-title">{step.title}</h2>
      <p className="tour-body">{step.body}</p>
      {step.note && <p className="tour-note">{step.note}</p>}
      <div className="tour-actions">
        <button type="button" className="practice-text-button" onClick={finish}>跳过</button>
        <div className="tour-nav">
          <button type="button" className="button button-secondary" disabled={index === 0} onClick={() => go(index - 1)}>上一步</button>
          <button type="button" className="button button-primary" autoFocus
            onClick={() => index === STEPS.length - 1 ? finish() : go(index + 1)}>{index === STEPS.length - 1 ? '开始使用' : '下一步'}</button>
        </div>
      </div>
    </div>
  </div>;
}
