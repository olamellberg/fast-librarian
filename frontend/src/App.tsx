import { Loader2 } from 'lucide-react'
import { Link, Route, Routes } from 'react-router-dom'
import { useAuthStatus } from './api/hooks'
import { Layout } from './components/Layout'
import { LogoMark } from './components/Logo'
import { errMsg } from './lib/format'
import { ActivityPage } from './pages/ActivityPage'
import { AuthorPage } from './pages/AuthorPage'
import { AuthScreen } from './pages/AuthScreen'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  const auth = useAuthStatus()

  if (auth.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LogoMark className="size-12 animate-shimmer" />
      </div>
    )
  }
  if (auth.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Cannot reach the FastLibrarian server: {errMsg(auth.error)}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void auth.refetch()}>
          {auth.isFetching && <Loader2 className="size-4 animate-spin" />} Retry
        </button>
      </div>
    )
  }
  if (auth.data.setup_required) return <AuthScreen setup />
  if (!auth.data.authenticated) return <AuthScreen setup={false} />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SearchPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="authors/:id" element={<AuthorPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <div className="py-20 text-center">
              <p className="text-zinc-500">Page not found.</p>
              <Link to="/" className="btn btn-secondary mt-4">
                Go to search
              </Link>
            </div>
          }
        />
      </Route>
    </Routes>
  )
}
