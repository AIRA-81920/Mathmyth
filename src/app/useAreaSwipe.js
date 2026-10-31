import { useLayoutEffect, useRef } from 'react';
import { blocksAreaSwipe, swipeCommitIndex, swipeIntent, swipeOffset, swipeMode, swipeTravel, commitsHistory, SWIPE_SETTLE_MS } from '../core/ui/areaSwipe.js';

export default function useAreaSwipe({ viewportRef, trackRef, drawerRef, index, count, disabled, onChange, onDrawer, onProgress, onAreaProgress }) {
  const config = useRef({ index, count, disabled, onChange, onDrawer, onProgress, onAreaProgress });
  config.current = { index, count, disabled, onChange, onDrawer, onProgress, onAreaProgress };
  const reset = useRef(null);
  const animate = useRef(null);
  const previousIndex = useRef(index);
  const pendingIndex = useRef(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    let gesture = null, settling = null, peekTimer = null, width = viewport.clientWidth;
    const layer = drawerRef.current;
    // 抽屉手势的实时进度以抽屉自身宽度为分母，与 CSS 里的 --drawer-w 保持一致。
    function drawerWidth() { return layer?.querySelector?.('.history-drawer')?.clientWidth || layer?.clientWidth || 1; }
    function clearPeek() { clearTimeout(peekTimer); layer?.classList.remove('is-peeking', 'is-dragging'); }
    // 拉出抽屉时只推进 --p：卡片缩放、抽屉滑出、遮罩变暗全部由 CSS 里的 --p 驱动，
    // 内容轨道（.area-swipe-track）一点都不位移 —— 这是「两个图层、只遮住不挤压」的关键，
    // 也是旧实现把轨道一起拖走造成「顶栏与内容撕裂」的根因所在。
    function peek(dx, dragging = true) {
      if (!layer) return;
      clearTimeout(peekTimer);
      layer.classList.add('is-peeking');
      layer.classList.toggle('is-dragging', dragging);
      config.current.onProgress?.(Math.max(0, Math.min(1, dx / drawerWidth())), dragging);
    }
    function position(next, dx = 0) { track.style.transform = `translate3d(${-next * width + dx}px, 0, 0)`; }
    function settled() { clearTimeout(settling); pendingIndex.current = null; viewport.classList.remove('is-swiping', 'is-settling'); }
    function settle(next = config.current.index) {
      gesture = null; clearTimeout(settling);
      pendingIndex.current = next;
      viewport.classList.remove('is-swiping'); viewport.classList.add('is-settling');
      position(next); settling = setTimeout(settled, SWIPE_SETTLE_MS + 30);
    }
    reset.current = () => { gesture = null; clearPeek(); settled(); width = viewport.clientWidth; position(config.current.index); };
    animate.current = () => { clearPeek(); width = viewport.clientWidth; settle(config.current.index); };
    function start(event) {
      if (config.current.disabled || event.touches.length !== 1 || document.getElementById('root')?.inert || blocksAreaSwipe(event.target, viewport)) return;
      const touch = event.touches[0];
      clearPeek(); settled(); width = viewport.clientWidth;
      gesture = { x: touch.clientX, y: touch.clientY, dx: 0, index: config.current.index, mode: 'waiting' };
    }
    function move(event) {
      if (!gesture) return;
      if (globalThis.getSelection?.()?.isCollapsed === false) { cancel(); return; }
      if (event.touches.length !== 1 || config.current.disabled || config.current.index !== gesture.index) { cancel(); return; }
      const touch = event.touches[0], dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.mode === 'waiting') {
        const intent = swipeIntent(dx, dy);
        if (intent === 'vertical') { gesture = null; return; }
        if (intent !== 'horizontal') return;
        gesture.mode = swipeMode(gesture.index, dx);
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault(); gesture.dx = dx;
      if (gesture.mode === 'area') {
        const offset = swipeOffset(gesture.index, config.current.count, dx);
        viewport.classList.add('is-swiping'); position(gesture.index, offset);
        // 顶部那条线要跟着手指走：给出去的是连续下标（1.37 = 从第 1 个往第 2 个走了 37%）。
        config.current.onAreaProgress?.(swipeTravel(gesture.index, config.current.count, dx, width));
      } else {
        // 抽屉路径：只写 --p，不碰轨道
        peek(dx);
      }
    }
    function end(event) {
      if (!gesture) return;
      const current = gesture, touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - current.x : current.dx;
      if (current.mode === 'drawer') {
        gesture = null;
        // 顺序很重要：先把 is-dragging 摘掉（恢复过渡），再设目标值；
        // 过渡中途绝不改类，落定动画才不会被浏览器撤销（旧实现抬手闪现的另一半原因）。
        layer?.classList.remove('is-dragging');
        if (commitsHistory(dx, width)) { config.current.onProgress?.(1, false); config.current.onDrawer(); }
        else { config.current.onProgress?.(0, false); peekTimer = setTimeout(clearPeek, SWIPE_SETTLE_MS + 30); }
        return;
      }
      const next = current.mode === 'area' ? swipeCommitIndex(current.index, config.current.count, dx, width) : current.index;
      // 先告诉线的持有者"手指松了、落在 next"，再切区（切区后的 layout effect 要用这个结果决定直接落位）。
      if (current.mode === 'area') config.current.onAreaProgress?.(null, next);
      settle(next); if (next !== current.index) config.current.onChange(next);
    }
    const cancel = () => {
      const wasArea = gesture?.mode === 'area';
      settle();
      if (wasArea) config.current.onAreaProgress?.(null, config.current.index);
      if (layer?.classList.contains('is-peeking')) { config.current.onProgress?.(0, false); peekTimer = setTimeout(clearPeek, SWIPE_SETTLE_MS + 30); }
    };
    viewport.addEventListener('touchstart', start, { passive: true });
    viewport.addEventListener('touchmove', move, { passive: false });
    viewport.addEventListener('touchend', end, { passive: true });
    viewport.addEventListener('touchcancel', cancel, { passive: true });
    const observer = globalThis.ResizeObserver ? new ResizeObserver(() => {
      // Entering/leaving a focused practice round changes height only. Do not
      // interrupt its ongoing horizontal settle animation for that resize.
      if (viewport.clientWidth !== width) reset.current?.();
    }) : null;
    observer?.observe(viewport); position(config.current.index);
    return () => {
      observer?.disconnect(); clearTimeout(settling); clearPeek(); reset.current = null; animate.current = null;
      viewport.removeEventListener('touchstart', start); viewport.removeEventListener('touchmove', move);
      viewport.removeEventListener('touchend', end); viewport.removeEventListener('touchcancel', cancel);
    };
  }, [viewportRef, trackRef, drawerRef]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    const changed = previousIndex.current !== index;
    previousIndex.current = index;
    // 抽屉打开时区页手势被禁用（disabled）：这里绝不能 reset()，否则会在同一帧把
    // 卡片与抽屉拽回原位，落定过渡被撤销 —— 也就是旧实现抬手「闪现」的根因。
    if (disabled) return;
    if (changed && pendingIndex.current !== index) { animate.current?.(); return; }
    // The committing touch already supplied the correct animation start point.
    if (!viewport.classList.contains('is-settling') || pendingIndex.current !== index) reset.current?.();
  }, [index, disabled, viewportRef, trackRef]);
}
