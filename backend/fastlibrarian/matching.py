"""Text normalisation and fuzzy matching – the single place where "is this the same book?" lives."""

import re
import unicodedata

from rapidfuzz import fuzz

_ARTICLES = {"the", "a", "an"}
_NON_ALNUM = re.compile(r"[^0-9a-z]+")
# "Title: A Novel", "Title (Book 3)", "Title [Series #2]"
_SUBTITLE_SPLIT = re.compile(r"\s*[:(\[]\s*")
_NOISE = re.compile(r"\b(a novel|roman|novel)\b")


def fold(text: str) -> str:
    """Lowercase, strip accents, collapse punctuation to single spaces. ``&`` becomes ``and``."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ").replace("'", "")
    return _NON_ALNUM.sub(" ", text).strip()


def norm_title(title: str, drop_subtitle: bool = True) -> str:
    if drop_subtitle:
        title = _SUBTITLE_SPLIT.split(title, maxsplit=1)[0]
    words = fold(title).split()
    if words and words[0] in _ARTICLES and len(words) > 1:
        words = words[1:]
    return _NOISE.sub("", " ".join(words)).strip()


def norm_author(name: str) -> str:
    """ "Tolkien, J. R. R." -> "j r r tolkien"."""
    if "," in name:
        last, _, first = name.partition(",")
        name = f"{first} {last}"
    return fold(name)


def title_key(title: str) -> str:
    """Key used to deduplicate works with the same title by the same author."""
    return norm_title(title).replace(" ", "")


# Words that say nothing about *which* book a release is. Dropped from a release name unless they
# are part of the wanted title itself.
_FILLER = {
    "epub", "mobi", "azw3", "azw", "kfx", "pdf", "fb2", "djvu", "cbz", "cbr", "txt", "rtf",
    "ebook", "ebooks", "e", "book", "bk", "retail", "by", "edition", "ed", "deluxe", "anniversary",
    "illustrated", "unabridged", "special", "expanded", "revised", "collectors", "collector",
    "novel", "roman", "a", "an", "the", "and", "vol", "volume", "english", "eng", "swedish", "svenska",
    "us", "uk", "v", "true", "scan", "ocr", "converted", "repack", "original",
}  # fmt: skip
# Scene-style group suffix: "...EPUB eBook-BitBook" / "...Retail.ePub-LiBRiCiDE"
_GROUP_SUFFIX = re.compile(r"(?i)(e-?books?|epub|mobi|azw3|pdf|retail)[-_.]([a-z0-9]+)\s*$")
_BRACKETS = re.compile(r"[\[({][^\])}]*[\])}]")
# "Title - The Empyrean (#3) - Author", "Title, Crescent City (03) by Author": a segment split off by
# a dash, comma or semicolon that carries a series number (#3, Book 2, Vol 1, (03) – not a year).
_SEGMENT_SPLIT = re.compile(r"\s+[-–—]\s+|\s*[,;]\s+")
_SERIES_MARK = re.compile(r"(?i)#\s*\d|\b(book|bk|vol(ume)?|part|nr|no)\.?\s*\d|\(\s*\d{1,3}\s*\)")


def _drop_series_segments(name: str, keep: set[str]) -> str:
    """Remove dash-separated series segments ("The Empyrean (#3)") unless they hold the title."""
    parts = _SEGMENT_SPLIT.split(name)
    if len(parts) < 2:
        return name

    def is_series(part: str) -> bool:
        return bool(_SERIES_MARK.search(part)) and not keep <= set(fold(_BRACKETS.sub(" ", part)).split())

    kept = [p for p in parts if not is_series(p)]
    return " - ".join(kept) if kept else name


EXTRA_WORD_PENALTY = 35.0


def _strip_author(tokens: list[str], author: str, keep: set[str]) -> list[str]:
    """Remove the author's name (full, reversed or surname only) once from ``tokens``.

    When the name comes *after* the title ("Title - Author-uploader", "Title by Author EPUB"),
    whatever follows it is uploader/format noise and is dropped too.
    """
    a = norm_author(author).split()
    if not a:
        return tokens
    for seq in (a, a[::-1], a[-1:]):
        if set(seq) & keep:
            continue
        n = len(seq)
        for i in range(len(tokens) - n + 1):
            if tokens[i : i + n] == seq:
                before, after = tokens[:i], tokens[i + n :]
                title_first = bool(set(before) & keep)
                return before if title_first else before + after
    return tokens


def _contains(seq: list[str], sub: list[str]) -> bool:
    n = len(sub)
    return any(seq[i : i + n] == sub for i in range(len(seq) - n + 1))


def release_title_score(title: str, author: str, name: str) -> float:
    """How well a release/file ``name`` is *exactly* the wanted book, 0–100.

    The author, format tags, years, brackets and group names are removed; whatever remains must
    be the title. Remaining extra words are penalised, so "Dune Messiah" does not match "Dune".
    """
    wanted = [t for t in norm_title(title).split() if t not in _ARTICLES]
    if not wanted:
        return 0.0
    keep = set(wanted)
    name = _GROUP_SUFFIX.sub(r"\1", name)
    name = _drop_series_segments(name, keep)
    name = _BRACKETS.sub(" ", name)
    tokens = _strip_author(fold(name).split(), author, keep)
    rest = [t for t in tokens if t in keep or not (t in _FILLER or t in _ARTICLES or t.isdigit())]
    if not rest:
        return 0.0
    if _contains(rest, wanted):
        return max(0.0, 100.0 - EXTRA_WORD_PENALTY * (len(rest) - len(wanted)))
    return float(fuzz.ratio(" ".join(wanted), " ".join(rest)))


def author_similarity(author: str, candidate: str) -> float:
    """How well ``candidate`` contains the author's name; surname carries most weight."""
    a, c = norm_author(author), fold(candidate)
    if not a or not c:
        return 0.0
    parts = a.split()
    surname = parts[-1]
    if not re.search(rf"\b{re.escape(surname)}\b", c):
        return float(fuzz.partial_ratio(a, c)) * 0.6
    if re.search(rf"\b{re.escape(a)}\b", c):
        return 100.0
    return 85.0


def same_book(title_a: str, author_a: str, title_b: str, author_b: str) -> bool:
    """Strict comparison of two structured records (e.g. our DB vs Calibre)."""
    ta, tb = norm_title(title_a), norm_title(title_b)
    if not ta or not tb:
        return False
    title_ok = ta == tb or fuzz.ratio(ta, tb) >= 92
    if not title_ok:
        return False
    sa, sb = norm_author(author_a).split(), norm_author(author_b).split()
    return bool(sa and sb and sa[-1] == sb[-1]) or fuzz.token_set_ratio(" ".join(sa), " ".join(sb)) >= 90
