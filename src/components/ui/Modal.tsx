// src/components/ui/Modal.tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  top = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
  /** Show above other open windows (e.g. a picker opened from inside a form) */
  top?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  // Rendered at the end of <body> so no page layout can push it behind another window
  return createPortal(
    <div className={cn('fixed inset-0 flex items-end justify-center sm:items-center sm:p-4', top ? 'z-[95]' : 'z-[90]')} role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          size === 'md' ? 'sm:max-w-md' : 'sm:max-w-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
