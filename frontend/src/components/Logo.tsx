/** An open book struck by a bolt: paper on ink, the same two tones as the rest of the interface. */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#f4f4f1" />
      <path d="M7 8.5c2.5-1 5-1 8 .8v15c-3-1.8-5.5-1.8-8-.8z" fill="#0a0a0a" />
      <path d="M25 8.5c-2.5-1-5-1-8 .8v15c3-1.8 5.5-1.8 8-.8z" fill="#0a0a0a" />
      <path d="M18.5 6 13 17h3.5l-2 9L21 14h-3.6z" fill="#f4f4f1" stroke="#0a0a0a" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-lg font-extrabold tracking-tight">FastLibrarian</span>
    </span>
  )
}
