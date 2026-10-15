import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TrailOutline from '../components/TrailOutline.jsx';
import PersonalNotes from '../components/PersonalNotes.jsx';
import SavedQuestions from '../components/SavedQuestions.jsx';
import TrailBottomShelf from '../components/TrailBottomShelf.jsx';
import { loadSkeleton } from '../core/skeleton/load.js';
import { buildTrail } from '../core/skeleton/trail.js';
import { loadTrail, onDatabaseChange } from '../core/db/database.js';
import { useAppStore } from '../store/appStore.js';

// 2026-10-09: user confirmed that exposed nodes appear in the trail too.
// buildTrail already limits nodes to actual encounters.
const includeTouched = () => true;
export default function Trail({ includeNode = includeTouched, onMethod, onScenario, active = true, savedQuestions = <SavedQuestions showTitle={false} /> }) {
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState('');
  const selectConversation = useAppStore((state) => state.selectConversation);
  const ref = useRef(null);
  const scrollEpoch = useRef(useAppStore.getState().trailEpoch);
  const restored = useRef(false);
  const epoch = useAppStore((state) => state.trailEpoch);
  useLayoutEffect(() => {
    if (epoch !== scrollEpoch.current) { scrollEpoch.current = epoch; restored.current = false; }
    if (ref.current && !restored.current) { ref.current.scrollTop = useAppStore.getState().preferences.trailScroll; restored.current = true; }
  }, [nodes, epoch]);
  useEffect(() => {
    if (typeof includeNode !== 'function') return;
    let live = true;
    let version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const [skeleton, data] = await Promise.all([loadSkeleton(), loadTrail()]);
        if (live && version === current) { setNodes(buildTrail(skeleton, data, includeNode)); setError(''); }
      } catch {
        if (live && version === current) setError('足迹暂时没能读出来，请重新打开这里。');
      }
    }
    const unsubscribe = onDatabaseChange((event) => {
      if (['completeJob', 'deleteConversation', 'commitImport', 'clearDatabase', 'gradePracticeItem', 'revealPracticeItem'].includes(event.method)) refresh();
    });
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [includeNode]);
  return <div className="trail-page"><div ref={ref} className="trail-scroll" onScroll={(event) => useAppStore.getState().setTrailScroll(event.currentTarget.scrollTop, scrollEpoch.current)}>
    {nodes.length ? <TrailOutline active={active} nodes={nodes} onMethod={onMethod} onScenario={onScenario ?? ((node) => useAppStore.getState().openScenario(node))} onQuestion={(item) => selectConversation(item.conversationId)} />
      : <div className="trail-empty"><p className="muted" role={error ? 'status' : undefined}>{error || '你还没走过任何地方。去问一道题吧。'}</p></div>}
  </div><TrailBottomShelf active={active} items={[
    { key: 'notes', title: '自己总结的易错点', content: <PersonalNotes showTitle={false} /> },
    { key: 'saved', title: '收藏的题', content: savedQuestions },
  ]} /></div>;
}
