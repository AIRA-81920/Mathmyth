// 可选性能探针：默认完全不启用，不注册任何监听、不占一帧。
//
// 打开方式（任选其一）：
//   · 地址栏加 ?perf=1
//   · localStorage.setItem('mathmyth:perf', '1')（浏览器/WebView 调试面板里执行一次即可）
//
// 记录两件与"抽屉开合卡顿"直接相关的事：
//   1) 长任务（>50ms）：哪一个时间点主线程被占了多久；
//   2) 帧间隔：最大间隔、超过 32ms（掉两帧）的次数。
// 结果在控制台打印，也可在控制台随时执行 window.__mathmythPerf.report() / reset()。
//
// 为什么不用 PerformanceObserver 的 'long-animation-frame'：安卓 WebView 内核版本
// 不一定支持，这里只用 longtask + rAF 采样这两种最保守的接口。

const STORAGE_KEY = 'mathmyth:perf'

function enabled() {
  try {
    if (globalThis.localStorage?.getItem(STORAGE_KEY) === '1') return true
  } catch { /* 隐私模式下 localStorage 可能抛错 */ }
  return /[?&]perf=1\b/.test(globalThis.location?.search ?? '')
}

export function installPerfProbe() {
  if (!globalThis.document || !enabled() || globalThis.__mathmythPerf) return;

  const state = { longTasks: [], maxGap: 0, over32: 0, over50: 0, samples: 0 };

  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({ at: Math.round(entry.startTime), ms: Math.round(entry.duration), name: entry.name });
        // 只留最近 200 条，避免长时间挂着时数组无限增长
        if (state.longTasks.length > 200) state.longTasks.shift();
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch { observer = null; }

  let last = 0;
  let raf = 0;
  const tick = (now) => {
    if (last) {
      const gap = now - last;
      state.samples += 1;
      if (gap > state.maxGap) state.maxGap = Math.round(gap);
      if (gap > 32) state.over32 += 1;
      if (gap > 50) state.over50 += 1;
    }
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const report = () => {
    const summary = {
      最长帧间隔ms: state.maxGap,
      '掉帧(>32ms)': state.over32,
      '卡顿帧(>50ms)': state.over50,
      采样帧数: state.samples,
      长任务数: state.longTasks.length,
      最长长任务ms: state.longTasks.reduce((max, item) => Math.max(max, item.ms), 0),
    };
    console.table?.(summary);
    return { ...summary, longTasks: [...state.longTasks] };
  };

  globalThis.__mathmythPerf = {
    report,
    // App.jsx 每次开合抽屉都会调这个（仅当探针启用时存在）。
    // 角标会显示：动画时长、目标值、创建了几个动画、以及 reduced-motion 的判定结果。
    // 「点开没动画」这种问题一眼就能定位：duration=0 或 count=0 就是代码侧，
    // 三者都正常却看不到动，才是合成/显示层的问题。
    noteDrawer(info) {
      state.lastDrawer = info;
      render();
    },
    reset() {
      state.longTasks.length = 0; state.maxGap = 0; state.over32 = 0; state.over50 = 0; state.samples = 0;
      render();
    },
    stop() {
      observer?.disconnect(); cancelAnimationFrame(raf); badge?.remove(); delete globalThis.__mathmythPerf;
    },
  };

  function render() {
    if (!badge) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference';
    const last = state.lastDrawer
      ? `${state.lastDrawer.from.toFixed(0)}→${state.lastDrawer.value} · ${state.lastDrawer.duration}ms · ${state.lastDrawer.count} anim`
      : '—';
    badge.textContent = [
      `motion: ${motion}`,
      `drawer: ${last}`,
      `max gap: ${state.maxGap}ms ( >32ms ×${state.over32} )`,
    ].join('\n');
  }

  const badge = document.createElement('div');
  badge.id = 'mathmyth-perf-badge';
  badge.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647',
    'padding:6px 8px', 'border-radius:6px', 'background:rgba(0,0,0,.78)', 'color:#fff',
    'font:11px/1.5 ui-monospace,monospace', 'white-space:pre', 'pointer-events:none', 'opacity:.9',
  ].join(';');
  document.body.appendChild(badge);
  render();
  setInterval(render, 400);

  console.info('[perf] 探针已启用：开合几次抽屉后执行 window.__mathmythPerf.report() 查看掉帧与长任务。');
}
