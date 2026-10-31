import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import * as database from '../core/db/database.js';
import PracticeReview from './PracticeReview.jsx';
import '../styles/learning-continuations.css';

export default function PracticeContinuations({ active = true }) {
  const initialized = useAppStore(state => state.storageInitialized);
  const learnerId = useAppStore(state => state.learnerId);
  const dataOperation = useAppStore(state => state.dataOperation);
  // 复习安排按学科隔离，切换后要重新读取当前学科的那一份。
  const subjectEpoch = useAppStore(state => state.subjectEpoch);
  const [items, setItems] = useState([]), [busy, setBusy] = useState(null), [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const closeReview = useCallback(() => setViewing(null), []);
  useEffect(() => {
    setItems([]); setError(''); setViewing(null); setBusy(null);
    if (!initialized || dataOperation || !active) return;
    let live = true, version = 0;
    async function refresh() {
      const current = ++version;
      try { const result = await database.listPracticeReviews(); if (live && current === version) { setItems(result); setError(''); } }
      catch (failure) { if (live && current === version) setError(failure.userMessage || '复习安排暂时没能读出来，请重新打开这里。'); }
    }
    refresh();
    const off = database.onDatabaseChange(({ method }) => {
      if (['setPracticeReview', 'finishChatPractice', 'deleteConversation', 'commitImport', 'clearDatabase'].includes(method)) refresh();
    });
    return () => { live = false; off(); };
  }, [initialized, learnerId, dataOperation, active, subjectEpoch]);
  async function start(entry) {
    if (busy || dataOperation) return;
    setBusy(entry.id); setError('');
    try {
      const result = await useAppStore.getState().startRelatedPractice({ sourceItemId: entry.sourceItemId, reviewId: entry.id, relation: 'similar' });
      if (!result?.ok) setError(result?.error || '这道复习尚未准备好，请稍后重试。');
    } catch { setError('这道复习尚未准备好，请稍后重试。'); }
    finally { setBusy(null); }
  }
  async function cancel(entry) {
    if (busy || dataOperation) return;
    setBusy(entry.id); setError('');
    try {
      const item = await database.loadPracticeItem(entry.sourceItemId);
      await database.setPracticeReview({ id: item.runId, generation: item.generation }, item.id, false);
      setItems(await database.listPracticeReviews());
    } catch (failure) { setError(failure.userMessage || '撤销尚未保存，请重试。'); }
    finally { setBusy(null); }
  }
  if (!items.length && !error) return null;
  return <section className="learning-continuations" aria-label="接着上次练习">
    <h2>接着上次</h2><p className="muted field-hint">这些是你选择留下的复习安排，可以现在练，也可以以后再来。</p>
    {items.map(entry => <div className="learning-continuation" key={entry.id}>
      <p>上次练过的一道题，换一道再试试。</p>
      <span className="muted field-hint">{new Date(entry.dueAt).getTime() <= Date.now() ? '已到建议复习时间' : `建议 ${new Date(entry.dueAt).toLocaleDateString('zh-CN')} 再试`}</span>
      <div className="learning-continuation-actions">
        <button type="button" className="button button-primary" disabled={Boolean(busy || dataOperation)} onClick={() => start(entry)}>{busy === entry.id ? '正在准备…' : '开始'}</button>
        <button type="button" className="practice-text-button" disabled={Boolean(busy || dataOperation)} onClick={() => setViewing(entry.sourceItemId)}>上次记录</button>
        <button type="button" className="practice-text-button" disabled={Boolean(busy || dataOperation)} onClick={() => cancel(entry)}>取消安排</button>
      </div>
    </div>)}
    {error && <p className="muted" role="status">{error}</p>}
    {viewing && <PracticeReview itemId={viewing} onClose={closeReview} />}
  </section>;
}
