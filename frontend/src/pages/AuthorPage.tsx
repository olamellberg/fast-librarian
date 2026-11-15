import {
  ArrowLeft,
  ChevronDown,
  Download,
  GalleryHorizontal,
  Library,
  List,
  Loader2,
  RefreshCw,
  Search,
  SearchCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuthor, useAuthorAction, useBookBulk, useDeleteAuthor } from '../api/hooks'
import type { Book } from '../api/types'
import { BookList } from '../components/BookList'
import { CoverFlow } from '../components/CoverFlow'
import { ConfirmDialog } from '../components/Dialog'
import { Ambient, Avatar } from '../components/Images'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { canCancel, canDownload, compareBooks, FILTERS, isObscure, isSort, plural, SORTS, type Filter, type Sort } from '../lib/books'
import { errMsg, timeAgo } from '../lib/format'
import { usePersistentState } from '../lib/storage'
import { placeholderGradient } from '../lib/tone'
import { ReleasesDialog } from './ReleasesDialog'

type View = 'flow' | 'list'
const isView = (v: unknown): v is View => v === 'flow' || v === 'list'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

const parseYear = (s: string) => {
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/** Filters, selection and the place in the flow all belong to one author: start fresh for the next one. */
export function AuthorPage() {
  const id = Number(useParams().id)
  return <AuthorView key={id} id={id} />
}

function AuthorView({ id }: { id: number }) {
  const { data, isPending, isError, error } = useAuthor(id)
  const navigate = useNavigate()
  const toast = useToast()
  // A card elsewhere links to one book: `?book=` says which cover to open on.
  const [params] = useSearchParams()
  const [linkedBook] = useState(() => Number(params.get('book')) || null)

  const refresh = useAuthorAction(id, 'refresh')
  const monitor = useAuthorAction(id, 'monitor')
  const del = useDeleteAuthor()
  const download = useBookBulk(id, 'download')
  const unwant = useBookBulk(id, 'unwant')

  const [view, setView] = usePersistentState<View>('fl.author.view', 'flow', isView)
  const [filter, setFilter] = useState<Filter>('all')
  const [hideObscure, setHideObscure] = usePersistentState('fl.author.hideObscure', true, isBool)
  // Best-known books first: the flow should open on covers people recognise, not on the latest reissue.
  // (New storage key, so the old default of "newest first" does not stick in browsers that saved it.)
  const [sort, setSort] = usePersistentState<Sort>('fl.author.order', 'popular', isSort)
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [text, setText] = useState('')
  const deferredText = useDeferredValue(text)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [activeId, setActiveId] = useState<number | null>(linkedBook)
  const [manualBook, setManualBook] = useState<Book | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bioOpen, setBioOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Something typed in the filter row is narrowing the list (worth a hint while the row is folded away).
  const narrowed = text.trim() !== '' || yearFrom !== '' || yearTo !== ''

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
      // The book a link pointed at stays visible even if it would count as obscure.
      const kept = list.filter((b) => !isObscure(b) || b.id === linkedBook)
      hidden = list.length - kept.length
      list = kept
    }
    return { base: [...list].sort(compareBooks(sort)), hiddenCount: hidden }
  }, [books, hideObscure, deferredText, yearFrom, yearTo, sort, linkedBook])

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

  // Changing what is listed starts the flow over; a refetch of the same list does not.
  const listKey = `${filter}|${sort}|${deferredText}|${yearFrom}|${yearTo}|${hideObscure}`
  const firstListKey = useRef(listKey)

  const activeBook = useMemo(() => shown.find((b) => b.id === activeId) ?? shown[0] ?? null, [shown, activeId])
  // The backdrop follows the cover in the middle, but only once the reader stops flicking.
  const toneBook = useDebounced(view === 'flow' ? activeBook : null, 350)

  // Only books that are currently shown count as selected.
  const selectedBooks = useMemo(() => shown.filter((b) => selected.has(b.id)), [shown, selected])
  const nDownloadable = selectedBooks.filter((b) => canDownload(b.status)).length
  const nCancellable = selectedBooks.filter((b) => canCancel(b.status)).length
  const bulkOpen = view === 'list' && selectedBooks.length > 0

  // In the list, a linked book is scrolled to once.
  const listReady = view === 'list' && shown.length > 0
  useEffect(() => {
    if (listReady && linkedBook) document.getElementById(`book-${linkedBook}`)?.scrollIntoView({ block: 'center' })
  }, [listReady, linkedBook])

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
        toast(kind === 'download' ? `Searching for ${plural(ids.length, 'book')}…` : `Cancelled ${ids.length}`)
        setSelected(new Set())
      },
      onError: (e) => toast(errMsg(e), 'error'),
    })
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="py-20 text-center">
        <p className="text-muted">{notFound ? 'This author is not in your library.' : `Could not load author: ${errMsg(error)}`}</p>
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
  const emptyText =
    refreshing && books.length === 0
      ? 'Fetching books…'
      : books.length === 0
        ? 'No books yet.'
        : hiddenCount > 0
          ? `No books here. ${plural(hiddenCount, 'obscure edition')} hidden.`
          : 'No books match this filter.'

  return (
    <div className={`space-y-8 ${bulkOpen ? 'pb-20' : ''}`}>
      <Ambient
        src={toneBook ? toneBook.cover_url : author.photo_url}
        fallback={placeholderGradient(toneBook ? toneBook.title : author.name)}
      />

      {/* ---------------------------------------------------------------- header */}
      <header className="flex flex-col items-center gap-6 pt-6 text-center sm:flex-row sm:items-end sm:gap-8 sm:text-left">
        <Avatar src={author.photo_url} name={author.name} className="size-36 text-5xl sm:size-44 xl:size-52" />
        <div className="min-w-0 flex-1">
          <h1 className="text-4xl leading-[0.95] font-extrabold tracking-tighter text-balance sm:text-6xl xl:text-7xl">{author.name}</h1>
          <p className="mt-4 text-sm font-medium">
            {plural(author.book_count, 'title')}, {author.have_count} in your library
          </p>
          <p className="mt-0.5 text-sm text-paper/60">
            {author.birth_date && <>Born {author.birth_date}. </>}
            {author.refreshed_at && <>Updated {timeAgo(author.refreshed_at)}. </>}
            {!author.monitored && <>Only the titles you added are tracked.</>}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
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
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden="true" /> Remove author
            </button>
          </div>
        </div>
      </header>

      {bio && (
        <div className="max-w-[70ch] text-sm leading-relaxed text-paper/75">
          <p className={`whitespace-pre-line ${bioOpen || !longBio ? '' : 'line-clamp-3'}`}>{bio}</p>
          {longBio && (
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-paper hover:underline"
              onClick={() => setBioOpen((o) => !o)}
              aria-expanded={bioOpen}
            >
              {bioOpen ? 'Show less' : 'Show more'}
              <ChevronDown className={`size-3.5 transition-transform ${bioOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {refreshing && (
        <p className="flex items-center gap-3 rounded-xl bg-white/8 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Fetching books from OpenLibrary…
        </p>
      )}

      {/* ---------------------------------------------------------------- toolbar */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div role="tablist" aria-label="Filter books" className="-mx-1 flex max-w-full gap-2 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" type="button" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className="chip">
                {f.label} <span className="text-xs tabular-nums opacity-60">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="chip"
              aria-expanded={filtersOpen}
              aria-controls="book-filters"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" /> Filters
              {narrowed && (
                <span className="size-1.5 rounded-full bg-paper">
                  <span className="sr-only">(in use)</span>
                </span>
              )}
            </button>
            <div className="flex gap-1 rounded-full bg-white/8 p-1" role="group" aria-label="View">
              <button type="button" className="seg" aria-pressed={view === 'flow'} onClick={() => setView('flow')}>
                <GalleryHorizontal className="size-4" aria-hidden="true" /> Flow
              </button>
              <button type="button" className="seg" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <List className="size-4" aria-hidden="true" /> List
              </button>
            </div>
          </div>
        </div>
        <div id="book-filters" hidden={!filtersOpen} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Filter titles"
              aria-label="Filter titles"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="year-from" className="text-muted">
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
            <span className="text-faint" aria-hidden="true">
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
            <span className="text-muted">Sort</span>
            <select className="input w-auto" value={sort} onChange={(e) => isSort(e.target.value) && setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
            <input type="checkbox" className="size-4" checked={hideObscure} onChange={(e) => setHideObscure(e.target.checked)} />
            Hide obscure editions
            {hiddenCount > 0 && <span className="text-faint tabular-nums">({hiddenCount} hidden)</span>}
          </label>
        </div>
      </section>

      {/* ---------------------------------------------------------------- books */}
      {view === 'list' ? (
        <BookList
          books={shown}
          selected={selected}
          selectedCount={selectedBooks.length}
          emptyText={emptyText}
          onToggle={toggle}
          onToggleAll={(select) => setSelected(select ? new Set(shown.map((b) => b.id)) : new Set())}
          onManual={setManualBook}
          onDownload={downloadOne}
          onCancel={cancelOne}
        />
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <div>
          <div className="-mx-(--shelf-pad)">
            <CoverFlow
              key={listKey}
              books={shown}
              initialId={listKey === firstListKey.current ? linkedBook : null}
              onActiveChange={setActiveId}
              label={`Books by ${author.name}`}
            />
          </div>
          {activeBook && (
            <FocusPanel
              book={activeBook}
              onDownload={downloadOne}
              onCancel={cancelOne}
              onManual={setManualBook}
            />
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- bulk bar */}
      {bulkOpen && (
        <div className="fixed right-0 bottom-(--tabbar-h) left-(--sidebar-w) z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-2xl animate-toast-in items-center gap-2 rounded-full bg-lift p-2 pl-5 shadow-2xl shadow-black ring-1 ring-white/10">
            <span className="mr-auto text-sm font-semibold tabular-nums">{selectedBooks.length} selected</span>
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
            <button type="button" className="btn btn-secondary" disabled={nCancellable === 0 || unwant.isPending} onClick={() => bulk('unwant')}>
              <Undo2 className="size-4" /> Cancel{nCancellable > 0 && nCancellable !== selectedBooks.length ? ` ${nCancellable}` : ''}
            </button>
            <button type="button" className="btn btn-icon btn-ghost" onClick={() => setSelected(new Set())}>
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Clear selection</span>
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

/** Everything about the cover in the middle of the flow, and what you can do with it. */
function FocusPanel({
  book: b,
  onDownload,
  onCancel,
  onManual,
}: {
  book: Book
  onDownload: (id: number) => void
  onCancel: (id: number) => void
  onManual: (b: Book) => void
}) {
  const showMsg = b.status_message && b.status !== 'none' && b.status !== 'have'
  return (
    <div className="mx-auto mt-6 flex min-h-52 max-w-xl flex-col items-center text-center">
      <h2 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl">{b.title}</h2>
      {b.subtitle && <p className="mt-1 line-clamp-1 text-muted">{b.subtitle}</p>}
      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          {b.year ?? 'Unknown year'}, {plural(b.edition_count, 'edition')}
        </span>
        <StatusBadge status={b.status} />
      </p>
      {showMsg && (
        <p className={`mt-2 line-clamp-2 max-w-md text-xs ${b.status === 'failed' ? 'text-failed' : 'text-muted'}`}>{b.status_message}</p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {canDownload(b.status) && (
          <button type="button" className="btn btn-primary px-6 py-3" onClick={() => onDownload(b.id)}>
            <Download className="size-4.5" aria-hidden="true" /> {b.status === 'failed' ? 'Retry download' : 'Download'}
          </button>
        )}
        {b.status === 'wanted' && (
          <button type="button" className="btn btn-secondary px-5 py-3" onClick={() => onCancel(b.id)}>
            <Undo2 className="size-4" aria-hidden="true" /> Cancel
          </button>
        )}
        {b.status !== 'have' && (
          <button type="button" className="btn btn-secondary px-5 py-3" onClick={() => onManual(b)}>
            <SearchCheck className="size-4.5" aria-hidden="true" /> Search manually
          </button>
        )}
      </div>
    </div>
  )
}

function AuthorSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:items-end sm:gap-8">
        <div className="skeleton size-36 rounded-full sm:size-44" />
        <div className="w-full flex-1 space-y-3">
          <div className="skeleton h-14 w-96 max-w-full" />
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-10 w-64" />
        </div>
      </div>
      <div className="flex justify-center gap-4 overflow-hidden py-8">
        {[0.8, 0.8, 1, 0.8, 0.8].map((s, i) => (
          <div key={i} className="skeleton aspect-[2/3] w-40 shrink-0" style={{ scale: String(s), opacity: s === 1 ? 1 : 0.5 }} />
        ))}
      </div>
    </div>
  )
}
