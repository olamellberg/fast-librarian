"""Unit tests for the pure building blocks."""

import zipfile
from pathlib import Path

import pytest

from fastlibrarian.indexers.prowlarr import Release, parse_release
from fastlibrarian.isbn import normalize_isbn
from fastlibrarian.library.calibre import read_library
from fastlibrarian.library.importer import ImportError_, deliver, map_path, pick_ebook
from fastlibrarian.matching import author_similarity, norm_author, norm_title, release_title_score, same_book
from fastlibrarian.metadata.openlibrary import AuthorInfo, clean_works, parse_work, rank_authors
from fastlibrarian.scoring import detect_format, rank, score_release
from fastlibrarian.torrent import info_hash_from_magnet, info_hash_from_torrent

from .conftest import fixture_json, make_calibre_db, make_torrent

# ---------------------------------------------------------------------------- isbn


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("9780441172719", "9780441172719"),
        ("978-0-441-17271-9", "9780441172719"),
        ("0441172717", "9780441172719"),
        ("0-441-17271-7", "9780441172719"),
        ("ISBN: 0-8044-2957-X", "9780804429573"),
        ("9780441172718", None),  # bad checksum
        ("dune", None),
        ("12345", None),
    ],
)
def test_normalize_isbn(raw, expected):
    assert normalize_isbn(raw) == expected


# ---------------------------------------------------------------------------- matching


def test_norm_title_and_author():
    assert norm_title("The Lord of the Rings: The Fellowship of the Ring") == "lord of the rings"
    assert norm_title("Mördarens apa") == "mordarens apa"
    assert norm_author("Tolkien, J. R. R.") == "j r r tolkien"


# Real release names returned by Prowlarr indexers (2026-11).
REAL_DUNE_RELEASES = {
    "Frank Herbert - Dune 2003 Retail EPUB eBook-BitBook": "Dune",
    "Frank Herbert - Dune Messiah 2008 Retail EPUB eBook-BitBook": "Dune Messiah",
    "Frank Herbert - Children Of Dune 2008 Retail EPUB eBook-BitBook": "Children of Dune",
    "Frank Herbert - Heretics Of Dune 1987 Retail EPUB eBook-BitBook": "Heretics of Dune",
    "Frank Herbert - Chapterhouse Dune 1987 Retail EPUB eBook-BitBook": "Chapterhouse Dune",
    "Frank Herbert God Emperor Of Dune 2014 RETAiL ePub eBook-LiBRiCiDE": "God Emperor of Dune",
}


@pytest.mark.parametrize("wanted", sorted(set(REAL_DUNE_RELEASES.values())))
def test_release_title_score_picks_only_the_right_dune_book(wanted):
    """Regression: every Dune sequel used to score 100 for "Dune" because it contains the word."""
    for name, actual in REAL_DUNE_RELEASES.items():
        score = release_title_score(wanted, "Frank Herbert", name)
        if actual == wanted:
            assert score == 100, name
        else:
            assert score < 70, (wanted, name, score)


@pytest.mark.parametrize(
    ("title", "author", "name", "ok"),
    [
        ("Project Hail Mary", "Andy Weir", "Project Hail Mary by Andy Weir EPUB", True),
        ("The Hobbit", "J.R.R. Tolkien", "Tolkien - Hobbit, The (retail) epub", True),
        (
            "The Hobbit",
            "J.R.R. Tolkien",
            "J.R.R. Tolkien - The Hobbit [Deluxe Illustrated Edition] (2012)",
            True,
        ),
        ("Dune Messiah", "Frank Herbert", "Frank.Herbert.-.Dune.Messiah.epub", True),
        ("Dune", "Frank Herbert", "Herbert, Frank - Dune (Dune Chronicles 1).azw3", True),
        ("1984", "George Orwell", "George Orwell - 1984 (1949) epub", True),
        ("Dune Messiah", "Frank Herbert", "Frank Herbert - Children of Dune", False),
        ("Dune", "Frank Herbert", "Frank Herbert - Dune Complete Collection 1-6 epub", False),
        ("Dune", "Frank Herbert", "Brian Herbert - Dune House Atreides epub", False),
        # real names from Prowlarr, 2026-11-07
        (
            "The Girl with the Dragon Tattoo",
            "Stieg Larsson",
            "Girl with the Dragon Tattoo, The - Stieg Larsson-viny",
            True,
        ),
        (
            "The Girl with the Dragon Tattoo",
            "Stieg Larsson",
            "The Girl with a Dragon Tattoo Trilogy by Stieg Larsson",
            False,
        ),
        ("Dune", "Frank Herbert", "Frank Herbert Dune 2020 SWEDiSH RETAiL ePub eBOOK-DECiPHER", True),
        (
            "Pippi Långstrump",
            "Astrid Lindgren",
            "Pippi Långstrump (TV-serien) 1 av 6",
            False,
        ),  # a TV series ("1 av 6" = episode 1 of 6)
    ],
)
def test_release_title_score_cases(title, author, name, ok):
    assert (release_title_score(title, author, name) >= 70) is ok


