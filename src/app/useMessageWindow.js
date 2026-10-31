import { useLayoutEffect, useRef, useState } from 'react';

// P1：长会话首帧只解析最近 WINDOW 轮，向上滚动时按 STEP 条一批补出更早的消息。
const WINDOW = 4;
const STEP = 10;

// 记住每个会话当前的窗口起点。用模块级 Map 而不是 ref：Ask 在 route 变化时会整块卸载，
// ref 跟着丢，"切走再切回"就退回"一律重置为最后 4 轮"——那正是要避免的退化。
const starts = new Map();

// 倒数第 WINDOW 条用户消息在 messages 里的下标；不足 WINDOW 轮时从头渲染。
export function windowStart(messages) {
  let turns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    turns += 1;
    if (turns === WINDOW) return index;
  }
  return 0;
}

// 记住过就沿用（读到哪就从哪继续，恢复的位置才精确），没记住过才回到"最后 WINDOW 轮"。
// 夹到最后一条：版本切换或分支之后，会话可能比记住的窗口还短。
export function windowStartFor(id, messages, memory = starts) {
  const saved = memory.get(id);
  if (saved == null) return windowStart(messages);
  return Math.min(Math.max(0, saved), Math.max(0, messages.length - 1));
}

export default function useMessageWindow({ flowRef, messages, currentId, focus }) {
  const [ range, setRange ] = useState(() => ({ id: currentId, start: windowStartFor(currentId, messages), empty: messages.length === 0 }));
  const sentinelRef = useRef(null);
  const total = useRef(messages.length);
  // 补给前记录一次 flow.scrollHeight，只在真的往上补消息时用。
  const baseline = useRef(null);
  // 切会话沿用记住的起点；消息是异步到的（读库的会话首帧 messages 为空），等真有消息再定窗口，
  // 否则会在空数组上定成 start=0，把整篇会话都渲染出来。
  if (range.id !== currentId || (range.empty && messages.length > 0)) {
    setRange({ id: currentId, start: windowStartFor(currentId, messages), empty: messages.length === 0 });
  }
  const targetIndex = focus?.conversationId === currentId ? messages.findIndex(item => item.id === focus.messageId) : -1;
  if (targetIndex >= 0 && range.id === currentId && range.start > targetIndex) {
    setRange(value => ({ ...value, start: targetIndex }));
  }
  const start = Math.min(range.start, messages.length);

  useLayoutEffect(() => { total.current = messages.length; });
  // 每次窗口真的变化后统一写回；离开会话不必再存一次——最后一次变化的起点早就在这里了。
  useLayoutEffect(() => { if (messages.length) starts.set(currentId, start); }, [start, currentId, messages.length]);

  function reveal(step) {
    const flow = flowRef.current;
    const next = Math.max(0, Math.min(start, total.current) - step);
    if (!flow || next >= start) return;
    baseline.current = flow.scrollHeight;
    setRange((value) => ({ ...value, start: next }));
  }

  useLayoutEffect(() => {
    const flow = flowRef.current, before = baseline.current;
    baseline.current = null;
    if (!flow || before == null) return;
    // 顶部补出更早的消息会把内容撑高：把新增高度补进 scrollTop，视口位置才不跳。
    const grown = flow.scrollHeight - before;
    if (grown > 0) flow.scrollTop += grown;
  }, [start, currentId]);

  useLayoutEffect(() => {
    const sentinel = sentinelRef.current, flow = flowRef.current;
    if (!sentinel || !flow || start === 0) return;
    let observer = null;
    // 等定位那一帧把 scrollTop 落定后再观察：挂载时内容还在顶部，立即观察会误判成"滚到了上沿"。
    const frame = requestAnimationFrame(() => {
      // 哨兵是内容区顶部的 1px 节点：它进入顶部外扩 400px 的视口，就说明用户滚到了窗口上沿。
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal(STEP);
      }, { root: flow, rootMargin: '400px 0px 0px 0px' });
      observer.observe(sentinel);
    });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [start, currentId]);

  return { start, sentinelRef, revealAll: () => reveal(start) };
}
