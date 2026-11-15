import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** A titled row of cards that scrolls sideways. Children must be `<li>` elements. */
export function Shelf({
  title,
  to,
  children,
}: {
  title: string
  /** Where the heading leads, when the shelf is a preview of a longer page. */
  to?: string
  children: ReactNode
}) {
  const id = useId()
  const track = useRef<HTMLUListElement>(null)
  const [more, setMore] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setMore((m) => (m.start === start && m.end === end ? m : { start, end }))
  }, [])

  useEffect(() => {
    const el = track.current
    if (!el) return
    measure()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Cards arriving and the window resizing both change how much there is to scroll.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const mo = new MutationObserver(measure)
    mo.observe(el, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      mo.disconnect()
    }
  }, [measure])

  function page(dir: -1 | 1) {
    const el = track.current
    if (!el) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' })
  }

  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id={id} className="min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl">
          {to ? (
            <Link to={to} className="rounded-sm hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        {(more.start || more.end) && (
          <div className="hidden shrink-0 gap-1 [@media(hover:hover)]:flex">
            <button type="button" className="btn btn-icon btn-ghost bg-white/5" onClick={() => page(-1)} disabled={!more.start}>
              <ChevronLeft className="size-5" aria-hidden="true" />
              <span className="sr-only">Scroll {title} back</span>
            </button>
            <button type="button" className="btn btn-icon btn-ghost bg-white/5" onClick={() => page(1)} disabled={!more.end}>
              <ChevronRight className="size-5" aria-hidden="true" />
              <span className="sr-only">Scroll {title} forward</span>
            </button>
          </div>
        )}
      </div>
      <ul
        ref={track}
        className="shelf-track pt-1 pb-3"
        data-more-start={more.start || undefined}
        data-more-end={more.end || undefined}
        aria-labelledby={id}
      >
        {children}
      </ul>
    </section>
  )
}

/** Placeholder cards with the same footprint as the real ones, so a loading shelf does not jump. */
export function ShelfSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div className="flex gap-4 overflow-hidden pt-1 pb-3" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="w-32 shrink-0 sm:w-40">
          <div className={`skeleton w-full ${round ? 'aspect-square rounded-full' : 'aspect-[2/3]'}`} />
          <div className="skeleton mt-3 h-4 w-5/6" />
          <div className="skeleton mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
