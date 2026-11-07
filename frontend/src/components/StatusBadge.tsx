import { AlertTriangle, CheckCircle2, Download, Loader2, Search, Send } from 'lucide-react'
import { memo } from 'react'
import type { BookStatus } from '../api/types'

const STYLES: Record<BookStatus, { label: string; cls: string; Icon: typeof Search | null }> = {
  none: { label: 'Not chosen', cls: 'bg-zinc-100 text-zinc-600 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700', Icon: null },
  wanted: { label: 'Wanted', cls: 'bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800', Icon: Search },
  downloading: { label: 'Downloading', cls: 'bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800', Icon: Download },
  sent: { label: 'Sent to CWA', cls: 'bg-violet-50 text-violet-800 ring-violet-300 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-800', Icon: Send },
  have: { label: 'In library', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 ring-red-300 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-800', Icon: AlertTriangle },
}

export const StatusBadge = memo(function StatusBadge({ status, title }: { status: BookStatus; title?: string | null }) {
  const s = STYLES[status]
  const spinning = status === 'wanted' || status === 'downloading'
  return (
    <span
      title={title ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${s.cls}`}
    >
      {spinning ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        s.Icon && <s.Icon className="size-3" aria-hidden="true" />
      )}
      {s.label}
    </span>
  )
})
