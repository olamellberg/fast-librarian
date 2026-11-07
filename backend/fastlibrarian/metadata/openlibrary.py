"""OpenLibrary metadata provider (primary source; no API key needed).

OpenLibrary's per-author work lists are noisy: magazines, calendars, colouring books, box sets,
split audio volumes and duplicate works with slightly different titles. ``clean_works`` filters
and deduplicates them so an author page shows the actual books.
"""

import math
import re
from dataclasses import dataclass, field

from ..http import MetadataHttp
from ..isbn import normalize_isbn
from ..matching import fold, norm_author, title_key

BASE = "https://openlibrary.org"
FIELDS = "key,title,subtitle,author_name,author_key,first_publish_year,isbn,cover_i,language,edition_count"
MAX_ISBNS = 40

_JUNK = re.compile(
    r"""(
        calend[ae]r | colou?ring\ book | box(ed)?[\s-]?set | boxed\b | \bbox$ | \bcollection[\s-]+\d |
        \b\d+\s+books\b | complete\ series | \bvolume\ [\divxl]+,\ no\b | magazine | \banalog\b.*\d{4} |
        \(\d\ of\ \d\) | \[\d/\d\] | sparknotes | cliffsnotes | study\ guide | cassette |
        \baudio\ collection | tie[\s-]?in\ \d | \d+m(x|f)(pk|fl) | ^__none__$ | \bbd\.\s*\d
    )""",
    re.IGNORECASE | re.VERBOSE,
)


@dataclass
class WorkInfo:
    ol_work_key: str
    title: str
    subtitle: str | None
    author_name: str | None
    author_key: str | None
    year: int | None
    cover_id: int | None
    isbns: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    edition_count: int = 0


@dataclass
class AuthorInfo:
    ol_key: str
    name: str
    work_count: int = 0
    top_work: str | None = None
    birth_date: str | None = None
    bio: str | None = None
    photo_url: str | None = None


def _strip_key(key: str) -> str:
    return key.rsplit("/", 1)[-1]


