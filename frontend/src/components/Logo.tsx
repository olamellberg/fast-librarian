export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-indigo-600 dark:fill-indigo-500" />
      <path d="M7 8.5c2.5-1 5-1 8 .8v15c-3-1.8-5.5-1.8-8-.8z" fill="#c7d2fe" />
      <path d="M25 8.5c-2.5-1-5-1-8 .8v15c3-1.8 5.5-1.8 8-.8z" fill="#e0e7ff" />
      <path
        d="M18.5 6 13 17h3.5l-2 9L21 14h-3.6z"
        fill="#facc15"
        className="stroke-indigo-600 dark:stroke-indigo-500"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">
        Fast<span className="text-indigo-600 dark:text-indigo-400">Librarian</span>
      </span>
    </span>
  )
}
