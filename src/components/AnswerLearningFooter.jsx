import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import QuestionRoutePanel from './QuestionRoutePanel.jsx';
import { routePaths } from '../core/chat/questionRoutes.js';
import { getMessageQuestionClassification, setQuestionStar, onDatabaseChange } from '../core/db/database.js';
import { useAppStore } from '../store/appStore.js';
import '../styles/answer-learning.css';

export default function AnswerLearningFooter({ result, skeleton, disabled = false }) {
  const [classification, setClassification] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [picking, setPicking] = useState(false), [fallback, setFallback] = useState(null);
  const [offerOther, setOfferOther] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const owner = ++epoch.current;
    let request = 0;
    const refresh = async () => {
      const ticket = ++request;
      try {
        const value = await getMessageQuestionClassification(result.messageId);
        if (epoch.current === owner && ticket === request) setClassification(value);
      } catch { /* A delayed classification must not interrupt the answer. */ }
    };
    refresh();
    const unsubscribe = onDatabaseChange(({ method }) => {
      if (['checkpointJob', 'completeJob', 'setQuestionStar', 'removeStarredQuestion', 'commitImport', 'clearDatabase'].includes(method)) refresh();
    });
    return () => { epoch.current++; unsubscribe(); };
  }, [result.messageId]);
  const isQuestion = classification?.isMathQuestion ?? result.isMathQuestion;
  if (isQuestion === false && !result.routes?.length) return null;
  const choices = result.ordered ? result.routes.flatMap(route => routePaths(route).map((path, pathIndex) => ({
    questionIndex: route.question_index, pathIndex,
    label: [...new Set(path.steps.map(step => skeleton?.methodById.get(step.method_id)?.name
      || skeleton?.scenarioById.get(step.scenario_id)?.name).filter(Boolean))].join(' → '),
  }))) : [];
  async function practice(choice, ai = false) {
    if (busy || disabled) return;
    const owner = epoch.current;
    setBusy(true); setError(''); setFallback(null); setOfferOther(false);
    try {
      const resultOfPractice = await useAppStore.getState().startRelatedPractice({
        answerId: result.answerId, userMessageId: result.messageId, ...choice, relation: 'similar', ai,
      });
      if (epoch.current !== owner) return;
      if (!resultOfPractice?.ok) {
        setError(resultOfPractice?.error || '这次练习没有准备完成。');
        setOfferOther(Boolean(resultOfPractice?.canSelectPractice));
        if (resultOfPractice?.canGenerate && !ai) setFallback(choice);
      } else setPicking(false);
    } finally { if (epoch.current === owner) setBusy(false); }
  }
  async function star() {
    if (busy || disabled || isQuestion !== true) return;
    const owner = epoch.current;
    setBusy(true); setError('');
    try {
      await setQuestionStar({ messageId: result.messageId, starred: !classification?.starred });
      const value = await getMessageQuestionClassification(result.messageId);
      if (epoch.current === owner) setClassification(value);
    } catch (failure) { if (epoch.current === owner) setError(failure.userMessage || '收藏尚未保存，请重试。'); }
    finally { if (epoch.current === owner) setBusy(false); }
  }
  return <section className="answer-learning" data-answer-learning={result.answerId} aria-label="这道题的后续操作" data-no-area-swipe>
    {result.updated && <p className="muted field-hint">更新后的本题路径</p>}
    <div className="answer-learning-actions">
      <QuestionRoutePanel result={result} skeleton={skeleton} />
      {choices.length > 0 && <button type="button" className="practice-text-button answer-practice-action" disabled={busy || disabled}
        onClick={() => { setError(''); setFallback(null); if (choices.length === 1) practice(choices[0]); else setPicking(value => !value); }}>
        {busy ? '正在准备…' : '试一道类似题'}
      </button>}
      {isQuestion === true && <button type="button" className="practice-text-button answer-star-action" disabled={busy || disabled}
        aria-pressed={Boolean(classification?.starred)} onClick={star}><Star size={14} fill={classification?.starred ? 'currentColor' : 'none'} aria-hidden="true" />{classification?.starred ? '已收藏原题' : '收藏原题'}</button>}
    </div>
    {picking && <div className="answer-practice-picker" aria-label="选择本题的训练思路"><p className="muted">想按哪条思路练？</p>
      {choices.map(choice => <button type="button" className="knowledge-link" key={`${choice.questionIndex}:${choice.pathIndex}`} disabled={busy || disabled}
        onClick={() => practice(choice)}>第 {choice.questionIndex} 题 · {choice.label || `解法 ${choice.pathIndex + 1}`}</button>)}
      <button type="button" className="practice-text-button" onClick={() => setPicking(false)}>收起</button>
    </div>}
    {result.updatedBy && <p className="muted field-hint">后续回答已更新这条路径，此处保留当时的思路。</p>}
    {error && <p className="muted field-hint" role="status">{error}</p>}
    {(fallback || offerOther) && <div className="answer-learning-fallback">{fallback && <button type="button" className="practice-text-button" disabled={busy || disabled} onClick={() => practice(fallback, true)}>让 AI 编一道</button>}
      <button type="button" className="practice-text-button" disabled={busy || disabled} onClick={() => useAppStore.getState().setActiveArea('practice')}>选择其他练习</button>
      {fallback && <span className="muted field-hint">AI 草稿尚未核对，不计独立掌握。</span>}</div>}
  </section>;
}
