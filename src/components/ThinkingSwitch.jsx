import { useEffect, useRef, useState } from 'react';
import { thinkingDragProgress } from '../core/ui/thinkingSwitch.js';

export default function ThinkingSwitch({ checked, disabled, description, status, onChange }) {
  const buttonRef = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const [progress, setProgress] = useState(null);
  const visualOn = (progress ?? Number(checked)) >= .5;

  function reset() {
    const pointer = gesture.current;
    gesture.current = null;
    setProgress(null);
    if (pointer && buttonRef.current?.hasPointerCapture(pointer.id)) buttonRef.current.releasePointerCapture(pointer.id);
  }
  useEffect(() => { if (disabled) reset() }, [disabled]);

  return <button ref={buttonRef} type="button" role="switch" aria-label="思考模式" aria-checked={checked}
    disabled={disabled} title={description} className={`thinking-switch${visualOn ? ' is-on' : ''}${progress !== null ? ' is-dragging' : ''}`}
    style={{ '--switch-progress': progress ?? Number(checked) }}
    onClick={event => {
      if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); return }
      suppressClick.current = false;
      onChange(!checked);
    }}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();if (!disabled) onChange(event.key === 'ArrowRight');
      }
    }}
    onPointerDown={event => {
      suppressClick.current = false;
      if (disabled || event.button !== 0 || event.isPrimary === false || !event.target.closest('[data-switch-track]')) return;
      const track = event.currentTarget.querySelector('[data-switch-track]');
      const thumb = track.querySelector('.thinking-switch-thumb');
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
        initial: checked, travel: track.clientWidth - thumb.offsetWidth - 4 };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const pointer = gesture.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.moved) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { suppressClick.current = true; reset(); return }
        if (Math.abs(dx) < 4 || Math.abs(dx) <= Math.abs(dy)) return;
        pointer.moved = true;
      }
      if (event.cancelable) event.preventDefault();
      suppressClick.current = true;
      setProgress(thinkingDragProgress(pointer.initial, dx, pointer.travel));
    }}
    onPointerUp={event => {
      const pointer = gesture.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      if (pointer.moved) {
        suppressClick.current = true;
        const next = thinkingDragProgress(pointer.initial, event.clientX - pointer.x, pointer.travel) >= .5;
        if (!disabled && next !== checked) onChange(next);
      }
      reset();
    }}
    onPointerCancel={() => { suppressClick.current = true; reset() }}
    onLostPointerCapture={() => { if (gesture.current) { suppressClick.current = true; reset() } }}>
    <svg className="thinking-bulb" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 17c0-2-3-3-3-7a6 6 0 0 1 12 0c0 4-3 5-3 7M9 18h6M10 21h4" />
      <path className="bulb-filament" d="m9.5 12.5 2.5 2 2.5-2M12 14.5V18" />
      <path className="bulb-rays" d="M12 1V0M3 4 1.5 2.5M21 4l1.5-1.5M2 11H0M22 11h2" />
    </svg>
    <span className="thinking-switch-label">思考模式</span>
    <span className="thinking-switch-track" data-switch-track aria-hidden="true"><span className="thinking-switch-thumb" /></span>
    {status && <span className="thinking-switch-status">{status}</span>}
  </button>;
}
