"""Pick the ebook out of a finished download and hand it to Calibre-Web Automated's ingest folder."""

import os
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from ..matching import release_title_score

EBOOK_EXTS = ("epub", "azw3", "mobi", "pdf", "azw", "fb2", "djvu", "cbz", "cbr")
_SAMPLE = re.compile(r"\bsample\b", re.I)
_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class ImportError_(RuntimeError):
    pass


@dataclass
class Picked:
    path: Path
    ext: str
    from_archive: bool = False


def map_path(path: str, src: str, dst: str) -> str:
    """Apply a remote→local path mapping (prefix replace)."""
    if src and path.startswith(src):
        return dst.rstrip("/") + "/" + path[len(src) :].lstrip("/")
    return path


def _ext(p: Path) -> str:
    return p.suffix.lower().lstrip(".")


def _candidates(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    return [p for p in root.rglob("*") if p.is_file()]


def pick_ebook(root: Path, title: str, author: str, preferred: list[str], workdir: Path) -> Picked:
    """Find the best ebook file under ``root``. Zip archives are extracted into ``workdir``."""
    if not root.exists():
        raise ImportError_(f"download path not found: {root} (check the qBittorrent path mapping)")
    files = _candidates(root)
    ebooks = [p for p in files if _ext(p) in EBOOK_EXTS and not _SAMPLE.search(p.name)]
    from_archive = False
    if not ebooks:
        for z in (p for p in files if _ext(p) == "zip"):
            with zipfile.ZipFile(z) as zf:
                for member in zf.namelist():
                    mp = Path(member)
                    if _ext(mp) in EBOOK_EXTS and not member.endswith("/") and ".." not in mp.parts:
                        target = workdir / mp.name
                        with zf.open(member) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        ebooks.append(target)
        from_archive = bool(ebooks)
    if not ebooks:
        kinds = sorted({_ext(p) for p in files if _ext(p)})
        raise ImportError_(f"no ebook file in download (found: {', '.join(kinds) or 'nothing'})")

    order = [f for f in preferred if f in EBOOK_EXTS] + [f for f in EBOOK_EXTS if f not in preferred]

    def key(p: Path) -> tuple[float, int, int]:
        match = release_title_score(title, author, p.stem) if len(ebooks) > 1 else 100.0
        return (-match, order.index(_ext(p)), -p.stat().st_size)

    best = sorted(ebooks, key=key)[0]
    if len(ebooks) > 1 and release_title_score(title, author, best.stem) < 60:
        raise ImportError_(f"download has {len(ebooks)} ebooks but none matches '{title}'")
    return Picked(best, _ext(best), from_archive)


def safe_name(text: str, limit: int = 120) -> str:
    text = _BAD_CHARS.sub("", text).strip().strip(".")
    return re.sub(r"\s+", " ", text)[:limit] or "book"


def deliver(picked: Picked, ingest_dir: Path, title: str, author: str, mode: str = "copy") -> Path:
    """Copy (or hardlink) the ebook into the ingest folder as "Title - Author.ext".

    Copy is the default: CWA may modify files it ingests, and a hardlink would then alter the
    file qBittorrent is still seeding.
    """
    if not ingest_dir.is_dir():
        raise ImportError_(f"ingest folder does not exist: {ingest_dir}")
    target = ingest_dir / f"{safe_name(title)} - {safe_name(author, 80)}.{picked.ext}"
    n = 1
    while target.exists():
        target = ingest_dir / f"{safe_name(title)} - {safe_name(author, 80)} ({n}).{picked.ext}"
        n += 1
    if mode == "hardlink" and not picked.from_archive:
        try:
            os.link(picked.path, target)
            return target
        except OSError:
            pass  # different filesystem – fall back to copying
    shutil.copyfile(picked.path, target)
    return target


def import_download(
    content_path: str,
    *,
    title: str,
    author: str,
    preferred: list[str],
    ingest_dir: str,
    mode: str,
    tmp_root: Path,
) -> Path:
    tmp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tmp_root) as work:
        picked = pick_ebook(Path(content_path), title, author, preferred, Path(work))
        return deliver(picked, Path(ingest_dir), title, author, mode)
