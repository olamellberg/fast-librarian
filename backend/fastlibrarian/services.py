"""Business logic: library, search, download and delivery. Used by the API and by jobs."""

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .appsettings import AppSettings
from .clients.qbittorrent import QBitError, QBitNotConfigured
from .context import AppContext
from .indexers.prowlarr import ProwlarrError, ProwlarrNotConfigured, Release
from .isbn import normalize_isbn
from .jobs import PermanentError, enqueue, handler
from .library.calibre import CalibreError, read_library
from .library.importer import ImportError_, import_download, map_path
from .matching import fold, norm_title, same_book, title_key
from .metadata.openlibrary import AuthorInfo, WorkInfo, clean_works
from .models import Author, Blocklist, Book, BookStatus, Download, DownloadState, utcnow
from .scoring import Scored, rank, score_release
from .torrent import BencodeError, info_hash_from_magnet, info_hash_from_torrent

log = logging.getLogger("fastlibrarian.services")
MAX_AUTO_ATTEMPTS = 3  # automatic grabs per book before giving up


# ---------------------------------------------------------------------------- search (metadata)


@dataclass
class SearchResult:
    query: str
    isbn: str | None
    authors: list[AuthorInfo]
    works: list[WorkInfo]


async def search_metadata(ctx: AppContext, query: str) -> SearchResult:
    ol = ctx.openlibrary
    isbn = normalize_isbn(query)
    if isbn:
        work = await ol.by_isbn(isbn)
        if work is None:
            settings = await ctx.settings()
            gb = ctx.googlebooks(settings)
            vol = await gb.by_isbn(isbn) if gb else None
            if vol:
                work = await ol.find_work(vol.title, vol.authors[0] if vol.authors else "")
        return SearchResult(query, isbn, [], [work] if work else [])
    authors, works = await asyncio.gather(ol.search_authors(query), ol.search_works(query))
    return SearchResult(query, None, authors, works)


# ---------------------------------------------------------------------------- library


async def get_or_create_author(
    session: AsyncSession, ctx: AppContext, ol_key: str, *, monitored: bool, name: str | None = None
) -> tuple[Author, bool]:
    author = await session.scalar(select(Author).where(Author.ol_key == ol_key))
    if author:
        if monitored and not author.monitored:
            author.monitored = True
            author.refreshed_at = None  # fetch the full bibliography now
        return author, False
    info = await ctx.openlibrary.get_author(ol_key)
    author = Author(
        ol_key=ol_key,
        name=(info.name if info else None) or name or ol_key,
        bio=info.bio if info else None,
        photo_url=info.photo_url if info else None,
        birth_date=info.birth_date if info else None,
        monitored=monitored,
    )
    session.add(author)
    await session.flush()
    return author, True


async def add_author(session: AsyncSession, ctx: AppContext, ol_key: str) -> Author:
    author, _ = await get_or_create_author(session, ctx, ol_key, monitored=True)
    await session.commit()
    await enqueue(session, "refresh_author", {"author_id": author.id})
    ctx.wake.set()
    return author


def _apply_work(book: Book, w: WorkInfo) -> None:
    book.title = w.title
    book.subtitle = w.subtitle
    book.ol_work_key = w.ol_work_key
    book.year = w.year
    book.cover_id = w.cover_id or book.cover_id
    book.isbns = w.isbns
    book.isbn = w.isbns[0] if w.isbns else book.isbn
    book.languages = w.languages
    book.edition_count = w.edition_count


async def upsert_works(session: AsyncSession, author: Author, works: list[WorkInfo]) -> int:
    """Insert new works for ``author``; update metadata of known ones. Never touches statuses."""
    existing = (await session.scalars(select(Book).where(Book.author_id == author.id))).all()
    by_key = {b.ol_work_key: b for b in existing if b.ol_work_key}
    by_title = {title_key(b.title): b for b in existing}
    added = 0
    for w in works:
        book = by_key.get(w.ol_work_key) or by_title.get(title_key(w.title))
        if book is None:
            # The same work may already exist under another (co-)author.
            book = await session.scalar(select(Book).where(Book.ol_work_key == w.ol_work_key))
            if book is not None:
                continue
            book = Book(author_id=author.id, title=w.title)
            session.add(book)
            added += 1
        _apply_work(book, w)
        by_key[w.ol_work_key] = book
        by_title[title_key(w.title)] = book
    return added


