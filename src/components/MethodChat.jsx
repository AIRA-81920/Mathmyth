import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, Square, X } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import ModalFrame from './ModalFrame.jsx';
import MathMarkdown from './MathMarkdown.jsx';

export default function MethodChat({ method }) {
  const open = useAppStore((state) => state.methodChatOpen);
  const id = useAppStore((state) => state.methodConversationId);
  const conversation = useAppStore((state) => state.conversations.find((entry) => entry.id === state.methodConversationId));
  const blocked = useAppStore((state) => Boolean(state.dataOperation || !state.storageInitialized));
  const [draft, setDraft] = useState('');
  const input = useRef(null), flow = useRef(null), follow = useRef(true);
  const messages = conversation?.messages ?? [];
  const busy = messages.some((message) => message.status === 'streaming');
  const loading = conversation?.loaded === false;
  useEffect(() => { setDraft(''); follow.current = true; }, [method.id]);
  useLayoutEffect(() => { if (flow.current && follow.current) flow.current.scrollTop = flow.current.scrollHeight; }, [open, id, messages]);
  function submit(event) {
    event.preventDefault();
    if (!draft.trim() || busy || blocked || loading) return;
    const text = draft; setDraft(''); follow.current = true;
    useAppStore.getState().sendMethodMessage(text);
  }
  return <>
    <button type="button" className="method-chat-trigger" aria-label={`讨论方法：${method.name}`} aria-expanded={open} aria-controls="method-chat-window" disabled={blocked} onClick={() => useAppStore.getState().openMethodChat()}><MessageCircle size={22} strokeWidth={1.6} /></button>
    <ModalFrame open={open} titleId="method-chat-title" initialFocusRef={input} className="method-chat-window" onClose={() => useAppStore.getState().setMethodChatOpen(false)}>
      <header className="method-chat-header"><h2 id="method-chat-title">讨论 · {method.name}</h2><button type="button" className="icon-button" aria-label="收起方法讨论" onClick={() => useAppStore.getState().setMethodChatOpen(false)}><X size={18} /></button></header>
      <div id="method-chat-window" ref={flow} className="conversation-flow method-chat-flow" aria-busy={busy || loading} onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; }}>
        {loading ? <p className="muted" role="status">正在读取讨论…</p> : !messages.length && <p className="muted">可以问这个方法的原理、使用条件，或它在某个情景中怎样用。</p>}
        {messages.map((message) => <article key={message.id} className={`message message-${message.role}`}>
          <MathMarkdown streaming={message.status === 'streaming'}>{message.content}</MathMarkdown>
          {message.status === 'streaming' && !message.content && <p className="muted message-status" role="status">正在回答…</p>}
          {message.error && <p className="muted message-status" role="status">{message.error}</p>}
        </article>)}
      </div>
      <form className="composer method-chat-composer" onSubmit={submit}><div className="composer-row">
        <textarea ref={input} aria-label="向当前方法提问" placeholder="问问这个方法…" rows={2} value={draft} disabled={blocked || loading} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event); }} />
        {busy ? <button className="send-button" type="button" aria-label="停止方法回答" onClick={() => useAppStore.getState().stopGenerating(id)}><Square size={15} /></button>
          : <button className="send-button" type="submit" aria-label="发送方法问题" disabled={!draft.trim() || blocked || loading}><ArrowUp size={20} /></button>}
      </div></form>
    </ModalFrame>
  </>;
}