def test_author_similarity():
    assert author_similarity("Frank Herbert", "Frank Herbert - Dune") == 100
    assert author_similarity("Frank Herbert", "Herbert, F. - Dune") == 85
    assert author_similarity("Frank Herbert", "Brian Herbert & Kevin J Anderson") == 85  # surname only
    assert author_similarity("Frank Herbert", "Isaac Asimov - Foundation") < 50


def test_same_book():
    assert same_book("Dune", "Frank Herbert", "Dune", "Herbert, Frank")
    assert same_book("The Hobbit", "J.R.R. Tolkien", "Hobbit: or There and Back Again", "J. R. R. Tolkien")
    assert not same_book("Dune", "Frank Herbert", "Dune Messiah", "Frank Herbert")
    assert not same_book("Dune", "Frank Herbert", "Dune", "Some Oneelse")


# ---------------------------------------------------------------------------- openlibrary


def test_clean_works_filters_noise_and_dedupes():
    raw = [parse_work(d) for d in fixture_json("ol_works_herbert.json")["docs"]]
    works = clean_works(raw)
    titles = [w.title for w in works]
    for expected in [
        "Dune",
        "Dune Messiah",
        "Children of Dune",
        "God Emperor of Dune",
        "Heretics of Dune",
        "Chapterhouse Dune",
        "The Dosadi Experiment",
        "Whipping Star",
    ]:
        assert expected in titles, expected
    for junk in [
        "Dune Calendar 1978",
        "Dune Coloring Book",
        "World Beyond Dune Box",
        "Dune [1/2]",
        "Dune Messiah (1 of 2)",
        "Dune Complete Series, 6 Books",
        "__None__",
    ]:
        assert junk not in titles, junk
    assert not any("Magazine" in t for t in titles)
    # "The Dragon in the Sea" and "Dragon in the Sea" are one book; "Dune" appears once
    assert sum(1 for t in titles if "Dragon in the Sea" in t) == 1
    assert titles.count("Dune") == 1
    dune = next(w for w in works if w.title == "Dune")
    assert dune.edition_count == 155 and dune.year == 1965 and dune.isbns
    assert len(works) < len(raw) * 0.75


def test_clean_works_language_filter():
    raw = [parse_work(d) for d in fixture_json("ol_works_herbert.json")["docs"]]
    german = clean_works(raw, ["ger"])
    assert german and all("ger" in w.languages for w in german)
    assert len(german) < len(clean_works(raw))
    assert clean_works(raw, ["swe"]) == []  # OpenLibrary has no Swedish Herbert editions


def test_rank_authors_prefers_exact_prolific_name():
    docs = fixture_json("ol_authors_herbert.json")["docs"]
    authors = [AuthorInfo(d["key"], d["name"], d.get("work_count", 0)) for d in docs]
    assert rank_authors("frank herbert", authors)[0].ol_key == "OL79034A"


# ---------------------------------------------------------------------------- torrent


def test_info_hash_from_torrent_matches_sha1_of_info_dict():
    import hashlib

    data = make_torrent()
    start = data.index(b"4:info") + 6
    assert info_hash_from_torrent(data) == hashlib.sha1(data[start:-1]).hexdigest()


def test_info_hash_from_magnet_hex_and_base32():
    h = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a"
    assert info_hash_from_magnet(f"magnet:?xt=urn:btih:{h.upper()}&dn=x") == h
    assert info_hash_from_magnet("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK") == h
    assert info_hash_from_magnet("magnet:?dn=nothing") is None


# ---------------------------------------------------------------------------- scoring


def _rel(title: str, size_mb: float = 2, seeders: int = 10) -> Release:
    return Release(
        guid=title,
        title=title,
        indexer="TL",
        indexer_id=1,
        size=int(size_mb * 1_048_576),
        seeders=seeders,
        leechers=0,
        download_url="http://x",
        magnet_url=None,
        info_hash=None,
        publish_date=None,
    )


SCORE_KW = dict(
    title="Dune",
    author="Frank Herbert",
    preferred_formats=["epub", "azw3", "mobi", "pdf"],
    min_seeders=1,
    max_size_mb=150,
    min_score=60,
)


def test_scoring_prefers_right_book_and_format():
    releases = [
        _rel("Frank Herbert - Dune [PDF]"),
        _rel("Frank Herbert - Dune (retail) [EPUB]"),
        _rel("Frank Herbert - Dune Messiah [EPUB]"),
        _rel("Frank Herbert - Dune [Audiobook] m4b", size_mb=600),
        _rel("Frank Herbert - Dune Complete Collection 1-6 epub", size_mb=12),
        _rel("Frank Herbert - Dune epub", seeders=0),
    ]
    ranked = rank([score_release(r, **SCORE_KW) for r in releases])
    assert ranked[0].release.title == "Frank Herbert - Dune (retail) [EPUB]"
    by_title = {s.release.title: s for s in ranked}
    assert "audiobook" in by_title["Frank Herbert - Dune [Audiobook] m4b"].reject_reason
    assert not by_title["Frank Herbert - Dune epub"].accepted  # no seeders
    pack = by_title["Frank Herbert - Dune Complete Collection 1-6 epub"]
    assert pack.score < by_title["Frank Herbert - Dune [PDF]"].score
    assert by_title["Frank Herbert - Dune [PDF]"].accepted
    assert detect_format("Herbert.Dune.AZW3") == "azw3"


