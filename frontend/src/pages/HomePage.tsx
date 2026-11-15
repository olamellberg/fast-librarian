import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthor, useAuthors, useBooks } from '../api/hooks'
import type { Author, Book } from '../api/types'
import { AuthorCard } from '../components/AuthorCard'
import { LibraryBookCard } from '../components/BookCard'
import { Shelf, ShelfSkeleton } from '../components/Shelf'
import { compareBooks, isObscure } from '../lib/books'
import { errMsg } from '../lib/format'

const IN_PROGRESS = ['wanted', 'downloading', 'sent'] as const
const HAVE = ['have'] as const
const AUTHOR_SHELVES = 8
const PER_AUTHOR = 20

export function HomePage() {
  const authors = useAuthors()
  const progress = useBooks(IN_PROGRESS, 60)
  const have = useBooks(HAVE, 30)
  useRefreshWhenBooksArrive(progress.data)

  // Authors you touched most recently first, then the ones you own most of.
  const featured = useMemo(() => {
    const all = authors.data ?? []
    const byId = new Map(all.map((a) => [a.id, a]))
    const picked = new Map<number, Author>()
    for (const b of [...(progress.data ?? []), ...(have.data ?? [])]) {
      const a = byId.get(b.author_id)
      if (a) picked.set(a.id, a)
    }
    for (const a of [...all].sort((x, y) => y.have_count - x.have_count || y.book_count - x.book_count)) picked.set(a.id, a)
    return [...picked.values()].filter((a) => a.book_count > 0).slice(0, AUTHOR_SHELVES)
  }, [authors.data, progress.data, have.data])

  if (authors.isError) return <p className="py-10 text-sm text-failed">Could not load your library: {errMsg(authors.error)}</p>

  if (authors.isPending) {
    return (
      <div className="space-y-10 pt-4" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="skeleton mb-4 h-7 w-56" />
            <ShelfSkeleton />
          </div>
        ))}
      </div>
    )
  }

  if (authors.data.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight">Start with an author you love</h1>
        <p className="text-muted">Add them and every book they wrote lines up here, ready to pick from.</p>
        <Link to="/search" className="btn btn-primary mt-2 px-6 py-3">
          <Search className="size-4.5" aria-hidden="true" /> Find an author
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-10 pt-4">
      <h1 className="sr-only">Home</h1>

      {!!progress.data?.length && (
        <Shelf title="In progress" to="/activity">
          {progress.data.map((b) => (
            <LibraryBookCard key={b.id} book={b} />
          ))}
        </Shelf>
      )}

      {!!have.data?.length && (
        <Shelf title="Latest in your library">
          {have.data.map((b) => (
            <LibraryBookCard key={b.id} book={b} />
          ))}
        </Shelf>
      )}

      <Shelf title="Your authors" to="/library">
        {authors.data.map((a) => (
          <AuthorCard key={a.id} author={a} />
        ))}
      </Shelf>

      {featured.map((a) => (
        <AuthorShelf key={a.id} author={a} />
      ))}
    </div>
  )
}

/**
 * A book leaving the in-progress list was imported (or failed) on the server, which no mutation here
 * knows about: refresh everything that counts books.
 */
function useRefreshWhenBooksArrive(progress: Book[] | undefined) {
  const qc = useQueryClient()
  const before = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (!progress) return
    const now = new Set(progress.map((b) => b.id))
    const left = before.current && [...before.current].some((id) => !now.has(id))
    before.current = now
    if (left) {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['authors'] })
    }
  }, [progress, qc])
}

/** The best-known books of one author. Loads when it comes near the screen, and shares its data with the author page. */
function AuthorShelf({ author }: { author: Author }) {
  const holder = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = holder.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '300px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const { data } = useAuthor(author.id, { enabled: near, poll: false, staleTime: 5 * 60_000 })
  const books = useMemo(
    () => (data ? data.books.filter((b) => !isObscure(b)).sort(compareBooks('popular')).slice(0, PER_AUTHOR) : null),
    [data],
  )

  // Nothing worth a shelf (an author whose few books are all obscure editions).
  if (books && books.length === 0) return null

  return (
    // The reserved height keeps the shelves below from all counting as "near" before this one has loaded.
    <div ref={holder} className="min-h-80">
      {books ? (
        <Shelf title={author.name} to={`/authors/${author.id}`}>
          {books.map((b) => (
            <LibraryBookCard key={b.id} book={b} showAuthor={false} />
          ))}
        </Shelf>
      ) : (
        <>
          <div className="skeleton mb-4 h-7 w-56" />
          <ShelfSkeleton />
        </>
      )}
    </div>
  )
}
