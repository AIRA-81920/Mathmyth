import { useEffect, useRef, useState } from 'react';
import { Star, X } from 'lucide-react';
import MathMarkdown from './MathMarkdown.jsx';
import ModalFrame from './ModalFrame.jsx';
import { listStarredQuestions, loadStarredQuestion, removeStarredQuestion, onDatabaseChange } from '../core/db/database.js';
import { useAppStore } from '../store/appStore.js';
import '../styles/message-actions.css';

export default function SavedQuestions({ showTitle = true }) {
  const initialized = useAppStore((state) => state.storageInitialized);
  const learnerId = useAppStore((state) => state.learnerId);
  const dataOperation = useAppStore((state) => state.dataOperation);
  const [questions, setQuestions] = useState([]), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const generation = useRef(0);
  const detailRequest = useRef(0);
  useEffect(() => {
    const owner = ++generation.current; let request = 0;
    detailRequest.current++; setDetailLoading(false);
    setQuestions([]); setSelected(null); setError(''); setBusy(false);
    if (!initialized || dataOperation) { setLoading(false); return () => { generation.current++; }; }
    async function refresh() {
      const current = ++request;
      try {
        const items = await listStarredQuestions({ includeImages: false });
        if (generation.current === owner && current === request) { setQuestions(items); setError(''); }
      } catch (failure) { if (generation.current === owner && current === request) setError(failure.userMessage || '收藏暂时没能读取，请重新打开足迹。'); }
      finally { if (generation.current === owner && current === request) setLoading(false); }
    }
    setLoading(true); refresh();
    const unsubscribe = onDatabaseChange(({ method }) => {
      if (['setQuestionStar', 'removeStarredQuestion', 'clearDatabase', 'commitImport'].includes(method)) refresh();
    });
    return () => { generation.current++; unsubscribe(); };
  }, [initialized, learnerId, dataOperation]);
  async function remove(question) {
    if (busy || dataOperation) return;
    const owner = generation.current; setBusy(true); setError('');
    try {
      await removeStarredQuestion(question.id);
      const items = await listStarredQuestions({ includeImages: false });
      if (generation.current === owner) { setQuestions(items); setSelected(null); }
    } catch (failure) { if (generation.current === owner) setError(failure.userMessage || '暂时无法取消收藏，请重试。'); }
    finally { if (generation.current === owner) setBusy(false); }
  }
  function closeSelected() { detailRequest.current++; setSelected(null); setDetailLoading(false); }
  async function openQuestion(question) {
    const request = ++detailRequest.current, owner = generation.current;
    setSelected(question); setDetailLoading(true); setError('');
    try {
      const detail = await loadStarredQuestion(question.id);
      if (generation.current === owner && detailRequest.current === request) setSelected(detail);
    } catch (failure) { if (generation.current === owner && detailRequest.current === request) setError(failure.userMessage || '题目图片暂时未能读取，请重新打开。'); }
    finally { if (generation.current === owner && detailRequest.current === request) setDetailLoading(false); }
  }
  return <section className="saved-questions" aria-label="收藏的题">
    {showTitle && <h2>收藏的题</h2>}
    {!questions.length && <p className="muted saved-questions-empty">{loading ? '正在读取…' : '长按问答中的数学题，点 Star 收藏。'}</p>}
    {questions.map((question) => <button type="button" className="saved-question-row" key={question.id} onClick={() => openQuestion(question)}>
      <Star size={16} strokeWidth={1.5} aria-hidden="true" /><div className="saved-question-preview"><MathMarkdown staticLinks>{(question.recognizedQuestion || question.content || '图片题目').split(/\n\s*\n/)[0]}</MathMarkdown></div>
    </button>)}
    {error && <p className="muted field-hint" role="status">{error}</p>}
    {selected && <ModalFrame open titleId="saved-question-title" className="saved-question-dialog" onClose={closeSelected}>
      <header className="message-revisions-header"><h2 id="saved-question-title">收藏的题</h2>
        <button type="button" className="icon-button" aria-label="关闭收藏题目" onClick={closeSelected}><X size={18} /></button></header>
      <div className="saved-question-content">{selected.images?.map((image) => <img className="message-image" key={image.id} src={image.dataUrl} alt="收藏的题目图片" />)}
        {detailLoading && <p className="muted field-hint" role="status">正在读取题目…</p>}
        <MathMarkdown>{selected.recognizedQuestion || selected.content || ''}</MathMarkdown>
        {selected.recognizedQuestion && selected.content && selected.content !== selected.recognizedQuestion && <MathMarkdown>{selected.content}</MathMarkdown>}
      </div>
      {error && <p className="muted field-hint" role="status">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" disabled={busy || Boolean(dataOperation)} onClick={() => remove(selected)}>取消 Star 收藏</button></div>
    </ModalFrame>}
  </section>;
}
