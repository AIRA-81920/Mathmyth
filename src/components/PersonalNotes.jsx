import { useEffect, useRef, useState } from 'react';
import MathMarkdown from './MathMarkdown.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { listPersonalNotes, savePersonalNote, deletePersonalNote, onDatabaseChange } from '../core/db/database.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { useAppStore } from '../store/appStore.js';
import '../styles/personal-notes.css';

const blank = () => ({ content: '', targetType: null, targetId: null });
export default function PersonalNotes({ showTitle = true }) {
  const initialized = useAppStore((state) => state.storageInitialized);
  const learner = useAppStore((state) => state.learnerId);
  const dataOperation = useAppStore((state) => state.dataOperation);
  const [notes, setNotes] = useState([]), [skeleton, setSkeleton] = useState(null);
  const [draft, setDraft] = useState(null), [deleting, setDeleting] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const version = useRef(0), editingRef = useRef(null);
  useEffect(() => {
    const owner = ++version.current;
    let request = 0;
    setNotes([]); setDraft(null); setDeleting(null); setBusy(false); setError('');
    if (!initialized || dataOperation) { setLoading(false); return () => { version.current++; }; }
    async function refresh() {
      const current = ++request;
      try {
        setLoading(true);
        const [items, knowledge] = await Promise.all([listPersonalNotes(), loadSkeleton().catch(() => null)]);
        if (version.current === owner && current === request) { setNotes(items); setSkeleton(knowledge); setError(''); }
      } catch (failure) { if (version.current === owner && current === request) setError(failure.userMessage || '易错点暂时没能读出来，请重新打开足迹。'); }
      finally { if (version.current === owner && current === request) setLoading(false); }
    }
    const unsubscribe = onDatabaseChange(({ method }) => {
      if (['savePersonalNote', 'deletePersonalNote', 'commitImport', 'clearDatabase'].includes(method)) refresh();
    });
    refresh();
    return () => { version.current++; unsubscribe(); };
  }, [initialized, learner, dataOperation]);
  useEffect(() => { if (draft) editingRef.current?.focus(); }, [draft?.id, Boolean(draft)]);
  const unavailable = !initialized || Boolean(dataOperation) || busy;
  async function commit(action) {
    if (unavailable) return;
    const owner = version.current;
    setBusy(true); setError('');
    try {
      await action();
      const items = await listPersonalNotes();
      if (owner === version.current) { setNotes(items); setDraft(null); setDeleting(null); }
    } catch (failure) { if (owner === version.current) setError(failure.userMessage || '易错点尚未保存，请重试。'); }
    finally { if (owner === version.current) setBusy(false); }
  }
  const targets = draft?.targetType === 'scenario' ? [...(skeleton?.scenarioById.values() ?? [])] : [...(skeleton?.methodById.values() ?? [])];
  function link(note) {
    const node = note.targetType === 'scenario' ? skeleton?.scenarioById.get(note.targetId) : skeleton?.methodById.get(note.targetId);
    if (!note.targetId) return null;
    return <button type="button" className="personal-note-link" disabled={!node || unavailable} onClick={() => {
      if (note.targetType === 'scenario') useAppStore.getState().openScenario({ id: note.targetId, kind: 'scenario' });
      else useAppStore.getState().openMethod(note.targetId);
    }}>{node?.name || note.targetId}</button>;
  }
  return <section className="personal-notes" aria-labelledby={showTitle ? 'personal-notes-title' : undefined} aria-label={showTitle ? undefined : '易错点内容'}>
    <div className="personal-notes-header">{showTitle && <h2 id="personal-notes-title">自己总结的易错点</h2>}
      <button type="button" className="personal-note-action" disabled={unavailable || Boolean(draft)} onClick={() => { setError(''); setDraft(blank()); }}>新增</button></div>
    {draft ? <form className="personal-note-editor" onSubmit={(event) => { event.preventDefault(); commit(() => savePersonalNote(draft)); }}>
      <label htmlFor="personal-note-content">易错点</label>
      <textarea id="personal-note-content" ref={editingRef} className="field-control" rows={4} maxLength={5000} value={draft.content} disabled={unavailable}
        placeholder="写下容易漏掉的条件、犯过的错，或下次要记得的事…" onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      <label htmlFor="personal-note-type">关联内容（可不选）</label>
      <select id="personal-note-type" className="field-control" value={draft.targetType || ''} disabled={unavailable} onChange={(event) => setDraft({ ...draft, targetType: event.target.value || null, targetId: null })}>
        <option value="">不关联</option><option value="scenario">情景</option><option value="method">方法</option>
      </select>
      {draft.targetType && <select className="field-control" aria-label={`关联${draft.targetType === 'scenario' ? '情景' : '方法'}`} value={draft.targetId || ''} disabled={unavailable || !skeleton}
        onChange={(event) => setDraft({ ...draft, targetId: event.target.value || null })}>
        <option value="">请选择</option>{targets.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
      </select>}
      <div className="personal-note-actions"><button type="submit" className="button button-primary" disabled={unavailable || !draft.content.trim() || Boolean(draft.targetType && !draft.targetId)}>{busy ? '正在保存…' : '保存'}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>取消</button></div>
    </form> : <>
      {!notes.length && <p className="muted personal-note-empty">{loading ? '正在读取…' : '记下自己容易犯的错，随时回来看看。'}</p>}
      {notes.map((note) => <article className="personal-note" key={note.id}>
        <MathMarkdown>{note.content}</MathMarkdown>{link(note)}
        <div className="personal-note-actions"><button type="button" className="personal-note-action" disabled={unavailable} onClick={() => { setError(''); setDraft({ ...note }); }}>编辑</button>
          <button type="button" className="personal-note-action" disabled={unavailable} onClick={() => setDeleting(note)}>删除</button></div>
      </article>)}
    </>}
    {error && <p className="muted field-hint" role="status">{error}</p>}
    <ConfirmDialog open={Boolean(deleting)} title="删除这条易错点？" description="只删除这条个人笔记，学习记录和聊天保留。" confirmLabel="删除" danger
      onCancel={() => setDeleting(null)} onConfirm={() => { const note = deleting; setDeleting(null); commit(() => deletePersonalNote(note.id)); }} />
  </section>;
}
