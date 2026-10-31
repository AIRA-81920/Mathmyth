import { useLayoutEffect, useRef, useState } from 'react';

export function questionOffset(flow, node) {
  return flow.scrollTop + node.getBoundingClientRect().top - flow.getBoundingClientRect().top - 20;
}
export default function useQuestionScroll({ flowRef, contentRef, currentId, userIds, active, ready, focus, onFocused }) {
  const positions = useRef(new Map()).current;
  // P5：用户消息相对内容顶部的位置缓存在这里（与 scrollTop 无关），滚动时只读缓存。
  const offsets = useRef(new Map()).current;
  const [space, setSpace] = useState(0);
  const [navigation, setNavigation] = useState({ previous: false, next: false });
  const anchor = useRef(null);
  const frame = useRef(0);
  const last = userIds.at(-1);
  const signature = userIds.join('|');
  const nodes = () => [...(contentRef.current?.querySelectorAll('[data-user-message-id]') ?? [])];
  function measureOffsets() {
    const flow = flowRef.current;
    if (!flow) return;
    offsets.clear();
    for (const node of nodes()) offsets.set(node.dataset.userMessageId, questionOffset(flow, node));
  }
  function updateNavigation() {
    const flow = flowRef.current;
    if (!flow || !active || !ready) return;
    positions.set(currentId, flow.scrollTop);
    const top = flow.scrollTop;
    // P1 的窗口化只把更早的输入移出 DOM，它们必然在视口上方，按"还有上一个输入"计；
    // 用"用户 id 数 - 已量到的节点数"判断，未测量（例如还没拿到几何）不会被误算成隐藏。
    let previous = userIds.length > offsets.size, next = false;
    for (const id of userIds) {
      const offset = offsets.get(id);
      if (offset == null) continue;
      if (offset < top - 8) previous = true;
      else if (offset > top + 8) next = true;
      if (previous && next) break;
    }
    setNavigation(old => old.previous === previous && old.next === next ? old : { previous, next });
  }
  // P5：滚动只排一帧，同一帧多次滚动合并成一次计算；停下后的那一帧照样补算一次。
  function onScroll() {
    if (!active || !ready || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      updateNavigation();
    });
  }
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);
  useLayoutEffect(() => {
    if (!ready || !active || !flowRef.current || !contentRef.current) return;
    const flow = flowRef.current, content = contentRef.current;
    function refresh() {
      // 内容尺寸变化时才重算偏移缓存，滚动路径不再碰布局。
      measureOffsets();
      const latest = nodes().at(-1);
      if (!latest) { setSpace(0); updateNavigation(); return; }
      const distance = content.getBoundingClientRect().bottom - latest.getBoundingClientRect().top;
      const padding = parseFloat(getComputedStyle(flow).paddingBottom) || 0;
      setSpace(Math.max(0, Math.ceil(flow.clientHeight - 20 - padding - distance)));
      updateNavigation();
    }
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(flow); observer.observe(content);
    return () => observer.disconnect();
  }, [currentId, signature, ready, active]);
  useLayoutEffect(() => {
    if (!ready || !active || !flowRef.current) return;
    const changed = anchor.current?.currentId !== currentId || anchor.current?.last !== last;
    if (!changed) { updateNavigation(); return; }
    const switched = anchor.current?.currentId !== currentId;
    const tick = requestAnimationFrame(() => {
      const flow = flowRef.current, latest = nodes().at(-1);
      if (!flow) return;
      anchor.current = { currentId, last };
      const saved = switched ? positions.get(currentId) : null;
      flow.scrollTop = saved ?? (latest ? Math.max(0, questionOffset(flow, latest)) : 0);
      updateNavigation();
    });
    return () => cancelAnimationFrame(tick);
  }, [currentId, last, ready, active, space]);
  useLayoutEffect(() => {
    if (!ready || !active || focus?.conversationId !== currentId) return;
    const tick = requestAnimationFrame(() => {
      const flow = flowRef.current;
      const target = nodes().find(node => node.dataset.userMessageId === focus.messageId);
      if (!flow || !target) return;
      flow.scrollTop = Math.max(0, questionOffset(flow, target));
      updateNavigation();
      onFocused?.(focus);
    });
    return () => cancelAnimationFrame(tick);
  }, [focus, currentId, signature, ready, active, space]);
  function navigate(direction) {
    const flow = flowRef.current;
    if (!flow) return;
    // 点击触发，不在滚动路径上：这里实时量一次，拿精确位置。
    const candidates = nodes().map(node => ({ node, top: Math.max(0, questionOffset(flow, node)) }));
    const target = direction < 0 ? candidates.filter(item => item.top < flow.scrollTop - 8).at(-1)
      : candidates.find(item => item.top > flow.scrollTop + 8);
    if (!target) return;
    flow.scrollTo({ top: target.top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return { space, navigation, onScroll, navigate };
}
