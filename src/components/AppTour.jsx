import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { clearPendingGuide } from '../core/onboarding/questionPool.js';

// 只跑一次的标记放在 localStorage：它属于"这台设备的界面状态"，
// 不该进数据库、也不该跟着备份跑到另一台机器上。
// 跳过和看完分开记：两个状态都停止主动重复引导，但含义不同，将来要靠它
// 决定"是不是该换个时机再带一次"。
const KEY = 'mathmyth.tour.v2';
// 上一版是 7 步讲解（v1）。已经跑过旧版的人不再被新版推一遍：
// 新版只对"刚配置完、第一次进来"的人生效，其他人从设置里重看。
const LEGACY_KEY = 'mathmyth.tour.v1';

export const tourStatus = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return localStorage.getItem(LEGACY_KEY) === 'done' ? 'done' : null;
    const value = JSON.parse(raw);
    return value?.status === 'done' || value?.status === 'skipped' ? value.status : null;
  } catch { return 'done'; /* 隐私模式下读不到偏好：当作已经看过，不打扰 */ }
};
export const tourDone = () => tourStatus() !== null;
export const resetTour = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* 隐私模式：跳过即可 */ }
};
const markTour = (status) => {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 2, status, at: Date.now() })); } catch { /* 同上 */ }
};

const state = () => useAppStore.getState();
const messages = () => state().conversations.find((one) => one.id === state().currentConversationId)?.messages ?? [];
const userCount = () => messages().filter((message) => message.role === 'user').length;

// 每一步只做一件事：指着一个真实控件说一句话，等用户真的做。
// kind='action' 没有"下一步"按钮——事件到了才走；kind='note' 只是旁注，
// 用户看完点"继续"，不逼他做任何动作。
const STEPS = [
  {
    id: 'send', kind: 'action', target: '.composer .send-button',
    title: '把这道题发出去',
    body: '输入框里是一道示例题，不用改，点右边的发送。',
    note: '思考模式已经打开了，它会多想一会儿。这期间退出，这次回答就没了。',
    // 从设置里重看引导时没有预置题面，这一步的说法要换。
    plain: { body: '先发一道你自己的题，我们边走边看。', note: '答题期间退出，这次回答就没了。' },
    done: (base) => userCount() > base.users || state().streamingCount > 0,
  },
  {
    id: 'attach', kind: 'action', target: 'button[aria-label="添加附件"]',
    title: '趁它还在想，看看图怎么进来',
    body: '点这个 ＋：最近图片、拍照、相册、文件都在这儿。选中图片后还能点一下裁切。',
    note: '这张图只是看看效果，不会跟着这道题发出去。简单的题不必开思考，左下角就能关。',
    done: () => Boolean(document.querySelector('#attachment-panel.is-open')),
  },
  {
    id: 'routes', kind: 'action', target: '.answer-learning .question-route-toggle',
    title: '答案下面这一条，是这道题的路径',
    body: '它把题归进一个情景，再往下串方法。点开看看。',
    waiting: '它还在写。写完这里就会出现「查看本题路径」，到时候再点。',
    done: () => Boolean(document.querySelector('.answer-learning .question-route-toggle[aria-expanded="true"]')),
  },
  {
    id: 'locate', kind: 'action', target: '.question-route-locate',
    title: '把它放进足迹',
    body: '点这个，这道题走过的路就记进足迹，以后还能找回来。',
    done: (base) => state().activeArea === 'trail' && Boolean(state().trailFocus) && state().trailFocus !== base.trailFocus,
  },
  {
    id: 'trail-forward', kind: 'note', target: '.trail-outline',
    title: '足迹是长出来的，不是搜出来的',
    body: '一个情景往下接方法，方法再落到新的情景。复习就从这条链上找，顶部「足迹」随时能回来。',
  },
  {
    id: 'trail-reverse', kind: 'note', target: '.trail-row.trail-title',
    title: '反过来也走得通',
    body: '情景按住不放能看它的定义；点一个方法，能看到它讲的是什么、还会出现在哪些情景里；方法页里那个小窗可以直接就地问。',
  },
  {
    id: 'practice', kind: 'action', target: '#tab-practice',
    title: '换到练习看看',
    body: '点顶部的「练习」。同一道题的思路，在这里变成题。',
    done: () => state().activeArea === 'practice',
  },
  {
    id: 'practice-note', kind: 'note', block: true,
    title: '练习考的是"选得对"',
    body: '它先让你在几种方案里挑出一条走得通的链，再让你动手算。算错不清零，看过答案不算功。',
  },
  {
    id: 'drawer', kind: 'action', target: 'button[aria-label="历史与设置"]',
    title: '对话都在左上角',
    body: '点这里展开所有对话。长按其中一条能改标题、删除。',
    done: () => state().drawerOpen,
  },
  {
    id: 'settings', kind: 'action', target: '.drawer-settings',
    title: '设置也在里面',
    body: '点「设置」进去，最后几件事都在那。',
    done: () => state().route === 'settings',
  },
  {
    id: 'subject', kind: 'note', target: '[aria-labelledby$="-subject"]',
    title: '教材换了就在这里换',
    body: '换学科，知识骨架、题库和讲解口吻会一起换；两个学科的数据分开存，不会混。',
  },
  {
    id: 'version', kind: 'action', target: '.settings-about-summary',
    title: '检查和更新都藏在这里',
    body: '点开「版本」，能看到当前版本，也能检查更新。',
    done: () => Boolean(document.querySelector('.settings-about .fold.is-open')),
  },
  {
    id: 'update', kind: 'note', target: '.settings-about-details button',
    title: '有新版本会给你下载地址',
    body: '「检查更新」拿到新版本后，这里会多出一行下载入口。',
  },
  {
    id: 'temperature', kind: 'action', target: '[data-theme-value="light"]',
    title: '按住「浅色」，纸面可以调温',
    body: '按住不放，会打开色温。偏冷偏暖自己定，拖动就预览，自动保存。',
    note: '这一步之后引导就结束了——刚才那几屏都是真实操作，数据不会被留下来。',
    done: () => Boolean(document.querySelector('.light-temperature-dialog')),
  },
];

