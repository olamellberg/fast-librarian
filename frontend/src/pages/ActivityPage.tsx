import { Download, ListChecks } from 'lucide-react'
import { memo } from 'react'
import { useActivity } from '../api/hooks'
import type { ActivityDownload, ActivityJob } from '../api/types'
import { absTime, errMsg, formatBytes, timeAgo } from '../lib/format'

const DL_STATE: Record<ActivityDownload['state'], string> = {
  downloading: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  completed: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  imported: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
}

const JOB_STATE: Record<ActivityJob['status'], string> = {
  pending: 'text-zinc-500 dark:text-zinc-400',
  running: 'text-sky-600 dark:text-sky-400',
  done: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
}

export function ActivityPage() {
  const { data, isPending, isError, error } = useActivity()

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      {isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load activity: {errMsg(error)}</p>}

      <section aria-labelledby="dl-h" className="space-y-3">
        <h2 id="dl-h" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          <Download className="size-4" aria-hidden="true" /> Downloads
        </h2>
        <div className="card overflow-hidden">
          {isPending ? (
            <RowsSkeleton />
          ) : data?.downloads.length ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.downloads.map((d) => (
                <DownloadRow key={d.id} d={d} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No downloads yet.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="jobs-h" className="space-y-3">
        <h2 id="jobs-h" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          <ListChecks className="size-4" aria-hidden="true" /> Recent jobs
        </h2>
        <div className="card overflow-hidden">
          {isPending ? (
            <RowsSkeleton />
          ) : data?.jobs.length ? (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {data.jobs.map((j) => (
                <JobRow key={j.id} j={j} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No jobs yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}

const DownloadRow = memo(function DownloadRow({ d }: { d: ActivityDownload }) {
  const pct = Math.round(Math.min(1, Math.max(0, d.progress)) * 100)
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {d.book_title}{' '}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">· {d.author_name}</span>
        </p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400" title={d.release_title}>
          {d.release_title}
        </p>
        {d.message && (
          <p className={`truncate text-xs ${d.state === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`} title={d.message}>
            {d.message}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${DL_STATE[d.state]}`}>{d.state}</span>
          <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{pct}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${d.state === 'failed' ? 'bg-red-500' : d.state === 'downloading' ? 'bg-sky-500' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-500 tabular-nums sm:flex-col sm:items-end sm:justify-center sm:gap-0.5 dark:text-zinc-400">
        <span title="Score">score {d.score}</span>
        <span>{formatBytes(d.size)}</span>
        <span title={absTime(d.created_at)}>{timeAgo(d.created_at)}</span>
      </div>
    </li>
  )
})

const JobRow = memo(function JobRow({ j }: { j: ActivityJob }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
      <span className="font-mono text-xs">{j.type}</span>
      <span className={`text-xs font-medium ${JOB_STATE[j.status]}`}>
        {j.status === 'pending' && j.attempts > 0 ? 'retrying' : j.status}
      </span>
      {j.attempts > 1 && <span className="text-xs text-zinc-400">{j.attempts} attempts</span>}
      <span className="min-w-0 flex-1 basis-40 truncate text-xs text-zinc-500 dark:text-zinc-400" title={j.message ?? undefined}>
        {j.message}
      </span>
      <span className="ml-auto text-xs text-zinc-400 tabular-nums" title={absTime(j.finished_at ?? j.created_at)}>
        {timeAgo(j.finished_at ?? j.created_at)}
      </span>
    </li>
  )
})

function RowsSkeleton() {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-3">
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}
