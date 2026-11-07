import { ArrowRight, Barcode, Download, Loader2, Plus, Search, X } from 'lucide-react'
import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAddAuthor, useAddBook, useSearch } from '../api/hooks'
import type { SearchAuthor, SearchBook } from '../api/types'
import { Avatar, Cover } from '../components/Images'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { errMsg } from '../lib/format'

const EXAMPLES = ['Frank Herbert', 'Ursula K. Le Guin', 'The Left Hand of Darkness', '9780441172719']

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const [text, setText] = useState(q)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useSearch(q)

  // Keep the box in sync with back/forward navigation.
  useEffect(() => setText(q), [q])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const v = text.trim()
    if (v) setParams({ q: v })
    inputRef.current?.blur()
  }

  const data = search.data
  const nothing = data && data.authors.length === 0 && data.books.length === 0

  return (
    <div className="space-y-8">
      <form onSubmit={submit} role="search" className={q ? '' : 'pt-6 sm:pt-16'}>
        {!q && (
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Find your next book</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Search by title, author or ISBN.</p>
          </div>
        )}
        <div className="relative mx-auto max-w-2xl">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            aria-label="Search for a book, author or ISBN"
            placeholder="Book, author or ISBN…"
            autoFocus={!q}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input h-14 rounded-2xl pr-28 pl-12 text-base shadow-sm [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
            {text && (
              <button
                type="button"
                className="btn btn-ghost p-2"
                aria-label="Clear"
                onClick={() => {
                  setText('')
                  inputRef.current?.focus()
                }}
              >
                <X className="size-4" />
              </button>
            )}
            <button type="submit" className="btn btn-primary h-10 rounded-xl" disabled={!text.trim()}>
              {search.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : 'Search'}
            </button>
          </div>
        </div>
        {!q && (
          <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="rounded-full bg-zinc-200/70 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-300/70 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                onClick={() => setParams({ q: ex })}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </form>

      {search.isError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          Search failed: {errMsg(search.error)}
        </p>
      )}

      {q && search.isPending && <ResultsSkeleton />}

      {data && (
        <>
          {data.isbn && (
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700 ring-1 ring-indigo-200 ring-inset dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800">
                <Barcode className="size-4" aria-hidden="true" /> ISBN match
              </span>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">{data.isbn}</span>
            </div>
          )}

          {nothing && (
            <p className="py-12 text-center text-zinc-500 dark:text-zinc-400">
              No results for <span className="font-medium text-zinc-700 dark:text-zinc-200">“{data.query}”</span>.
            </p>
          )}

          {data.authors.length > 0 && (
            <section aria-labelledby="authors-h">
              <h2 id="authors-h" className="mb-3 text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Authors
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.authors.map((a) => (
                  <AuthorResult key={a.ol_key} author={a} />
                ))}
              </div>
            </section>
          )}

          {data.books.length > 0 && (
            <section aria-labelledby="books-h">
              <h2 id="books-h" className="mb-3 text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {data.isbn ? 'Book' : 'Books'}
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {data.books.map((b) => (
                  <BookResult key={b.ol_work_key} book={b} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

const AuthorResult = memo(function AuthorResult({ author: a }: { author: SearchAuthor }) {
  const add = useAddAuthor()
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <div className="card flex items-center gap-4 p-4">
      <Avatar src={a.photo_url} name={a.name} className="size-16" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{a.name}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {a.work_count ? `${a.work_count} works` : 'No works listed'}
          {a.birth_date && ` · b. ${a.birth_date}`}
        </p>
        {a.top_work && <p className="mt-0.5 truncate text-xs text-zinc-500 italic dark:text-zinc-400">{a.top_work}</p>}
        <div className="mt-2">
          {a.library_id ? (
            <Link to={`/authors/${a.library_id}`} className="btn btn-secondary btn-sm">
              In library <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={add.isPending}
              onClick={() =>
                add.mutate(a.ol_key, {
                  onSuccess: (author) => {
                    toast(`Added ${author.name}. Fetching books…`)
                    navigate(`/authors/${author.id}`)
                  },
                  onError: (e) => toast(`Could not add author: ${errMsg(e)}`, 'error'),
                })
              }
            >
              {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add to library
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

const BookResult = memo(function BookResult({ book: b }: { book: SearchBook }) {
  const add = useAddBook()
  const toast = useToast()
  const pendingDownload = add.isPending && add.variables?.download

  function run(download: boolean) {
    add.mutate(
      { ol_work_key: b.ol_work_key, download },
      {
        onSuccess: () => toast(download ? `Searching for “${b.title}”…` : `Added “${b.title}”`),
        onError: (e) => toast(`Could not add book: ${errMsg(e)}`, 'error'),
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Cover src={b.cover_url} title={b.title} className="w-full" />
      <div className="mt-2 flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-sm leading-snug font-semibold" title={b.title}>
          {b.title}
        </p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {b.author_name ?? 'Unknown author'}
          {b.year && ` · ${b.year}`}
        </p>
        {!!b.edition_count && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {b.edition_count} edition{b.edition_count === 1 ? '' : 's'}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {b.library_id && b.status ? (
            b.status === 'none' || b.status === 'failed' ? (
              <>
                <StatusBadge status={b.status} />
                <button type="button" className="btn btn-primary btn-sm" disabled={add.isPending} onClick={() => run(true)}>
                  {pendingDownload ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Download
                </button>
              </>
            ) : (
              <StatusBadge status={b.status} />
            )
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={add.isPending} onClick={() => run(true)}>
                {pendingDownload ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                Download
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={add.isPending} onClick={() => run(false)}>
                {add.isPending && !pendingDownload ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Add
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

function ResultsSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card flex items-center gap-4 p-4">
            <div className="skeleton size-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-7 w-28" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[2/3] w-full" />
            <div className="skeleton mt-2 h-4 w-5/6" />
            <div className="skeleton mt-1 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
