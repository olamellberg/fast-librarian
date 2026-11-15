import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { Author } from '../api/types'
import { Avatar } from './Images'

/** A round portrait with the name underneath; the whole card links to the author. */
export const AuthorCard = memo(function AuthorCard({ author: a, className = 'w-32 sm:w-40' }: { author: Author; className?: string }) {
  return (
    <li className={`group relative min-w-0 list-none ${className}`}>
      <Avatar src={a.photo_url} name={a.name} className="aspect-square w-full text-3xl" />
      <p className="mt-2.5 line-clamp-2 text-sm leading-snug font-semibold">
        <Link
          to={`/authors/${a.id}`}
          className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-paper"
        >
          {a.name}
        </Link>
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">
        {a.have_count} of {a.book_count} in library
      </p>
    </li>
  )
})
