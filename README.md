# FastLibrarian

A fast, simple ebook manager: a ground-up rewrite inspired by
[LazyLibrarian](https://gitlab.com/LazyLibrarian/LazyLibrarian), licensed GPL-3.0.

**What it does (v1, ebooks only):**

1. **Search** for a book, an author or an ISBN, all from one field.
2. **Add an author** to your library. Their bibliography is fetched in the background from
   OpenLibrary, cleaned of noise (calendars, box sets, magazines, duplicates) and refreshed daily.
3. **Pick the books you want.** FastLibrarian searches your indexers through **Prowlarr** and
   scores every release. The score breakdown is visible, so you can see why a release won.
   The best release goes to **qBittorrent**. When the download finishes, the ebook is copied into
   **Calibre-Web Automated**'s ingest folder.
4. FastLibrarian reads the Calibre library (read-only) and marks books you already have.

Nothing is downloaded unless you ask for it.

<p>
  <img src="docs/screenshot-author.png" alt="Author page with the book list" width="72%">
  <img src="docs/screenshot-phone.png" alt="Search on a phone" width="24%">
</p>

### Why a rewrite?

LazyLibrarian does a lot, but it does it slowly. It runs on CherryPy with a 10 000-line request
handler, it makes blocking API calls inside web requests, and it opens a new SQLite connection
for every query behind one global lock. Its fuzzy matching is spread across 19 files.
FastLibrarian keeps the part most people use (ebooks via torrents into Calibre) and does it with:

- an async API with background jobs, so the UI never waits on OpenLibrary or an indexer
- one matching module, tested on real release names
  (e.g. "Dune Messiah" never matches a search for "Dune")
- a modern, phone-friendly UI

## Run with Docker

```sh
docker build -t fastlibrarian:local .
```

See [`docker/docker-compose.example.yml`](docker/docker-compose.example.yml). Open
`http://host:8790`, create the admin account, then fill in **Settings**:

| Setting | Typical value |
|---|---|
| Prowlarr URL + API key | `http://prowlarr:9696`, from Prowlarr → Settings → General |
| qBittorrent URL (+ login unless the subnet is whitelisted) | `http://qbittorrent:8080` |
| qBittorrent category | `books` |
| Ingest folder | `/cwa-book-ingest` (mount CWA's ingest dir here) |
| Calibre library | `/calibre-library` (mount CWA's library, `:ro` is fine) |

Each section has a **Test** button. If qBittorrent sees downloads under a different path than
FastLibrarian, set the path mapping (from → to). Mounting the same path in both containers is
simplest.

Environment variables: `PUID`/`PGID`/`UMASK` (file ownership), `FL_PORT` (default 8790),
`FL_LOG_LEVEL`, and `FL_AUTH_DISABLED=true` (only behind an auth proxy).

## Development

```sh
cd backend && uv sync && uv run pytest && uv run ruff check . && uv run mypy fastlibrarian
FL_CONFIG_DIR=./config uv run python -m fastlibrarian.main          # API on :8790
cd frontend && npm install && npm run dev                           # UI on :5173, proxies /api
```

Architecture: FastAPI + SQLAlchemy (async, SQLite/WAL, Alembic), with a persistent job queue for
all background work, and a React + Vite + TanStack Query frontend served from the same container.

## Roadmap

- [x] v1: ebooks via Prowlarr (torrents) → qBittorrent → Calibre-Web Automated
- [ ] Sorting/filters in the library view
- [ ] Automatic search for wanted books
- [ ] Usenet (Newznab + SABnzbd/NZBGet), more torrent clients
- [ ] Audiobooks (e.g. → Audiobookshelf)
- [ ] OPDS feed and notifications (Apprise)
- [ ] Published images (GHCR)

## License

GPL-3.0-or-later. FastLibrarian is inspired by LazyLibrarian (also GPL-3.0) and is not
affiliated with it.
