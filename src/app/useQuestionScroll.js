import { useLayoutEffect, useRef, useState } from 'react';

export function questionOffset(flow, node) {
  return flow.scrollTop + node.getBoundingClientRect().top - flow.getBoundingClientRect().top - 20;
}
export default function useQuestionScroll({ flowRef, contentRef, currentId, userIds, active, ready }) {
  const positions = useRef(new Map()).current;
  const [space, setSpace] = useState(0);
  const [navigation, setNavigation] = useState({ previous: false, next: false });
  const anchor = useRef(null);
  const last = userIds.at(-1);
  const signature = userIds.join('|');
  const nodes = () => [...(contentRef.current?.querySelectorAll('[data-user-message-id]') ?? [])];
  function updateNavigation() {
    const flow = flowRef.current;
    if (!flow || !active) return;
    positions.set(currentId, flow.scrollTop);
    const offsets = nodes().map(node => questionOffset(flow, node));
    const previous = offsets.some(top => top < flow.scrollTop - 8);
    const next = offsets.some(top => top > flow.scrollTop + 8);
    setNavigation(old => old.previous === previous && old.next === next ? old : { previous, next });
  }
  useLayoutEffect(() => {
    if (!ready || !active || !flowRef.current || !contentRef.current) return;
    const flow = flowRef.current, content = contentRef.current;
    const latest = nodes().at(-1);
    function measure() {
      if (!latest) { setSpace(0); return; }
      const distance = content.getBoundingClientRect().bottom - latest.getBoundingClientRect().top;
      const padding = parseFloat(getComputedStyle(flow).paddingBottom) || 0;
      setSpace(Math.max(0, Math.ceil(flow.clientHeight - 20 - padding - distance)));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow); observer.observe(content);
    return () => observer.disconnect();
  }, [currentId, signature, ready, active]);
  useLayoutEffect(() => {
    if (!ready || !active || !flowRef.current) return;
    const changed = anchor.current?.currentId !== currentId || anchor.current?.last !== last;
    if (!changed) { updateNavigation(); return; }
    const switched = anchor.current?.currentId !== currentId;
    const frame = requestAnimationFrame(() => {
      const flow = flowRef.current, latest = nodes().at(-1);
      if (!flow) return;
      anchor.current = { currentId, last };
      const saved = switched ? positions.get(currentId) : null;
      flow.scrollTop = saved ?? (latest ? Math.max(0, questionOffset(flow, latest)) : 0);
      updateNavigation();
    });
    return () => cancelAnimationFrame(frame);
  }, [currentId, last, ready, active, space]);
  function navigate(direction) {
    const flow = flowRef.current;
    if (!flow) return;
    const candidates = nodes().map(node => ({ node, top: Math.max(0, questionOffset(flow, node)) }));
    const target = direction < 0 ? candidates.filter(item => item.top < flow.scrollTop - 8).at(-1)
      : candidates.find(item => item.top > flow.scrollTop + 8);
    if (!target) return;
    flow.scrollTo({ top: target.top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return { space, navigation, onScroll: updateNavigation, navigate };
}
