import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { loadTrail, onDatabaseChange } from '../core/db/database.js';
import QuestionLink from '../components/QuestionLink.jsx';
import MethodChat from '../components/MethodChat.jsx';
import PracticeReview from '../components/PracticeReview.jsx';
import QuestionSnapshot from '../components/QuestionSnapshot.jsx';
import MathMarkdown from '../components/MathMarkdown.jsx';
import KnowledgePatterns from '../components/KnowledgePatterns.jsx';
import useKnowledgeExposure from '../components/useKnowledgeExposure.js';
import { methodConnections } from '../core/knowledge/index.js';
import { patternsForMethod } from '../core/knowledge/patterns.js';
import { knowledgeMarkdown, methodLearningContent } from '../core/skeleton/content.js';
import { readKnowledgeView, saveKnowledgeView } from '../core/skeleton/viewState.js';
import '../styles/scenario-content.css';

const label = { exposed: '巩固中', consolidating: '巩固中', mastered: '已掌握' };
export default function Method({ onScenario }) {
  const exposure = useKnowledgeExposure();
  const exposureClass = (kind, id) => exposure.ready && !(kind === 'method' ? exposure.methods : exposure.scenarios).has(id) ? ' knowledge-unseen' : '';
  const methodId = useAppStore((state) => state.methodId);
  const viewEpoch = useAppStore((state) => state.trailEpoch);
  const route = useAppStore((state) => state.route);
  const close = useAppStore((state) => state.closeMethod);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const viewKey = `method:${methodId}`;
  const [expanded, setExpanded] = useState(() => Boolean(readKnowledgeView(viewKey, viewEpoch).expanded));
  const [questionsOpen, setQuestionsOpen] = useState(() => Boolean(readKnowledgeView(viewKey, viewEpoch).questionsOpen));
  const [stepsOpen, setStepsOpen] = useState(() => Boolean(readKnowledgeView(viewKey, viewEpoch).stepsOpen));
  const body = useRef(null);
  const [reviewId, setReviewId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const closeReview = useCallback(() => setReviewId(null), []);
  useEffect(() => { saveKnowledgeView(viewKey, viewEpoch, { expanded, questionsOpen, stepsOpen }); }, [viewKey, viewEpoch, expanded, questionsOpen, stepsOpen]);
  useLayoutEffect(() => {
    if (content && body.current && route === 'method') body.current.scrollTop = readKnowledgeView(viewKey, viewEpoch).scroll ?? 0;
  }, [content?.method.id, route, viewKey, viewEpoch]);
  useEffect(() => {
    let live = true, request = 0;
    const remembered = readKnowledgeView(viewKey, viewEpoch);
    setContent(null); setExpanded(Boolean(remembered.expanded)); setQuestionsOpen(Boolean(remembered.questionsOpen)); setStepsOpen(Boolean(remembered.stepsOpen));
    async function refresh() {
      const owner = ++request;
      try {
        const [skeleton, data] = await Promise.all([loadSkeleton(), loadTrail()]);
        const method = skeleton.methodById.get(methodId);
        if (!method) throw new Error();
        const mastery = new Map(data.mastery.map((row) => [`${row.targetType}:${row.targetId}`, row]));
        const touched = new Set(data.encounters.map((entry) => entry.scenarioId));
        const applies = skeleton.scenariosForMethod.get(methodId).map((id) => skeleton.scenarioById.get(id));
        const seen = new Set();
        const questions = data.encounters.filter((entry) => {
          if (entry.methodId !== methodId || !(entry.conversationId || entry.practiceItemId || entry.question)) return false;
          const key = entry.practiceItemId || entry.conversationId || entry.question;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        const connections = methodConnections(skeleton, methodId);
        if (live && request === owner) { setContent({ method, mastery, touched, applies, questions, connections, skeleton, patterns: patternsForMethod(skeleton, methodId) }); setError(''); }
      } catch { if (live && request === owner) setError('方法页暂时没能读出来，请重新打开这里。'); }
    }
    refresh();
    const unsubscribe = onDatabaseChange((event) => {
      if (['completeJob','deleteConversation','gradePracticeItem','revealPracticeItem'].includes(event.method)) refresh();
    });
    return () => { live = false; unsubscribe(); };
  }, [methodId, viewEpoch]);
  const execution = content?.mastery.get(`method:${methodId}`)?.state;
  const learning = content && methodLearningContent(content.method);
  const explore = onScenario ?? ((node) => useAppStore.getState().openScenario(node));
  const wide = content && (content.applies.length >= 4 || new Set(content.applies.map((scenario) => scenario.block_id)).size >= 2);
  return <div className="method-page">
    <header className="page-header"><button type="button" className="icon-button" aria-label="返回足迹" onClick={close}><ArrowLeft size={20} /></button>
      <h1 className="page-title">{content?.method.name || '方法'}</h1><div className="header-spacer" /></header>
    <main ref={body} className="method-content" onScroll={(event) => { if (content?.method.id === methodId && event.currentTarget.clientHeight > 0 && route === 'method') saveKnowledgeView(viewKey, viewEpoch, { scroll: event.currentTarget.scrollTop }); }}>
      {error ? <p className="muted" role="status">{error}</p> : !content ? <p className="muted">正在读取…</p> : <>
        <section className="method-section method-learning"><h2>它做什么</h2><MathMarkdown>{knowledgeMarkdown(learning.definition)}</MathMarkdown></section>
        {!!content.patterns.length && <KnowledgePatterns key={`${viewEpoch}:${viewKey}`} patterns={content.patterns} skeleton={content.skeleton} viewKey={viewKey} viewEpoch={viewEpoch} methodId={methodId} onScenario={explore} onMethod={(id) => useAppStore.getState().openMethod(id)} />}
        {!!learning.signals.length && <section className="method-section method-learning"><h2>看到这些特征可以想到它</h2><ul>{learning.signals.map((signal, index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(signal)}</MathMarkdown></li>)}</ul></section>}
        {!!learning.examples.length && <section className="method-section method-learning"><h2>典型例子</h2>{learning.examples.map((example, index) => <div className="knowledge-item" key={index}><MathMarkdown>{knowledgeMarkdown(example.statement)}</MathMarkdown><MathMarkdown>{knowledgeMarkdown(example.answer_sketch)}</MathMarkdown></div>)}</section>}
        {learning.principle && <section className="method-section method-learning"><h2>为什么成立</h2><MathMarkdown>{learning.principle}</MathMarkdown>
          {learning.basis && <p className="knowledge-note">{learning.basis}</p>}
          {learning.source && <a className="knowledge-source" href={learning.source.url} target="_blank" rel="noreferrer">{learning.source.title} · 通俗转述</a>}</section>}
        {!!learning.conditions.length && <section className="method-section method-learning"><h2>使用前先检查</h2><ul>{learning.conditions.map((condition, index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(condition)}</MathMarkdown></li>)}</ul></section>}
        <section className="method-section method-execution"><h2>用得出</h2><span className={`trail-${execution || 'exposed'}`}>{execution === 'mastered' && content.patterns.length ? '已有独立成功记录' : label[execution] || '未接触'}</span></section>
        <section className="method-section"><h2>接触过的情景</h2><div className="method-scenarios">
          {content.applies.filter((scenario) => content.touched.has(scenario.id)).map((scenario) => <button key={scenario.id} type="button" className="knowledge-link" onClick={() => explore({ id: scenario.id, kind: 'scenario' })}><span>{scenario.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}
        </div></section>
        {!!content.applies.length && <section className="method-section">{wide ? <button type="button" className={`method-disclosure${expanded ? ' is-open' : ''}`} aria-expanded={expanded} aria-controls="method-coverage" onClick={() => setExpanded(!expanded)}>
          <span>这招还能用在这些地方 · {content.applies.length}</span>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          : <h2>这招可以用在哪里</h2>}
          {(!wide || expanded) && <div id="method-coverage" className="method-scenarios method-coverage">{content.applies.map((scenario) => <button key={scenario.id} type="button" className={`knowledge-link${exposureClass('scenario', scenario.id)}`} onClick={() => explore({ id: scenario.id, kind: 'scenario' })}><span>{scenario.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>}
        </section>}
        {!!content.connections.length && <section className="method-section method-learning"><h2>接下来还可能遇到什么</h2>{content.connections.map(connection => <div className="knowledge-item" key={connection.id}>
          <button type="button" className={`knowledge-link${exposureClass(connection.to.kind, connection.to.id)}`} onClick={() => connection.to.kind === 'scenario' ? explore({ kind: 'scenario', id: connection.to.id }) : useAppStore.getState().openMethod(connection.to.id)}><span>{connection.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
          <MathMarkdown>{knowledgeMarkdown(connection.output)}</MathMarkdown><ul>{connection.conditions.map((condition,index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(condition)}</MathMarkdown></li>)}</ul>
          <p className="knowledge-note">{connection.boundary}</p></div>)}</section>}
        {!!learning.steps.length && <section className="method-section method-learning"><button type="button" className={`method-disclosure${stepsOpen ? ' is-open' : ''}`} aria-expanded={stepsOpen} aria-controls="method-standard-steps" onClick={() => setStepsOpen(!stepsOpen)}><span>常见步骤</span>{stepsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          {stepsOpen && <ol id="method-standard-steps" className="method-step-list">{learning.steps.map((step, index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(step)}</MathMarkdown></li>)}</ol>}</section>}
        {!!learning.pitfalls.length && <section className="method-section method-learning"><h2>容易踩的坑</h2><ul>{learning.pitfalls.slice(0, 3).map((pitfall, index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(pitfall)}</MathMarkdown></li>)}</ul></section>}
        {content.questions.length > 0 && <section className="method-section"><button type="button" className={`method-disclosure${questionsOpen ? ' is-open' : ''}`} aria-expanded={questionsOpen} aria-controls="method-questions" onClick={() => setQuestionsOpen(!questionsOpen)}>
          <span>碰过的题</span>{questionsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          {questionsOpen && <div id="method-questions">{content.questions.map((item) => <QuestionLink key={item.id} item={item} onClick={() => item.practiceItemId ? setReviewId(item.practiceItemId) : item.conversationId ? selectConversation(item.conversationId) : setSnapshot(item.question)} />)}</div>}
        </section>}
      </>}
    </main>
    {content && <MethodChat method={content.method} />}
    {reviewId && <PracticeReview itemId={reviewId} onClose={closeReview} />}
    {snapshot && <QuestionSnapshot question={snapshot} onClose={() => setSnapshot(null)} />}
  </div>;
}
