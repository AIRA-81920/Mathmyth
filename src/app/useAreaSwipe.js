import { useLayoutEffect, useRef } from 'react';
import { blocksAreaSwipe, swipeCommitIndex, swipeIntent, swipeOffset, swipeMode, commitsHistory, SWIPE_SETTLE_MS } from '../core/ui/areaSwipe.js';

export default function useAreaSwipe({ viewportRef, trackRef, drawerRef, index, count, disabled, onChange, onDrawer }) {
  const config = useRef({ index, count, disabled, onChange, onDrawer });
  config.current = { index, count, disabled, onChange, onDrawer };
  const reset = useRef(null);
  const animate = useRef(null);
  const previousIndex = useRef(index);
  const pendingIndex = useRef(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    let gesture = null, settling = null, peekTimer = null, width = viewport.clientWidth;
    const layer = drawerRef.current;
    function clearPeek() {
      clearTimeout(peekTimer); layer?.classList.remove('is-peeking', 'is-dragging');
      layer?.style.removeProperty('--drawer-offset'); layer?.style.removeProperty('--drawer-progress');
    }
    function peek(dx, dragging = true) {
      if (!layer) return;
      clearTimeout(peekTimer);
      const drawerWidth = layer.querySelector('.history-drawer').clientWidth;
      const offset = Math.max(0, Math.min(drawerWidth, dx));
      layer.classList.add('is-peeking'); layer.classList.toggle('is-dragging', dragging);
      layer.style.setProperty('--drawer-offset', `${offset}px`);
      layer.style.setProperty('--drawer-progress', `${offset / drawerWidth}`);
      return offset;
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
        viewport.classList.add('is-swiping'); position(gesture.index, swipeOffset(gesture.index, config.current.count, dx));
      } else {
        viewport.classList.add('is-swiping'); position(0, peek(dx) ?? Math.max(0, dx));
      }
    }
    function end(event) {
      if (!gesture) return;
      const current = gesture, touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - current.x : current.dx;
      if (current.mode === 'drawer') {
        settle();
        if (commitsHistory(dx, width)) { layer?.classList.remove('is-dragging', 'is-peeking'); config.current.onDrawer(); }
        else { peek(0, false); peekTimer = setTimeout(clearPeek, SWIPE_SETTLE_MS + 30); }
        return;
      }
      const next = current.mode === 'area' ? swipeCommitIndex(current.index, config.current.count, dx, width) : current.index;
      settle(next); if (next !== current.index) config.current.onChange(next);
    }
    const cancel = () => { settle(); if (layer?.classList.contains('is-peeking')) { peek(0, false); peekTimer = setTimeout(clearPeek, SWIPE_SETTLE_MS + 30); } };
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
    if (disabled) { reset.current?.(); return; }
    if (changed && pendingIndex.current !== index) { animate.current?.(); return; }
    // The committing touch already supplied the correct animation start point.
    if (!viewport.classList.contains('is-settling') || pendingIndex.current !== index) reset.current?.();
  }, [index, disabled, viewportRef, trackRef]);
}
