"""End-to-end: search → add author → pick a book → Prowlarr → qBittorrent → CWA ingest → in library.

External services are mocked at the HTTP level (respx) with real OpenLibrary responses.
"""

from pathlib import Path

import httpx
import pytest
import respx

from .conftest import fixture_json, make_calibre_db, make_torrent

PROWLARR = "http://prowlarr:9696"
QBIT = "http://qbit:5080"


def ol_router(mock: respx.MockRouter) -> None:
    def search(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        if "author_key" in p:
            return httpx.Response(200, json=fixture_json("ol_works_herbert.json"))
        if "isbn" in p:
            return httpx.Response(200, json=fixture_json("ol_isbn_dune.json"))
        return httpx.Response(200, json=fixture_json("ol_search_dune.json"))

    mock.get("https://openlibrary.org/search.json").mock(side_effect=search)
    mock.get("https://openlibrary.org/search/authors.json").mock(
        return_value=httpx.Response(200, json=fixture_json("ol_authors_herbert.json"))
    )
    mock.get("https://openlibrary.org/authors/OL79034A.json").mock(
        return_value=httpx.Response(200, json=fixture_json("ol_author_herbert.json"))
    )


async def configure(h, tmp: Path) -> dict[str, Path]:
    paths = {"ingest": tmp / "ingest", "library": tmp / "library", "downloads": tmp / "downloads"}
    paths["ingest"].mkdir()
    paths["downloads"].mkdir()
    make_calibre_db(paths["library"], [("Emma", ["Jane Austen"], [])])
    r = await h.client.put(
        "/api/settings",
        json={
            "prowlarr_url": PROWLARR,
            "prowlarr_api_key": "k",
            "qbit_url": QBIT,
            "ingest_dir": str(paths["ingest"]),
            "calibre_library_dir": str(paths["library"]),
        },
    )
    assert r.status_code == 200 and r.json()["prowlarr_api_key"] == "********"
    return paths


async def test_auth_is_required(harness):
    assert (await harness.client.get("/api/health")).status_code == 200
    assert (await harness.client.get("/api/auth/status")).json()["setup_required"] is True
    assert (await harness.client.get("/api/authors")).status_code == 401
    await harness.client.post(
        "/api/auth/setup", json={"username": "admin", "password": "correct-horse-battery"}
    )
    assert (await harness.client.get("/api/authors")).status_code == 200
    # a second setup is refused, logout locks the API, login opens it again
    r = await harness.client.post("/api/auth/setup", json={"username": "x", "password": "yyyyyyyyy"})
    assert r.status_code == 409
    await harness.client.post("/api/auth/logout")
    assert (await harness.client.get("/api/authors")).status_code == 401
    bad = await harness.client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401
    await harness.client.post(
        "/api/auth/login", json={"username": "admin", "password": "correct-horse-battery"}
    )
    assert (await harness.client.get("/api/authors")).status_code == 200


@respx.mock(assert_all_mocked=True, assert_all_called=False)
async def test_search_by_text_and_isbn(logged_in, respx_mock):
    ol_router(respx_mock)
    res = (await logged_in.client.get("/api/search", params={"q": "frank herbert"})).json()
    assert res["authors"][0]["ol_key"] == "OL79034A"
    assert res["books"][0]["title"] == "Dune"
    res = (await logged_in.client.get("/api/search", params={"q": "978-0-441-17271-9"})).json()
    assert res["isbn"] == "9780441172719"
    assert [b["ol_work_key"] for b in res["books"]] == ["OL893414W"]
    assert res["authors"] == []


@respx.mock(assert_all_mocked=True, assert_all_called=False)
async def test_full_flow(logged_in, respx_mock, tmp_path):
    h = logged_in
    ol_router(respx_mock)
    paths = await configure(h, tmp_path)

    # 1. add author → bibliography is fetched in the background
    r = await h.client.post("/api/authors", json={"ol_key": "OL79034A"})
    assert r.status_code == 200
    author_id = r.json()["id"]
    await h.drain()
    detail = (await h.client.get(f"/api/authors/{author_id}")).json()
    assert detail["author"]["name"] == "Frank Herbert" and not detail["refreshing"]
    books = {b["title"]: b for b in detail["books"]}
    assert "Dune" in books and "Dune Calendar 1978" not in books
    assert all(b["status"] == "none" for b in books.values())  # nothing downloads by itself
    dune_id = books["Dune"]["id"]

    # 2. user picks Dune → search → best release grabbed
    torrent = make_torrent("Frank Herbert - Dune.epub")
    respx_mock.get(f"{PROWLARR}/api/v1/search").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "protocol": "torrent",
                    "guid": "g-pdf",
                    "title": "Frank Herbert - Dune [PDF]",
                    "size": 3_000_000,
                    "seeders": 30,
                    "indexer": "TL",
                    "downloadUrl": f"{PROWLARR}/dl/pdf",
                },
                {
                    "protocol": "torrent",
                    "guid": "g-epub",
                    "title": "Frank Herbert - Dune (retail) [EPUB]",
                    "size": 1_500_000,
                    "seeders": 12,
                    "indexer": "TL",
                    "downloadUrl": f"{PROWLARR}/dl/epub",
                },
                {
                    "protocol": "torrent",
                    "guid": "g-audio",
                    "title": "Frank Herbert - Dune Audiobook M4B",
                    "size": 900_000_000,
                    "seeders": 99,
                    "indexer": "TL",
                    "downloadUrl": f"{PROWLARR}/dl/audio",
                },
            ],
        )
    )
    respx_mock.get(f"{PROWLARR}/dl/epub").mock(return_value=httpx.Response(200, content=torrent))
    respx_mock.get(f"{QBIT}/api/v2/torrents/categories").mock(
        return_value=httpx.Response(200, json={"books": {}})
    )
    add_route = respx_mock.post(f"{QBIT}/api/v2/torrents/add").mock(
        return_value=httpx.Response(200, text="Ok.")
    )

    from fastlibrarian.torrent import info_hash_from_torrent

    info_hash = info_hash_from_torrent(torrent)
    payload = paths["downloads"] / "Frank Herbert - Dune"
    payload.mkdir()
    (payload / "Frank Herbert - Dune.epub").write_bytes(b"EPUBDATA")
    qbit_state = {"progress": 0.4, "state": "downloading"}
    respx_mock.get(f"{QBIT}/api/v2/torrents/info").mock(
        side_effect=lambda req: httpx.Response(
            200,
            json=[
                {"hash": info_hash, "name": "x", "content_path": str(payload), "save_path": "", **qbit_state}
            ],
        )
    )

    r = await h.client.post("/api/books/download", json={"book_ids": [dune_id]})
    assert r.json() == {"queued": 1}
    await h.drain()
    assert add_route.called
    assert b"category" in add_route.calls.last.request.content
    activity = (await h.client.get("/api/activity")).json()
    dl = activity["downloads"][0]
    assert dl["release_title"] == "Frank Herbert - Dune (retail) [EPUB]" and dl["state"] == "downloading"
    assert dl["score_details"]["format"].startswith("epub")
    book = next(
        b for b in (await h.client.get(f"/api/authors/{author_id}")).json()["books"] if b["id"] == dune_id
    )
    assert book["status"] == "downloading"

    # 3. torrent finishes → ebook copied to the CWA ingest folder
    qbit_state.update(progress=1.0, state="uploading")
    await h.worker.schedule_once()
    await h.drain()
    ingested = list(paths["ingest"].iterdir())
    assert [p.name for p in ingested] == ["Dune - Frank Herbert.epub"]
    assert ingested[0].read_bytes() == b"EPUBDATA"
    assert (payload / "Frank Herbert - Dune.epub").exists()  # still seeding
    book = next(
        b for b in (await h.client.get(f"/api/authors/{author_id}")).json()["books"] if b["id"] == dune_id
    )
    assert book["status"] == "sent"

    # 4. CWA imports it into Calibre → we notice and mark it as in the library
    (paths["library"] / "metadata.db").unlink()
    for suffix in ("-wal", "-shm"):
        (paths["library"] / f"metadata.db{suffix}").unlink(missing_ok=True)
    make_calibre_db(paths["library"], [("Emma", ["Jane Austen"], []), ("Dune", ["Frank Herbert"], [])])
    from fastlibrarian.jobs import enqueue

    async with h.ctx.db.sessionmaker() as s:
        await enqueue(s, "calibre_sync")  # the periodic sync, as the scheduler would enqueue it
    await h.drain()
    book = next(
        b for b in (await h.client.get(f"/api/authors/{author_id}")).json()["books"] if b["id"] == dune_id
    )
    assert book["status"] == "have"
    authors = (await h.client.get("/api/authors")).json()
    assert authors[0]["have_count"] == 1


