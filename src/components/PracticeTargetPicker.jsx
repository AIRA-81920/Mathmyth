import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ModalFrame from './ModalFrame.jsx';
import { practicePresentation } from '../core/practice/presentation.js';

export default function PracticeTargetPicker({ choices, selected, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const id = useId(), selectedRef = useRef(null);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const filtered = choices.filter((choice) => [practicePresentation(choice).title, choice.scenarioName, choice.blockName, choice.groupName].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { title: '已有本地题', items: filtered.filter((choice) => choice.localReady) },
    { title: '还没有本地题，需 AI 出题', items: filtered.filter((choice) => !choice.localReady) },
  ];
  return <>
    <button type="button" className="practice-edge-name practice-target-trigger" aria-label="选择训练题组" aria-haspopup="dialog" aria-expanded={open}
      disabled={disabled} onClick={() => { setQuery(''); setOpen(true); }}>
      <span>{practicePresentation(selected).title}</span><ChevronDown size={17} aria-hidden="true" />
    </button>
    <ModalFrame open={open} className="practice-target-dialog" titleId={`${id}-title`} onClose={() => setOpen(false)} initialFocusRef={selectedRef}>
      <h2 id={`${id}-title`}>选择题组</h2>
      <input className="field-control" type="search" aria-label="搜索题组" placeholder="搜索章节、情景或题型" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="practice-target-list">
        {!filtered.length && <p className="muted field-hint">没有找到相关题组。</p>}
        {groups.filter((group) => group.items.length).map((group) => <section key={group.title}>
          <h3 className="muted">{group.title}</h3>
          {group.items.map((choice) => <button key={choice.key} ref={choice.key === selected.key ? selectedRef : undefined} type="button"
            className={`practice-target-option${choice.key === selected.key ? ' is-selected' : ''}`} aria-pressed={choice.key === selected.key}
            onClick={() => { if (onSelect(choice.key)) setOpen(false); }}>
            <span>{practicePresentation(choice).title}</span>
            <small className="muted">{choice.localReady ? choice.primaryScenarioId && choice.primaryQuestionCount < 3 && choice.questionCount >= 3
              ? `本类 ${choice.primaryQuestionCount} 题 · 配合同组相关题`
              : `本地 ${choice.questionCount} 题` : '暂无本地题'}{choice.count ? ` · 见过 ${choice.count} 道相关题` : ''}</small>
          </button>)}
        </section>)}
      </div>
      <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>关闭</button>
    </ModalFrame>
  </>;
}
