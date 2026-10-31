import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { usePracticeStore } from '../store/practiceStore.js';
import { useAppStore } from '../store/appStore.js';
import { practiceChoiceFor } from '../core/practice/targetChoice.js';

export default function PracticeShortcut({ scenarioId, methodId, scenarioIds, children }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, [scenarioId, methodId]);
  async function open() {
    if (busy || useAppStore.getState().dataOperation) return;
    const owner = ++request.current;
    setBusy(true); setError('');
    try {
      await usePracticeStore.getState().initialize();
      if (owner !== request.current || useAppStore.getState().dataOperation) return;
      const practice = usePracticeStore.getState();
      if (practice.busy || practice.generating) { setError('当前练习正在处理，请稍后再试。'); return; }
      const choice = practiceChoiceFor(practice.choices, { scenarioId, methodId, scenarioIds });
      if (!choice || !practice.selectChoice(choice.key)) { setError(practice.error || '还没有对应的练习入口。题目归位后可在这里继续练习。'); return; }
      practice.showEntry();
      useAppStore.setState({ route: 'main', activeArea: 'practice', drawerOpen: false,
        methodChatOpen: false, scenarioRef: null, methodId: null, knowledgeBack: [] });
    } catch { if (owner === request.current) setError('练习入口暂时没能读出来，请重试。'); }
    finally { if (owner === request.current) setBusy(false); }
  }
  return <div className="knowledge-practice-shortcut">
    <button type="button" className="knowledge-link" disabled={busy} onClick={open}><span>{busy ? '正在准备…' : children}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
    {error && <p className="muted field-hint" role="status">{error}</p>}
  </div>;
}
