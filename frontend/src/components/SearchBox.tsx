import { useIsFetching } from '@tanstack/react-query'
import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export const SEARCH_INPUT_ID = 'global-search'

/** The one search field of the app. It lives in the top bar and drives `/search?q=`. */
export function SearchBox() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const onSearchPage = pathname === '/search'
  const q = onSearchPage ? (params.get('q') ?? '').trim() : ''
  const [text, setText] = useState(q)
  const input = useRef<HTMLInputElement>(null)
  const searching = useIsFetching({ queryKey: ['search'] }) > 0

  // Keep the box in sync with back/forward navigation, and empty it when leaving the results.
  useEffect(() => setText(q), [q, onSearchPage])

  // Arriving on an empty search page means the next thing to do is type.
  useEffect(() => {
    if (onSearchPage && !q) input.current?.focus()
  }, [onSearchPage, q])

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    navigate(`/search?q=${encodeURIComponent(v)}`)
    input.current?.blur()
  }

  const Icon = searching ? Loader2 : Search
  return (
    <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 lg:max-w-md">
      <Icon
        className={`pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-muted ${searching ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <input
        ref={input}
        id={SEARCH_INPUT_ID}
        type="search"
        enterKeyHint="search"
        aria-label="Search for a book, author or ISBN"
        placeholder="Book, author or ISBN"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="input h-11 rounded-full pr-11 pl-11 text-[0.95rem] [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          className="btn btn-icon btn-ghost absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => {
            setText('')
            input.current?.focus()
          }}
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </form>
  )
}
