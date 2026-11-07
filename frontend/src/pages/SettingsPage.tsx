import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Plug, Plus, Save, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSaveSettings, useSettings, useTestService } from '../api/hooks'
import type { Settings, TestResult } from '../api/types'
import { useToast } from '../components/Toast'
import { errMsg } from '../lib/format'

type Service = 'prowlarr' | 'qbittorrent' | 'calibre'

/** Form state: list and number fields are edited as text and parsed on save. */
interface Form {
  prowlarr_url: string
  prowlarr_api_key: string
  prowlarr_categories: string
  prowlarr_indexer_ids: string
  qbit_url: string
  qbit_username: string
  qbit_password: string
  qbit_category: string
  qbit_path_from: string
  qbit_path_to: string
  ingest_dir: string
  calibre_library_dir: string
  import_mode: string
  google_books_api_key: string
  preferred_formats: string[]
  languages: string
  min_seeders: string
  min_score: string
  max_size_mb: string
  author_refresh_hours: string
  calibre_sync_minutes: string
}

const toForm = (s: Settings): Form => ({
  ...s,
  prowlarr_categories: s.prowlarr_categories.join(', '),
  prowlarr_indexer_ids: s.prowlarr_indexer_ids.join(', '),
  languages: s.languages.join(', '),
  min_seeders: String(s.min_seeders),
  min_score: String(s.min_score),
  max_size_mb: String(s.max_size_mb),
  author_refresh_hours: String(s.author_refresh_hours),
  calibre_sync_minutes: String(s.calibre_sync_minutes),
})

function intList(v: string, field: string): number[] {
  const parts = v.split(/[,\s]+/).filter(Boolean)
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isInteger(n))) throw new Error(`${field}: use whole numbers separated by commas`)
  return nums
}

function num(v: string, field: string, integer = true): number {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < 0)
    throw new Error(`${field}: enter a ${integer ? 'whole ' : ''}number ≥ 0`)
  return n
}

function fromForm(f: Form): Settings {
  return {
    ...f,
    prowlarr_url: f.prowlarr_url.trim(),
    qbit_url: f.qbit_url.trim(),
    prowlarr_categories: intList(f.prowlarr_categories, 'Categories'),
    prowlarr_indexer_ids: intList(f.prowlarr_indexer_ids, 'Indexer IDs'),
    languages: f.languages
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    min_seeders: num(f.min_seeders, 'Minimum seeders'),
    min_score: num(f.min_score, 'Minimum score', false),
    max_size_mb: num(f.max_size_mb, 'Maximum size'),
    author_refresh_hours: num(f.author_refresh_hours, 'Author refresh'),
    calibre_sync_minutes: num(f.calibre_sync_minutes, 'Calibre sync'),
  }
}

export function SettingsPage() {
  const { data, isPending, isError, error } = useSettings()
  if (isError) return <p className="text-sm text-red-600 dark:text-red-400">Could not load settings: {errMsg(error)}</p>
  if (isPending) return <SettingsSkeleton />
  return <SettingsForm saved={data} />
}

