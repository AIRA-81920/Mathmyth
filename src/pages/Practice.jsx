import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import MathMarkdown from '../components/MathMarkdown.jsx';
import PracticeReview from '../components/PracticeReview.jsx';
import RouteReview from '../components/RouteReview.jsx';
import PracticeTargetPicker from '../components/PracticeTargetPicker.jsx';
import { usePracticeStore } from '../store/practiceStore.js';
import { useAppStore } from '../store/appStore.js';
import { isRouteQuestion, practiceLevels, selectionPrompt } from '../core/practice/routes.js';
import { practicePresentation } from '../core/practice/presentation.js';
import { reviewedMathMarkdown } from '../core/practice/reviewedMath.js';
import { onDatabaseChange } from '../core/db/database.js';
import '../styles/practice-routes.css';

const dateLabel = (value) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export default function Practice({ active = true }) {
  const state = usePracticeStore();
  const initialized = useAppStore((app) => app.storageInitialized);
  const learnerId = useAppStore((app) => app.learnerId);
  const dataOperation = useAppStore((app) => app.dataOperation);
  const [reviewId, setReviewId] = useState(null);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const closeReview = useCallback(() => setReviewId(null), []);
  useEffect(() => {
    if (!initialized || dataOperation || !active) return;
    state.initialize();
    return onDatabaseChange(({ method }) => {
      if (['completeJob', 'deleteConversation', 'gradePracticeItem'].includes(method)) state.initialize();
    });
  }, [initialized, learnerId, dataOperation, active, state.initialize]);
  useEffect(() => { setReviewId(null); setExpandedItemId(null); }, [learnerId, dataOperation]);
  const edge = state.choices[state.choiceIndex];
  if (state.screen === 'history') return <div className="practice-page">
    <header className="page-header"><button type="button" className="icon-button" aria-label="返回练习入口" onClick={state.showEntry}><ArrowLeft size={20} /></button><h1 className="page-title">练习记录</h1><span className="header-spacer" /></header>
    <main className="practice-content practice-history">
      {!state.history.length && <p className="muted" role="status">{state.historyBusy ? '正在读取…' : '还没有练习记录。'}</p>}
      {state.history.map((entry) => <button type="button" className="practice-history-item" key={entry.id} onClick={() => setReviewId(entry.id)}>
        <span className="practice-history-meta">{dateLabel(entry.startedAt)} · 第 {entry.seq} 题 · {entry.answer?.revealed ? '已看答案' : entry.result === 'right' ? '已答对' : entry.result === 'wrong' ? '待巩固' : entry.answer?.advanced ? '已跳过' : '未完成'}</span>
        <span className="practice-history-stem"><MathMarkdown>{entry.question.metadata?.bankId ? reviewedMathMarkdown(entry.question.question) : entry.question.question}</MathMarkdown></span>
      </button>)}
      {state.error && <p role="status" className="muted">{state.error}</p>}
      {state.historyMore && <button type="button" className="practice-text-button" disabled={state.historyBusy} onClick={() => state.showHistory(true)}>{state.historyBusy ? '正在读取…' : '更多记录'}</button>}
    </main>{reviewId && <PracticeReview itemId={reviewId} onClose={closeReview} />}
  </div>;
  if (state.screen === 'run' && state.session) {
    const item = state.session.items[state.itemIndex];
    if (!item) return <div className="practice-entry"><p role="status">{state.generating ? '下一道题正在生成…' : '这一轮的后续题目未能生成，已完成的练习已保存。'}</p>
      {state.error && <p className="muted">{state.error}</p>}
      {state.generating && <button type="button" className="practice-text-button" onClick={state.cancel}>停止出题</button>}
      <button type="button" className="button button-secondary" onClick={state.showEntry}>返回练习</button></div>;
    const routeBased = isRouteQuestion(item.question), single = routeBased && item.question.selectionMode !== 'multi';
    const feedback = item.answer?.feedback && !state.feedbackHidden;
    const expanded = expandedItemId === item.id;
    async function toggleDetails() {
      if (state.busy) return;
      if (expanded) { setExpandedItemId(null); return; }
      if (!item.answer?.revealed) {
        await state.reveal();
        if (!usePracticeStore.getState().session?.items.find((entry) => entry.id === item.id)?.answer?.revealed) return;
      }
      setExpandedItemId(item.id);
    }
    return <div className="practice-page">
      <header className="page-header"><button type="button" className="icon-button" aria-label="返回练习入口" disabled={state.busy} onClick={state.showEntry}><ArrowLeft size={20} /></button>
        <h1 id="practice-active-title" className="page-title">{routeBased ? '判断解题路线' : '练习'}</h1><span className="muted">{state.itemIndex + 1}/{state.session.generationStatus === 'preparing' ? 3 : state.session.items.length}</span></header>
      <main className="practice-content">
        {state.generating && <p className="muted field-hint" role="status">后续题目正在生成，当前题可以先练。<button type="button" className="practice-text-button" onClick={state.cancel}>停止出题</button></p>}
        <div className="practice-question"><MathMarkdown>{item.question.metadata?.bankId ? reviewedMathMarkdown(item.question.question) : item.question.question}</MathMarkdown></div>
        {item.question.metadata?.reviewStatus === 'model_unverified' && <p className="muted field-hint">AI 变式草稿，尚未人工核对。本题作答不计入掌握度。</p>}
        <p className="practice-prompt">{state.mode === 'selection' ? selectionPrompt(item.question) : '写出你实际会怎样变形，以及接下来出现的新结构。关键步骤即可。'}</p>
        <div className="practice-modes" role="group" aria-label="作答方式">
          <button type="button" className={state.mode === 'selection' ? 'is-active' : ''} disabled={state.busy} onClick={() => state.setMode('selection')}>{routeBased ? '选路线' : '选方法'}</button>
          <button type="button" className={state.mode === 'steps' ? 'is-active' : ''} disabled={state.busy} onClick={() => state.setMode('steps')}>写关键步骤</button>
        </div>
        {state.mode === 'selection' ? <div className="practice-options">{item.question.options.map((option) => <label key={option.id} className={`practice-option${state.selectedIds.includes(option.id) ? ' is-selected' : ''}`}>
          <input type={single ? 'radio' : 'checkbox'} name="practice-route" value={option.id} checked={state.selectedIds.includes(option.id)} disabled={state.busy} onChange={() => state.toggleMethod(option.id)} />
          <span className={`practice-check${single ? ' is-radio' : ''}`} aria-hidden="true">{state.selectedIds.includes(option.id) && <Check size={14} />}</span><span className="practice-option-name"><MathMarkdown>{option.name}</MathMarkdown></span>
        </label>)}</div> : <textarea className="field-control practice-steps" aria-label="你的关键步骤" placeholder="写下关键变形和使用条件，支持公式和大白话…" value={state.steps} disabled={state.busy} onChange={(event) => state.setSteps(event.target.value)} />}
        {feedback && <div className="practice-feedback" role="status"><MathMarkdown>{item.answer.feedback}</MathMarkdown></div>}
        {state.error && <p className="muted field-hint" role="status">{state.error}</p>}
        <button type="button" className="practice-text-button practice-detail-toggle" disabled={state.busy} onClick={toggleDetails} aria-expanded={expanded} aria-controls={`practice-details-${item.id}`}>
          {expanded ? '收起路线与答案' : item.answer?.revealed ? '展开路线与答案' : '查看路线与答案'}
        </button>
        {expanded && <div id={`practice-details-${item.id}`}>
          {routeBased && <RouteReview question={item.question} selectedIds={item.answer?.selectedIds} revealed />}
          <div className="practice-solution"><MathMarkdown>{item.question.solution}</MathMarkdown></div>
        </div>}
        <div className="practice-actions">
          <button type="button" className="button button-primary" disabled={state.busy || (state.mode === 'selection' ? !state.selectedIds.length : !state.steps.trim())} onClick={state.submit}>{state.busy ? '正在检查…' : '提交'}</button>
          {feedback && <button type="button" className="button button-secondary" disabled={state.busy} onClick={state.retryItem}>再试一次</button>}
          <button type="button" className="button button-secondary" disabled={state.busy} onClick={state.next}>{state.itemIndex === state.session.items.length - 1 && state.session.generationStatus !== 'preparing'
            ? state.session.generationStatus === 'failed' ? '结束本轮' : '完成这一轮' : '下一道'}</button>
        </div>
        {state.busy && <button type="button" className="practice-text-button" onClick={state.cancel}>取消检查</button>}
      </main>
    </div>;
  }
  if (state.screen === 'finished') return <div className="practice-entry"><p>这一轮结束了，题面、你的作答和反馈已保存。</p><button type="button" className="button button-secondary" onClick={state.showEntry}>返回练习</button><button type="button" className="practice-text-button" onClick={() => state.showHistory()}>查看练习记录</button></div>;
  if (!edge) return <div className="practice-entry"><p className="muted" role="status">{state.error || '还没有接触过的练习情景。先在问答里问一道题，归类完成后，这里会出现相关练习。'}</p>
    {state.session && !state.session.finishedAt && <button type="button" className="practice-text-button" onClick={state.resume}>继续上次这一轮</button>}
    <button type="button" className="practice-text-button" onClick={() => state.showHistory()}>练习记录</button></div>;
  const goal = practicePresentation(edge);
  return <div className="practice-entry">
    <h1>选一组题来练</h1>
    <PracticeTargetPicker choices={state.choices} selected={edge} disabled={state.busy || state.generating} onSelect={state.selectChoice} />
    <div className="practice-goal-description"><MathMarkdown>{goal.description}</MathMarkdown></div>
    {goal.example && <div className="muted practice-goal-example"><MathMarkdown>{`例如：${goal.example}`}</MathMarkdown></div>}
    <p className="muted">{edge.count ? `你已经见过 ${edge.count} 道这类题。` : '可以先从这类题开始练。'}</p>
    <div className="practice-levels" role="group" aria-label="训练方式">{practiceLevels.map((level) => <button type="button" key={level.id} className={state.level === level.id ? 'is-active' : ''} disabled={state.busy || state.generating} onClick={() => state.setLevel(level.id)}>{level.name}</button>)}</div>
    <p className="muted practice-round-hint">{edge.localReady && edge.questionCount < 3 ? `本轮 ${edge.questionCount} 道题，先练已核对的题，后续继续补充。` : '一轮三道题，先做较容易的，再做需要多次变形或换一种做法的题。'}</p>
    {edge.localReady && <p className="muted field-hint">{edge.primaryScenarioId && edge.primaryQuestionCount < 3 && edge.questionCount >= 3
      ? `这类题已整理 ${edge.primaryQuestionCount} 道，每轮配合同组的其他情景练三题。`
      : `已有 ${edge.questionCount} 道本地题，每轮选${Math.min(3, edge.questionCount)}题，优先未做题。`}</p>}
    {!edge.localReady && <p className="muted field-hint practice-unprepared">这类题还没有本地题组。可从上面的列表选择已有题组，或主动让 AI 出题。</p>}
    {state.error && <p className="muted field-hint" role="status">{state.error}</p>}
    <div className="practice-actions"><button type="button" className="button button-secondary" disabled={state.busy || state.generating || !state.choices.some((choice, index) => choice.localReady && index !== state.choiceIndex)} onClick={state.changeEdge}>换一组</button>
      <button type="button" className="button button-primary" disabled={state.busy || state.generating || !edge.localReady} onClick={() => state.start()}>{state.busy ? '正在准备…' : state.generating ? '正在出题…' : edge.localReady ? '开练' : '本地题未准备'}</button></div>
    {!edge.localReady && !state.generating && <button type="button" className="practice-text-button" disabled={state.busy} onClick={() => state.start({ ai: true })}>让 AI 编写路线变式</button>}
    {state.generating && <p className="muted field-hint" role="status">{state.generationProgress}第一道准备好后即可开始。</p>}
    {state.busy || state.generating ? <button type="button" className="practice-text-button" onClick={state.cancel}>取消</button>
      : state.session && !state.session.finishedAt && <button type="button" className="practice-text-button" onClick={state.resume}>继续上次这一轮</button>}
    <button type="button" className="practice-text-button practice-history-link" disabled={state.busy} onClick={() => state.showHistory()}>练习记录</button>
  </div>;
}
