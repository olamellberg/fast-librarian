"""Read-only view of the Calibre library that Calibre-Web Automated maintains.

The library's ``metadata.db`` runs in WAL mode and is written by CWA. To never interfere with it
(and to work with a read-only mount) we copy the db + WAL to a scratch dir and read the copy.
"""

import shutil
import sqlite3
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


class CalibreError(RuntimeError):
    pass


@dataclass
class CalibreBook:
    id: int
    title: str
    authors: list[str]
    isbns: list[str] = field(default_factory=list)


def read_library(library_dir: str, tmp_root: Path) -> list[CalibreBook]:
    db = Path(library_dir) / "metadata.db"
    if not db.is_file():
        raise CalibreError(f"no metadata.db in {library_dir}")
    tmp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tmp_root) as work:
        copy = Path(work) / "metadata.db"
        shutil.copyfile(db, copy)
        wal = db.with_name("metadata.db-wal")
        if wal.is_file():
            shutil.copyfile(wal, copy.with_name("metadata.db-wal"))
        con = sqlite3.connect(copy)
        try:
            books = {
                bid: CalibreBook(bid, title, []) for bid, title in con.execute("SELECT id, title FROM books")
            }
            for bid, name in con.execute(
                "SELECT l.book, a.name FROM books_authors_link l JOIN authors a ON a.id = l.author "
                "ORDER BY l.id"
            ):
                if bid in books:
                    books[bid].authors.append(name)
            for bid, val in con.execute(
                "SELECT book, val FROM identifiers WHERE type IN ('isbn', 'isbn13', 'isbn10')"
            ):
                if bid in books:
                    books[bid].isbns.append(val)
        except sqlite3.DatabaseError as e:
            raise CalibreError(f"cannot read Calibre library: {e}") from e
        finally:
            con.close()
    return list(books.values())
