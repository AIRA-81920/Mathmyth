import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import MathMarkdown from './MathMarkdown.jsx';
import { loadPatternProgress, onDatabaseChange } from '../core/db/database.js';
import { knowledgeMarkdown } from '../core/skeleton/content.js';
import { readKnowledgeView, saveKnowledgeView } from '../core/skeleton/viewState.js';

function useProgress() {
  const [state, setState] = useState({ items: [], failed: false });
  useEffect(() => {
    let live = true, request = 0;
    async function refresh() {
      const current = ++request;
      try {
        const items = await loadPatternProgress();
        if (live && current === request) setState({ items, failed: false });
      } catch { if (live && current === request) setState({ items: [], failed: true }); }
    }
    refresh();
    const unsubscribe = onDatabaseChange((event) => {
      if (['gradePracticeItem', 'revealPracticeItem', 'deleteConversation', 'clearDatabase', 'commitImport'].includes(event.method)) refresh();
    });
    return () => { live = false; unsubscribe(); };
  }, []);
  return state;
}

export default function KnowledgePatterns({ patterns, skeleton, viewKey, viewEpoch, methodId, onScenario, onMethod }) {
  const [openIds, setOpenIds] = useState(() => readKnowledgeView(viewKey, viewEpoch).patternOpenIds ?? []);
  const progress = useProgress();
  function toggle(id) {
    const next = openIds.includes(id) ? openIds.filter((value) => value !== id) : [...openIds, id];
    setOpenIds(next); saveKnowledgeView(viewKey, viewEpoch, { patternOpenIds: next });
  }
  return <section className="knowledge-section method-section knowledge-patterns">
    <h2>具体长相与第一步</h2>
    {patterns.map((pattern) => {
      const open = openIds.includes(pattern.id);
      const panelId = `pattern-${viewKey}-${pattern.id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const evidence = progress.items.filter((entry) => entry.patternId === pattern.id && (!methodId || entry.methodId === methodId));
      const recognized = evidence.some((entry) => entry.recognitionKeys.length);
      const executed = evidence.some((entry) => entry.executionKeys.length);
      return <article className="knowledge-pattern" key={pattern.id} data-pattern-id={pattern.id}>
        <button type="button" className="knowledge-pattern-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(pattern.id)}>
          <span>{pattern.name}</span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="knowledge-pattern-shape"><MathMarkdown>{knowledgeMarkdown(pattern.shape)}</MathMarkdown></div>
        <div className="knowledge-pattern-cue"><MathMarkdown>{knowledgeMarkdown(pattern.signals[0])}</MathMarkdown></div>
        {evidence.length > 0 && <p className="knowledge-pattern-progress">{recognized ? '识别：独立选对过' : '识别：尚无独立成功记录'} · {executed ? '使用：独立做对过' : '使用：尚无独立成功记录'}</p>}
        <div id={panelId} className="knowledge-pattern-detail" hidden={!open}>
          <h3>为什么想到</h3><MathMarkdown>{knowledgeMarkdown(pattern.why)}</MathMarkdown>
          <h3>先做这一步</h3><MathMarkdown>{knowledgeMarkdown(pattern.firstStep)}</MathMarkdown>
          <h3>先核对条件</h3><ul>{pattern.conditions.map((condition, i) => <li key={i}><MathMarkdown>{knowledgeMarkdown(condition)}</MathMarkdown></li>)}</ul>
          {pattern.signals.length > 1 && <ul>{pattern.signals.slice(1).map((signal, i) => <li key={i}><MathMarkdown>{knowledgeMarkdown(signal)}</MathMarkdown></li>)}</ul>}
          <h3>看一个例子</h3>{pattern.examples.map((example, i) => <div className="knowledge-pattern-example" key={i}>
            <MathMarkdown>{knowledgeMarkdown(example.statement)}</MathMarkdown><MathMarkdown>{knowledgeMarkdown(example.solution)}</MathMarkdown>
            <p className="knowledge-note">{example.source}</p>
          </div>)}
          {!!pattern.variants.length && <><h3>换一种长相</h3>{pattern.variants.map((variant, i) => <MathMarkdown key={i}>{knowledgeMarkdown(variant)}</MathMarkdown>)}</>}
          <h3>相似时先别急着套</h3><MathMarkdown>{knowledgeMarkdown(pattern.counterexample.statement)}</MathMarkdown><MathMarkdown>{knowledgeMarkdown(pattern.counterexample.reason)}</MathMarkdown>
          <div className="knowledge-pattern-links">{pattern.methodIds.filter((id) => id !== methodId).map((id) => <button type="button" className="knowledge-link" key={id} onClick={() => onMethod(id)}><span>{skeleton.methodById.get(id).name}</span><ArrowUpRight size={14} /></button>)}
            {pattern.nextScenarioIds.map((id) => <button type="button" className="knowledge-link" key={id} onClick={() => onScenario({ kind: 'scenario', id })}><span>{skeleton.scenarioById.get(id).name}</span><ArrowUpRight size={14} /></button>)}
          </div>
        </div>
      </article>;
    })}
    {progress.failed && <p className="knowledge-note" role="status">具体结构已显示，练习记录暂时没能读出来。</p>}
  </section>;
}
