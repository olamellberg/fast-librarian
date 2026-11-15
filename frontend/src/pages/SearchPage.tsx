import { ArrowRight, Barcode, Download, Loader2, Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAddAuthor, useAddBook, useAuthors, useSearch } from '../api/hooks'
import type { SearchAuthor, SearchBook } from '../api/types'
import { BookCard, CoverAction } from '../components/BookCard'
import { Avatar } from '../components/Images'
import { useToast } from '../components/Toast'
import { canDownload } from '../lib/books'
import { errMsg } from '../lib/format'

const EXAMPLES = ['Frank Herbert', 'Ursula K. Le Guin', 'The Left Hand of Darkness', '9780441172719']

/** Cards fill the row whatever the width of the content column (the sidebar takes some of the window). */
const BOOK_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]'
const AUTHOR_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3'

/** Results for the query in the top bar (`?q=`). The search field itself lives in the layout. */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const search = useSearch(q)
  const authors = useAuthors()

  // Search results know the OpenLibrary key of the author; the page of that author is by library id.
  const authorIdByKey = useMemo(() => new Map((authors.data ?? []).map((a) => [a.ol_key, a.id])), [authors.data])

  const data = search.data
  const nothing = data && data.authors.length === 0 && data.books.length === 0

  if (!q) {
    return (
      <div className="mx-auto max-w-xl pt-10 text-center sm:pt-24">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Find your next book</h1>
        <p className="mt-3 text-muted">Type a title, an author or an ISBN in the field above.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setParams({ q: ex })}>
              {ex}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-10 pt-4">
      <h1 className="sr-only">Results for {q}</h1>

      {search.isError && <p className="rounded-lg bg-failed/15 px-4 py-3 text-sm text-failed">Search failed: {errMsg(search.error)}</p>}

      {search.isPending && <ResultsSkeleton />}

      {data && (
        <>
          {data.isbn && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Barcode className="size-4" aria-hidden="true" /> Matched as ISBN <span className="font-mono text-paper">{data.isbn}</span>
            </p>
          )}

          {nothing && (
            <p className="py-16 text-center text-muted">
              Nothing found for <span className="font-semibold text-paper">“{data.query}”</span>. Check the spelling, or try the ISBN.
            </p>
          )}

          {data.authors.length > 0 && (
            <section aria-labelledby="authors-h">
              <h2 id="authors-h" className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">
                Authors
              </h2>
              <div className={AUTHOR_GRID}>
                {data.authors.map((a) => (
                  <AuthorResult key={a.ol_key} author={a} />
                ))}
              </div>
            </section>
          )}

          {data.books.length > 0 && (
            <section aria-labelledby="books-h">
              <h2 id="books-h" className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">
                {data.isbn ? 'Book' : 'Books'}
              </h2>
              <ul className={BOOK_GRID}>
                {data.books.map((b) => (
                  <BookResult key={b.ol_work_key} book={b} authorId={b.author_key ? authorIdByKey.get(b.author_key) : undefined} />
                ))}
              </ul>
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
      <Avatar src={a.photo_url} name={a.name} className="size-20 text-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{a.name}</p>
        <p className="text-xs text-muted">
          {a.work_count ? `${a.work_count} works` : 'No works listed'}
          {a.birth_date && `, born ${a.birth_date}`}
        </p>
        {a.top_work && <p className="mt-0.5 truncate text-xs text-muted italic">{a.top_work}</p>}
        <div className="mt-2.5">
          {a.library_id ? (
            <Link to={`/authors/${a.library_id}`} className="btn btn-secondary btn-sm">
              In your library <ArrowRight className="size-3.5" aria-hidden="true" />
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

const BookResult = memo(function BookResult({ book: b, authorId }: { book: SearchBook; authorId: number | undefined }) {
  const add = useAddBook()
  const toast = useToast()
  const pendingDownload = add.isPending && !!add.variables?.download

  function run(download: boolean) {
    add.mutate(
      { ol_work_key: b.ol_work_key, download },
      {
        onSuccess: () => toast(download ? `Searching for “${b.title}”…` : `Added “${b.title}”`),
        onError: (e) => toast(`Could not add book: ${errMsg(e)}`, 'error'),
      },
    )
  }

  const inLibrary = b.library_id != null && b.status != null
  const downloadable = !inLibrary || canDownload(b.status!)
  return (
    <BookCard
      className=""
      title={b.title}
      line={[b.author_name ?? 'Unknown author', b.year].filter(Boolean).join(', ')}
      coverUrl={b.cover_url}
      status={inLibrary ? b.status : null}
      to={inLibrary && authorId ? `/authors/${authorId}?book=${b.library_id}` : undefined}
      actions={
        downloadable && (
          <>
            {!inLibrary && (
              <CoverAction quiet label={`Add ${b.title} without downloading`} busy={add.isPending && !pendingDownload} disabled={add.isPending} onClick={() => run(false)}>
                <Plus className="size-4.5" aria-hidden="true" />
              </CoverAction>
            )}
            <CoverAction label={`Download ${b.title}`} busy={pendingDownload} disabled={add.isPending} onClick={() => run(true)}>
              <Download className="size-4.5" aria-hidden="true" />
            </CoverAction>
          </>
        )
      }
    />
  )
})

function ResultsSkeleton() {
  return (
    <div className="space-y-10" aria-hidden="true">
      <div className={AUTHOR_GRID}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card flex items-center gap-4 p-4">
            <div className="skeleton size-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-7 w-28 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <div className={BOOK_GRID}>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[2/3] w-full" />
            <div className="skeleton mt-3 h-4 w-5/6" />
            <div className="skeleton mt-1.5 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
