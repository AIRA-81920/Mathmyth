import { useEffect, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';
import MathMarkdown from './MathMarkdown.jsx';
import { reviewedMathMarkdown } from '../core/practice/reviewedMath.js';
import RouteReview from './RouteReview.jsx';
import { isRouteQuestion } from '../core/practice/routes.js';
import '../styles/practice-routes.css';
import { loadPracticeItem, revealPracticeItem, onDatabaseChange } from '../core/db/database.js';

export default function PracticeReview({ itemId, onClose }) {
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let live = true;
    setItem(null); setError(''); setExpanded(false);
    loadPracticeItem(itemId).then((value) => { if (live) setItem(value); })
      .catch(() => { if (live) setError('这道练习暂时没能读出来。'); });
    const unsubscribe = onDatabaseChange((event) => {
      if (['commitImport','clearDatabase'].includes(event.method)) onClose();
    });
    return () => { live = false; unsubscribe(); };
  }, [itemId, onClose]);
  async function reveal() {
    if (!item || busy) return;
    if (expanded) { setExpanded(false); return; }
    if (item.answer?.revealed) { setExpanded(true); return; }
    setBusy(true); setError('');
    try {
      const run = await revealPracticeItem({ id: item.runId, generation: item.generation }, item.id);
      setItem((current) => current?.id === item.id ? { ...current, ...run.items.find((entry) => entry.id === item.id) } : current);
      setExpanded(true);
    } catch (failure) { setError(failure.userMessage || '答案暂时没能读出来。'); }
    finally { setBusy(false); }
  }
  return <ModalFrame open titleId="practice-review-title" onClose={onClose} className="practice-review">
    <h2 id="practice-review-title" className="dialog-title">这道练习</h2>
    {item ? <div className="practice-review-content">
      <MathMarkdown>{item.question.metadata?.bankId ? reviewedMathMarkdown(item.question.question) : item.question.question}</MathMarkdown>
      {item.answer?.steps && <><p className="muted">你的关键步骤</p><MathMarkdown>{item.answer.steps}</MathMarkdown></>}
      {item.answer?.selectedIds?.length > 0 && <div className="muted"><p>{isRouteQuestion(item.question) ? '你选的路线' : '你选的方法'}</p><MathMarkdown>{item.question.options.filter((option) => item.answer.selectedIds.includes(option.id)).map((option) => option.name).join('\n\n')}</MathMarkdown></div>}
      {item.answer?.feedback && <MathMarkdown>{item.answer.feedback}</MathMarkdown>}
      {isRouteQuestion(item.question) && expanded && <RouteReview question={item.question} revealed />}
      {expanded && <div className="practice-solution"><MathMarkdown>{item.question.solution}</MathMarkdown></div>}
    </div> : !error && <p className="muted">正在读取…</p>}
    {error && <p className="muted" role="status">{error}</p>}
    <div className="dialog-actions">{item && <button type="button" className="button button-secondary" disabled={busy} onClick={reveal} aria-expanded={expanded}>{busy ? '正在读取…' : expanded ? '收起路线与答案' : '查看路线与答案'}</button>}
      <button type="button" className="button button-primary" onClick={onClose}>关闭</button></div>
  </ModalFrame>;
}
