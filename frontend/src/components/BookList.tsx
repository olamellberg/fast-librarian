import { Download, SearchCheck, Undo2 } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import type { Book } from '../api/types'
import { canDownload, plural } from '../lib/books'
import { Cover } from './Images'
import { StatusBadge } from './StatusBadge'

/** The overview: every book as a row, with checkboxes for acting on many at once. */
export function BookList({
  books,
  selected,
  selectedCount,
  emptyText,
  onToggle,
  onToggleAll,
  onManual,
  onDownload,
  onCancel,
}: {
  books: Book[]
  selected: ReadonlySet<number>
  /** How many of the shown books are selected. */
  selectedCount: number
  emptyText: string
  onToggle: (id: number) => void
  onToggleAll: (select: boolean) => void
  onManual: (b: Book) => void
  onDownload: (id: number) => void
  onCancel: (id: number) => void
}) {
  const allChecked = books.length > 0 && selectedCount === books.length
  const someChecked = selectedCount > 0 && !allChecked
  const selectAll = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someChecked
  }, [someChecked])

  return (
    <section className="card overflow-hidden">
      <label className="flex items-center gap-3 border-b border-line px-3 py-2.5 text-xs font-medium text-muted sm:px-4">
        <input
          ref={selectAll}
          type="checkbox"
          className="size-4"
          aria-label="Select all shown books"
          checked={allChecked}
          disabled={books.length === 0}
          onChange={() => onToggleAll(!allChecked)}
        />
        <span>{selectedCount > 0 ? `${selectedCount} selected` : plural(books.length, 'book')}</span>
      </label>

      {books.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line">
          {books.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              selected={selected.has(b.id)}
              onToggle={onToggle}
              onManual={onManual}
              onDownload={onDownload}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

const BookRow = memo(function BookRow({
  book: b,
  selected,
  onToggle,
  onManual,
  onDownload,
  onCancel,
}: {
  book: Book
  selected: boolean
  onToggle: (id: number) => void
  onManual: (b: Book) => void
  onDownload: (id: number) => void
  onCancel: (id: number) => void
}) {
  const showMsg = b.status_message && b.status !== 'none' && b.status !== 'have'
  return (
    <li
      id={`book-${b.id}`}
      className={`flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 ${selected ? 'bg-white/8' : 'hover:bg-white/4'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 84px' }}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0"
        checked={selected}
        onChange={() => onToggle(b.id)}
        aria-label={`Select ${b.title}`}
      />
      <Cover src={b.cover_url} title={b.title} className="w-11 rounded-sm shadow-none sm:w-12" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug font-semibold sm:line-clamp-1">
          {b.title}
          {b.subtitle && <span className="font-normal text-muted">: {b.subtitle}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {b.year ?? 'Unknown year'}, {plural(b.edition_count, 'edition')}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2 sm:hidden">
          <StatusBadge status={b.status} title={b.status_message} />
        </div>
        {showMsg && (
          <p className={`mt-0.5 truncate text-xs ${b.status === 'failed' ? 'text-failed' : 'text-muted'}`} title={b.status_message ?? undefined}>
            {b.status_message}
          </p>
        )}
      </div>
      <div className="hidden w-32 shrink-0 sm:block">
        <StatusBadge status={b.status} title={b.status_message} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canDownload(b.status) && (
          <button
            type="button"
            className="btn btn-secondary btn-sm px-2 sm:px-3"
            onClick={() => onDownload(b.id)}
            title={b.status === 'failed' ? 'Retry download' : 'Download'}
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span className="hidden md:inline">{b.status === 'failed' ? 'Retry' : 'Download'}</span>
            <span className="sr-only md:hidden">Download</span>
          </button>
        )}
        {b.status === 'wanted' && (
          <button type="button" className="btn btn-ghost btn-sm px-2" onClick={() => onCancel(b.id)} title="Cancel">
            <Undo2 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Cancel</span>
          </button>
        )}
        {b.status !== 'have' && (
          <button type="button" className="btn btn-ghost btn-sm px-2" onClick={() => onManual(b)} title="Search manually">
            <SearchCheck className="size-4" aria-hidden="true" />
            <span className="sr-only">Search manually</span>
          </button>
        )}
      </div>
    </li>
  )
})
