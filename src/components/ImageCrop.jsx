import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import ModalFrame from './ModalFrame.jsx';
import ThinkingIndicator from './ThinkingIndicator.jsx';
import { cropBetweenPoints, cropImageAttachment, cropPixelBounds, decodeCropImage, moveCrop, resizeCrop } from '../core/images/crop.js';
import '../styles/image-crop.css';

const cornerNames = { nw: '左上', ne: '右上', sw: '左下', se: '右下' };

export default function ImageCrop({ attachment, onApply, onRestore, onClose }) {
  const source = attachment.cropSource || attachment;
  const [rect, setRect] = useState(attachment.cropRect || { x: 0, y: 0, width: 1, height: 1 });
  const [image, setImage] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const viewport = useRef(null), stage = useRef(null), drag = useRef(null);
  const controller = useRef(null), alive = useRef(true);
  const minimum = image ? { minWidth: Math.min(16 / image.naturalWidth, 1), minHeight: Math.min(16 / image.naturalHeight, 1) } : {};

  useEffect(() => {
    alive.current = true;
    const task = new AbortController(); controller.current = task;
    decodeCropImage(source.dataUrl, { signal: task.signal }).then((value) => {
      if (!task.signal.aborted) setImage(value);
    }).catch((failure) => { if (!task.signal.aborted) setError(failure.userMessage || '原图暂时无法读取。'); });
    return () => { alive.current = false; task.abort(); };
  }, [source.dataUrl]);

  useLayoutEffect(() => {
    if (!image || !viewport.current) return;
    const measure = () => {
      const box = viewport.current.getBoundingClientRect();
      const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
      setSize({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [image]);

  const bounds = image ? cropPixelBounds(rect, image.naturalWidth, image.naturalHeight) : null;
  function point(event) {
    const box = stage.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  function start(event, mode) {
    if (!image || working || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.currentTarget.tagName === 'BUTTON') event.currentTarget.focus({ preventScroll: true });
    stage.current.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, origin: point(event), rect, mode };
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = point(event), dx = next.x - current.origin.x, dy = next.y - current.origin.y;
    setRect(current.mode === 'new' ? cropBetweenPoints(current.origin, next, minimum)
      : current.mode === 'move' ? moveCrop(current.rect, dx, dy) : resizeCrop(current.rect, current.mode, dx, dy, minimum));
  }
  function finish(event) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
  }
  function keyMove(event, mode) {
    if (!image || working || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step / image.naturalWidth : event.key === 'ArrowRight' ? step / image.naturalWidth : 0;
    const dy = event.key === 'ArrowUp' ? -step / image.naturalHeight : event.key === 'ArrowDown' ? step / image.naturalHeight : 0;
    setRect((value) => mode === 'move' ? moveCrop(value, dx, dy) : resizeCrop(value, mode, dx, dy, minimum));
  }
  async function apply() {
    if (!image || working) return;
    setWorking(true); setError('');
    try {
      const result = await cropImageAttachment(attachment, rect, { decodedImage: image, signal: controller.current.signal });
      if (alive.current) onApply(result);
    } catch (failure) {
      if (alive.current && failure.name !== 'AbortError') setError(failure.userMessage || '裁切失败，原图仍然保留。');
    } finally { if (alive.current) setWorking(false); }
  }

  return <ModalFrame open titleId="image-crop-title" descriptionId="image-crop-description" className="image-crop-dialog" onClose={onClose}>
    <div className="image-crop-header"><h2 id="image-crop-title">裁切图片</h2><button type="button" className="icon-button" aria-label="取消裁切" onClick={onClose}><X size={18} /></button></div>
    <p id="image-crop-description" className="muted">拖动选框或四角，只保留需要提问的部分。</p>
    <div ref={viewport} className="image-crop-viewport">
      {!image ? <p className="muted" role="status">{error || '正在打开原图…'}</p> : <div ref={stage} className="image-crop-stage" style={{ width: size.width, height: size.height }}
        onPointerDown={(event) => start(event, 'new')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }}>
        <img src={source.dataUrl} alt="待裁切原图" draggable={false} />
        <div className="image-crop-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}>
          <button className="image-crop-move" type="button" aria-label="移动裁切选框，方向键微调，Shift 加速" onPointerDown={(event) => start(event, 'move')} onKeyDown={(event) => keyMove(event, 'move')} disabled={working} />
          {Object.entries(cornerNames).map(([corner, name]) => <button type="button" className={`image-crop-handle image-crop-${corner}`} key={corner}
            aria-label={`调整${name}裁切角，方向键微调`} onPointerDown={(event) => start(event, corner)} onKeyDown={(event) => keyMove(event, corner)} disabled={working}><span aria-hidden="true" /></button>)}
        </div>
      </div>}
    </div>
    <div className="image-crop-information">
      {bounds && <p className="muted">选区 {bounds.width} × {bounds.height} 像素，按原始清晰度保存。</p>}
      {bounds && (bounds.width < 64 || bounds.height < 64) && <p role="status">选区较小，题目可能难以识别，请确认文字完整清楚。</p>}
      {source.mime === 'image/gif' && <p className="muted">动图裁切后保存为静态图片。</p>}
      {error && image && <p role="status">{error}</p>}
    </div>
    <div className="image-crop-tools"><button type="button" disabled={!image || working} onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}>选择全图</button>
      {attachment.cropSource && <button type="button" disabled={working} onClick={() => onRestore(source)}>恢复原图</button>}
    </div>
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={!image || working} onClick={apply}>{working ? <ThinkingIndicator label="正在保存" /> : '使用裁切图片'}</button></div>
  </ModalFrame>;
}
