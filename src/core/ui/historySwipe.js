import { commitsHistory, swipeIntent } from './areaSwipe.js';

// The open drawer owns its gesture: the underlying area viewport is inert.
// Either horizontal direction dismisses it; vertical drags remain list scrolls.
export function bindHistorySwipe(layer, { enabled, onClose, onGesture, onProgress }) {
  let gesture = null, suppressClickUntil = 0;
  // 拖拽关闭的实时进度以抽屉自身宽度为分母，与 CSS 里的 --drawer-w / --p 保持一致。
  function drawerWidth() { return layer.querySelector?.('.history-drawer')?.clientWidth || layer.clientWidth || 1; }
  function release() {
    if (gesture && layer.hasPointerCapture?.(gesture.id)) layer.releasePointerCapture(gesture.id);
    gesture = null;
  }
  function start(event) {
    suppressClickUntil = 0;
    if (gesture) { release(); return; }
    if (!enabled() || event.isPrimary === false || event.button !== 0
      || event.target.closest?.('input, textarea, select, [contenteditable="true"], [data-no-area-swipe]')
      || globalThis.getSelection?.()?.isCollapsed === false) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'waiting' };
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!enabled()) { release(); return; }
    // 拖拽途中浏览器可能已经起了文本选区（鼠标按下即开始选词）。旧写法遇到选区直接
    // release() 丢弃手势 —— 结果就是抽屉停在半路、松手时 end() 发现没有手势、什么也不做。
    // 横向拖拽本来就该接管这次拖动，清掉选区继续跟手即可。
    if (globalThis.getSelection?.()?.isCollapsed === false) globalThis.getSelection().removeAllRanges();
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (gesture.mode === 'waiting') {
      const intent = swipeIntent(dx, dy);
      if (intent === 'vertical') { release(); return; }
      if (intent !== 'horizontal') return;
      gesture.mode = 'horizontal';
      onGesture?.();
      layer.setPointerCapture?.(event.pointerId);
    }
    if (event.cancelable) event.preventDefault();
    // 已打开的抽屉被横向拖拽：实时把「关闭进度」写回 --p（跟随手指，卡片同步放大回去），
    // 松手时再落定到「关闭」或「弹回全开」。
    onProgress?.(Math.max(0, Math.min(1, 1 - Math.abs(dx) / drawerWidth())), true);
    suppressClickUntil = Date.now() + 500;
  }
  function end(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const committed = gesture.mode === 'horizontal';
    // 阈值按「抽屉自身宽度」算，和手势进度用同一个分母。原来用的是 layer.clientWidth
    // （整屏宽 986），要拖近 200px 才算关闭，而抽屉本身只有 319 宽 —— 手感上就是
    // 「明明已经拉过大半还弹回去」。
    const close = enabled() && committed && commitsHistory(Math.abs(event.clientX - gesture.x), drawerWidth());
    if (committed) { suppressClickUntil = Date.now() + 500; onProgress?.(close ? 0 : 1, false); }
    release();
    if (close) onClose();
  }
  function click(event) {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  const listeners = { pointerdown: start, pointermove: move, pointerup: end, pointercancel: release, click };
  for (const [type, handler] of Object.entries(listeners)) layer.addEventListener(type, handler, { capture: true });
  return () => {
    release();
    for (const [type, handler] of Object.entries(listeners)) layer.removeEventListener(type, handler, { capture: true });
  };
}
