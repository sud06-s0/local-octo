// src/components/ui/Toast.tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastKind = 'success' | 'error'
interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random()
    setItems((t) => [...t, { id, message, kind }])
    setTimeout(() => setItems((t) => t.filter((i) => i.id !== id)), 3200)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' ? 'border-brand-200' : 'border-red-200',
            )}
          >
            {t.kind === 'success' ? (
              <CircleCheck className="size-5 shrink-0 text-brand-700" />
            ) : (
              <TriangleAlert className="size-5 shrink-0 text-red-600" />
            )}
            <span className="flex-1 text-ink">{t.message}</span>
            <button
              onClick={() => setItems((all) => all.filter((i) => i.id !== t.id))}
              className="text-muted hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
