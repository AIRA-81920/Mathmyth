import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ModalFrame({ open, titleId, descriptionId, onClose, initialFocusRef, className = '', children }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert
    const previousOverflow = document.body.style.overflow
    if (appRoot) appRoot.inert = true
    document.body.style.overflow = 'hidden'
    const target = initialFocusRef?.current
    if (target && !target.disabled) target.focus()
    else dialogRef.current?.querySelector(focusable)?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll(focusable)
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (appRoot) appRoot.inert = previousInert
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open, initialFocusRef])

  if (!open) return null
  return createPortal(
    <div className="dialog-layer">
      <div className="dialog-backdrop" aria-hidden="true" onClick={onClose} />
      <section ref={dialogRef} className={`modal-frame ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        {children}
      </section>
    </div>,
    document.body,
  )
}
