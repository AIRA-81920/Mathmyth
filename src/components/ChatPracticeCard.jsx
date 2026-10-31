import { useEffect, useState } from 'react';
import MathMarkdown from './MathMarkdown.jsx';
import RouteReview from './RouteReview.jsx';
import { useChatPracticeStore } from '../store/chatPracticeStore.js';
import { useAppStore } from '../store/appStore.js';
import { onDatabaseChange } from '../core/db/database.js';
import { selectionPrompt } from '../core/practice/routes.js';
import { reviewedMathMarkdown } from '../core/practice/reviewedMath.js';
import { nextHintLevel, practiceEvidenceSummary, targetExecutionComplete } from '../core/learning/practiceSummary.js';
import '../styles/chat-practice.css';

export default function ChatPracticeCard({ itemId, onWrite }) {
  const state = useChatPracticeStore(), item = state.items[itemId], busy = state.busy[itemId];
  const dataOperation = useAppStore(s => s.dataOperation), learnerId = useAppStore(s => s.learnerId);
  const [selected, setSelected] = useState([]), [expanded, setExpanded] = useState(false), [showHints, setShowHints] = useState(true);
  const [relatedError, setRelatedError] = useState('');
  useEffect(() => { if (item) setSelected(item.answer?.selectedIds ?? []); }, [item?.id, item?.answer?.selectedIds?.join('|')]);
  useEffect(() => {
    setExpanded(false); setRelatedError(''); setShowHints(true);
    if (dataOperation) return;
    state.load(itemId);
    return onDatabaseChange(({ method }) => { if (['gradePracticeItem', 'revealPracticeItem', 'recordPracticeHint', 'finishChatPractice', 'setPracticeReview', 'disputePracticeItem'].includes(method)) state.load(itemId); });
  }, [itemId, state.load, dataOperation, learnerId]);
  if (!item) return <p className="muted" role="status">{state.errors[itemId] || '正在读取题库练习…'}</p>;
  const q = item.question, learning = q.metadata?.learning, multi = q.selectionMode === 'multi';
  const disabled = Boolean(busy || dataOperation), finished = Boolean(item.finishedAt);
  // 只有一条路线时"选路线"没有意义（AI 草稿就是这样）：直接进写关键步骤。
  const routeBased = (q.routes?.length ?? 0) > 1;
  const routesVisible = routeBased && (!learning || item.answer?.routeOptionsRevealed || item.answer?.mode === 'selection');
  const hintLevel = nextHintLevel(item), usedHintLevels = (item.answer?.helpEvents ?? []).filter(event => event.kind === 'hint').map(event => event.level);
  const summary = practiceEvidenceSummary(item);
  const targetComplete = targetExecutionComplete(item);
  const canReview = Boolean(learning?.familyId), reviewPending = item.review?.status === 'pending';
  async function toggleAnswer() {
    if (expanded) { setExpanded(false); return; }
    if (!item.answer?.revealed && !await state.reveal(itemId)) return;
    setExpanded(true);
  }
  return <section className="chat-practice-card" data-practice-item={itemId} aria-label="聊天随练题">
    <p className="chat-practice-caption muted">{learning?.reviewId ? '接着上次练习' : '试一道类似题'}{finished ? ' · 已结束' : ''}</p>
    <MathMarkdown>{q.metadata?.bankId ? reviewedMathMarkdown(q.question) : q.question}</MathMarkdown>
    {learning?.changedCondition && !learning?.reviewId && <p className="muted field-hint">{learning.changedCondition}</p>}
    {q.metadata?.reviewStatus === 'model_unverified' && <p className="muted field-hint">AI 变式草稿，尚未人工核对；本题作答不计入掌握度。</p>}
    {!finished && <>
      <p className="chat-practice-prompt">{learning ? '先写出关键变形即可。没思路时可以看提示，也可以先选路线。' : selectionPrompt(q)}</p>
      {routesVisible && <div className="chat-practice-options">{q.options.map((option, i) => <label key={option.id} className={selected.includes(option.id) ? 'is-selected' : ''}>
        <input type={multi ? 'checkbox' : 'radio'} value={option.id} name={`chat-route-${itemId}`} disabled={disabled} checked={selected.includes(option.id)}
          onChange={() => setSelected(multi ? selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id] : [option.id])} />
        <span>{String.fromCharCode(65 + i)}.</span><MathMarkdown>{option.name}</MathMarkdown>
      </label>)}</div>}
      <div className="chat-practice-actions">
        <button type="button" className="button button-primary" disabled={disabled} onClick={() => onWrite(itemId)}>{item.answer?.outcome === 'wrong' ? '修改关键步骤' : item.answer?.outcome === 'uncertain' ? '补充关键步骤' : item.answer?.mode === 'steps' && item.answer?.outcome === 'right' && !targetComplete ? '继续写关键步骤' : '写关键步骤'}</button>
        {routesVisible ? <button type="button" className="button button-secondary" disabled={disabled || !selected.length} onClick={() => state.submit(itemId, { mode: 'selection', selectedIds: selected })}>提交路线</button>
          : <button type="button" className="button button-secondary" disabled={disabled} onClick={() => state.reveal(itemId, { kind: 'route_options' })}>先选路线</button>}
        {hintLevel && <button type="button" className="button button-secondary" disabled={disabled} onClick={async () => { if (await state.hint(itemId, hintLevel)) setShowHints(true); }}>{usedHintLevels.length ? '再提示一步' : '给点提示'}</button>}
        {item.answer?.outcome === 'wrong' && hintLevel === 1 && learning?.hints?.length > 1 && <button type="button" className="practice-text-button" disabled={disabled} onClick={async () => { if (await state.hint(itemId, 2)) setShowHints(true); }}>第一步已完成，提示后一步</button>}
      </div>
    </>}
    {usedHintLevels.length > 0 && <div className="chat-practice-hints">
      <button type="button" className="practice-text-button" aria-expanded={showHints} onClick={() => setShowHints(value => !value)}>{showHints ? '收起提示' : '展开已看提示'}</button>
      {showHints && [...new Set(usedHintLevels)].map(level => <div key={level}><p className="muted field-hint">{level === 1 ? '先看一个方向' : '关键操作提示'}</p><MathMarkdown>{typeof learning?.hints?.[level - 1] === 'string' ? learning.hints[level - 1] : learning?.hints?.[level - 1]?.content || ''}</MathMarkdown></div>)}
    </div>}
    {item.answer?.steps && <div className="chat-practice-attempt"><span className="muted">你的关键步骤</span><MathMarkdown>{item.answer.steps}</MathMarkdown></div>}
    {item.answer?.feedback && <div className="chat-practice-feedback" role="status"><MathMarkdown>{item.answer.feedback}</MathMarkdown></div>}
    {item.answer?.assessmentScope === 'result' && item.answer?.resultCorrect && <p className="muted field-hint">已记录结果正确；关键步骤尚未检验。</p>}
    {item.answer?.disputed ? <p className="muted field-hint">已标记判断有异议，相关能力结论已暂停。原作答与反馈会保留。</p>
      : item.answer?.outcome && <button type="button" className="practice-text-button" disabled={disabled} onClick={() => state.dispute(itemId)}>这一步可能判错了</button>}
    {item.answer?.revealed && <p className="muted field-hint">{item.answer.assisted ? '用过答疑帮助' : '已看解答'}；继续作答会保留这次帮助背景。</p>}
    {state.errors[itemId] && <p className="muted" role="status">{state.errors[itemId]}</p>}
    <div className="chat-practice-actions">
      <button type="button" className="practice-text-button" disabled={disabled} aria-expanded={expanded} onClick={toggleAnswer}>{expanded ? '收起解答' : '查看解答'}</button>
      {(item.source?.sourceMessageId || learning?.provenance?.sourceItemId) && <button type="button" className="practice-text-button" disabled={disabled} onClick={async () => { if (!await state.openSource(itemId)) setRelatedError('原题对话已不可用；本题记录仍保留。'); }}>回看来源</button>}
      {!finished && <button type="button" className="practice-text-button" disabled={disabled} onClick={() => state.finish(itemId)}>先到这里</button>}
    </div>
    {expanded && <><RouteReview question={q} selectedIds={item.answer?.selectedIds} revealed /><MathMarkdown>{q.solution}</MathMarkdown></>}
    {finished && <div className="chat-practice-summary" role="status"><strong>这次练习</strong><p>{summary.done}</p><p className="muted">{summary.pending}</p>
      {learning?.reviewId && (!['right', 'wrong'].includes(item.answer?.outcome) || item.answer?.disputed) && <p className="muted field-hint">这次还没有得到可用的检验结果，原复习安排仍保留，可在练习中继续。</p>}
      <div className="chat-practice-actions">{canReview && item.review?.status !== 'completed' && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => state.scheduleReview(itemId, !reviewPending)}>{reviewPending ? '撤销复习安排' : '下次再试'}</button>}
        <button type="button" className="practice-text-button" disabled={disabled} onClick={() => useAppStore.getState().returnToQuestion()}>继续聊天</button></div>
      {reviewPending && <p className="muted field-hint">已安排，可在练习或足迹中继续。建议 {new Date(item.review.dueAt).toLocaleDateString('zh-CN')} 再试；也可以提前练。</p>}
      {item.review?.status === 'completed' && <p className="muted field-hint">这条安排已完成，练习记录已保留。</p>}
    </div>}
    {relatedError && <p className="muted" role="status">{relatedError}</p>}
    {state.checking[itemId] && <button type="button" className="practice-text-button" onClick={() => state.cancel(itemId)}>停止检查</button>}
  </section>;
}
