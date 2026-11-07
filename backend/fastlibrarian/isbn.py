"""ISBN detection, validation and normalisation."""

import re

_STRIP = re.compile(r"[\s\-]")


def _isbn10_ok(s: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", s):
        return False
    total = sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(s))
    return total % 11 == 0


def _isbn13_ok(s: str) -> bool:
    if not re.fullmatch(r"\d{13}", s):
        return False
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s[:12]))
    return (10 - total % 10) % 10 == int(s[12])


def to_isbn13(isbn10: str) -> str:
    core = "978" + isbn10[:9]
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(core))
    return core + str((10 - total % 10) % 10)


def normalize_isbn(text: str) -> str | None:
    """Return a valid ISBN-13 for ``text`` (ISBN-10 or -13, with/without dashes), else None."""
    s = _STRIP.sub("", text.strip()).upper()
    if s.startswith("ISBN"):
        s = s[4:].lstrip(":")
    if _isbn13_ok(s):
        return s
    if _isbn10_ok(s):
        return to_isbn13(s)
    return None
