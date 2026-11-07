import {
  ArrowLeft,
  ChevronDown,
  Download,
  Library,
  Loader2,
  RefreshCw,
  Search,
  SearchCheck,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuthor, useAuthorAction, useBookBulk, useDeleteAuthor } from '../api/hooks'
import type { Book, BookStatus } from '../api/types'
import { ConfirmDialog } from '../components/Dialog'
import { Avatar, Cover } from '../components/Images'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { errMsg, timeAgo } from '../lib/format'
import { usePersistentState } from '../lib/storage'
import { ReleasesDialog } from './ReleasesDialog'

type Filter = 'all' | 'missing' | 'active' | 'library'

const FILTERS: { id: Filter; label: string; match: (s: BookStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'missing', label: 'Missing', match: (s) => s === 'none' || s === 'failed' },
  { id: 'active', label: 'Wanted', match: (s) => s === 'wanted' || s === 'downloading' },
  { id: 'library', label: 'In library', match: (s) => s === 'sent' || s === 'have' },
]

type Sort = 'year-desc' | 'year-asc' | 'title-asc' | 'title-desc' | 'popular'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'year-desc', label: 'Newest first' },
  { id: 'year-asc', label: 'Oldest first' },
  { id: 'title-asc', label: 'Title A–Z' },
  { id: 'title-desc', label: 'Title Z–A' },
  { id: 'popular', label: 'Most editions' },
]
const isSort = (v: unknown): v is Sort => SORTS.some((s) => s.id === v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

const collator = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })
/** Sort key for titles: ignore a leading English article. */
const titleKey = (t: string) => t.replace(/^(the|a|an)\s+/i, '')

function compareBooks(sort: Sort) {
  // Books without a year always go last, whatever the direction.
  const byYear = (dir: 1 | -1) => (a: Book, b: Book) =>
    a.year == null ? (b.year == null ? 0 : 1) : b.year == null ? -1 : dir * (a.year - b.year)
  const byTitle = (a: Book, b: Book) => collator.compare(titleKey(a.title), titleKey(b.title))
  switch (sort) {
    case 'year-desc':
      return (a: Book, b: Book) => byYear(-1)(a, b) || byTitle(a, b)
    case 'year-asc':
      return (a: Book, b: Book) => byYear(1)(a, b) || byTitle(a, b)
    case 'title-asc':
      return byTitle
    case 'title-desc':
      return (a: Book, b: Book) => byTitle(b, a)
    case 'popular':
      return (a: Book, b: Book) => b.edition_count - a.edition_count || byTitle(a, b)
  }
}

