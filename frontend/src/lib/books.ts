import type { Book, BookStatus } from '../api/types'

export type Filter = 'all' | 'missing' | 'active' | 'library'

export const FILTERS: { id: Filter; label: string; match: (s: BookStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'missing', label: 'Missing', match: (s) => s === 'none' || s === 'failed' },
  { id: 'active', label: 'Wanted', match: (s) => s === 'wanted' || s === 'downloading' },
  { id: 'library', label: 'In library', match: (s) => s === 'sent' || s === 'have' },
]

export type Sort = 'year-desc' | 'year-asc' | 'title-asc' | 'title-desc' | 'popular'

export const SORTS: { id: Sort; label: string }[] = [
  { id: 'year-desc', label: 'Newest first' },
  { id: 'year-asc', label: 'Oldest first' },
  { id: 'title-asc', label: 'Title A–Z' },
  { id: 'title-desc', label: 'Title Z–A' },
  { id: 'popular', label: 'Most editions' },
]
export const isSort = (v: unknown): v is Sort => SORTS.some((s) => s.id === v)

const collator = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })
/** Sort key for titles: ignore a leading English article. */
const titleKey = (t: string) => t.replace(/^(the|a|an)\s+/i, '')

export function compareBooks(sort: Sort) {
  // Books without a year always go last, whatever the direction.
  const byYear = (dir: 1 | -1) => (a: Book, b: Book) =>
    a.year == null ? (b.year == null ? 0 : 1) : b.year == null ? -1 : dir * (a.year - b.year)
  const byTitle = (a: Book, b: Book) => collator.compare(titleKey(a.title), titleKey(b.title))
  switch (sort) {
    case 'year-desc':
      return (a: Book, b: Book) => byYear(-1)(a, b) || byTitle(a, b)
    case 'year-asc':
      return (a: Book, b: Book) => byYear(1)(a, b) || byTitle(a, b)
    case 'title-asc':
      return byTitle
    case 'title-desc':
      return (a: Book, b: Book) => byTitle(b, a)
    case 'popular':
      return (a: Book, b: Book) => b.edition_count - a.edition_count || byTitle(a, b)
  }
}

/** Single-edition works are mostly OpenLibrary noise; keep ones the user already acted on. */
export const isObscure = (b: Book) => b.edition_count <= 1 && b.status === 'none'

export const canDownload = (s: BookStatus) => s === 'none' || s === 'failed'
export const canCancel = (s: BookStatus) => s === 'wanted' || s === 'failed'

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
