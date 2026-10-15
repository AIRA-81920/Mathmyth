import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { loadSkeleton } from '../core/skeleton/load.js';
import { getKnowledgeNode, knowledgeMarkdown } from '../core/skeleton/content.js';
import { readKnowledgeView, saveKnowledgeView } from '../core/skeleton/viewState.js';
import { useAppStore } from '../store/appStore.js';
import MathMarkdown from '../components/MathMarkdown.jsx';
import KnowledgePatterns from '../components/KnowledgePatterns.jsx';
import useKnowledgeExposure from '../components/useKnowledgeExposure.js';
import '../styles/scenario-content.css';

const kinds = { scenario: '情景', group: '情景组', block: '板块' };

export default function Scenario({ nodeRef, onBack, onMethod, onScenario }) {
  const exposure = useKnowledgeExposure();
  const unseen = (kind, id) => exposure.ready && !(kind === 'method' ? exposure.methods : exposure.scenarios).has(id) ? ' knowledge-unseen' : '';
  const [node, setNode] = useState(null), [skeleton, setSkeleton] = useState(null), [error, setError] = useState('');
  const body = useRef(null);
  const viewEpoch = useAppStore((state) => state.trailEpoch);
  const viewKey = `${nodeRef?.kind}:${nodeRef?.id}`;
  const openScenario = onScenario ?? ((ref) => useAppStore.getState().openScenario(ref));
  const openMethod = onMethod ?? ((id) => useAppStore.getState().openMethod(id));
  useEffect(() => {
    let live = true;
    setNode(null); setError('');
    loadSkeleton().then((skeleton) => {
      const next = getKnowledgeNode(skeleton, nodeRef);
      if (!live) return;
      if (next) { setNode(next); setSkeleton(skeleton); } else setError('这个情景已不存在，请返回重新选择。');
    }).catch(() => { if (live) setError('情景资料暂时没能读出来，请重新打开。'); });
    return () => { live = false; };
  }, [nodeRef?.id, nodeRef?.kind]);
  useLayoutEffect(() => {
    if (node?.id === nodeRef?.id && node?.kind === nodeRef?.kind && body.current) body.current.scrollTop = readKnowledgeView(viewKey, viewEpoch).scroll ?? 0;
  }, [node?.id, viewKey, viewEpoch]);
  return <div className="knowledge-page">
    <header className="page-header"><button className="icon-button" type="button" aria-label="返回上一页" onClick={onBack ?? (() => useAppStore.getState().closeScenario())}><ArrowLeft size={20} /></button>
      <h1 className="page-title">{node?.name || kinds[nodeRef?.kind] || '情景'}</h1><span className="header-spacer" /></header>
    <main ref={body} className="knowledge-content" onScroll={(event) => { if (node?.id === nodeRef?.id && node?.kind === nodeRef?.kind && event.currentTarget.clientHeight > 0) saveKnowledgeView(viewKey, viewEpoch, { scroll: event.currentTarget.scrollTop }); }}>
      {error ? <p className="muted" role="status">{error}</p> : !node ? <p className="muted" role="status">正在读取…</p> : <>
        {(node.parent || node.group) && <nav className="knowledge-path" aria-label="知识层级">
          {node.parent && <button type="button" onClick={() => openScenario(node.parent)}>{node.parent.name}</button>}
          {node.group && <button type="button" onClick={() => openScenario(node.group)}>{node.group.name}</button>}
        </nav>}
        <section className="knowledge-section"><h2>这是什么</h2><MathMarkdown>{knowledgeMarkdown(node.definition)}</MathMarkdown>
          {node.note && <div className="knowledge-note"><MathMarkdown>{knowledgeMarkdown(node.note)}</MathMarkdown></div>}</section>
        {!!node.patterns?.length && <KnowledgePatterns key={`${viewEpoch}:${viewKey}`} patterns={node.patterns} skeleton={skeleton} viewKey={viewKey} viewEpoch={viewEpoch} onScenario={openScenario} onMethod={openMethod} />}
        {!!node.signals.length && <section className="knowledge-section"><h2>看到哪些特征可以想到它</h2><ul>{node.signals.map((signal, index) => <li key={index}><MathMarkdown>{knowledgeMarkdown(signal)}</MathMarkdown></li>)}</ul></section>}
        {!!node.examples.length && <section className="knowledge-section"><h2>常见长相</h2>{node.examples.map((example, index) => <div className="knowledge-item" key={index}><MathMarkdown>{knowledgeMarkdown(example)}</MathMarkdown></div>)}</section>}
        {!!node.boundaries.length && <section className="knowledge-section"><h2>和相近情景怎样区分</h2>{node.boundaries.map((entry) => <div className="knowledge-item" key={entry.scenarioId}>
          <button type="button" className={`knowledge-link${unseen('scenario', entry.scenarioId)}`} onClick={() => openScenario({ kind: 'scenario', id: entry.scenarioId })}><span>{entry.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
          <MathMarkdown>{knowledgeMarkdown(entry.how)}</MathMarkdown></div>)}</section>}
        {!!node.methods.length && <section className="knowledge-section"><h2>可以考虑的方法</h2>{node.methods.map((method) => <div className="knowledge-item" key={method.id}>
          <button type="button" className={`knowledge-link${unseen('method', method.id)}`} onClick={() => openMethod(method.id)}><span>{method.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
          <MathMarkdown>{knowledgeMarkdown(method.condition)}</MathMarkdown></div>)}</section>}
        {!!node.children.length && <section className="knowledge-section"><h2>具体情景</h2>{node.children.map((scenario) => <div className="knowledge-item" key={scenario.id}>
          <button type="button" className={`knowledge-link${unseen('scenario', scenario.id)}`} onClick={() => openScenario({ kind: 'scenario', id: scenario.id })}><span>{scenario.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
          <MathMarkdown>{knowledgeMarkdown(scenario.definition)}</MathMarkdown></div>)}</section>}
      </>}
    </main>
  </div>;
}
