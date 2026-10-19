import { useAppStore } from '../store/appStore.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import useHoldToOpen, { HOLD_WAVE_MS } from './useHoldToOpen.js';
import MathMarkdown from './MathMarkdown.jsx';
import QuestionLink from './QuestionLink.jsx';
import { knowledgeMarkdown } from '../core/skeleton/content.js';
import '../styles/scenario-content.css';
import { trailIdentity, trailBranchPath, trailExpansionKey } from '../core/skeleton/trailLocation.js';

function Branch({ node, onMethod, onQuestion, onScenario, active, parentPath = '' }) {
  const path = trailBranchPath(parentPath, node);
  const key = trailExpansionKey(parentPath, node);
  const open = useAppStore((state) => Boolean(state.preferences.trailExpanded[key]));
  const toggle = useAppStore((state) => state.toggleTrailNode);
  const state = node.mastery?.state;
  const intensity = node.kind === 'block' || node.kind === 'group' ? 'structure' : state || 'exposed';
  const isMethod = node.kind === 'method';
  const items = isMethod ? node.encounters : node.children;
  const actionable = items.length > 0 || Boolean(isMethod && onMethod);
  const hold = useHoldToOpen({ enabled: active && !isMethod && Boolean(onScenario), onOpen: () => onScenario?.({ id: node.id, kind: node.kind }) });
  return (
    <li className={`trail-node trail-${intensity}`} data-node-key={trailIdentity(node)} data-view-key={path}>
      <div className="trail-row-actions">
      {isMethod ? <button type="button" className={`trail-row${open ? ' is-open' : ''}`} disabled={!actionable}
        aria-expanded={!onMethod && actionable ? open : undefined} onClick={() => onMethod ? onMethod(node.id) : toggle(key)}>
        <span className="trail-arrow-space" aria-hidden="true" /><span>{node.name}</span>
      </button> : <button type="button" className={`trail-row trail-title${open ? ' is-open' : ''}`} disabled={!actionable && !onScenario}
        aria-expanded={actionable ? open : undefined} aria-label={`${open ? '折叠' : '展开'}${node.name}，长按查看详情`}
        {...hold.handlers} onClick={(event) => {
          if (hold.consumeClick()) { event.preventDefault(); return; }
          if (actionable) toggle(key);
        }}>
        {hold.charging && <span className="trail-hold-wave" aria-hidden="true" style={{ animationDuration: `${HOLD_WAVE_MS}ms` }} />}
        {actionable ? open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" /> : <span className="trail-arrow-space" aria-hidden="true" />}
        <span className="trail-label">{node.name}</span>
      </button>}
      </div>
      {isMethod && <div className="trail-condition muted"><MathMarkdown>{knowledgeMarkdown(node.whenToPrefer)}</MathMarkdown></div>}
      {open && <ul className="trail-children">
        {isMethod ? items.filter((item, index, all) => all.findIndex((other) => (other.practiceItemId || other.conversationId) === (item.practiceItemId || item.conversationId)) === index)
          .map((item) => <li key={item.id}><QuestionLink item={item} onClick={() => onQuestion?.(item)} /></li>)
          : items.map((child) => <Branch key={child.id} node={child} onMethod={onMethod} onQuestion={onQuestion} onScenario={onScenario} active={active} parentPath={path} />)}
      </ul>}
    </li>
  );
}

export default function TrailOutline({ nodes, onMethod, onQuestion, onScenario, active = true }) {
  return <ul className="trail-outline">{nodes.map((node) => <Branch key={node.id} node={node} onMethod={onMethod} onQuestion={onQuestion} onScenario={onScenario} active={active} />)}</ul>;
}