const PAD = 8;
const CALLOUT_WIDTH = 300;

function targetOf(step) {
  if (!step?.target) return null;
  return document.querySelector(step.target);
}

function boxOf(element) {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  return { x: box.left, y: box.top, w: box.width, h: box.height };
}

export default function AppTour({ onDone, startAt = 0 }) {
  const [index, setIndex] = useState(startAt);
  const [rect, setRect] = useState(null);
  // 目标在不在页面里、滚动之后会不会变，都得跟着走，所以把"当前步骤"和
  // "已滚过哪一步"放进 ref：轮询和订阅回调里读到的必须是最新值。
  const indexRef = useRef(startAt);
  indexRef.current = index;
  const scrolledRef = useRef(-1);
  const calloutRef = useRef(null);
  const [calloutHeight, setCalloutHeight] = useState(200);
  // 目标迟迟不出现（模型慢、断线、这题没命中路径）时，得让人知道"可以跳过"，
  // 否则画面停在那里，看起来像卡死了。
  const [stalled, setStalled] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const advanceGuard = useRef(0);
  const finishedRef = useRef(false);

  const step = STEPS[index];

  // 引导开始那一刻的基线：只认"这次引导之后发生的事"。
  // 否则从设置里重看引导时，历史会话里早就有用户消息，第一步会瞬间跳过。
  const baseline = useRef({ users: userCount(), trailFocus: state().trailFocus });
  const guidedRef = useRef(Boolean(state().guidedComposer));
  const guidedIdRef = useRef(state().currentConversationId);

  // 目标可能在折叠线以下，也可能要等回答写完才挂出来。所以测量不能只在挂载时
  // 跑几十帧就停——"查看本题路径"这类控件是几十秒后才出现的，那时早就没有
  // 画面循环了。测量和事件判定放在同一条 160ms 的循环里，才不会出现
  // "该亮的地方一直不亮，用户只能自己猜着点"。
  const measure = useCallback(() => {
    const element = targetOf(STEPS[indexRef.current]);
    const box = boxOf(element);
    if (!box) { setRect(null); return; }
    const outside = box.y < 8 || box.y + box.h > window.innerHeight - 8;
    if (outside && scrolledRef.current !== indexRef.current) {
      scrolledRef.current = indexRef.current;
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    // 位置没变就保持同一个对象：每帧都造一个新 rect 会让气泡每帧重排一次。
    setRect((prev) => prev && Math.abs(prev.x - box.x) < .5 && Math.abs(prev.y - box.y) < .5
      && Math.abs(prev.w - box.w) < .5 && Math.abs(prev.h - box.h) < .5 ? prev : box);
  }, []);

  useEffect(() => {
    measure();
    const onResize = () => { setViewport({ width: window.innerWidth, height: window.innerHeight }); measure(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => { scrolledRef.current = -1; }, [index]);
  useEffect(() => { if (calloutRef.current) setCalloutHeight(calloutRef.current.offsetHeight || 200); }, [index, rect]);
  useEffect(() => {
    setStalled(false);
    const timer = setTimeout(() => setStalled(true), 30000);
    return () => clearTimeout(timer);
  }, [index]);

  // onDone 是父组件里的一次性回调（每次渲染都是新函数）。放进 ref 里存着，
  // finish / advance 才是稳定引用；否则每次父组件渲染都会重装一遍事件轮询。
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((status) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markTour(status);
    clearPendingGuide();
    const guidedId = guidedIdRef.current;
    const wasGuided = guidedRef.current;
    state().setGuidedComposer(null);
    onDoneRef.current?.();
    if (!wasGuided || !guidedId) return;
    // 引导是"真实使用"：这道题的会话、本题路径和练习卡都真写进了库，
    // 所以收尾必须真的删掉——不删就等于把一个练习用的对话塞进了历史。
    // 但不能在设置页里删：删会话会顺手新建一个会话、把路由拉回问答区，
    // 用户刚长按打开的色温面板会"啪"地消失。所以等到他回到问答区再删。
    let tries = 0;
    const remove = () => {
      if (useAppStore.getState().route !== 'main') {
        if (++tries < 400) setTimeout(remove, 700);
        return;
      }
      // deep=true：这次引导练出来的证据与掌握度也一起删掉，
      // 否则"引导里做对一道题"会把掌握度留成真的。
      Promise.resolve(useAppStore.getState().deleteConversation(guidedId, true, true)).catch(() => {})
        // 会话没了，指着它的"回到题目"焦点也要一起清掉，否则足迹顶上会留一颗
        // 点不动、也回不去的按钮。
        .then(() => useAppStore.setState({ trailFocus: null, questionFocus: null }))
        .catch(() => {});
    };
    remove();
  }, []);

  const advance = useCallback(() => {
    // 一次事件只能推进一步：订阅回调和轮询可能在同一帧里都判定为"完成"。
    const now = Date.now();
    if (now - advanceGuard.current < 240) return;
    advanceGuard.current = now;
    if (indexRef.current >= STEPS.length - 1) finish('done');
    else setIndex(indexRef.current + 1);
  }, [finish]);

  // 事件驱动：不是"用户点了下一步"，而是"真实状态满足了才走"。
  // 生成失败、断线、路径还没出来，都停在原地等——用户重试成功后事件照样会来。
  useEffect(() => {
    const check = () => {
      measure();
      const current = STEPS[indexRef.current];
      if (!current?.done) return;
      let done = false;
      try { done = current.done(baseline.current); } catch { done = false; }
      if (done) advance();
    };
    check();
    const timer = setInterval(check, 160);
    const unsubscribe = useAppStore.subscribe(check);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [advance, measure]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish('skipped'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const ring = rect ? { left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 } : null;
  const plain = guidedRef.current ? null : step.plain;
  const waiting = !rect && step.waiting;
  const bodyText = waiting
    ? step.waiting + (stalled ? ' 一直没出来的话，可以先跳过这一步。' : '')
    : (plain?.body ?? step.body);
  const noteText = plain?.note ?? step.note;
  let placement = { left: viewport.width / 2 - CALLOUT_WIDTH / 2, top: viewport.height / 2 - calloutHeight / 2 };
  if (ring) {
    const below = ring.top + ring.height + 12;
    const above = ring.top - calloutHeight - 12;
    const top = below + calloutHeight < viewport.height - 12 || above < 12 ? below : above;
    const left = Math.min(Math.max(12, ring.left + ring.width / 2 - CALLOUT_WIDTH / 2), viewport.width - CALLOUT_WIDTH - 12);
    placement = { left, top: Math.min(Math.max(12, top), viewport.height - calloutHeight - 12) };
  }

  // 四块边条围出那个洞：洞里的控件是真的能点的，其余地方照样挡住误点。
  // 整块遮罩会连用户该点的东西一起吞掉——这正是旧引导"只能看、不能做"的根因。
  const bands = ring ? [
    { key: 'top', style: { left: 0, top: 0, right: 0, height: Math.max(0, ring.top) } },
    { key: 'bottom', style: { left: 0, top: ring.top + ring.height, right: 0, bottom: 0 } },
    { key: 'left', style: { left: 0, top: ring.top, width: Math.max(0, ring.left), height: ring.height } },
    { key: 'right', style: { left: ring.left + ring.width, top: ring.top, right: 0, height: ring.height } },
  ] : [];

  return <div className="tour-root">
    {bands.map((band) => <div key={band.key} className="tour-mask" style={band.style} aria-hidden="true" />)}
    {/* 没有聚光环、又标了 block 的步骤：只讲不动。练习那一步如果放任整页可点，
        用户顺手开一轮真练习，那一轮跟会话没有关联，收尾删不掉。 */}
    {!ring && step.block && <div className="tour-mask" style={{ inset: 0 }} aria-hidden="true" />}
    {ring && <div className="tour-ring" style={ring} aria-hidden="true" />}
    <div className="tour-callout" ref={calloutRef} role="dialog" aria-labelledby="tour-title" style={placement}>
      <p className="tour-progress">第 {index + 1} / {STEPS.length} 步</p>
      <h2 id="tour-title">{step.title}</h2>
      <p className="tour-body">{bodyText}</p>
      {noteText && <p className="tour-note">{noteText}</p>}
      <div className="tour-actions">
        <button type="button" className="practice-text-button" onClick={() => finish('skipped')}>跳过</button>
        {step.kind === 'note'
          ? <button type="button" className="button button-primary" onClick={advance}>继续</button>
          : <span className="tour-waiting muted" role="status">{rect ? '等你动手' : '等它出现…'}</span>}
      </div>
    </div>
  </div>;
}
