import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function MessageMenu({ anchor, trigger, onClose, items = [] }) {
  const itemRef = useRef(null)
  const menuRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    itemRef.current?.focus()
    const close = (event) => {
      const buttons = [...(menuRef.current?.querySelectorAll('button:not(:disabled)') ?? [])]
      const index = buttons.indexOf(document.activeElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next].focus()
        return
      }
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        closeRef.current()
        trigger?.focus()
      }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [trigger])

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 192))
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - (items?.length ?? 1) * 46 - 20))
  return createPortal(
    <div className="message-menu-layer">
      <div className="message-menu-backdrop" onPointerDown={onClose} aria-hidden="true" />
      <div ref={menuRef} className="message-menu" role="menu" aria-label="消息操作" style={{ left, top }}>
        {items.map((item, index) => (
          <button key={item.label} ref={index === 0 ? itemRef : undefined} type="button" role="menuitem" disabled={item.disabled}
            onClick={() => { onClose(); item.onSelect?.() }}>{item.label}</button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
