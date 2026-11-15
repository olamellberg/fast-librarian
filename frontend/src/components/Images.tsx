import { BookOpen, UserRound } from 'lucide-react'
import { memo, useState } from 'react'
import { hue, placeholderGradient } from '../lib/tone'

/** OpenLibrary returns a 1x1 placeholder (or 404) for missing images; treat tiny images as missing. */
function isBlank(img: HTMLImageElement) {
  return img.naturalWidth <= 1 || img.naturalHeight <= 1
}

/** OpenLibrary serves every cover in S, M and L; the API hands out M. */
const largeUrl = (src: string) => src.replace(/-M\.jpg$/, '-L.jpg')

export const Cover = memo(function Cover({
  src,
  title,
  className = '',
  large = false,
}: {
  src: string | null
  title: string
  className?: string
  /** Offer the browser the large image too. Only for covers shown bigger than a thumbnail. */
  large?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const [sharp, setSharp] = useState<'loading' | 'ready' | 'none'>('loading')
  const showImg = src && !failed
  const big = large && src && largeUrl(src) !== src ? largeUrl(src) : null
  return (
    <div className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-raised shadow-lg shadow-black/40 ${className}`}>
      {/* Placeholder sits underneath so a slow, missing or blank image never leaves an empty box. */}
      <div
        className="flex size-full flex-col items-center justify-center gap-1 p-1.5 text-center text-white/90"
        style={{ background: placeholderGradient(title) }}
        aria-hidden="true"
      >
        <BookOpen className="size-1/3 max-h-8 opacity-70" />
        <span className="line-clamp-3 text-[0.6rem] leading-tight font-medium">{title}</span>
      </div>
      {showImg && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
          onLoad={(e) => isBlank(e.currentTarget) && setFailed(true)}
        />
      )}
      {/* The large file can take a while: the medium one shows first and this sharpens it once it is in. */}
      {showImg && big && sharp !== 'none' && (
        <img
          src={big}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`absolute inset-0 size-full object-cover ${sharp === 'ready' ? '' : 'invisible'}`}
          onError={() => setSharp('none')}
          onLoad={(e) => setSharp(isBlank(e.currentTarget) ? 'none' : 'ready')}
        />
      )}
    </div>
  )
})

export const Avatar = memo(function Avatar({
  src,
  name,
  className = 'size-16',
}: {
  src: string | null
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full shadow-lg shadow-black/40 ${className}`}
      style={{ background: `hsl(${hue(name)} 30% 34%)` }}
    >
      <span className="flex size-full items-center justify-center font-semibold text-white/90" aria-hidden="true">
        {initials || <UserRound className="size-1/2" />}
      </span>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
          onLoad={(e) => isBlank(e.currentTarget) && setFailed(true)}
        />
      )}
    </div>
  )
})

/**
 * The colour of the page: a heavily blurred copy of a cover (or a gradient) behind the content.
 * When the tone changes the new one fades in on top while the previous one fades out underneath.
 */
export function Ambient({ src, fallback }: { src: string | null; fallback: string }) {
  const tone = `${src ?? ''}|${fallback}`
  const [layers, setLayers] = useState([{ tone, src, fallback }])
  const top = layers[layers.length - 1]
  if (top?.tone !== tone) {
    const next = { tone, src, fallback }
    setLayers(top && !layers.some((l) => l.tone === tone) ? [top, next] : [next])
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] overflow-hidden" aria-hidden="true">
      {layers.map((l, i) => (
        <div key={l.tone} className={`absolute inset-0 transition-opacity duration-700 ${i === layers.length - 1 ? '' : 'opacity-0'}`}>
          <AmbientLayer src={l.src} fallback={l.fallback} />
        </div>
      ))}
      {/* One pixel larger than the box: at fractional widths the last column would otherwise show unfaded. */}
      <div className="absolute -inset-px bg-linear-to-b from-panel/0 via-panel/55 to-panel" />
    </div>
  )
}

function AmbientLayer({ src, fallback }: { src: string | null; fallback: string }) {
  const [failed, setFailed] = useState(false)
  return src && !failed ? (
    <img
      src={src}
      alt=""
      className="size-full scale-150 animate-fade-in object-cover opacity-60 blur-3xl saturate-150"
      onError={() => setFailed(true)}
      onLoad={(e) => isBlank(e.currentTarget) && setFailed(true)}
    />
  ) : (
    <div className="size-full scale-150 animate-fade-in opacity-50 blur-3xl" style={{ background: fallback }} />
  )
}
