import { Download, ListChecks } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { useActivity } from '../api/hooks'
import type { ActivityDownload, ActivityJob } from '../api/types'
import { absTime, errMsg, formatBytes, timeAgo } from '../lib/format'

const DL_STATE: Record<ActivityDownload['state'], string> = {
  downloading: 'bg-downloading/15 text-downloading',
  completed: 'bg-sent/15 text-sent',
  imported: 'bg-have/15 text-have',
  failed: 'bg-failed/15 text-failed',
}

const JOB_STATE: Record<ActivityJob['status'], string> = {
  pending: 'text-muted',
  running: 'text-downloading',
  done: 'text-have',
  failed: 'text-failed',
}

export function ActivityPage() {
  const { data, isPending, isError, error } = useActivity()

  return (
    <div className="space-y-8 pt-4">
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Activity</h1>
      {isError && <p className="text-sm text-failed">Could not load activity: {errMsg(error)}</p>}

      <section aria-labelledby="dl-h" className="space-y-3">
        <h2 id="dl-h" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Download className="size-5 text-muted" aria-hidden="true" /> Downloads
        </h2>
        <div className="card overflow-hidden">
          {isPending ? (
            <RowsSkeleton />
          ) : data?.downloads.length ? (
            <ul className="divide-y divide-line">
              {data.downloads.map((d) => (
                <DownloadRow key={d.id} d={d} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">No downloads yet.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="jobs-h" className="space-y-3">
        <h2 id="jobs-h" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ListChecks className="size-5 text-muted" aria-hidden="true" /> Recent jobs
        </h2>
        <div className="card overflow-hidden">
          {isPending ? (
            <RowsSkeleton />
          ) : data?.jobs.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.jobs.map((j) => (
                <JobRow key={j.id} j={j} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">No jobs yet.</p>
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
          <Link to={`/authors/${d.author_id}?book=${d.book_id}`} className="rounded-sm hover:underline">
            {d.book_title}
          </Link>{' '}
          <span className="font-normal text-muted">by {d.author_name}</span>
        </p>
        <p className="truncate text-xs text-muted" title={d.release_title}>
          {d.release_title}
        </p>
        {d.message && (
          <p className={`truncate text-xs ${d.state === 'failed' ? 'text-failed' : 'text-muted'}`} title={d.message}>
            {d.message}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${DL_STATE[d.state]}`}>{d.state}</span>
          <span className="text-muted tabular-nums">{pct}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${d.state === 'failed' ? 'bg-failed' : d.state === 'downloading' ? 'bg-downloading' : 'bg-have'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted tabular-nums sm:flex-col sm:items-end sm:justify-center sm:gap-0.5">
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
      {j.attempts > 1 && <span className="text-xs text-faint">{j.attempts} attempts</span>}
      <span className="min-w-0 flex-1 basis-40 truncate text-xs text-muted" title={j.message ?? undefined}>
        {j.message}
      </span>
      <span className="ml-auto text-xs text-faint tabular-nums" title={absTime(j.finished_at ?? j.created_at)}>
        {timeAgo(j.finished_at ?? j.created_at)}
      </span>
    </li>
  )
})

function RowsSkeleton() {
  return (
    <div className="divide-y divide-line" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-3">
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}
