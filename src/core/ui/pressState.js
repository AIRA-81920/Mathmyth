// 记录"这一次按下是什么时候开始的"。长按弹出的对话框是在手指还按着的时候
// 挂载的，抬手时浏览器补发的 click 会落到刚铺满屏幕的遮罩上；那个 click 属于
// "打开面板的那一次按下"，不是关闭意图。比较时间戳就能把它和真正的新点击分开，
// 不需要任何时间窗（真人按住 1 秒以上是常态，时间窗从来没管用）。
let pressing = false;
let pressStartedAt = 0;

if (typeof document !== 'undefined') {
  const start = () => { pressing = true; pressStartedAt = performance.now(); };
  const end = () => { pressing = false; };
  document.addEventListener('pointerdown', start, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
}

export function isPressActive() {
  return pressing;
}

export function lastPressAt() {
  return pressStartedAt;
}