@respx.mock(assert_all_mocked=True, assert_all_called=False)
async def test_failed_import_blocklists_and_retries(logged_in, respx_mock, tmp_path):
    h = logged_in
    ol_router(respx_mock)
    paths = await configure(h, tmp_path)
    book = await h.client.post("/api/books", json={"ol_work_key": "OL893414W"})
    if book.status_code != 200:  # get_work uses search.json with q=key:..., served by the search fixture
        pytest.fail(book.text)
    book_id = book.json()["id"]

    respx_mock.get(f"{PROWLARR}/api/v1/search").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "protocol": "torrent",
                    "guid": "bad",
                    "title": "Frank Herbert - Dune epub",
                    "size": 1_000_000,
                    "seeders": 50,
                    "indexer": "TL",
                    "magnetUrl": "magnet:?xt=urn:btih:" + "a" * 40,
                },
                {
                    "protocol": "torrent",
                    "guid": "good",
                    "title": "Frank Herbert - Dune mobi",
                    "size": 1_000_000,
                    "seeders": 5,
                    "indexer": "TL",
                    "magnetUrl": "magnet:?xt=urn:btih:" + "b" * 40,
                },
            ],
        )
    )
    respx_mock.get(f"{QBIT}/api/v2/torrents/categories").mock(
        return_value=httpx.Response(200, json={"books": {}})
    )
    respx_mock.post(f"{QBIT}/api/v2/torrents/add").mock(return_value=httpx.Response(200, text="Ok."))
    empty = paths["downloads"] / "junk"
    empty.mkdir()
    (empty / "virus.exe").write_bytes(b"x")
    respx_mock.get(f"{QBIT}/api/v2/torrents/info").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "hash": "a" * 40,
                    "name": "junk",
                    "state": "uploading",
                    "progress": 1,
                    "content_path": str(empty),
                },
            ],
        )
    )
    await h.client.post("/api/books/download", json={"book_ids": [book_id]})
    await h.drain()
    await h.worker.schedule_once()
    await h.drain()
    downloads = (await h.client.get("/api/activity")).json()["downloads"]
    states = {d["release_title"]: d["state"] for d in downloads}
    assert states["Frank Herbert - Dune epub"] == "failed"
    assert "no ebook" in next(d["message"] for d in downloads if d["state"] == "failed")
    # the bad release is blocklisted; the next best one was grabbed automatically
    assert states["Frank Herbert - Dune mobi"] == "downloading"
    releases = (await h.client.get(f"/api/books/{book_id}/releases")).json()
    bad = next(r for r in releases if r["release"]["guid"] == "bad")
    assert bad["reject_reason"] == "blocklisted"


