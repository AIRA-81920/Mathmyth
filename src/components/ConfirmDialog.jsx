import { useId, useRef } from 'react';
import ModalFrame from './ModalFrame.jsx';

export default function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  danger = false,
}) {
  const id = useId();
  const cancelRef = useRef(null);
  return (
    <ModalFrame open={open} className="confirm-dialog" titleId={`${id}-title`} descriptionId={`${id}-description`} onClose={onCancel} initialFocusRef={cancelRef}>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="muted" id={`${id}-description`}>{description}</p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" ref={cancelRef} onClick={onCancel}>取消</button>
          <button className={`button ${danger ? 'button-danger' : 'button-primary'}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
    </ModalFrame>
  );
}
