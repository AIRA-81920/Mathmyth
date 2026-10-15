import { useEffect, useState } from 'react';
import MathMarkdown from './MathMarkdown.jsx';
import RouteReview from './RouteReview.jsx';
import { useChatPracticeStore } from '../store/chatPracticeStore.js';
import { useAppStore } from '../store/appStore.js';
import { onDatabaseChange } from '../core/db/database.js';
import { selectionPrompt } from '../core/practice/routes.js';
import { reviewedMathMarkdown } from '../core/practice/reviewedMath.js';
import '../styles/chat-practice.css';

export default function ChatPracticeCard({ itemId, onWrite }) {
  const state = useChatPracticeStore(), item = state.items[itemId], busy = state.busy[itemId];
  const dataOperation = useAppStore(s => s.dataOperation), learnerId = useAppStore(s => s.learnerId);
  const [selected, setSelected] = useState([]), [expanded, setExpanded] = useState(false);
  useEffect(() => { if (item) setSelected(item.answer?.selectedIds ?? []); }, [item?.id, item?.answer?.selectedIds?.join('|')]);
  useEffect(() => {
    if (dataOperation) return;
    state.load(itemId);
    return onDatabaseChange(({ method }) => { if (['gradePracticeItem', 'revealPracticeItem'].includes(method)) state.load(itemId); });
  }, [itemId, state.load, dataOperation, learnerId]);
  if (!item) return <p className="muted" role="status">{state.errors[itemId] || '正在读取题库练习…'}</p>;
  const q = item.question, multi = q.selectionMode === 'multi';
  async function toggleAnswer() {
    if (expanded) { setExpanded(false); return; }
    if (!item.answer?.revealed && !await state.reveal(itemId)) return;
    setExpanded(true);
  }
  return <section className="chat-practice-card" data-practice-item={itemId} aria-label="聊天随练题">
    <p className="chat-practice-caption muted">题库随练 · {item.finishedAt ? '已结束' : '答案先收起'}</p>
    <MathMarkdown>{q.metadata?.bankId ? reviewedMathMarkdown(q.question) : q.question}</MathMarkdown>
    <p className="chat-practice-prompt">{selectionPrompt(q)}</p>
    <p className="muted field-hint">也可以在下面输入 A、B 等选项；写解法请点“写关键步骤”。</p>
    <div className="chat-practice-options">{q.options.map((option, i) => <label key={option.id} className={selected.includes(option.id) ? 'is-selected' : ''}>
      <input type={multi ? 'checkbox' : 'radio'} value={option.id} name={`chat-route-${itemId}`} disabled={busy || Boolean(item.finishedAt)} checked={selected.includes(option.id)}
        onChange={() => setSelected(multi ? selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id] : [option.id])} />
      <span>{String.fromCharCode(65 + i)}.</span><MathMarkdown>{option.name}</MathMarkdown>
    </label>)}</div>
    <div className="chat-practice-actions"><button type="button" className="button button-primary" disabled={busy || !selected.length || Boolean(item.finishedAt)} onClick={() => state.submit(itemId, { mode: 'selection', selectedIds: selected })}>{busy ? '正在检查…' : '提交路线'}</button>
      <button type="button" className="button button-secondary" disabled={busy || Boolean(item.finishedAt)} onClick={() => onWrite(itemId)}>写关键步骤</button></div>
    {item.answer?.steps && <div className="chat-practice-attempt"><span className="muted">你的关键步骤</span><MathMarkdown>{item.answer.steps}</MathMarkdown></div>}
    {item.answer?.feedback && <div className="chat-practice-feedback" role="status"><MathMarkdown>{item.answer.feedback}</MathMarkdown></div>}
    {item.answer?.assisted && !item.answer.outcome && <p className="muted field-hint">这题已使用答疑帮助，作答仍可检查，但不记独立掌握证据。</p>}
    {state.errors[itemId] && <p className="muted" role="status">{state.errors[itemId]}</p>}
    <button type="button" className="practice-text-button" disabled={busy} aria-expanded={expanded} onClick={toggleAnswer}>{expanded ? '收起路线与答案' : '查看路线与答案'}</button>
    {expanded && <><RouteReview question={q} selectedIds={item.answer?.selectedIds} revealed /><MathMarkdown>{q.solution}</MathMarkdown></>}
    {busy && <button type="button" className="practice-text-button" onClick={() => state.cancel(itemId)}>停止检查</button>}
  </section>;
}
