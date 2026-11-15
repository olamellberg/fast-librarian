import { Download, Loader2 } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useBookBulk } from '../api/hooks'
import type { Book, BookStatus } from '../api/types'
import { canDownload } from '../lib/books'
import { errMsg } from '../lib/format'
import { Cover } from './Images'
import { StatusDot } from './StatusBadge'
import { useToast } from './Toast'

/** A cover with its title underneath. The whole card is one link when `to` is given; `actions` float on the cover. */
export function BookCard({
  title,
  line,
  coverUrl,
  status,
  to,
  actions,
  className = 'w-32 sm:w-40',
}: {
  title: string
  /** Second line: author, year or whatever places the book. */
  line: ReactNode
  coverUrl: string | null
  status?: BookStatus | null
  to?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <li className={`group relative min-w-0 list-none ${className}`}>
      <div className="relative">
        <Cover src={coverUrl} title={title} className="w-full" />
        {status && <StatusDot status={status} className="absolute top-2 left-2" />}
        {actions && <div className="reveal absolute right-2 bottom-2 z-10 flex gap-1.5">{actions}</div>}
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm leading-snug font-semibold" title={title}>
        {to ? (
          // The link is stretched over the whole card; the actions sit above it.
          <Link
            to={to}
            className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-paper"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">{line}</p>
    </li>
  )
}

/** Round action button that sits on a cover. */
export function CoverAction({
  label,
  onClick,
  busy,
  disabled,
  children,
  quiet = false,
}: {
  label: string
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  children: ReactNode
  /** Secondary action: ink instead of paper. */
  quiet?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled || busy}
      className={`btn size-10 p-0 shadow-lg shadow-black/50 ${quiet ? 'bg-ink/80 text-paper backdrop-blur hover:bg-ink' : 'btn-primary'}`}
    >
      {busy ? <Loader2 className="size-4.5 animate-spin" aria-hidden="true" /> : children}
      <span className="sr-only">{label}</span>
    </button>
  )
}

/** A book that is already in FastLibrarian: opens on the page of its author, and can be downloaded from the card. */
export const LibraryBookCard = memo(function LibraryBookCard({ book: b, showAuthor = true }: { book: Book; showAuthor?: boolean }) {
  const download = useBookBulk(b.author_id, 'download')
  const toast = useToast()
  return (
    <BookCard
      title={b.title}
      line={showAuthor ? b.author_name : (b.year ?? 'Unknown year')}
      coverUrl={b.cover_url}
      status={b.status}
      to={`/authors/${b.author_id}?book=${b.id}`}
      actions={
        canDownload(b.status) && (
          <CoverAction
            label={`Download ${b.title}`}
            busy={download.isPending}
            onClick={() =>
              download.mutate([b.id], {
                onSuccess: () => toast(`Searching for “${b.title}”…`),
                onError: (e) => toast(`Download failed: ${errMsg(e)}`, 'error'),
              })
            }
          >
            <Download className="size-4.5" aria-hidden="true" />
          </CoverAction>
        )
      }
    />
  )
})