def _isbn13s(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    for r in raw or []:
        n = normalize_isbn(r)
        if n and n not in out:
            out.append(n)
    # prefer 978/979 English-group-agnostic ordering: keep OL's order, cap the list
    return out[:MAX_ISBNS]


def _sane_year(y: object) -> int | None:
    return y if isinstance(y, int) and 1450 <= y <= 2100 else None


def parse_work(doc: dict) -> WorkInfo:
    return WorkInfo(
        ol_work_key=_strip_key(doc["key"]),
        title=doc.get("title") or "",
        subtitle=doc.get("subtitle"),
        author_name=(doc.get("author_name") or [None])[0],
        author_key=(doc.get("author_key") or [None])[0],
        year=_sane_year(doc.get("first_publish_year")),
        cover_id=doc.get("cover_i"),
        isbns=_isbn13s(doc.get("isbn")),
        languages=list(doc.get("language") or []),
        edition_count=int(doc.get("edition_count") or 0),
    )


def is_junk(work: WorkInfo) -> bool:
    return work.edition_count == 0 or not work.title.strip() or bool(_JUNK.search(work.title))


def clean_works(works: list[WorkInfo], languages: list[str] | None = None) -> list[WorkInfo]:
    """Drop junk, apply the language filter, merge duplicate titles (keep the most-published)."""
    langs = set(languages or [])
    best: dict[str, WorkInfo] = {}
    for w in works:
        if is_junk(w):
            continue
        if langs and not (langs & set(w.languages)):
            continue
        k = title_key(w.title)
        if not k:
            continue
        cur = best.get(k)
        if cur is None or w.edition_count > cur.edition_count:
            if cur is not None:  # keep the earliest year and union of ISBNs
                w.year = min(filter(None, [w.year, cur.year]), default=None)
                w.isbns = (w.isbns + [i for i in cur.isbns if i not in w.isbns])[:MAX_ISBNS]
            best[k] = w
        else:
            cur.year = min(filter(None, [w.year, cur.year]), default=None)
    return sorted(best.values(), key=lambda w: (w.year or 9999, w.title))


def rank_authors(query: str, authors: list[AuthorInfo]) -> list[AuthorInfo]:
    """OpenLibrary's relevance order is poor for authors; prefer exact names with many works."""
    q = norm_author(query)

    def score(a: AuthorInfo) -> float:
        n = norm_author(a.name)
        exact = 3.0 if n == q else (1.5 if q in n else 0.0)
        return exact + math.log1p(a.work_count)

    return sorted(authors, key=score, reverse=True)


def author_photo(ol_key: str) -> str:
    # default=false makes OpenLibrary return 404 (not a 1x1 GIF) when there is no photo
    return f"https://covers.openlibrary.org/a/olid/{ol_key}-M.jpg?default=false"


def cover_url(cover_id: int | None, size: str = "M") -> str | None:
    return f"https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg" if cover_id else None


class OpenLibrary:
    def __init__(self, http: MetadataHttp):
        self.http = http

    async def search_works(self, query: str, limit: int = 20) -> list[WorkInfo]:
        data = await self.http.get_json(f"{BASE}/search.json", {"q": query, "fields": FIELDS, "limit": limit})
        works = [parse_work(d) for d in (data or {}).get("docs", [])]
        return [w for w in works if not is_junk(w)]

    async def search_authors(self, query: str, limit: int = 10) -> list[AuthorInfo]:
        data = await self.http.get_json(f"{BASE}/search/authors.json", {"q": query, "limit": 25})
        authors = [
            AuthorInfo(
                ol_key=d["key"],
                name=d.get("name", ""),
                work_count=int(d.get("work_count") or 0),
                top_work=d.get("top_work"),
                birth_date=d.get("birth_date"),
                photo_url=author_photo(d["key"]),
            )
            for d in (data or {}).get("docs", [])
            if d.get("name")
        ]
        return rank_authors(query, authors)[:limit]

    async def get_author(self, ol_key: str) -> AuthorInfo | None:
        d = await self.http.get_json(f"{BASE}/authors/{ol_key}.json")
        if not d:
            return None
        bio = d.get("bio")
        if isinstance(bio, dict):
            bio = bio.get("value")
        photos = [p for p in d.get("photos") or [] if isinstance(p, int) and p > 0]
        return AuthorInfo(
            ol_key=ol_key,
            name=d.get("name") or d.get("personal_name") or ol_key,
            birth_date=d.get("birth_date"),
            bio=bio,
            photo_url=f"https://covers.openlibrary.org/a/id/{photos[0]}-M.jpg"
            if photos
            else author_photo(ol_key),
        )

    async def author_works(self, ol_key: str, cache: bool = False) -> list[WorkInfo]:
        """All works by the author (raw; run through ``clean_works``)."""
        works: list[WorkInfo] = []
        page = 1
        while True:
            data = await self.http.get_json(
                f"{BASE}/search.json",
                {"author_key": ol_key, "fields": FIELDS, "limit": 500, "page": page, "sort": "old"},
                cache=cache,
            )
            docs = (data or {}).get("docs", [])
            works += [parse_work(d) for d in docs]
            if len(docs) < 500 or page >= 10:
                return works
            page += 1

    async def get_work(self, ol_work_key: str) -> WorkInfo | None:
        data = await self.http.get_json(
            f"{BASE}/search.json", {"q": f"key:/works/{ol_work_key}", "fields": FIELDS, "limit": 1}
        )
        docs = (data or {}).get("docs", [])
        return parse_work(docs[0]) if docs else None

    async def by_isbn(self, isbn13: str) -> WorkInfo | None:
        data = await self.http.get_json(f"{BASE}/search.json", {"isbn": isbn13, "fields": FIELDS})
        docs = (data or {}).get("docs", [])
        if docs:
            return parse_work(docs[0])
        # The search index lags behind; the edition endpoint often knows newer ISBNs.
        ed = await self.http.get_json(f"{BASE}/isbn/{isbn13}.json")
        works = (ed or {}).get("works") or []
        if not works:
            return None
        return await self.get_work(_strip_key(works[0]["key"]))

    async def find_work(self, title: str, author: str) -> WorkInfo | None:
        data = await self.http.get_json(
            f"{BASE}/search.json", {"title": title, "author": author, "fields": FIELDS, "limit": 5}
        )
        docs = [parse_work(d) for d in (data or {}).get("docs", [])]
        want = title_key(title)
        for w in docs:
            if title_key(w.title) == want:
                return w
        return docs[0] if docs and fold(docs[0].title).startswith(fold(title)[:10]) else None
