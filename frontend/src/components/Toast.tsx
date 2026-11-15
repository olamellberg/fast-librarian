import { CheckCircle2, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error'
interface Toast {
  id: number
  kind: Kind
  text: string
}

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {})

export function useToast() {
  return useContext(Ctx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-0 bottom-(--tabbar-h) left-(--sidebar-w) z-50 flex flex-col items-center gap-2 p-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md animate-toast-in items-start gap-2 rounded-xl bg-lift px-4 py-3 text-sm text-paper shadow-lg shadow-black ring-1 ring-white/10"
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-have" aria-hidden="true" />
            ) : (
              <XCircle className="mt-px size-4 shrink-0 text-failed" aria-hidden="true" />
            )}
            <span className="break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
