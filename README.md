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

## Prerequisites

FastLibrarian is **not** a standalone downloader. It is the "pick and fetch" piece in an
existing self-hosted media stack and relies on these services, which you install and run
yourself:

| Required | What for | Notes |
|---|---|---|
| **Docker** (with Docker Compose) | Runs FastLibrarian | Linux x86_64 tested. There is no prebuilt image yet; you build it locally (Node and Python are only needed inside the build). |
| **[Prowlarr](https://prowlarr.com/)** | Searches your indexers | Needs at least one **torrent** indexer with a Books category (7000 / 7020) enabled. FastLibrarian uses Prowlarr's API key; no "app sync" setup is needed. |
| **[qBittorrent](https://www.qbittorrent.org/)** (Web UI enabled) | Downloads the torrents | Web UI login, or the FastLibrarian container's subnet whitelisted under *Bypass authentication*. |
| **[Calibre-Web Automated](https://github.com/crocodilestick/Calibre-Web-Automated)** (CWA) | Imports finished ebooks into your Calibre library | FastLibrarian copies books into CWA's **ingest folder**, and reads CWA's **Calibre library** (`metadata.db`) to see what you already own. |
| Internet access to `openlibrary.org` | Book and author metadata | No account or API key needed. |

**Shared folders.** FastLibrarian has to see the same files as the other containers:

- the **download folder** qBittorrent saves to. Mount it at the same path in both containers;
  otherwise use the path mapping in Settings.
- CWA's **ingest folder**, read-write.
- CWA's **library folder**, read-only.

Run all of them with the same `PUID`/`PGID`, so CWA can read and delete the files FastLibrarian
writes.

**Not supported (yet):** Usenet/NZB, other torrent clients (Transmission, Deluge, …), a library
without CWA, and audiobooks. See the [roadmap](#roadmap).

FastLibrarian does not provide or point to any content. What you download through your own
indexers is your responsibility.

## Quick start

This assumes Prowlarr, qBittorrent and Calibre-Web Automated already run in Docker on the same
host (see [Prerequisites](#prerequisites)). Plan on about 10 minutes.

### 1. Build the image

```sh
git clone https://github.com/olamellberg/fast-librarian.git
cd fast-librarian
docker build -t fastlibrarian:local .
```

### 2. Add FastLibrarian to your compose file

Find the folders your other containers already use. The paths below are examples:

| Folder on the host | Used by | Mount in FastLibrarian at |
|---|---|---|
| `/srv/downloads` | qBittorrent (as `/downloads`) | `/downloads`, the **same path** as in qBittorrent |
| `/srv/books/ingest` | CWA (as `/cwa-book-ingest`) | `/cwa-book-ingest` |
| `/srv/books/library` | CWA (as `/calibre-library`) | `/calibre-library:ro` |

```yaml
services:
  fastlibrarian:
    image: fastlibrarian:local
    container_name: fastlibrarian
    environment:
      - PUID=1000          # same user/group as qBittorrent and CWA
      - PGID=1000
      - TZ=Etc/UTC
    volumes:
      - ./fastlibrarian:/config                         # FastLibrarian's database and settings
      - /srv/downloads:/downloads
      - /srv/books/ingest:/cwa-book-ingest
      - /srv/books/library:/calibre-library:ro
    ports:
      - "8790:8790"
    restart: unless-stopped
```

Put it on the same Docker network as the other services so it can reach them by name, then run:

```sh
docker compose up -d fastlibrarian
docker logs fastlibrarian      # should end with "Uvicorn running on http://0.0.0.0:8790"
```

### 3. Create your account

Open `http://<host>:8790`. The first visit asks you to create the admin account (password at
least 8 characters).

### 4. Connect your services

Go to **Settings**. Fill in each section, press **Save**, then press the section's **Test**
button. All three should turn green.

| Section | Field | Value |
|---|---|---|
| **Prowlarr** | URL | e.g. `http://prowlarr:9696`, as seen from the FastLibrarian container |
| | API key | Prowlarr → *Settings → General → Security → API Key* |
| **qBittorrent** | URL | e.g. `http://qbittorrent:8080` (the Web UI port) |
| | Username / password | The Web UI login. Leave both empty if *Tools → Options → Web UI → Bypass authentication for clients in whitelisted IP subnets* covers the FastLibrarian container. |
| | Category | `books`. It is created automatically if it doesn't exist. |
| **Calibre-Web Automated** | Ingest folder | `/cwa-book-ingest` |
| | Calibre library | `/calibre-library` |
| | Import mode | `copy` (recommended: CWA may change files it imports, and the original keeps seeding) |

If the tests show red:

- **Prowlarr / qBittorrent: "cannot reach".** The URL must work *from inside the container*.
  Use the container name or the Docker network IP, not `localhost`.
- **qBittorrent: "login failed" or HTTP 403.** Check the username/password, or the whitelist
  subnet.
- **Calibre: "missing or not writable" / "no metadata.db".** Check the volume paths and that
  `PUID`/`PGID` match the owner of the folders. CWA creates `metadata.db` on first start.

### 5. Get your first book

1. **Search.** Type a title, an author or an ISBN (with or without dashes) and press Enter.
2. **Add an author.** Click *Add to library* on an author. Their books are fetched in the
   background, which takes a few seconds for most authors.
3. **Pick books.** On the author page you can:
   - sort by year, title or popularity, and filter by year or status;
   - use *Hide obscure editions* (on by default) to hide rare one-off printings;
   - click *Download* on a book, or tick several and use *Download* in the bar at the bottom.
4. **Follow it.** A book's status goes
   *Wanted* → *Downloading* → *Sent to CWA* → *In library*.
   - **Activity** shows each download, the release that was chosen and why (its score
     breakdown).
   - *In library* appears once CWA has imported the book; FastLibrarian checks the Calibre
     library every 10 minutes.
5. **Not happy with the pick?** Use the magnifier next to a book (*Search manually*) to see all
   releases with their scores and grab a specific one.

If no acceptable release is found the book becomes *Failed* with the reason, e.g.
"No releases found". Click *Download* again to retry later. A download that turns out to be
broken is blocklisted, and the next-best release is tried automatically.

### Updating

```sh
cd fast-librarian && git pull
docker build -t fastlibrarian:local .
docker compose up -d fastlibrarian
```

Database migrations run automatically on start.

### Configuration reference

| | |
|---|---|
| Environment variables | `PUID`/`PGID`/`UMASK` (file ownership), `FL_PORT` (default 8790), `FL_LOG_LEVEL`, `FL_AUTH_DISABLED=true` (only behind an auth proxy) |
| Path mapping | Only needed if qBittorrent sees downloads under a different path than FastLibrarian. Set *from* (qBittorrent's path) → *to* (FastLibrarian's path) in Settings → qBittorrent. |
| Languages | Settings → Search → *Languages* (OpenLibrary codes like `eng,swe`) limits an author's book list to works published in those languages. |
| API docs | `http://<host>:8790/api/docs` |

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
