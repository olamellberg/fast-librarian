import { AlertTriangle, Check, Download, Loader2, Search, Send } from 'lucide-react'
import { memo } from 'react'
import type { BookStatus } from '../api/types'

const STYLES: Record<BookStatus, { label: string; cls: string; dot: string; Icon: typeof Search | null }> = {
  none: { label: 'Not chosen', cls: 'bg-white/8 text-muted', dot: '', Icon: null },
  wanted: { label: 'Wanted', cls: 'bg-wanted/15 text-wanted', dot: 'bg-wanted', Icon: Search },
  downloading: { label: 'Downloading', cls: 'bg-downloading/15 text-downloading', dot: 'bg-downloading', Icon: Download },
  sent: { label: 'Sent to CWA', cls: 'bg-sent/15 text-sent', dot: 'bg-sent', Icon: Send },
  have: { label: 'In library', cls: 'bg-have/15 text-have', dot: 'bg-have', Icon: Check },
  failed: { label: 'Failed', cls: 'bg-failed/15 text-failed', dot: 'bg-failed', Icon: AlertTriangle },
}

const isBusy = (s: BookStatus) => s === 'wanted' || s === 'downloading'

export const StatusBadge = memo(function StatusBadge({ status, title }: { status: BookStatus; title?: string | null }) {
  const s = STYLES[status]
  return (
    <span
      title={title ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}
    >
      {isBusy(status) ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        s.Icon && <s.Icon className="size-3" aria-hidden="true" />
      )}
      {s.label}
    </span>
  )
})

/** The status as a small coloured disc for the corner of a cover. Nothing for books not chosen. */
export const StatusDot = memo(function StatusDot({ status, className = '' }: { status: BookStatus; className?: string }) {
  const s = STYLES[status]
  if (!s.Icon) return null
  return (
    <span
      title={s.label}
      className={`flex size-6 items-center justify-center rounded-full text-ink shadow-md shadow-black/50 ${s.dot} ${className}`}
    >
      {isBusy(status) ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <s.Icon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      )}
      <span className="sr-only">{s.label}</span>
    </span>
  )
})
