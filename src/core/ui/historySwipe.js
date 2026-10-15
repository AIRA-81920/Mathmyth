import { commitsHistory, swipeIntent } from './areaSwipe.js';

// The open drawer owns its gesture: the underlying area viewport is inert.
// Either horizontal direction dismisses it; vertical drags remain list scrolls.
export function bindHistorySwipe(layer, { enabled, onClose, onGesture }) {
  let gesture = null, suppressClickUntil = 0;
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
    if (!enabled() || globalThis.getSelection?.()?.isCollapsed === false) { release(); return; }
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
    suppressClickUntil = Date.now() + 500;
  }
  function end(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const close = enabled() && gesture.mode === 'horizontal'
      && commitsHistory(Math.abs(event.clientX - gesture.x), layer.clientWidth);
    if (gesture.mode === 'horizontal') suppressClickUntil = Date.now() + 500;
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
