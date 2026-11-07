"""HTTP API (JSON under /api). The React frontend is the only intended client."""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import __version__, services
from .appsettings import save_settings
from .auth import hash_password, require_user, verify_password
from .clients.qbittorrent import QBitError
from .context import AppContext
from .indexers.prowlarr import ProwlarrError
from .jobs import enqueue
from .library.calibre import CalibreError, read_library
from .metadata.openlibrary import cover_url
from .models import Author, Book, BookStatus, Download, Job, User

# ---------------------------------------------------------------------------- dependencies


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


async def get_session(request: Request):
    async with request.app.state.ctx.db.sessionmaker() as s:
        yield s


Ctx = Annotated[AppContext, Depends(get_ctx)]
Session = Annotated[AsyncSession, Depends(get_session)]

public = APIRouter(prefix="/api")
router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


# ---------------------------------------------------------------------------- schemas


class AuthorOut(BaseModel):
    id: int
    name: str
    ol_key: str | None
    photo_url: str | None
    bio: str | None = None
    birth_date: str | None = None
    monitored: bool
    refreshed_at: datetime | None
    book_count: int = 0
    have_count: int = 0
    wanted_count: int = 0


class BookOut(BaseModel):
    id: int
    author_id: int
    author_name: str
    title: str
    subtitle: str | None
    ol_work_key: str | None
    isbn: str | None
    year: int | None
    cover_url: str | None
    edition_count: int
    languages: list[str]
    status: BookStatus
    status_message: str | None


def book_out(b: Book) -> BookOut:
    return BookOut(
        id=b.id,
        author_id=b.author_id,
        author_name=b.author.name,
        title=b.title,
        subtitle=b.subtitle,
        ol_work_key=b.ol_work_key,
        isbn=b.isbn,
        year=b.year,
        cover_url=cover_url(b.cover_id),
        edition_count=b.edition_count,
        languages=b.languages[:12],
        status=b.status,
        status_message=b.status_message,
    )


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class BookIds(BaseModel):
    book_ids: list[int] = Field(min_length=1, max_length=5000)


# ---------------------------------------------------------------------------- auth / health


@public.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@public.get("/auth/status")
async def auth_status(request: Request, session: Session, ctx: Ctx) -> dict[str, Any]:
    has_user = bool(await session.scalar(select(func.count()).select_from(User)))
    if ctx.env.auth_disabled:
        return {"setup_required": False, "authenticated": True, "username": "admin", "version": __version__}
    return {
        "setup_required": not has_user,
        "authenticated": bool(request.session.get("user")),
        "username": request.session.get("user"),
        "version": __version__,
    }


@public.post("/auth/setup")
async def auth_setup(body: Credentials, request: Request, session: Session) -> dict[str, str]:
    if await session.scalar(select(func.count()).select_from(User)):
        raise HTTPException(409, "already set up")
    if len(body.password) < 8:
        raise HTTPException(422, "password must be at least 8 characters")
    session.add(User(username=body.username, password_hash=hash_password(body.password)))
    await session.commit()
    request.session["user"] = body.username
    return {"username": body.username}


@public.post("/auth/login")
async def auth_login(body: Credentials, request: Request, session: Session) -> dict[str, str]:
    user = await session.scalar(select(User).where(User.username == body.username))
    if not user or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "wrong username or password")
    request.session["user"] = user.username
    return {"username": user.username}


@public.post("/auth/logout")
async def auth_logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"ok": True}


# ---------------------------------------------------------------------------- search


@router.get("/search")
async def search(q: Annotated[str, Query(min_length=1, max_length=300)], ctx: Ctx, session: Session):
    result = await services.search_metadata(ctx, q.strip())
    author_keys = [a.ol_key for a in result.authors]
    work_keys = [w.ol_work_key for w in result.works]
    in_lib_authors = dict(
        (await session.execute(select(Author.ol_key, Author.id).where(Author.ol_key.in_(author_keys)))).all()
    )
    in_lib_books = {
        k: (i, st)
        for k, i, st in (
            await session.execute(
                select(Book.ol_work_key, Book.id, Book.status).where(Book.ol_work_key.in_(work_keys))
            )
        ).all()
    }
    return {
        "query": result.query,
        "isbn": result.isbn,
        "authors": [
            {
                "ol_key": a.ol_key,
                "name": a.name,
                "work_count": a.work_count,
                "top_work": a.top_work,
                "birth_date": a.birth_date,
                "photo_url": a.photo_url,
                "library_id": in_lib_authors.get(a.ol_key),
            }
            for a in result.authors
        ],
        "books": [
            {
                "ol_work_key": w.ol_work_key,
                "title": w.title,
                "subtitle": w.subtitle,
                "author_name": w.author_name,
                "author_key": w.author_key,
                "year": w.year,
                "cover_url": cover_url(w.cover_id),
                "edition_count": w.edition_count,
                "library_id": in_lib_books.get(w.ol_work_key, (None, None))[0],
                "status": in_lib_books.get(w.ol_work_key, (None, None))[1],
            }
            for w in result.works
        ],
    }


