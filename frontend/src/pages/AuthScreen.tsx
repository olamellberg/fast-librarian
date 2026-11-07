import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuthAction } from '../api/hooks'
import { LogoMark } from '../components/Logo'
import { errMsg } from '../lib/format'

export function AuthScreen({ setup }: { setup: boolean }) {
  const action = useAuthAction(setup ? 'setup' : 'login')
  const [username, setUsername] = useState(setup ? 'admin' : '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (setup) {
      if (password.length < 8) return setLocalError('Password must be at least 8 characters.')
      if (password !== confirm) return setLocalError('Passwords do not match.')
    }
    action.mutate({ username: username.trim(), password })
  }

  const error = localError ?? (action.error ? errMsg(action.error) : null)

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-12" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {setup ? 'Welcome to FastLibrarian' : 'Sign in to FastLibrarian'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {setup ? 'Create the admin account to get started.' : 'Your fast, simple ebook manager.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="username" className="label">
              Username
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!setup}
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password {setup && <span className="font-normal text-zinc-400">(at least 8 characters)</span>}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete={setup ? 'new-password' : 'current-password'}
              required
              minLength={setup ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={setup}
            />
          </div>
          {setup && (
            <div>
              <label htmlFor="confirm" className="label">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                className="input"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={action.isPending}>
            {action.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {setup ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}
