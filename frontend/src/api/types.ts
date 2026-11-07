// JSON shapes returned by backend/fastlibrarian/api.py.

export type BookStatus = 'none' | 'wanted' | 'downloading' | 'sent' | 'have' | 'failed'

export interface AuthStatus {
  setup_required: boolean
  authenticated: boolean
  username: string | null
  version: string
}

export interface Author {
  id: number
  name: string
  ol_key: string | null
  photo_url: string | null
  bio: string | null
  birth_date: string | null
  monitored: boolean
  refreshed_at: string | null
  book_count: number
  have_count: number
  wanted_count: number
}

export interface Book {
  id: number
  author_id: number
  author_name: string
  title: string
  subtitle: string | null
  ol_work_key: string | null
  isbn: string | null
  year: number | null
  cover_url: string | null
  edition_count: number
  languages: string[]
  status: BookStatus
  status_message: string | null
}

export interface AuthorDetail {
  author: Author
  refreshing: boolean
  books: Book[]
}

export interface SearchAuthor {
  ol_key: string
  name: string
  work_count: number | null
  top_work: string | null
  birth_date: string | null
  photo_url: string | null
  library_id: number | null
}

export interface SearchBook {
  ol_work_key: string
  title: string
  subtitle: string | null
  author_name: string | null
  author_key: string | null
  year: number | null
  cover_url: string | null
  edition_count: number | null
  library_id: number | null
  status: BookStatus | null
}

export interface SearchResult {
  query: string
  isbn: string | null
  authors: SearchAuthor[]
  books: SearchBook[]
}

/** The Prowlarr release dict (passed back verbatim to /grab). */
export interface Release {
  guid: string
  title: string
  indexer: string
  indexer_id: number | null
  size: number
  seeders: number
  leechers: number
  download_url: string | null
  magnet_url: string | null
  info_hash: string | null
  publish_date: string | null
  categories: number[]
  [key: string]: unknown
}

export interface ScoredRelease {
  release: Release
  score: number
  accepted: boolean
  format: string | null
  details: Record<string, string | number>
  reject_reason: string | null
}

export interface ActivityDownload {
  id: number
  book_id: number
  book_title: string
  author_name: string
  release_title: string
  indexer: string | null
  size: number | null
  score: number
  score_details: Record<string, string | number>
  state: 'downloading' | 'completed' | 'imported' | 'failed'
  progress: number
  message: string | null
  imported_file: string | null
  created_at: string
  finished_at: string | null
}

export interface ActivityJob {
  id: number
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'failed'
  attempts: number
  message: string | null
  created_at: string
  finished_at: string | null
}

export interface Activity {
  downloads: ActivityDownload[]
  jobs: ActivityJob[]
}

export interface Settings {
  prowlarr_url: string
  prowlarr_api_key: string
  prowlarr_categories: number[]
  prowlarr_indexer_ids: number[]
  qbit_url: string
  qbit_username: string
  qbit_password: string
  qbit_category: string
  qbit_path_from: string
  qbit_path_to: string
  ingest_dir: string
  calibre_library_dir: string
  import_mode: 'copy' | 'hardlink' | string
  google_books_api_key: string
  preferred_formats: string[]
  languages: string[]
  min_seeders: number
  min_score: number
  max_size_mb: number
  author_refresh_hours: number
  calibre_sync_minutes: number
}

export interface TestResult {
  ok: boolean
  message: string
}
