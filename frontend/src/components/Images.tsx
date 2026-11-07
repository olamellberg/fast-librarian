import { BookOpen, UserRound } from 'lucide-react'
import { memo, useState } from 'react'

/** OpenLibrary returns a 1x1 placeholder (or 404) for missing images; treat tiny images as missing. */
function isBlank(img: HTMLImageElement) {
  return img.naturalWidth <= 1 || img.naturalHeight <= 1
}

function hue(text: string) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

export const Cover = memo(function Cover({
  src,
  title,
  className = '',
}: {
  src: string | null
  title: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed
  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-zinc-200 shadow-sm ring-1 ring-black/5 dark:bg-zinc-800 dark:ring-white/10 ${className}`}
    >
      {/* Placeholder sits underneath so a slow, missing or blank image never leaves an empty box. */}
      <div
        className="flex size-full flex-col items-center justify-center gap-1 p-1.5 text-center text-white/90"
        style={{ background: `linear-gradient(160deg, hsl(${hue(title)} 45% 42%), hsl(${(hue(title) + 40) % 360} 50% 28%))` }}
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
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
          onLoad={(e) => isBlank(e.currentTarget) && setFailed(true)}
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
      className={`relative shrink-0 overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      style={{ background: `hsl(${hue(name)} 40% 45%)` }}
    >
      <span className="flex size-full items-center justify-center font-semibold text-white" aria-hidden="true">
        {initials || <UserRound className="size-1/2" />}
      </span>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
          onLoad={(e) => isBlank(e.currentTarget) && setFailed(true)}
        />
      )}
    </div>
  )
})
