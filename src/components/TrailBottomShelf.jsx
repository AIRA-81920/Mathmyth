import { useEffect, useId, useRef, useState } from 'react';
import { ChevronUp, X } from 'lucide-react';
import '../styles/trail-shelf.css';

// The dock stays at the bottom. Its body floats over the outline, never
// changing the outline's scroll position or squeezing its expanded branches.
export default function TrailBottomShelf({ items, active = true }) {
  const [openKey, setOpenKey] = useState(null);
  const [displayedKey, setDisplayedKey] = useState(null);
  const id = useId();
  const shelfRef = useRef(null), triggerRefs = useRef(new Map());
  useEffect(() => { if (!active) setOpenKey(null); }, [active]);
  useEffect(() => {
    if (openKey) { setDisplayedKey(openKey); return; }
    const timer = setTimeout(() => setDisplayedKey(null), 180);
    return () => clearTimeout(timer);
  }, [openKey]);
  useEffect(() => {
    if (!openKey) return;
    function close(event) {
      if (event.key === 'Escape' && !document.querySelector('.dialog-layer')) {
        event.preventDefault(); setOpenKey(null); triggerRefs.current.get(openKey)?.focus();
      }
    }
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [openKey]);
  function hide() { const previous = openKey; setOpenKey(null); triggerRefs.current.get(previous)?.focus(); }
  return <>
    {openKey && <button type="button" className="trail-shelf-backdrop" aria-label="收起足迹下方的浮窗" onClick={hide} data-no-area-swipe />}
    <aside ref={shelfRef} className={`trail-bottom-shelf${openKey ? ' is-open' : ''}`} data-no-area-swipe aria-label="个人题目与笔记">
      <div className="trail-shelf-panel-frame">
        {items.map((item) => <section key={item.key} id={`${id}-${item.key}`} className={`trail-shelf-panel${displayedKey === item.key && !openKey ? ' is-closing' : ''}`} hidden={displayedKey !== item.key} aria-hidden={openKey !== item.key || undefined}
          ref={(node) => { if (node) node.inert = openKey !== item.key }} aria-labelledby={`${id}-${item.key}-title`}>
          <div className="trail-shelf-heading"><h2 id={`${id}-${item.key}-title`}>{item.title}</h2>
            <button type="button" className="icon-button" aria-label={`收起${item.title}`} onClick={hide}><X size={18} aria-hidden="true" /></button></div>
          <div className="trail-shelf-content">{item.content}</div>
        </section>)}
      </div>
      <div className="trail-shelf-dock">{items.map((item) => <button key={item.key} type="button" className={`trail-shelf-trigger${openKey === item.key ? ' is-open' : ''}`}
        ref={(node) => { if (node) triggerRefs.current.set(item.key, node); else triggerRefs.current.delete(item.key) }}
        aria-expanded={openKey === item.key} aria-controls={`${id}-${item.key}`} onClick={() => setOpenKey(openKey === item.key ? null : item.key)}>
        <span>{item.title}</span><ChevronUp size={16} aria-hidden="true" /></button>)}</div>
    </aside>
  </>;
}