# ---------------------------------------------------------------------------- authors


class AddAuthor(BaseModel):
    ol_key: str = Field(pattern=r"^OL\d+A$")


@router.get("/authors")
async def list_authors(session: Session) -> list[AuthorOut]:
    counts = (
        select(
            Book.author_id,
            func.count().label("n"),
            func.sum(case((Book.status == BookStatus.HAVE, 1), else_=0)).label("have"),
            func.sum(
                case(
                    (Book.status.in_([BookStatus.WANTED, BookStatus.DOWNLOADING, BookStatus.SENT]), 1),
                    else_=0,
                )
            ).label("wanted"),
        )
        .group_by(Book.author_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(Author, counts.c.n, counts.c.have, counts.c.wanted)
            .outerjoin(counts, counts.c.author_id == Author.id)
            .order_by(Author.name)
        )
    ).all()
    return [
        AuthorOut(
            id=a.id,
            name=a.name,
            ol_key=a.ol_key,
            photo_url=a.photo_url,
            monitored=a.monitored,
            refreshed_at=a.refreshed_at,
            book_count=n or 0,
            have_count=have or 0,
            wanted_count=wanted or 0,
        )
        for a, n, have, wanted in rows
    ]


@router.post("/authors")
async def add_author(body: AddAuthor, ctx: Ctx, session: Session) -> AuthorOut:
    a = await services.add_author(session, ctx, body.ol_key)
    return AuthorOut(
        id=a.id,
        name=a.name,
        ol_key=a.ol_key,
        photo_url=a.photo_url,
        monitored=a.monitored,
        refreshed_at=a.refreshed_at,
    )


@router.get("/authors/{author_id}")
async def get_author(author_id: int, session: Session) -> dict[str, Any]:
    a = await session.scalar(
        select(Author)
        .where(Author.id == author_id)
        .options(selectinload(Author.books).selectinload(Book.author))
    )
    if not a:
        raise HTTPException(404, "author not found")
    refreshing = bool(
        await session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.key == f"refresh_author:author_id={a.id}", Job.status.in_(["pending", "running"]))
        )
    )
    books = sorted(a.books, key=lambda b: (b.year or 9999, b.title))
    return {
        "author": AuthorOut(
            id=a.id,
            name=a.name,
            ol_key=a.ol_key,
            photo_url=a.photo_url,
            bio=a.bio,
            birth_date=a.birth_date,
            monitored=a.monitored,
            refreshed_at=a.refreshed_at,
            book_count=len(books),
            have_count=sum(b.status == BookStatus.HAVE for b in books),
        ),
        "refreshing": refreshing,
        "books": [book_out(b) for b in books],
    }


@router.post("/authors/{author_id}/refresh")
async def refresh_author(author_id: int, ctx: Ctx, session: Session) -> dict[str, bool]:
    if not await session.get(Author, author_id):
        raise HTTPException(404, "author not found")
    await enqueue(session, "refresh_author", {"author_id": author_id})
    ctx.wake.set()
    return {"ok": True}


@router.post("/authors/{author_id}/monitor")
async def monitor_author(author_id: int, ctx: Ctx, session: Session) -> dict[str, bool]:
    a = await session.get(Author, author_id)
    if not a:
        raise HTTPException(404, "author not found")
    a.monitored = True
    await session.commit()
    await enqueue(session, "refresh_author", {"author_id": author_id})
    ctx.wake.set()
    return {"ok": True}


@router.delete("/authors/{author_id}")
async def delete_author(author_id: int, session: Session) -> dict[str, bool]:
    a = await session.get(Author, author_id)
    if not a:
        raise HTTPException(404, "author not found")
    await session.delete(a)
    await session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------- books


class AddBook(BaseModel):
    ol_work_key: str = Field(pattern=r"^OL\d+W$")
    download: bool = False


@router.get("/books")
async def list_books(
    session: Session,
    status: Annotated[list[BookStatus] | None, Query()] = None,
    limit: int = 500,
) -> list[BookOut]:
    q = (
        select(Book)
        .options(selectinload(Book.author))
        .order_by(Book.updated_at.desc())
        .limit(min(limit, 2000))
    )
    if status:
        q = q.where(Book.status.in_(status))
    return [book_out(b) for b in (await session.scalars(q)).all()]