def test_scoring_rejects_wrong_author():
    s = score_release(_rel("Dune - Some Other Writer epub"), **SCORE_KW)
    assert not s.accepted and "author" in s.reject_reason


def test_scoring_blocklisted():
    s = score_release(_rel("Frank Herbert - Dune epub"), **SCORE_KW, blocklisted=True)
    assert not s.accepted and s.reject_reason == "blocklisted"


def test_parse_release_skips_usenet_and_linkless():
    assert parse_release({"protocol": "usenet", "title": "x", "downloadUrl": "http://x"}) is None
    assert parse_release({"protocol": "torrent", "title": "x"}) is None
    r = parse_release(
        {
            "protocol": "torrent",
            "title": "x",
            "magnetUrl": "magnet:?",
            "infoHash": "ABC",
            "categories": [{"id": 7020, "name": "EBook"}],
        }
    )
    assert r and r.info_hash == "abc" and r.categories == [7020]


# ---------------------------------------------------------------------------- importer


def test_pick_ebook_prefers_format_and_skips_samples(tmp_path: Path):
    d = tmp_path / "Frank Herbert - Dune"
    d.mkdir()
    (d / "Dune.pdf").write_bytes(b"p" * 100)
    (d / "Dune.epub").write_bytes(b"e" * 50)
    (d / "sample.epub").write_bytes(b"s")
    (d / "cover.jpg").write_bytes(b"j")
    picked = pick_ebook(d, "Dune", "Frank Herbert", ["epub", "pdf"], tmp_path)
    assert picked.path.name == "Dune.epub"


def test_pick_ebook_from_pack_matches_title(tmp_path: Path):
    d = tmp_path / "pack"
    d.mkdir()
    for t in ["Dune", "Dune Messiah", "Children of Dune"]:
        (d / f"Frank Herbert - {t}.epub").write_bytes(b"x")
    for t in ["Dune", "Dune Messiah", "Children of Dune"]:
        assert pick_ebook(d, t, "Frank Herbert", ["epub"], tmp_path).path.name == f"Frank Herbert - {t}.epub"
    with pytest.raises(ImportError_):
        pick_ebook(d, "Foundation", "Isaac Asimov", ["epub"], tmp_path)


def test_pick_ebook_extracts_zip_and_reports_missing(tmp_path: Path):
    d = tmp_path / "zipped"
    d.mkdir()
    with zipfile.ZipFile(d / "book.zip", "w") as zf:
        zf.writestr("inner/Dune.epub", b"zz")
    work = tmp_path / "work"
    work.mkdir()
    picked = pick_ebook(d, "Dune", "Frank Herbert", ["epub"], work)
    assert picked.from_archive and picked.path.read_bytes() == b"zz"
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / "readme.nfo").write_text("x")
    with pytest.raises(ImportError_, match="no ebook"):
        pick_ebook(empty, "Dune", "Frank Herbert", ["epub"], work)


def test_deliver_copies_with_clean_name_and_no_overwrite(tmp_path: Path):
    src = tmp_path / "a.epub"
    src.write_bytes(b"book")
    ingest = tmp_path / "ingest"
    ingest.mkdir()
    from fastlibrarian.library.importer import Picked

    t1 = deliver(Picked(src, "epub"), ingest, 'Dune: "Deluxe"?', "Frank Herbert")
    t2 = deliver(Picked(src, "epub"), ingest, 'Dune: "Deluxe"?', "Frank Herbert")
    assert t1.name == "Dune Deluxe - Frank Herbert.epub"
    assert t2.name == "Dune Deluxe - Frank Herbert (1).epub"
    assert src.exists()  # copy, the seeding file is untouched


def test_map_path():
    assert map_path("/downloads/books/x", "/downloads", "/data/dl") == "/data/dl/books/x"
    assert map_path("/downloads/books/x", "", "") == "/downloads/books/x"


# ---------------------------------------------------------------------------- calibre


def test_read_calibre_library_wal(tmp_path: Path):
    lib = tmp_path / "library"
    make_calibre_db(lib, [("Dune", ["Frank Herbert"], ["9780441172719"]), ("Emma", ["Jane Austen"], [])])
    books = read_library(str(lib), tmp_path / "tmp")
    assert {b.title for b in books} == {"Dune", "Emma"}
    dune = next(b for b in books if b.title == "Dune")
    assert dune.authors == ["Frank Herbert"] and dune.isbns == ["9780441172719"]


def test_search_queries_keep_swedish_letters_then_fold():
    from fastlibrarian.services import search_queries

    assert search_queries("Män som hatar kvinnor", "Stieg Larsson") == [
        "män som hatar kvinnor larsson",
        "man som hatar kvinnor larsson",
        "män som hatar kvinnor",
        "man som hatar kvinnor",
    ]
    assert search_queries("Dune: Deluxe Edition", "Herbert, Frank")[0] == "dune herbert"
