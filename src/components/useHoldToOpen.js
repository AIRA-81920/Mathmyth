import { useCallback, useEffect, useRef, useState } from 'react';

export const HOLD_DELAY_MS = 350;
export const HOLD_WAVE_MS = 550;

// The gesture owns two timers; releasing or scrolling cancels both stages.
export default function useHoldToOpen({ enabled, onOpen }) {
  const [charging, setCharging] = useState(false);
  const pending = useRef(null);
  const suppressClick = useRef(false);
  const open = useRef(onOpen);
  open.current = onOpen;
  const cancel = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.delay);
      clearTimeout(pending.current.finish);
      pending.current = null;
    }
    setCharging(false);
  }, []);

  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerup', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerup', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [cancel]);
  useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);

  return {
    charging,
    cancel,
    consumeClick() {
      const suppress = suppressClick.current;
      suppressClick.current = false;
      return suppress;
    },
    handlers: {
      onPointerDown(event) {
        cancel();
        suppressClick.current = false;
        if (!enabled || event.button !== 0 || event.isPrimary === false) return;
        const gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
        pending.current = gesture;
        gesture.delay = setTimeout(() => {
          if (pending.current !== gesture) return;
          suppressClick.current = true;
          setCharging(true);
          gesture.finish = setTimeout(() => {
            if (pending.current !== gesture) return;
            cancel();
            open.current?.();
          }, HOLD_WAVE_MS);
        }, HOLD_DELAY_MS);
      },
      onPointerMove(event) {
        const gesture = pending.current;
        if (gesture && (event.pointerId !== gesture.id || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10)) {
          suppressClick.current = true;
          cancel();
        }
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu(event) { event.preventDefault(); },
      // Keyboard activation keeps details accessible without visible UI clutter.
      onKeyDown(event) {
        if (enabled && event.altKey && event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat) { cancel(); open.current?.(); }
        }
      },
    },
  };
}
