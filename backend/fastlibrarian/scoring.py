"""Release scoring: how likely is this release the ebook we want, and how good is it?

Every score comes with a human-readable breakdown so the UI can show *why* a release won.
"""

import re
from dataclasses import dataclass, field

from .indexers.prowlarr import Release
from .matching import author_similarity, fold, other_book_in_release, release_title_score

FORMATS = ("epub", "azw3", "mobi", "pdf", "azw", "fb2", "cbz", "djvu")
_AUDIO = re.compile(r"\b(audiobook|audio book|m4b|mp3|flac|unabridged|narrated|read by|aac|ogg)\b")
_PACK = re.compile(
    r"\b(collection|complete|anthology|omnibus|bundle|pack|series|trilogy|duology|saga|box set"
    r"|books? \d+\s*-\s*\d+|\d+ books)\b"
)
_RETAIL = re.compile(r"\bretail\b")


@dataclass
class Scored:
    release: Release
    score: float
    accepted: bool
    format: str | None
    details: dict[str, float | str] = field(default_factory=dict)
    reject_reason: str | None = None


def detect_format(title: str) -> str | None:
    f = fold(title)
    for fmt in FORMATS:
        if re.search(rf"\b{fmt}\b", f):
            return fmt
    return None


def score_release(
    release: Release,
    *,
    title: str,
    author: str,
    preferred_formats: list[str],
    min_seeders: int,
    max_size_mb: int,
    min_score: float,
    blocklisted: bool = False,
    other_titles: list[str] | None = None,
) -> Scored:
    """Score one release. ``other_titles`` = the author's other books, used to tell a sequel
    ("Dune Messiah") from the wanted book ("Dune") when the name contains both."""
    name = fold(release.title)
    d: dict[str, float | str] = {}
    reject: str | None = None

    t = release_title_score(title, author, release.title)
    a = author_similarity(author, release.title, title)
    d["title"] = round(t, 1)
    d["author"] = round(a, 1)
    # Title is what matters most; author confirms it.
    score = 0.65 * t + 0.35 * a

    fmt = detect_format(release.title)
    if fmt and fmt in preferred_formats:
        bonus = 10 - 2.5 * preferred_formats.index(fmt)
        d["format"] = f"{fmt} (+{bonus:g})"
        score += bonus
    elif fmt:
        d["format"] = f"{fmt} (not preferred)"
        reject = reject or f"format {fmt} is not in the preferred formats"
    else:
        d["format"] = "unknown"

    if _RETAIL.search(name):
        score += 3
        d["retail"] = "+3"

    # Newznab/Torznab category 3000–3999 = Audio (3030 = Audiobook)
    if _AUDIO.search(name) or any(3000 <= c < 4000 for c in release.categories or []):
        reject = reject or "looks like an audiobook"
    if _PACK.search(name) and not _PACK.search(fold(title)):
        score -= 15
        d["pack"] = "-15 (collection/pack)"

    size_mb = release.size / 1_048_576 if release.size else 0
    d["size_mb"] = round(size_mb, 1)
    if size_mb > max_size_mb:
        reject = reject or f"too large ({size_mb:.0f} MB > {max_size_mb} MB)"

    d["seeders"] = release.seeders
    if release.seeders < min_seeders:
        reject = reject or f"too few seeders ({release.seeders})"
    else:
        score += min(release.seeders, 50) / 10  # up to +5

    if a < 50:
        reject = reject or f"author not found in release name ({a:.0f})"
    elif t < 70:
        reject = reject or f"title does not match ({t:.0f})"
    elif other := other_book_in_release(title, author, release.title, other_titles or []):
        d["other_book"] = other
        reject = reject or f"looks like another book: {other}"

    if blocklisted:
        reject = "blocklisted"

    score = round(score, 1)
    if reject is None and score < min_score:
        reject = f"score {score} below minimum {min_score:g}"
    return Scored(release, score, reject is None, fmt, d, reject)


def rank(scored: list[Scored]) -> list[Scored]:
    return sorted(scored, key=lambda s: (s.accepted, s.score), reverse=True)