function SettingsForm({ saved }: { saved: Settings }) {
  const savedForm = useMemo(() => toForm(saved), [saved])
  const [form, setForm] = useState<Form>(savedForm)
  const [results, setResults] = useState<Partial<Record<Service, TestResult | 'pending'>>>({})
  const save = useSaveSettings()
  const test = useTestService()
  const toast = useToast()

  // Re-sync after a save (server may normalise values / re-mask secrets).
  useEffect(() => setForm(savedForm), [savedForm])

  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const text = (k: Exclude<keyof Form, 'preferred_formats'>) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  })

  async function persist(): Promise<boolean> {
    let body: Settings
    try {
      body = fromForm(form)
    } catch (e) {
      toast(errMsg(e), 'error')
      return false
    }
    try {
      await save.mutateAsync(body)
      return true
    } catch (e) {
      toast(`Save failed: ${errMsg(e)}`, 'error')
      return false
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (await persist()) toast('Settings saved')
  }

  async function runTest(service: Service) {
    setResults((r) => ({ ...r, [service]: 'pending' }))
    // The backend tests the stored settings, so save unsaved edits first.
    if (dirty && !(await persist())) {
      setResults((r) => ({ ...r, [service]: undefined }))
      return
    }
    try {
      const res = await test.mutateAsync(service)
      setResults((r) => ({ ...r, [service]: res }))
    } catch (e) {
      setResults((r) => ({ ...r, [service]: { ok: false, message: errMsg(e) } }))
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Prowlarr" description="Indexer manager used to search for torrents." test={{ service: 'prowlarr', result: results.prowlarr, run: runTest }}>
        <Field label="URL" id="prowlarr_url">
          <input id="prowlarr_url" className="input" type="url" placeholder="http://prowlarr:9696" {...text('prowlarr_url')} />
        </Field>
        <Field label="API key" id="prowlarr_api_key">
          <input id="prowlarr_api_key" className="input" type="password" autoComplete="off" {...text('prowlarr_api_key')} />
        </Field>
        <Field label="Categories" id="prowlarr_categories" hint="Comma separated. 7000 = Books, 7020 = EBook.">
          <input id="prowlarr_categories" className="input" inputMode="numeric" placeholder="7000, 7020" {...text('prowlarr_categories')} />
        </Field>
        <Field label="Indexer IDs" id="prowlarr_indexer_ids" hint="Comma separated. Leave empty to use all enabled indexers.">
          <input id="prowlarr_indexer_ids" className="input" inputMode="numeric" placeholder="All indexers" {...text('prowlarr_indexer_ids')} />
        </Field>
      </Section>

      <Section title="qBittorrent" description="Download client." test={{ service: 'qbittorrent', result: results.qbittorrent, run: runTest }}>
        <Field label="URL" id="qbit_url">
          <input id="qbit_url" className="input" type="url" placeholder="http://qbittorrent:8080" {...text('qbit_url')} />
        </Field>
        <Field label="Category" id="qbit_category">
          <input id="qbit_category" className="input" placeholder="books" {...text('qbit_category')} />
        </Field>
        <Field label="Username" id="qbit_username">
          <input id="qbit_username" className="input" autoComplete="off" {...text('qbit_username')} />
        </Field>
        <Field label="Password" id="qbit_password">
          <input id="qbit_password" className="input" type="password" autoComplete="off" {...text('qbit_password')} />
        </Field>
        <Field label="Path mapping: from" id="qbit_path_from" hint="Path as qBittorrent sees it (optional).">
          <input id="qbit_path_from" className="input" placeholder="/downloads" {...text('qbit_path_from')} />
        </Field>
        <Field label="Path mapping: to" id="qbit_path_to" hint="Same folder as FastLibrarian sees it.">
          <input id="qbit_path_to" className="input" placeholder="/downloads" {...text('qbit_path_to')} />
        </Field>
      </Section>

      <Section
        title="Calibre-Web Automated"
        description="Finished ebooks are delivered to CWA's ingest folder."
        test={{ service: 'calibre', result: results.calibre, run: runTest }}
      >
        <Field label="Ingest folder" id="ingest_dir">
          <input id="ingest_dir" className="input" placeholder="/cwa-book-ingest" {...text('ingest_dir')} />
        </Field>
        <Field label="Calibre library folder" id="calibre_library_dir" hint="Read to detect books you already have.">
          <input id="calibre_library_dir" className="input" placeholder="/calibre-library" {...text('calibre_library_dir')} />
        </Field>
        <Field label="Import mode" id="import_mode" hint="Copy is recommended: CWA may modify files it ingests, and with a hardlink that would also change the file your torrent is seeding.">
          <select id="import_mode" className="input" {...text('import_mode')}>
            <option value="copy">Copy (recommended)</option>
            <option value="hardlink">Hardlink</option>
          </select>
        </Field>
      </Section>

      <Section title="Search" description="How releases are matched and filtered.">
        <div className="sm:col-span-2">
          <span className="label">Preferred formats</span>
          <FormatList value={form.preferred_formats} onChange={(v) => set('preferred_formats', v)} />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Best first. Formats not listed are rejected.</p>
        </div>
        <Field label="Languages" id="languages" hint="OpenLibrary 3-letter codes, comma separated (e.g. eng, swe). Empty = all.">
          <input id="languages" className="input" placeholder="All languages" {...text('languages')} />
        </Field>
        <Field label="Minimum seeders" id="min_seeders">
          <input id="min_seeders" className="input" type="number" min={0} {...text('min_seeders')} />
        </Field>
        <Field label="Minimum score" id="min_score" hint="0–100+. Releases below are rejected.">
          <input id="min_score" className="input" type="number" min={0} step="any" {...text('min_score')} />
        </Field>
        <Field label="Maximum size (MB)" id="max_size_mb">
          <input id="max_size_mb" className="input" type="number" min={0} {...text('max_size_mb')} />
        </Field>
      </Section>

      <Section title="Optional" description="Extra metadata sources.">
        <Field label="Google Books API key" id="google_books_api_key" hint="Used as a fallback for ISBN lookups.">
          <input id="google_books_api_key" className="input" type="password" autoComplete="off" {...text('google_books_api_key')} />
        </Field>
      </Section>

      <Section title="Schedule">
        <Field label="Refresh authors every (hours)" id="author_refresh_hours">
          <input id="author_refresh_hours" className="input" type="number" min={0} {...text('author_refresh_hours')} />
        </Field>
        <Field label="Sync Calibre library every (minutes)" id="calibre_sync_minutes">
          <input id="calibre_sync_minutes" className="input" type="number" min={0} {...text('calibre_sync_minutes')} />
        </Field>
      </Section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-end gap-3 sm:bottom-4">
        {dirty && (
          <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-200 backdrop-blur dark:bg-zinc-900/90 dark:ring-zinc-800">
            Unsaved changes
          </span>
        )}
        {dirty && (
          <button type="button" className="btn btn-secondary shadow-lg" onClick={() => setForm(savedForm)}>
            Discard
          </button>
        )}
        <button type="submit" className="btn btn-primary px-5 shadow-lg" disabled={save.isPending || !dirty}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </button>
      </div>
    </form>
  )
}

function Section({
  title,
  description,
  children,
  test,
}: {
  title: string
  description?: string
  children: ReactNode
  test?: { service: Service; result: TestResult | 'pending' | undefined; run: (s: Service) => void }
}) {
  const r = test?.result
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {test && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => test.run(test.service)} disabled={r === 'pending'}>
            {r === 'pending' ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Test
          </button>
        )}
      </div>
      {r && r !== 'pending' && (
        <p
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm break-words ${
            r.ok
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span className="min-w-0">{r.message}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  )
}

function FormatList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState('')
  const move = (i: number, d: -1 | 1) => {
    const next = [...value]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  const add = () => {
    const f = adding.trim().toLowerCase().replace(/^\./, '')
    if (f && !value.includes(f)) onChange([...value, f])
    setAdding('')
  }
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap gap-2">
        {value.map((f, i) => (
          <li
            key={f}
            className="flex items-center gap-0.5 rounded-lg bg-zinc-100 py-0.5 pr-0.5 pl-2.5 text-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
          >
            <span className="mr-1 text-xs text-zinc-400 tabular-nums">{i + 1}.</span>
            <span className="mr-1 font-medium uppercase">{f}</span>
            <button type="button" className="btn btn-ghost p-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${f} up`}>
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              className="btn btn-ghost p-1"
              onClick={() => move(i, 1)}
              disabled={i === value.length - 1}
              aria-label={`Move ${f} down`}
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button type="button" className="btn btn-ghost p-1" onClick={() => onChange(value.filter((x) => x !== f))} aria-label={`Remove ${f}`}>
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex max-w-xs gap-2">
        <input
          className="input"
          placeholder="Add format, e.g. azw"
          aria-label="Add format"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={!adding.trim()}>
          <Plus className="size-4" /> Add
        </button>
      </div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-hidden="true">
      <div className="skeleton h-8 w-40" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card space-y-4 p-5">
          <div className="skeleton h-5 w-32" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="skeleton h-9" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
