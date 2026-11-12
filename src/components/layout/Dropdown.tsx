// src/components/layout/Dropdown.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Click-to-open menu that closes on outside click / Escape. */
export function Dropdown({
  trigger,
  children,
  placement = 'bottom',
  align = 'stretch',
  className,
}: {
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  placement?: 'bottom' | 'top'
  align?: 'stretch' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={cn(
            'absolute z-50 rounded-xl border border-line bg-white p-1.5 shadow-lg',
            align === 'stretch' ? 'left-0 right-0' : 'right-0 w-56',
            placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm',
        danger ? 'text-red-700 hover:bg-red-50' : 'text-ink hover:bg-canvas',
      )}
    >
      {children}
    </button>
  )
}