@handler("refresh_author")
async def job_refresh_author(ctx: AppContext, payload: dict[str, Any]) -> str:
    async with ctx.db.sessionmaker() as s:
        author = await s.get(Author, payload["author_id"])
        if author is None or not author.ol_key:
            raise PermanentError("author not found")
        settings = await ctx.settings(s)
        info = await ctx.openlibrary.get_author(author.ol_key)
        if info:
            author.name, author.bio = info.name, info.bio or author.bio
            author.photo_url = info.photo_url or author.photo_url
            author.birth_date = info.birth_date or author.birth_date
        raw = await ctx.openlibrary.author_works(author.ol_key)
        # Only keep works where this author is the primary author.
        raw = [w for w in raw if w.author_key in (None, author.ol_key)]
        works = clean_works(raw, settings.languages)
        added = await upsert_works(s, author, works)
        author.refreshed_at = utcnow()
        await s.commit()
        if added:
            await enqueue(s, "calibre_sync")
        return f"{author.name}: {len(works)} books ({added} new, {len(raw) - len(works)} filtered)"


async def add_book(session: AsyncSession, ctx: AppContext, ol_work_key: str) -> Book:
    book = await session.scalar(select(Book).where(Book.ol_work_key == ol_work_key))
    if book:
        return book
    work = await ctx.openlibrary.get_work(ol_work_key)
    if work is None or not work.author_key:
        raise ValueError("work not found on OpenLibrary")
    author, _ = await get_or_create_author(
        session, ctx, work.author_key, monitored=False, name=work.author_name
    )
    await upsert_works(session, author, [work])
    await session.commit()
    book = await session.scalar(select(Book).where(Book.ol_work_key == ol_work_key))
    assert book is not None
    return book


async def want_books(session: AsyncSession, ctx: AppContext, book_ids: list[int]) -> int:
    books = (await session.scalars(select(Book).where(Book.id.in_(book_ids)))).all()
    n = 0
    for b in books:
        if b.status in (BookStatus.DOWNLOADING, BookStatus.SENT, BookStatus.HAVE):
            continue
        b.status, b.status_message = BookStatus.WANTED, "Searching…"
        await enqueue(session, "search_book", {"book_id": b.id}, commit=False)
        n += 1
    await session.commit()
    ctx.wake.set()
    return n


async def unwant_books(session: AsyncSession, book_ids: list[int]) -> int:
    books = (await session.scalars(select(Book).where(Book.id.in_(book_ids)))).all()
    n = 0
    for b in books:
        if b.status in (BookStatus.WANTED, BookStatus.FAILED):
            b.status, b.status_message = BookStatus.NONE, None
            n += 1
    await session.commit()
    return n


# ---------------------------------------------------------------------------- releases


