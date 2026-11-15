import { Activity, House, Library, LogOut, Search, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { useAuthStatus, useAuthors, useLogout } from '../api/hooks'
import { Avatar } from './Images'
import { Logo, LogoMark } from './Logo'
import { SEARCH_INPUT_ID, SearchBox } from './SearchBox'

const NAV = [
  { to: '/', label: 'Home', Icon: House, end: true, phoneOnly: false },
  { to: '/search', label: 'Search', Icon: Search, end: false, phoneOnly: false },
  // On desktop the sidebar itself is the library.
  { to: '/library', label: 'Library', Icon: Library, end: false, phoneOnly: true },
  { to: '/activity', label: 'Activity', Icon: Activity, end: false, phoneOnly: false },
  { to: '/settings', label: 'Settings', Icon: Settings, end: false, phoneOnly: false },
]

/** iOS only opens the keyboard when focus moves inside the tap itself, so do it here and not after navigation. */
function focusSearch() {
  document.getElementById(SEARCH_INPUT_ID)?.focus()
}

export function Layout() {
  const { data: auth } = useAuthStatus()
  const logout = useLogout()
  const { pathname } = useLocation()
  const navType = useNavigationType()

  // A new page starts at the top; going back or forward keeps the browser's own position.
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0)
  }, [pathname, navType])

  return (
    <div className="lg:pl-(--sidebar-w)">
      <aside className="fixed inset-y-0 left-0 hidden w-(--sidebar-w) flex-col bg-ink lg:flex">
        <NavLink to="/" className="mx-3 mt-4 mb-2 flex h-10 items-center rounded-lg px-3">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="space-y-0.5 px-3">
          {NAV.filter((n) => !n.phoneOnly).map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={to === '/search' ? focusSearch : undefined}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3.5 rounded-lg px-3 text-[0.95rem] font-semibold transition-colors ${
                  isActive ? 'bg-white/10 text-paper' : 'text-muted hover:text-paper'
                }`
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <SidebarAuthors />

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{auth?.username}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="size-4" aria-hidden="true" /> Log out
          </button>
        </div>
      </aside>

      {/* `isolate` so a page can paint an ambient backdrop behind its content and the top bar. */}
      <div className="relative isolate min-h-dvh min-w-0 overflow-x-clip pb-(--tabbar-h)">
        <header className="topbar sticky top-0 z-30 flex h-(--topbar-h) items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="rounded-lg lg:hidden" aria-label="Home">
            <LogoMark className="size-9" />
          </Link>
          <SearchBox />
          <button
            type="button"
            className="btn btn-icon btn-ghost lg:hidden"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="size-4.5" aria-hidden="true" />
            <span className="sr-only">Log out</span>
          </button>
        </header>

        <main className="px-4 pt-2 pb-10 sm:px-6 lg:px-8 [--shelf-pad:1rem] sm:[--shelf-pad:1.5rem] lg:[--shelf-pad:2rem]">
          <Outlet />
        </main>
      </div>

      {/* Bottom tab bar on phones and tablets */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={to === '/search' ? focusSearch : undefined}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium ${isActive ? 'text-paper' : 'text-faint'}`
            }
          >
            <Icon className="size-5.5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** The library as a list: every author you follow, one click away from anywhere. */
function SidebarAuthors() {
  const { data } = useAuthors()
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? (data ?? []).filter((a) => a.name.toLowerCase().includes(f)) : (data ?? [])
  }, [data, filter])

  return (
    <section aria-labelledby="side-authors" className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-6 pb-2">
        <h2 id="side-authors" className="text-sm font-semibold text-muted">
          <Link to="/library" className="rounded-sm hover:text-paper">
            Your authors
          </Link>
        </h2>
        {data && data.length > 0 && <span className="text-xs text-faint tabular-nums">{data.length}</span>}
      </div>
      {data && data.length > 8 && (
        <div className="px-3 pb-2">
          <input
            type="search"
            className="input h-9 bg-white/8"
            placeholder="Filter authors"
            aria-label="Filter authors"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-3">
        {shown.map((a) => (
          <li key={a.id}>
            <NavLink
              to={`/authors/${a.id}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg p-2 transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`
              }
            >
              <Avatar src={a.photo_url} name={a.name} className="size-11 text-sm shadow-none" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                <span className="block truncate text-xs text-muted">
                  {a.have_count} of {a.book_count} in library
                </span>
              </span>
              {a.wanted_count > 0 && (
                <span className="size-2 shrink-0 rounded-full bg-wanted" title={`${a.wanted_count} on the way`}>
                  <span className="sr-only">{a.wanted_count} on the way</span>
                </span>
              )}
            </NavLink>
          </li>
        ))}
        {data && data.length === 0 && (
          <li className="px-3 py-2 text-sm text-faint">Authors you add show up here.</li>
        )}
        {data && data.length > 0 && shown.length === 0 && <li className="px-3 py-2 text-sm text-faint">No author matches.</li>}
      </ul>
    </section>
  )
}
