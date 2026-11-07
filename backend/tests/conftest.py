import json
import sqlite3
from pathlib import Path

import httpx
import pytest

from fastlibrarian.context import AppContext
from fastlibrarian.env import Env
from fastlibrarian.http import MetadataHttp, make_client
from fastlibrarian.jobs import Worker
from fastlibrarian.main import create_app
from fastlibrarian.models import db_now

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_json(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def make_torrent(name: str = "Dune - Frank Herbert.epub", length: int = 1234) -> bytes:
    info = b"d6:lengthi%de4:name%d:%s12:piece lengthi16384e6:pieces20:%se" % (
        length,
        len(name.encode()),
        name.encode(),
        b"\x01" * 20,
    )
    return b"d8:announce20:http://tracker/annou4:info" + info + b"e"


def make_calibre_db(library: Path, books: list[tuple[str, list[str], list[str]]]) -> None:
    """Create a minimal Calibre-like metadata.db (WAL mode, like CWA's)."""
    library.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(library / "metadata.db")
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(
        """
        CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author_sort TEXT, path TEXT);
        CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER);
        CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER, type TEXT, val TEXT);
        """
    )
    for i, (title, authors, isbns) in enumerate(books, start=1):
        con.execute("INSERT INTO books (id, title, path) VALUES (?, ?, ?)", (i, title, f"x/{i}"))
        for a in authors:
            cur = con.execute("INSERT INTO authors (name) VALUES (?)", (a,))
            con.execute("INSERT INTO books_authors_link (book, author) VALUES (?, ?)", (i, cur.lastrowid))
        for isbn in isbns:
            con.execute("INSERT INTO identifiers (book, type, val) VALUES (?, 'isbn', ?)", (i, isbn))
    con.commit()
    con.close()


class Harness:
    def __init__(self, app, ctx: AppContext, client: httpx.AsyncClient, tmp: Path):
        self.app, self.ctx, self.client, self.tmp = app, ctx, client, tmp
        self.worker = Worker(ctx)

    async def drain(self, max_jobs: int = 50) -> None:
        """Run all queued jobs now (ignoring scheduled delays)."""
        from sqlalchemy import text

        for _ in range(max_jobs):
            async with self.ctx.db.sessionmaker() as s:
                await s.execute(
                    text("UPDATE jobs SET run_after=:now WHERE status='pending'"), {"now": db_now()}
                )
                await s.commit()
            if not await self.worker.run_one():
                return
        raise AssertionError("job queue did not drain")


@pytest.fixture
async def harness(tmp_path: Path):
    env = Env(config_dir=tmp_path / "config", run_worker=False, static_dir=None)
    app = create_app(env)
    ctx = AppContext(
        env=env,
        db=app.state.db,
        http=make_client(),
        meta_http=MetadataHttp(make_client(), min_interval=0),
    )
    app.state.ctx = ctx
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield Harness(app, ctx, client, tmp_path)
    await ctx.http.aclose()
    await ctx.meta_http.client.aclose()
    await ctx.db.dispose()


@pytest.fixture
async def logged_in(harness: Harness) -> Harness:
    r = await harness.client.post("/api/auth/setup", json={"username": "admin", "password": "correct-horse-battery"})
    assert r.status_code == 200, r.text
    return harness
