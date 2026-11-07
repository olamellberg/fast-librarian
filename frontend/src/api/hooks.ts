import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from './client'
import { AUTH_KEY } from './queryClient'
import type {
  Activity,
  AuthStatus,
  Author,
  AuthorDetail,
  Book,
  BookStatus,
  ScoredRelease,
  SearchResult,
  Settings,
  TestResult,
} from './types'

const ACTIVE: ReadonlySet<BookStatus> = new Set(['wanted', 'downloading', 'sent'])
export const isActive = (s: BookStatus) => ACTIVE.has(s)

// ---------------------------------------------------------------- auth

export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: () => api<AuthStatus>('/auth/status'), staleTime: Infinity })
}

export function useAuthAction(kind: 'setup' | 'login') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { username: string; password: string }) => post<{ username: string }>(`/auth/${kind}`, body),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] })
      await qc.invalidateQueries({ queryKey: AUTH_KEY })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] })
      await qc.invalidateQueries({ queryKey: AUTH_KEY })
    },
  })
}

// ---------------------------------------------------------------- search

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api<SearchResult>(`/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.length > 0,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------- authors

export function useAuthors() {
  return useQuery({ queryKey: ['authors'], queryFn: () => api<Author[]>('/authors') })
}

export function useAddAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ol_key: string) => post<Author>('/authors', { ol_key }),
    onSuccess: (author) => {
      qc.setQueriesData<SearchResult>({ queryKey: ['search'] }, (old) =>
        old && {
          ...old,
          authors: old.authors.map((a) => (a.ol_key === author.ol_key ? { ...a, library_id: author.id } : a)),
        },
      )
      void qc.invalidateQueries({ queryKey: ['authors'] })
    },
  })
}

export function useAuthor(id: number) {
  return useQuery({
    queryKey: ['author', id],
    queryFn: () => api<AuthorDetail>(`/authors/${id}`),
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d) return false
      if (d.refreshing) return 2000
      return d.books.some((b) => isActive(b.status)) ? 5000 : false
    },
  })
}

export function useAuthorAction(id: number, action: 'refresh' | 'monitor') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<{ ok: boolean }>(`/authors/${id}/${action}`),
    onSuccess: () => {
      qc.setQueryData<AuthorDetail>(['author', id], (old) =>
        old && {
          ...old,
          refreshing: true,
          author: action === 'monitor' ? { ...old.author, monitored: true } : old.author,
        },
      )
      void qc.invalidateQueries({ queryKey: ['authors'] })
    },
  })
}

export function useDeleteAuthor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/authors/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Author[]>(['authors'], (old) => old?.filter((a) => a.id !== id))
      qc.removeQueries({ queryKey: ['author', id] })
      void qc.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

// ---------------------------------------------------------------- books

export function useAddBook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ol_work_key: string; download: boolean }) => post<Book>('/books', v),
    onSuccess: (book) => {
      qc.setQueriesData<SearchResult>({ queryKey: ['search'] }, (old) =>
        old && {
          ...old,
          books: old.books.map((b) =>
            b.ol_work_key === book.ol_work_key ? { ...b, library_id: book.id, status: book.status } : b,
          ),
        },
      )
      void qc.invalidateQueries({ queryKey: ['authors'] })
      void qc.invalidateQueries({ queryKey: ['author', book.author_id] })
    },
  })
}

/** Bulk download / cancel for books of one author page, with an optimistic status change. */
export function useBookBulk(authorId: number, action: 'download' | 'unwant') {
  const qc = useQueryClient()
  const key = ['author', authorId]
  return useMutation({
    mutationFn: (book_ids: number[]) => post<Record<string, number>>(`/books/${action}`, { book_ids }),
    onMutate: async (book_ids) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<AuthorDetail>(key)
      const ids = new Set(book_ids)
      qc.setQueryData<AuthorDetail>(key, (old) =>
        old && {
          ...old,
          books: old.books.map((b) => {
            if (!ids.has(b.id)) return b
            if (action === 'download' && (b.status === 'none' || b.status === 'failed' || b.status === 'wanted'))
              return { ...b, status: 'wanted', status_message: 'Searching…' }
            if (action === 'unwant' && (b.status === 'wanted' || b.status === 'failed'))
              return { ...b, status: 'none', status_message: null }
            return b
          }),
        },
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['authors'] })
    },
  })
}

export function useReleases(bookId: number | null) {
  return useQuery({
    queryKey: ['releases', bookId],
    queryFn: ({ signal }) => api<ScoredRelease[]>(`/books/${bookId}/releases`, { signal }),
    enabled: bookId !== null,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export function useGrab(authorId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { bookId: number; release: ScoredRelease['release'] }) =>
      post<{ download_id: number }>(`/books/${v.bookId}/grab`, { release: v.release }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['author', authorId] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

// ---------------------------------------------------------------- activity

export function useActivity() {
  return useQuery({
    queryKey: ['activity'],
    queryFn: () => api<Activity>('/activity'),
    refetchInterval: 3000,
    staleTime: 0,
  })
}

// ---------------------------------------------------------------- settings

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: Infinity })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Settings) => api<Settings>('/settings', { method: 'PUT', body: s }),
    onSuccess: (s) => qc.setQueryData(['settings'], s),
  })
}

export function useTestService() {
  return useMutation({
    mutationFn: (service: 'prowlarr' | 'qbittorrent' | 'calibre') => post<TestResult>(`/settings/test/${service}`),
  })
}
