import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, Square, X } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import ModalFrame from './ModalFrame.jsx';
import MathMarkdown from './MathMarkdown.jsx';

// 只给三个最常用的追问：再多就是把视线交给按钮，而不是回答。
const QUICK_ASKS = [
  { label: '原理', text: '这个方法为什么成立？' },
  { label: '举个例', text: '给一个最简单的例子。' },
  { label: '什么时候不能用', text: '什么时候不能用这个方法？' },
];

export default function MethodChat({ method }) {
  const open = useAppStore((state) => state.methodChatOpen);
  const id = useAppStore((state) => state.methodConversationId);
  const conversation = useAppStore((state) => state.conversations.find((entry) => entry.id === state.methodConversationId));
  const blocked = useAppStore((state) => Boolean(state.dataOperation || !state.storageInitialized));
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState(''), [saving, setSaving] = useState(false);
  const saveOwner = useRef(id);
  saveOwner.current = id;
  const input = useRef(null), flow = useRef(null);
  const messages = conversation?.messages ?? [];
  const busy = messages.some((message) => message.status === 'streaming');
  const loading = conversation?.loaded === false;
  // 与主问答一致：只把最后一条提问定位到顶部，回答在下面长出来；不跟随流式输出滚动，
  // 否则用户正读到一半就被拽到底部。切会话/重新打开也回到最后一条提问。
  const lastUserId = messages.filter((message) => message.role === 'user').at(-1)?.id;
  useEffect(() => { setDraft(''); }, [method.id]);
  useEffect(() => { setSaveError(''); setSaving(false); }, [id]);
  async function saveDiscussion() {
    if (saving) return;
    const owner = id;
    setSaving(true); setSaveError('');
    try {
      const saved = await useAppStore.getState().saveMethodConversation(owner);
      if (!saved && saveOwner.current === owner) setSaveError(useAppStore.getState().storageError || '讨论尚未保存，请重试。');
    } catch { if (saveOwner.current === owner) setSaveError('讨论尚未保存，请重试。'); }
    finally { if (saveOwner.current === owner) setSaving(false); }
  }
  useLayoutEffect(() => {
    const node = flow.current;
    if (!node || !open) return;
    const latest = [...node.querySelectorAll('[data-user-message-id]')].at(-1);
    if (!latest) { node.scrollTop = 0; return; }
    node.scrollTop += latest.getBoundingClientRect().top - node.getBoundingClientRect().top - 20;
  }, [open, id, lastUserId]);
  // 输入条默认一行，随内容长到最多约四行；把常驻的两行高度还给对话内容。
  useLayoutEffect(() => {
    const node = input.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 88)}px`
  }, [draft]);
  function submit(event) {
    event.preventDefault();
    if (!draft.trim() || busy || blocked || loading) return;
    const text = draft; setDraft('');
    useAppStore.getState().sendMethodMessage(text);
  }
  return <>
    <button type="button" className="method-chat-trigger" aria-label={`讨论方法：${method.name}`} aria-expanded={open} aria-controls="method-chat-window" disabled={blocked} onClick={() => useAppStore.getState().openMethodChat()}><MessageCircle size={22} strokeWidth={1.6} /></button>
    <ModalFrame open={open} titleId="method-chat-title" initialFocusRef={input} className="method-chat-window" onClose={() => useAppStore.getState().setMethodChatOpen(false)}>
      <header className="method-chat-header"><h2 id="method-chat-title">{method.name}</h2>
        {conversation?.ephemeral && messages.length > 0 && <button type="button" className="method-chat-save" disabled={blocked || busy || saving}
          onClick={saveDiscussion}>存进历史</button>}
        <button type="button" className="icon-button" aria-label="收起方法讨论" onClick={() => useAppStore.getState().setMethodChatOpen(false)}><X size={18} /></button></header>
      <div id="method-chat-window" ref={flow} className="conversation-flow method-chat-flow" aria-busy={busy || loading}>
        {saveError && <p className="muted message-status" role="status">{saveError}</p>}
        {loading ? <p className="muted" role="status">正在读取讨论…</p> : !messages.length && <p className="muted">可以问这个方法的原理、使用条件，或它在某个情景中怎样用。</p>}
        {messages.map((message) => <article key={message.id} className={`message message-${message.role}`} data-user-message-id={message.role === 'user' ? message.id : undefined}>
          <MathMarkdown streaming={message.status === 'streaming'}>{message.content}</MathMarkdown>
          {message.status === 'streaming' && !message.content && <p className="muted message-status" role="status">正在回答…</p>}
          {message.error && <p className="muted message-status" role="status">{message.error}</p>}
        </article>)}
      </div>
      {!loading && <div className="method-chat-chips">
        {QUICK_ASKS.map((item) => <button key={item.label} type="button" disabled={blocked}
          onClick={() => { setDraft(item.text); input.current?.focus() }}>{item.label}</button>)}
      </div>}
      <form className="composer method-chat-composer" onSubmit={submit}><div className="composer-row">
        <textarea ref={input} aria-label="向当前方法提问" placeholder="问这个方法…" rows={1} value={draft} disabled={blocked || loading} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event); }} />
        {busy ? <button className="send-button" type="button" aria-label="停止方法回答" onClick={() => useAppStore.getState().stopGenerating(id)}><Square size={15} /></button>
          : <button className="send-button" type="submit" aria-label="发送方法问题" disabled={!draft.trim() || blocked || loading}><ArrowUp size={20} /></button>}
      </div></form>
    </ModalFrame>
  </>;
}
