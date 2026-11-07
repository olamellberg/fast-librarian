import { Check, Info, Loader2, RotateCw, Users, X } from 'lucide-react'
import { memo, useId } from 'react'
import { useGrab, useReleases } from '../api/hooks'
import type { Book, ScoredRelease } from '../api/types'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { errMsg, formatBytes } from '../lib/format'

export function ReleasesDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const releases = useReleases(book?.id ?? null)
  const grab = useGrab(book?.author_id ?? 0)
  const toast = useToast()

  function onGrab(r: ScoredRelease) {
    if (!book) return
    grab.mutate(
      { bookId: book.id, release: r.release },
      {
        onSuccess: () => {
          toast(`Sent “${r.release.title}” to qBittorrent`)
          onClose()
        },
        onError: (e) => toast(`Grab failed: ${errMsg(e)}`, 'error'),
      },
    )
  }

  const list = releases.data
  const accepted = list?.filter((r) => r.accepted).length ?? 0

  return (
    <Dialog
      open={book !== null}
      onClose={onClose}
      className="max-w-4xl"
      title={
        <span className="block">
          <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">Search manually</span>
          <span className="line-clamp-2">{book?.title}</span>
        </span>
      }
    >
      {releases.isFetching && !list && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="size-8 animate-spin text-indigo-500" aria-hidden="true" />
          <p className="font-medium">Searching indexers…</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">This can take up to a minute.</p>
        </div>
      )}

      {releases.isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="max-w-md rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {errMsg(releases.error)}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void releases.refetch()} disabled={releases.isFetching}>
            {releases.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Retry
          </button>
        </div>
      )}

      {list && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>
              {list.length} release{list.length === 1 ? '' : 's'} · {accepted} accepted
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void releases.refetch()} disabled={releases.isFetching}>
              <RotateCw className={`size-3.5 ${releases.isFetching ? 'animate-spin' : ''}`} /> Search again
            </button>
          </div>
          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">No releases found.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {list.map((r) => (
                <ReleaseRow
                  key={r.release.guid}
                  r={r}
                  onGrab={onGrab}
                  busy={grab.isPending && grab.variables?.release.guid === r.release.guid}
                  disabled={grab.isPending}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  )
}

const ReleaseRow = memo(function ReleaseRow({
  r,
  onGrab,
  busy,
  disabled,
}: {
  r: ScoredRelease
  onGrab: (r: ScoredRelease) => void
  busy: boolean
  disabled: boolean
}) {
  const popId = useId()
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words" title={r.release.title}>
          {r.release.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{r.release.indexer || 'Unknown indexer'}</span>
          <span>{formatBytes(r.release.size)}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden="true" />
            {r.release.seeders} seeders
          </span>
          {r.format && <span className="uppercase">{r.format}</span>}
          {r.accepted ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" aria-hidden="true" /> Accepted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <X className="size-3.5" aria-hidden="true" /> {r.reject_reason ?? 'Rejected'}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`min-w-12 rounded-md px-2 py-1 text-center text-sm font-semibold tabular-nums ${
            r.accepted
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
          title="Score"
        >
          {r.score}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" popovertarget={popId} aria-label="Score details">
          <Info className="size-4" aria-hidden="true" />
        </button>
        <div
          id={popId}
          popover="auto"
          className="m-auto w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 text-sm text-zinc-800 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700"
        >
          <p className="mb-2 font-semibold">Score breakdown</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {Object.entries(r.details).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500 capitalize dark:text-zinc-400">{k.replace(/_/g, ' ')}</dt>
                <dd className="text-right font-mono text-xs leading-5">{String(v)}</dd>
              </div>
            ))}
            <dt className="border-t border-zinc-200 pt-1 font-medium dark:border-zinc-700">Total</dt>
            <dd className="border-t border-zinc-200 pt-1 text-right font-mono text-xs leading-5 font-semibold dark:border-zinc-700">
              {r.score}
            </dd>
          </dl>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${r.accepted ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onGrab(r)}
          disabled={disabled}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />} Grab
        </button>
      </div>
    </li>
  )
})