async def test_settings_secrets_are_masked_and_kept(logged_in):
    h = logged_in
    await h.client.put("/api/settings", json={"prowlarr_api_key": "secret", "min_seeders": 3})
    s = (await h.client.get("/api/settings")).json()
    assert s["prowlarr_api_key"] == "********" and s["min_seeders"] == 3
    await h.client.put("/api/settings", json={**s, "min_seeders": 2})  # UI sends the mask back
    async with h.ctx.db.sessionmaker() as session:
        stored = await h.ctx.settings(session)
    assert stored.prowlarr_api_key == "secret" and stored.min_seeders == 2


@respx.mock(assert_all_mocked=True, assert_all_called=False)
async def test_search_errors_end_in_failed_not_stuck_wanted(logged_in, respx_mock, tmp_path):
    """Regression: a book must never stay 'wanted' forever when Prowlarr is broken."""
    h = logged_in
    ol_router(respx_mock)
    book_id = (await h.client.post("/api/books", json={"ol_work_key": "OL893414W"})).json()["id"]

    async def status() -> tuple[str, str]:
        books = (await h.client.get("/api/books")).json()
        b = next(b for b in books if b["id"] == book_id)
        return b["status"], b["status_message"] or ""

    # not configured → fails at once, no pointless retries
    await h.client.post("/api/books/download", json={"book_ids": [book_id]})
    await h.drain()
    st, msg = await status()
    assert st == "failed" and "not configured" in msg

    # configured but down → retried, then failed after the last attempt
    await configure(h, tmp_path)
    route = respx_mock.get(f"{PROWLARR}/api/v1/search").mock(return_value=httpx.Response(503, text="down"))
    await h.client.post("/api/books/download", json={"book_ids": [book_id]})
    await h.worker.run_one()
    st, msg = await status()
    assert st == "wanted" and "retrying" in msg
    await h.drain()
    st, msg = await status()
    assert st == "failed" and "503" in msg
    assert route.call_count == 3


@respx.mock(assert_all_mocked=True, assert_all_called=False)
async def test_prowlarr_timeout_has_a_helpful_message(logged_in, respx_mock, tmp_path):
    h = logged_in
    ol_router(respx_mock)
    await configure(h, tmp_path)
    book_id = (await h.client.post("/api/books", json={"ol_work_key": "OL893414W"})).json()["id"]
    respx_mock.get(f"{PROWLARR}/api/v1/search").mock(side_effect=httpx.ReadTimeout(""))
    r = await h.client.get(f"/api/books/{book_id}/releases")
    assert r.status_code == 502 and "did not answer within" in r.json()["detail"]
