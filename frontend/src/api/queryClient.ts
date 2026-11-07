import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'
import type { AuthStatus } from './types'

export const AUTH_KEY = ['auth'] as const

function onError(err: unknown) {
  // Any 401 drops the user back to the login screen.
  if (err instanceof ApiError && err.status === 401) {
    queryClient.setQueryData<AuthStatus>(AUTH_KEY, (old) => (old ? { ...old, authenticated: false } : old))
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
})
