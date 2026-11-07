import { Library, Search } from 'lucide-react'
import { memo, useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthors } from '../api/hooks'
import type { Author } from '../api/types'
import { Avatar } from '../components/Images'
import { errMsg } from '../lib/format'

export function LibraryPage() {
  const { data, isPending, isError, error } = useAuthors()
  const [filter, setFilter] = useState('')
  const deferred = useDeferredValue(filter)

  const shown = useMemo(() => {
    const f = deferred.trim().toLowerCase()
    return f ? (data ?? []).filter((a) => a.name.toLowerCase().includes(f)) : (data ?? [])
  }, [data, deferred])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          {data && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {data.length} author{data.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            className="input pl-9"
            placeholder="Filter authors…"
            aria-label="Filter authors"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load library: {errMsg(error)}</p>}

      {isPending && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="card flex flex-col items-center gap-3 p-5">
              <div className="skeleton size-20 rounded-full" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Library className="size-10 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
          <p className="font-medium">Your library is empty</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Search for an author and add them to get started.</p>
          <Link to="/" className="btn btn-primary mt-2">
            <Search className="size-4" aria-hidden="true" /> Search
          </Link>
        </div>
      )}

      {data && data.length > 0 && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-500">No authors match “{filter}”.</p>
      )}

      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((a) => (
            <AuthorCard key={a.id} author={a} />
          ))}
        </div>
      )}
    </div>
  )
}

const AuthorCard = memo(function AuthorCard({ author: a }: { author: Author }) {
  const pct = a.book_count ? Math.round((a.have_count / a.book_count) * 100) : 0
  return (
    <Link
      to={`/authors/${a.id}`}
      className="card group relative flex flex-col items-center gap-2 p-4 text-center transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-500 sm:p-5 dark:hover:ring-indigo-700"
    >
      {a.wanted_count > 0 && (
        <span
          className="absolute top-2.5 right-2.5 rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
          title={`${a.wanted_count} wanted / downloading`}
        >
          {a.wanted_count} wanted
        </span>
      )}
      <Avatar src={a.photo_url} name={a.name} className="size-20" />
      <p className="line-clamp-2 leading-tight font-semibold group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
        {a.name}
      </p>
      <div className="w-full">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">{a.have_count}</span> / {a.book_count} books
        </p>
        <div className="mx-auto mt-1.5 h-1 w-2/3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {!a.monitored && (
        <span className="text-[0.7rem] text-zinc-400 italic dark:text-zinc-500">single book</span>
      )}
    </Link>
  )
})
