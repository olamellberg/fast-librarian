import { ChevronLeft, ChevronRight } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Book } from '../api/types'
import { Cover } from './Images'
import { StatusDot } from './StatusBadge'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const HAS_SCROLLEND = typeof window !== 'undefined' && 'onscrollend' in window

/**
 * Covers in a row that you flick through; the one in the middle is the active book.
 *
 * Scrolling is native (touch, trackpad, keyboard) with snap points, so everything here only *reads*
 * the scroll position: the active index is `scrollLeft / pitch`, and the same number drives the
 * buttons, the keys and the scrubber. The turning and shrinking of the covers is pure CSS
 * (see `.cf-*` in index.css).
 *
 * The position is anchored to a book, not to an index: the list is re-fetched while downloads are
 * running, and the cover under your thumb must not change because a row was added before it.
 * Remount (change `key`) to start over from `initialId`.
 */
export const CoverFlow = memo(function CoverFlow({
  books,
  initialId,
  onActiveChange,
  label,
}: {
  books: Book[]
  initialId: number | null
  onActiveChange: (id: number | null) => void
  label: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, books.findIndex((b) => b.id === initialId)))
  const [announcement, setAnnouncement] = useState('')

  const booksRef = useRef(books)
  const indexRef = useRef(index)
  const activeId = useRef<number | null>(books[index]?.id ?? null)
  /** Where a button or key press is heading while the smooth scroll is still on its way. */
  const target = useRef<number | null>(null)
  /** Distance between the centres of two neighbouring covers. */
  const pitch = useRef(0)

  const commit = useCallback(
    (i: number) => {
      const id = booksRef.current[i]?.id ?? null
      if (i === indexRef.current && id === activeId.current) return
      indexRef.current = i
      activeId.current = id
      setIndex(i)
      onActiveChange(id)
    },
    [onActiveChange],
  )

  const measure = useCallback(() => {
    const first = track.current?.firstElementChild as HTMLElement | null
    const second = first?.nextElementSibling as HTMLElement | null
    pitch.current = first ? (second ? second.offsetLeft - first.offsetLeft : first.offsetWidth) : 0
  }, [])

  // Start on the requested book, before the first paint.
  useLayoutEffect(() => {
    measure()
    if (track.current) track.current.scrollLeft = indexRef.current * pitch.current
    onActiveChange(activeId.current)
    // Mount only: later changes go through the effects below.
  }, [])

  // The list changed under us: stay on the same book wherever it moved to.
  useLayoutEffect(() => {
    booksRef.current = books
    const prev = indexRef.current
    const found = activeId.current == null ? -1 : books.findIndex((b) => b.id === activeId.current)
    const next = found === -1 ? clamp(prev, 0, Math.max(0, books.length - 1)) : found
    measure()
    // Shifting by the difference (not jumping to the slot) keeps a scroll that is in flight intact.
    if (next !== prev && track.current) track.current.scrollLeft += (next - prev) * pitch.current
    commit(next)
  }, [books, commit, measure])

  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    let timer = 0

    const read = () => {
      // A press already said where we are going; reading every frame of that scroll would fight it.
      if (target.current != null || !pitch.current) return
      commit(clamp(Math.round(el.scrollLeft / pitch.current), 0, Math.max(0, booksRef.current.length - 1)))
    }
    const settle = () => {
      target.current = null
      read()
      const b = booksRef.current[indexRef.current]
      setAnnouncement(b ? `${b.title}, ${indexRef.current + 1} of ${booksRef.current.length}` : '')
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(read)
      if (!HAS_SCROLLEND) {
        clearTimeout(timer)
        timer = window.setTimeout(settle, 150)
      }
    }
    // Width changes move every snap point; keep the active cover in the middle.
    const ro = new ResizeObserver(() => {
      measure()
      el.scrollLeft = indexRef.current * pitch.current
    })

    el.addEventListener('scroll', onScroll, { passive: true })
    if (HAS_SCROLLEND) el.addEventListener('scrollend', settle)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', settle)
      ro.disconnect()
    }
  }, [commit, measure])

  const go = useCallback(
    (to: number, instant = false) => {
      const el = track.current
      if (!el) return
      const i = clamp(to, 0, Math.max(0, booksRef.current.length - 1))
      const smooth = !instant && !matchMedia('(prefers-reduced-motion: reduce)').matches
      // Rapid presses build on where we are heading, not on where the scroll happens to be.
      target.current = smooth ? i : null
      commit(i)
      el.scrollTo({ left: i * pitch.current, behavior: smooth ? 'smooth' : 'instant' })
    },
    [commit],
  )
  const step = useCallback((d: -1 | 1) => go((target.current ?? indexRef.current) + d), [go])

  function onKeyDown(e: KeyboardEvent) {
    const to =
      e.key === 'ArrowRight' ? (target.current ?? indexRef.current) + 1
      : e.key === 'ArrowLeft' ? (target.current ?? indexRef.current) - 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? books.length - 1
      : null
    if (to == null) return
    e.preventDefault()
    go(to)
  }
  // The reader took over mid-scroll: follow the finger again.
  const release = () => {
    target.current = null
  }

  const last = books.length - 1
  return (
    <section className="cf relative" aria-roledescription="carousel" aria-label={label}>
      <div className="pointer-events-none absolute inset-x-2 top-0 bottom-0 z-10 flex items-center justify-between sm:inset-x-4">
        <button type="button" className="btn btn-icon pointer-events-auto bg-ink/60 text-paper backdrop-blur hover:bg-ink" onClick={() => step(-1)} disabled={index <= 0}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          <span className="sr-only">Previous book</span>
        </button>
        <button type="button" className="btn btn-icon pointer-events-auto bg-ink/60 text-paper backdrop-blur hover:bg-ink" onClick={() => step(1)} disabled={index >= last}>
          <ChevronRight className="size-5" aria-hidden="true" />
          <span className="sr-only">Next book</span>
        </button>
      </div>

      <div
        ref={track}
        className="cf-track rounded-lg"
        tabIndex={0}
        role="group"
        aria-label="Covers. Use the arrow keys to browse."
        onKeyDown={onKeyDown}
        onPointerDown={release}
        onWheel={release}
      >
        {books.map((b, i) => (
          <FlowItem key={b.id} book={b} position={i} total={books.length} active={i === index} onPick={go} />
        ))}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="mx-auto flex max-w-xl items-center gap-3 px-4">
        <input
          type="range"
          className="scrubber min-w-0 flex-1"
          min={0}
          max={Math.max(1, last)}
          value={index}
          disabled={last < 1}
          onChange={(e) => go(Number(e.target.value), true)}
          aria-label="Position in the list"
          aria-valuetext={books[index] ? `${books[index].title}, ${index + 1} of ${books.length}` : undefined}
        />
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {books.length ? index + 1 : 0} / {books.length}
        </span>
      </div>
    </section>
  )
})

const FlowItem = memo(function FlowItem({
  book: b,
  position,
  total,
  active,
  onPick,
}: {
  book: Book
  position: number
  total: number
  active: boolean
  onPick: (i: number) => void
}) {
  return (
    <div
      className="cf-item"
      role="group"
      aria-roledescription="slide"
      aria-label={`${b.title}, ${position + 1} of ${total}`}
      aria-current={active || undefined}
      onClick={active ? undefined : () => onPick(position)}
    >
      <div className="cf-cover relative">
        <Cover src={b.cover_url} title={b.title} large className="w-full rounded-lg shadow-2xl shadow-black/70" />
        <StatusDot status={b.status} className="absolute top-2.5 left-2.5" />
      </div>
    </div>
  )
})
