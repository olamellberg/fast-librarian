import { Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthors } from '../api/hooks'
import { AuthorCard } from '../components/AuthorCard'
import { plural } from '../lib/books'
import { errMsg } from '../lib/format'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]'

/** Every author you follow, as portraits. */
export function LibraryPage() {
  const { data, isPending, isError, error } = useAuthors()
  const [filter, setFilter] = useState('')
  const deferred = useDeferredValue(filter)

  const shown = useMemo(() => {
    const f = deferred.trim().toLowerCase()
    return f ? (data ?? []).filter((a) => a.name.toLowerCase().includes(f)) : (data ?? [])
  }, [data, deferred])

  return (
    <div className="space-y-7 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Your authors</h1>
          {data && data.length > 0 && <p className="mt-1 text-sm text-muted">{plural(data.length, 'author')}</p>}
        </div>
        {data && data.length > 0 && (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Filter authors"
              aria-label="Filter authors"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}
      </div>

      {isError && <p className="text-sm text-failed">Could not load your authors: {errMsg(error)}</p>}

      {isPending && (
        <div className={GRID} aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i}>
              <div className="skeleton aspect-square w-full rounded-full" />
              <div className="skeleton mt-3 h-4 w-3/4" />
              <div className="skeleton mt-1.5 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-xl font-bold">No authors yet</p>
          <p className="text-sm text-muted">Search for an author and add them to see their books here.</p>
          <Link to="/search" className="btn btn-primary mt-2">
            <Search className="size-4" aria-hidden="true" /> Find an author
          </Link>
        </div>
      )}

      {data && data.length > 0 && shown.length === 0 && <p className="py-10 text-center text-sm text-muted">No author matches “{filter}”.</p>}

      {shown.length > 0 && (
        <ul className={GRID}>
          {shown.map((a) => (
            <AuthorCard key={a.id} author={a} className="" />
          ))}
        </ul>
      )}
    </div>
  )
}