def search_queries(title: str, author_name: str) -> list[str]:
    """Queries to try in order until one returns results.

    The original spelling (with å/ä/ö) comes first – indexers match it literally – followed by the
    accent-folded form and finally the title alone.
    """
    main = re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", re.split(r"\s*[:(\[]", title, maxsplit=1)[0])).strip()
    last_name_part = author_name.split(",")[0] if "," in author_name else author_name  # "Herbert, Frank"
    surname = (last_name_part.split() or [""])[-1]
    candidates = [f"{main} {surname}", f"{norm_title(title)} {fold(surname)}", main, norm_title(title)]
    out: list[str] = []
    for q in candidates:
        q = q.strip().lower()
        if q and q not in out:
            out.append(q)
    return out


async def other_titles(ctx: AppContext, session: AsyncSession, book: Book) -> list[str]:
    """The author's other book titles, to tell a sequel from the wanted book in release names."""
    author = book.author
    titles = set(await session.scalars(select(Book.title).where(Book.author_id == author.id)))
    if not author.monitored and author.ol_key:
        # Only this book is in the library – ask OpenLibrary for the rest (cached).
        try:
            titles |= {
                w.title for w in clean_works(await ctx.openlibrary.author_works(author.ol_key, cache=True))
            }
        except Exception as e:  # noqa: BLE001 - best effort; matching still works without it
            log.info("could not fetch other works of %s: %s", author.name, e)
    return sorted(t for t in titles if title_key(t) != title_key(book.title))


async def find_releases(
    ctx: AppContext, session: AsyncSession, book: Book, settings: AppSettings
) -> list[Scored]:
    prowlarr = ctx.prowlarr(settings)
    author_name = book.author.name
    releases = []
    for query in search_queries(book.title, author_name):
        releases = await prowlarr.search(query, settings.prowlarr_categories, settings.prowlarr_indexer_ids)
        if releases:
            break
    blocked = set(await session.scalars(select(Blocklist.guid).where(Blocklist.book_id == book.id)))
    others = await other_titles(ctx, session, book)
    unique = {r.guid: r for r in releases}.values()
    return rank(
        [
            score_release(
                r,
                title=book.title,
                author=author_name,
                preferred_formats=settings.preferred_formats,
                min_seeders=settings.min_seeders,
                max_size_mb=settings.max_size_mb,
                min_score=settings.min_score,
                blocklisted=r.guid in blocked,
                other_titles=others,
            )
            for r in unique
        ]
    )


async def load_book(session: AsyncSession, book_id: int) -> Book | None:
    return await session.scalar(select(Book).where(Book.id == book_id).options(selectinload(Book.author)))


async def grab(
    ctx: AppContext, session: AsyncSession, book: Book, scored: Scored, settings: AppSettings
) -> Download:
    """Send a release to qBittorrent and start tracking it."""
    r = scored.release
    torrent: bytes | None = None
    magnet = r.magnet_url
    if r.download_url:
        torrent, redirect_magnet = await ctx.prowlarr(settings).fetch_torrent(r.download_url)
        magnet = redirect_magnet or magnet
    info_hash = r.info_hash
    try:
        if torrent is not None:
            info_hash = info_hash_from_torrent(torrent)
        elif magnet:
            info_hash = info_hash_from_magnet(magnet) or info_hash
    except BencodeError as e:
        raise ProwlarrError(f"invalid torrent file: {e}") from e
    if not info_hash:
        raise ProwlarrError("could not determine the torrent's info hash")

    qbit = ctx.qbit(settings)
    await qbit.ensure_category(settings.qbit_category)
    await qbit.add(category=settings.qbit_category, torrent=torrent, magnet=None if torrent else magnet)

    dl = Download(
        book_id=book.id,
        release_title=r.title,
        indexer=r.indexer,
        guid=r.guid,
        info_hash=info_hash.lower(),
        size=r.size,
        score=scored.score,
        score_details=scored.details,
    )
    session.add(dl)
    book.status, book.status_message = BookStatus.DOWNLOADING, f"Downloading: {r.title}"
    await session.commit()
    await enqueue(session, "poll_downloads", delay=15)
    return dl


@handler("search_book")
async def job_search_book(ctx: AppContext, payload: dict[str, Any]) -> str:
    async with ctx.db.sessionmaker() as s:
        book = await load_book(s, payload["book_id"])
        if book is None:
            raise PermanentError("book not found")
        if book.status != BookStatus.WANTED:
            return f"skipped ({book.status})"
        settings = await ctx.settings(s)
        try:
            ranked = await find_releases(ctx, s, book, settings)
            best = next((x for x in ranked if x.accepted), None)
            if best is None:
                book.status = BookStatus.FAILED
                reason = ranked[0].reject_reason if ranked else None
                book.status_message = (
                    f"No acceptable release ({len(ranked)} found; best: {reason})"
                    if ranked
                    else "No releases found"
                )
                await s.commit()
                return book.status_message
            dl = await grab(ctx, s, book, best, settings)
            return f"grabbed '{dl.release_title}' (score {dl.score})"
        except (ProwlarrError, QBitError) as e:
            permanent = isinstance(e, ProwlarrNotConfigured | QBitNotConfigured)
            if permanent or payload.get("_final", True):
                book.status, book.status_message = BookStatus.FAILED, str(e)
                await s.commit()
                raise PermanentError(str(e)) from e
            book.status_message = f"{e} – retrying"
            await s.commit()
            raise


async def grab_manual(ctx: AppContext, session: AsyncSession, book: Book, release: dict) -> Download:
    settings = await ctx.settings(session)
    r = Release.from_dict(release)
    scored = score_release(
        r,
        title=book.title,
        author=book.author.name,
        preferred_formats=settings.preferred_formats,
        min_seeders=0,
        max_size_mb=10**6,
        min_score=0,
    )
    return await grab(ctx, session, book, scored, settings)


# ---------------------------------------------------------------------------- downloads


async def _fail_download(
    ctx: AppContext, s: AsyncSession, dl: Download, book: Book, reason: str, settings: AppSettings
) -> None:
    dl.state, dl.message, dl.finished_at = DownloadState.FAILED, reason, utcnow()
    if not await s.scalar(select(Blocklist).where(Blocklist.book_id == book.id, Blocklist.guid == dl.guid)):
        s.add(Blocklist(book_id=book.id, guid=dl.guid, reason=reason[:500]))
    attempts = await s.scalar(select(func.count()).select_from(Download).where(Download.book_id == book.id))
    if (attempts or 0) < MAX_AUTO_ATTEMPTS:
        book.status, book.status_message = BookStatus.WANTED, f"Retrying: {reason}"
        await enqueue(s, "search_book", {"book_id": book.id}, commit=False)
    else:
        book.status, book.status_message = BookStatus.FAILED, reason


@handler("poll_downloads")
async def job_poll_downloads(ctx: AppContext, payload: dict[str, Any]) -> str:
    async with ctx.db.sessionmaker() as s:
        settings = await ctx.settings(s)
        active = (
            await s.scalars(
                select(Download)
                .where(Download.state == DownloadState.DOWNLOADING)
                .options(selectinload(Download.book).selectinload(Book.author))
            )
        ).all()
        if not active:
            return "nothing to do"
        status = await ctx.qbit(settings).status([d.info_hash for d in active if d.info_hash])
        imported = 0
        for dl in active:
            book = dl.book
            t = status.get(dl.info_hash or "")
            if t is None:
                # qBittorrent may need a moment to register a magnet; give it 10 minutes.
                if (utcnow() - dl.created_at).total_seconds() > 600:
                    await _fail_download(ctx, s, dl, book, "torrent disappeared from qBittorrent", settings)
                continue
            dl.progress = t.progress
            if t.errored:
                await _fail_download(ctx, s, dl, book, f"qBittorrent error state: {t.state}", settings)
                continue
            if not t.done:
                book.status_message = f"Downloading {t.progress * 100:.0f}%"
                continue
            dl.state = DownloadState.COMPLETED
            path = map_path(t.content_path, settings.qbit_path_from, settings.qbit_path_to)
            try:
                target = await asyncio.to_thread(
                    import_download,
                    path,
                    title=book.title,
                    author=book.author.name,
                    preferred=settings.preferred_formats,
                    ingest_dir=settings.ingest_dir,
                    mode=settings.import_mode,
                    tmp_root=ctx.tmp_dir,
                )
            except (ImportError_, OSError) as e:
                await _fail_download(ctx, s, dl, book, f"import failed: {e}", settings)
                continue
            dl.state, dl.imported_file, dl.finished_at = DownloadState.IMPORTED, str(target), utcnow()
            book.status, book.status_message = (
                BookStatus.SENT,
                f"Sent to Calibre-Web Automated ({target.name})",
            )
            imported += 1
        await s.commit()
        if imported:
            # CWA usually ingests within a minute; check the library a bit later.
            await enqueue(s, "calibre_sync", delay=90)
        return f"{len(active)} active, {imported} imported"


# ---------------------------------------------------------------------------- calibre


@handler("calibre_sync")
async def job_calibre_sync(ctx: AppContext, payload: dict[str, Any]) -> str:
    settings = await ctx.settings()
    if not settings.calibre_library_dir:
        return "no Calibre library configured"
    try:
        library = await asyncio.to_thread(read_library, settings.calibre_library_dir, ctx.tmp_dir)
    except CalibreError as e:
        raise PermanentError(str(e)) from e
    by_isbn: dict[str, int] = {}
    for cb in library:
        for raw in cb.isbns:
            if n := normalize_isbn(raw):
                by_isbn[n] = cb.id
    by_title: dict[str, list] = {}
    for cb in library:
        by_title.setdefault(title_key(cb.title), []).append(cb)

    async with ctx.db.sessionmaker() as s:
        books = (
            await s.scalars(
                select(Book).where(Book.status != BookStatus.HAVE).options(selectinload(Book.author))
            )
        ).all()
        found = 0
        for b in books:
            cid = next((by_isbn[i] for i in b.isbns if i in by_isbn), None)
            if cid is None:
                for cb in by_title.get(title_key(b.title), []):
                    if any(same_book(b.title, b.author.name, cb.title, a) for a in cb.authors or [""]):
                        cid = cb.id
                        break
            if cid is not None:
                b.status, b.status_message, b.calibre_id = BookStatus.HAVE, None, cid
                found += 1
        await s.commit()
    return f"{len(library)} books in Calibre, {found} newly matched"