const parseYear = (s: string) => {
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

/** Single-edition works are mostly OpenLibrary noise; keep ones the user already acted on. */
const isObscure = (b: Book) => b.edition_count <= 1 && b.status === 'none'

const canDownload = (s: BookStatus) => s === 'none' || s === 'failed'
const canCancel = (s: BookStatus) => s === 'wanted' || s === 'failed'

export function AuthorPage() {
  const id = Number(useParams().id)
  const { data, isPending, isError, error } = useAuthor(id)
  const navigate = useNavigate()
  const toast = useToast()

  const refresh = useAuthorAction(id, 'refresh')
  const monitor = useAuthorAction(id, 'monitor')
  const del = useDeleteAuthor()
  const download = useBookBulk(id, 'download')
  const unwant = useBookBulk(id, 'unwant')

  const [filter, setFilter] = useState<Filter>('all')
  const [hideObscure, setHideObscure] = usePersistentState('fl.author.hideObscure', true, isBool)
  const [sort, setSort] = usePersistentState<Sort>('fl.author.sort', 'year-desc', isSort)
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [text, setText] = useState('')
  const deferredText = useDeferredValue(text)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [manualBook, setManualBook] = useState<Book | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bioOpen, setBioOpen] = useState(false)

  const books = useMemo(() => data?.books ?? [], [data])

  const { base, hiddenCount } = useMemo(() => {
    const t = deferredText.trim().toLowerCase()
    let list = books
    if (t) list = list.filter((b) => b.title.toLowerCase().includes(t) || b.subtitle?.toLowerCase().includes(t))
    const from = parseYear(yearFrom)
    const to = parseYear(yearTo)
    if (from != null || to != null)
      list = list.filter((b) => b.year != null && (from == null || b.year >= from) && (to == null || b.year <= to))
    let hidden = 0
    if (hideObscure) {
      const kept = list.filter((b) => !isObscure(b))
      hidden = list.length - kept.length
      list = kept
    }
    return { base: [...list].sort(compareBooks(sort)), hiddenCount: hidden }
  }, [books, hideObscure, deferredText, yearFrom, yearTo, sort])

  const yearBounds = useMemo(() => {
    const ys = books.map((b) => b.year).filter((y): y is number => y != null)
    return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : null
  }, [books])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, missing: 0, active: 0, library: 0 }
    for (const b of base) for (const f of FILTERS) if (f.match(b.status)) c[f.id]++
    return c
  }, [base])

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    return filter === 'all' ? base : base.filter((b) => f.match(b.status))
  }, [base, filter])

  // Only books that are currently shown count as selected.
  const selectedBooks = useMemo(() => shown.filter((b) => selected.has(b.id)), [shown, selected])
  const nDownloadable = selectedBooks.filter((b) => canDownload(b.status)).length
  const nCancellable = selectedBooks.filter((b) => canCancel(b.status)).length

  const allChecked = shown.length > 0 && selectedBooks.length === shown.length
  const someChecked = selectedBooks.length > 0 && !allChecked
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked
  }, [someChecked])

  const toggle = useCallback((bookId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      return next
    })
  }, [])

  const downloadOne = useCallback(
    (bookId: number) => download.mutate([bookId], { onError: (e) => toast(`Download failed: ${errMsg(e)}`, 'error') }),
    [download.mutate, toast],
  )
  const cancelOne = useCallback(
    (bookId: number) => unwant.mutate([bookId], { onError: (e) => toast(`Cancel failed: ${errMsg(e)}`, 'error') }),
    [unwant.mutate, toast],
  )

  function bulk(kind: 'download' | 'unwant') {
    const ids = selectedBooks.filter((b) => (kind === 'download' ? canDownload(b.status) : canCancel(b.status))).map((b) => b.id)
    if (ids.length === 0) return
    const m = kind === 'download' ? download : unwant
    m.mutate(ids, {
      onSuccess: () => {
        toast(kind === 'download' ? `Searching for ${ids.length} book${ids.length === 1 ? '' : 's'}…` : `Cancelled ${ids.length}`)
        setSelected(new Set())
      },
      onError: (e) => toast(errMsg(e), 'error'),
    })
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="py-20 text-center">
        <p className="text-zinc-500">{notFound ? 'This author is not in your library.' : `Could not load author: ${errMsg(error)}`}</p>
        <Link to="/library" className="btn btn-secondary mt-4">
          <ArrowLeft className="size-4" /> Back to library
        </Link>
      </div>
    )
  }
  if (isPending) return <AuthorSkeleton />

  const { author, refreshing } = data
  const bio = author.bio?.trim()
  const longBio = (bio?.length ?? 0) > 280

  return (
    <div className={`space-y-6 ${selectedBooks.length > 0 ? 'pb-20' : ''}`}>
      {/* ---------------------------------------------------------------- header */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar src={author.photo_url} name={author.name} className="size-24 self-center sm:size-32 sm:self-start" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-center gap-1 text-center sm:items-start sm:text-left">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{author.name}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {author.birth_date && <>b. {author.birth_date} · </>}
              {author.book_count} titles · {author.have_count} in library
              {author.refreshed_at && <> · updated {timeAgo(author.refreshed_at)}</>}
            </p>
            {!author.monitored && (
              <p className="text-xs text-zinc-400 italic dark:text-zinc-500">Single book: only the titles you added are tracked.</p>
            )}
          </div>

          {bio && (
            <div className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              <p className={`whitespace-pre-line ${bioOpen || !longBio ? '' : 'line-clamp-3'}`}>{bio}</p>
              {longBio && (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  onClick={() => setBioOpen((o) => !o)}
                  aria-expanded={bioOpen}
                >
                  {bioOpen ? 'Show less' : 'Show more'}
                  <ChevronDown className={`size-3.5 transition-transform ${bioOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {!author.monitored && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={monitor.isPending}
                onClick={() =>
                  monitor.mutate(undefined, {
                    onSuccess: () => toast(`Fetching all books by ${author.name}…`),
                    onError: (e) => toast(errMsg(e), 'error'),
                  })
                }
              >
                <Library className="size-4" aria-hidden="true" /> Add all books
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={refresh.isPending || refreshing}
              onClick={() => refresh.mutate(undefined, { onError: (e) => toast(errMsg(e), 'error') })}
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className="btn btn-ghost text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden="true" /> Remove author
            </button>
          </div>
        </div>
      </section>

      {refreshing && (
        <div className="flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800 ring-1 ring-indigo-200 ring-inset dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-900">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Fetching books from OpenLibrary…
        </div>
      )}

      {/* ---------------------------------------------------------------- toolbar */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Filter books" className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800/80">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                type="button"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  filter === f.id
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                }`}
              >
                {f.label} <span className="text-xs text-zinc-400 tabular-nums">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm select-none">
            <input type="checkbox" className="size-4" checked={hideObscure} onChange={(e) => setHideObscure(e.target.checked)} />
            Hide obscure editions
            {hiddenCount > 0 && <span className="text-zinc-400 tabular-nums">({hiddenCount} hidden)</span>}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Filter titles…"
              aria-label="Filter titles"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="year-from" className="text-zinc-500 dark:text-zinc-400">
              Year
            </label>
            <input
              id="year-from"
              type="number"
              inputMode="numeric"
              className="input w-22 tabular-nums"
              placeholder={yearBounds ? String(yearBounds.min) : 'from'}
              aria-label="Published from year"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
            />
            <span className="text-zinc-400" aria-hidden="true">
              –
            </span>
            <input
              type="number"
              inputMode="numeric"
              className="input w-22 tabular-nums"
              placeholder={yearBounds ? String(yearBounds.max) : 'to'}
              aria-label="Published to year"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Sort</span>
            <select className="input w-auto" value={sort} onChange={(e) => isSort(e.target.value) && setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ---------------------------------------------------------------- books */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="size-4"
            aria-label="Select all shown books"
            checked={allChecked}
            disabled={shown.length === 0}
            onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((b) => b.id)))}
          />
          <span>{selectedBooks.length > 0 ? `${selectedBooks.length} selected` : `${shown.length} books`}</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {refreshing && books.length === 0
              ? 'Fetching books…'
              : books.length === 0
                ? 'No books yet.'
                : hiddenCount > 0
                  ? `No books here. ${hiddenCount} obscure editions are hidden.`
                  : 'No books match this filter.'}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {shown.map((b) => (
              <BookRow
                key={b.id}
                book={b}
                selected={selected.has(b.id)}
                onToggle={toggle}
                onManual={setManualBook}
                onDownload={downloadOne}
                onCancel={cancelOne}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- bulk bar */}
      {selectedBooks.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-3 pb-3 sm:bottom-0 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-2xl animate-toast-in items-center gap-2 rounded-2xl bg-zinc-900 p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10 dark:bg-zinc-800">
            <span className="mr-auto text-sm font-medium tabular-nums">{selectedBooks.length} selected</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={nDownloadable === 0 || download.isPending}
              onClick={() => bulk('download')}
              title={nDownloadable === 0 ? 'None of the selected books can be downloaded' : undefined}
            >
              {download.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download{nDownloadable > 0 && nDownloadable !== selectedBooks.length ? ` ${nDownloadable}` : ''}
            </button>
            <button
              type="button"
              className="btn bg-white/10 text-white hover:bg-white/20"
              disabled={nCancellable === 0 || unwant.isPending}
              onClick={() => bulk('unwant')}
            >
              <Undo2 className="size-4" /> Cancel{nCancellable > 0 && nCancellable !== selectedBooks.length ? ` ${nCancellable}` : ''}
            </button>
            <button
              type="button"
              className="btn p-2 text-zinc-300 hover:bg-white/10 hover:text-white"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <ReleasesDialog book={manualBook} onClose={() => setManualBook(null)} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${author.name}?`}
        confirmLabel="Remove author"
        busy={del.isPending}
        onConfirm={() =>
          del.mutate(id, {
            onSuccess: () => {
              toast(`Removed ${author.name}`)
              navigate('/library')
            },
            onError: (e) => toast(errMsg(e), 'error'),
          })
        }
      >
        This removes the author and all {author.book_count} of their books from FastLibrarian. Files already in your Calibre
        library are not touched.
      </ConfirmDialog>
    </div>
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
      className={`flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 ${selected ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 84px' }}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0"
        checked={selected}
        onChange={() => onToggle(b.id)}
        aria-label={`Select ${b.title}`}
      />
      <Cover src={b.cover_url} title={b.title} className="w-11 sm:w-12" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug font-medium sm:line-clamp-1">
          {b.title}
          {b.subtitle && <span className="font-normal text-zinc-500 dark:text-zinc-400">: {b.subtitle}</span>}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {b.year ?? 'Unknown year'} · {b.edition_count} edition{b.edition_count === 1 ? '' : 's'}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2 sm:hidden">
          <StatusBadge status={b.status} title={b.status_message} />
        </div>
        {showMsg && (
          <p
            className={`mt-0.5 truncate text-xs ${b.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}
            title={b.status_message ?? undefined}
          >
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
            className="btn btn-secondary btn-sm px-2 sm:px-2.5"
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

function AuthorSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="skeleton size-24 rounded-full sm:size-32" />
        <div className="w-full flex-1 space-y-3">
          <div className="skeleton h-8 w-64 max-w-full" />
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-16 w-full" />
        </div>
      </div>
      <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="skeleton size-4" />
            <div className="skeleton aspect-[2/3] w-12" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
