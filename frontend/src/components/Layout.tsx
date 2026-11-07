import { Activity, Library, LogOut, Search, Settings } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStatus, useLogout } from '../api/hooks'
import { Logo, LogoMark } from './Logo'

const NAV = [
  { to: '/', label: 'Search', Icon: Search, end: true },
  { to: '/library', label: 'Library', Icon: Library, end: false },
  { to: '/activity', label: 'Activity', Icon: Activity, end: false },
  { to: '/settings', label: 'Settings', Icon: Settings, end: false },
]

export function Layout() {
  const { data: auth } = useAuthStatus()
  const logout = useLogout()

  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <NavLink to="/" className="flex items-center rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-500">
            <span className="hidden sm:inline">
              <Logo />
            </span>
            <span className="flex items-center gap-2 sm:hidden">
              <LogoMark className="size-7" />
              <span className="font-semibold tracking-tight">FastLibrarian</span>
            </span>
          </NavLink>
          <nav className="ml-4 hidden gap-1 sm:flex" aria-label="Main">
            {NAV.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `btn ${isActive ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'btn-ghost'}`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {auth?.username && (
              <span className="hidden text-sm text-zinc-500 md:inline dark:text-zinc-400">{auth.username}</span>
            )}
            <button
              type="button"
              className="btn btn-ghost px-2"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              title="Log out"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">Log out</span>
              <span className="sr-only md:hidden">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:py-8">
        <Outlet />
      </main>

      {/* Bottom tab bar on phones */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden dark:border-zinc-800 dark:bg-zinc-950/90"
      >
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium ${
                isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'
              }`
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