@router.post("/books")
async def add_book(body: AddBook, ctx: Ctx, session: Session) -> BookOut:
    try:
        book = await services.add_book(session, ctx, body.ol_work_key)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    book_id = book.id
    if body.download:
        await services.want_books(session, ctx, [book_id])
    session.expire_all()
    loaded = await services.load_book(session, book_id)
    assert loaded is not None
    return book_out(loaded)


@router.post("/books/download")
async def download_books(body: BookIds, ctx: Ctx, session: Session) -> dict[str, int]:
    return {"queued": await services.want_books(session, ctx, body.book_ids)}


@router.post("/books/unwant")
async def unwant_books(body: BookIds, session: Session) -> dict[str, int]:
    return {"updated": await services.unwant_books(session, body.book_ids)}


@router.get("/books/{book_id}/releases")
async def book_releases(book_id: int, ctx: Ctx, session: Session) -> list[dict[str, Any]]:
    book = await services.load_book(session, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    settings = await ctx.settings(session)
    try:
        ranked = await services.find_releases(ctx, session, book, settings)
    except ProwlarrError as e:
        raise HTTPException(502, str(e)) from e
    return [
        {
            "release": s.release.to_dict(),
            "score": s.score,
            "accepted": s.accepted,
            "format": s.format,
            "details": s.details,
            "reject_reason": s.reject_reason,
        }
        for s in ranked
    ]


class GrabBody(BaseModel):
    release: dict[str, Any]


@router.post("/books/{book_id}/grab")
async def grab_release(book_id: int, body: GrabBody, ctx: Ctx, session: Session) -> dict[str, Any]:
    book = await services.load_book(session, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    try:
        dl = await services.grab_manual(ctx, session, book, body.release)
    except (ProwlarrError, QBitError) as e:
        raise HTTPException(502, str(e)) from e
    ctx.wake.set()
    return {"download_id": dl.id}


# ---------------------------------------------------------------------------- activity


@router.get("/activity")
async def activity(session: Session) -> dict[str, Any]:
    downloads = (
        await session.scalars(
            select(Download)
            .options(selectinload(Download.book).selectinload(Book.author))
            .order_by(Download.created_at.desc())
            .limit(100)
        )
    ).all()
    jobs = (await session.scalars(select(Job).order_by(Job.id.desc()).limit(100))).all()
    return {
        "downloads": [
            {
                "id": d.id,
                "book_id": d.book_id,
                "book_title": d.book.title,
                "author_id": d.book.author_id,
                "author_name": d.book.author.name,
                "release_title": d.release_title,
                "indexer": d.indexer,
                "size": d.size,
                "score": d.score,
                "score_details": d.score_details,
                "state": d.state,
                "progress": d.progress,
                "message": d.message,
                "imported_file": d.imported_file,
                "created_at": d.created_at,
                "finished_at": d.finished_at,
            }
            for d in downloads
        ],
        "jobs": [
            {
                "id": j.id,
                "type": j.type,
                "payload": j.payload,
                "status": j.status,
                "attempts": j.attempts,
                "message": j.message,
                "created_at": j.created_at,
                "finished_at": j.finished_at,
            }
            for j in jobs
        ],
    }


# ---------------------------------------------------------------------------- settings


@router.get("/settings")
async def get_settings(ctx: Ctx, session: Session) -> dict[str, Any]:
    return (await ctx.settings(session)).masked()


@router.put("/settings")
async def put_settings(body: dict[str, Any], session: Session) -> dict[str, Any]:
    try:
        return (await save_settings(session, body)).masked()
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def _check_calibre(ingest_dir: str, library_dir: str, tmp: Path) -> str:
    if not os.path.isdir(ingest_dir) or not os.access(ingest_dir, os.W_OK):
        raise CalibreError(f"ingest folder {ingest_dir} is missing or not writable")
    books = read_library(library_dir, tmp)
    return f"ingest folder writable; Calibre library has {len(books)} books"


@router.post("/settings/test/{service}")
async def test_service(service: str, ctx: Ctx, session: Session) -> dict[str, Any]:
    s = await ctx.settings(session)
    try:
        if service == "prowlarr":
            msg = await ctx.prowlarr(s).test()
        elif service == "qbittorrent":
            msg = await ctx.qbit(s).test()
        elif service == "calibre":
            msg = await asyncio.to_thread(_check_calibre, s.ingest_dir, s.calibre_library_dir, ctx.tmp_dir)
        else:
            raise HTTPException(404, "unknown service")
    except (ProwlarrError, QBitError, CalibreError) as e:
        return {"ok": False, "message": str(e)}
    return {"ok": True, "message": msg}
