import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Native modal <dialog>: the browser provides focus containment, Esc / back-gesture dismissal,
 * the top layer and focus return. `open` drives showModal()/close().
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // React's autoFocus fires before showModal(); move focus to the marked control afterwards.
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // Light dismiss: click on the backdrop (pointer outside the dialog box).
      onClick={(e) => {
        // Keyboard-activated clicks report detail 0 and clientX/Y 0; only the dialog itself is the backdrop target.
        if (e.detail === 0 || e.target !== e.currentTarget) return
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose()
      }}
      className={`m-auto w-[calc(100%-1.5rem)] rounded-2xl bg-raised p-0 text-paper shadow-2xl shadow-black ring-1 ring-white/10 ${className}`}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id={titleId} className="min-w-0 text-base font-semibold">
              {title}
            </h2>
            <button type="button" className="btn btn-ghost -m-1.5 p-1.5" onClick={onClose} aria-label="Close">
              <X className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className="max-w-md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-muted">{children}</div>
    </Dialog>
  )
}
