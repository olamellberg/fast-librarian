"""ORM models.

The book model carries a ``format`` dimension on downloads so audiobooks can be added later,
but v1 only deals with ebooks.
"""

import enum
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC in SQLite, always returns timezone-aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=UTC) if value is not None else None


def db_now() -> str:
    """``utcnow()`` in the exact text format SQLite columns use (for raw SQL comparisons)."""
    return utcnow().replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")


class BookStatus(enum.StrEnum):
    NONE = "none"  # known, not chosen
    WANTED = "wanted"  # chosen, waiting for search/grab
    DOWNLOADING = "downloading"  # handed to qBittorrent
    SENT = "sent"  # copied to the CWA ingest folder
    HAVE = "have"  # found in the Calibre library
    FAILED = "failed"  # no usable release / import failed


class DownloadState(enum.StrEnum):
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    IMPORTED = "imported"
    FAILED = "failed"


class JobStatus(enum.StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


def _enum(e: type[enum.Enum]) -> Enum:
    return Enum(e, native_enum=False, length=20, values_callable=lambda x: [m.value for m in x])


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


class Author(Base):
    __tablename__ = "authors"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    ol_key: Mapped[str | None] = mapped_column(String(50), unique=True)  # e.g. OL23919A
    bio: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(String(500))
    birth_date: Mapped[str | None] = mapped_column(String(50))
    # True = added to the library on purpose (titles are fetched + refreshed).
    # False = only created because a single book of theirs was added.
    monitored: Mapped[bool] = mapped_column(Boolean, default=True)
    added_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    refreshed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    books: Mapped[list["Book"]] = relationship(back_populates="author", cascade="all, delete-orphan")


class Book(Base):
    __tablename__ = "books"
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500), index=True)
    subtitle: Mapped[str | None] = mapped_column(String(500))
    ol_work_key: Mapped[str | None] = mapped_column(String(50), unique=True)  # e.g. OL45804W
    isbn: Mapped[str | None] = mapped_column(String(13), index=True)  # a representative ISBN-13
    isbns: Mapped[list[str]] = mapped_column(JSON, default=list)  # known ISBN-13s (capped)
    languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    year: Mapped[int | None] = mapped_column(Integer)
    cover_id: Mapped[int | None] = mapped_column(Integer)  # OpenLibrary cover id
    edition_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[BookStatus] = mapped_column(_enum(BookStatus), default=BookStatus.NONE, index=True)
    status_message: Mapped[str | None] = mapped_column(String(500))
    calibre_id: Mapped[int | None] = mapped_column(Integer)
    added_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)

    author: Mapped[Author] = relationship(back_populates="books")
    downloads: Mapped[list["Download"]] = relationship(back_populates="book", cascade="all, delete-orphan")


class Download(Base):
    __tablename__ = "downloads"
    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(20), default="ebook")
    release_title: Mapped[str] = mapped_column(String(1000))
    indexer: Mapped[str | None] = mapped_column(String(200))
    guid: Mapped[str] = mapped_column(String(1000))
    info_hash: Mapped[str | None] = mapped_column(String(40), index=True)
    size: Mapped[int | None] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(default=0)
    score_details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    state: Mapped[DownloadState] = mapped_column(
        _enum(DownloadState), default=DownloadState.DOWNLOADING, index=True
    )
    progress: Mapped[float] = mapped_column(default=0)
    message: Mapped[str | None] = mapped_column(String(1000))
    imported_file: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    book: Mapped[Book] = relationship(back_populates="downloads")


class Blocklist(Base):
    """Releases that turned out bad for a book; never grabbed again for that book."""

    __tablename__ = "blocklist"
    __table_args__ = (UniqueConstraint("book_id", "guid"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    guid: Mapped[str] = mapped_column(String(1000))
    reason: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    # Deduplication key: at most one pending/running job per key.
    key: Mapped[str] = mapped_column(String(200), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus), default=JobStatus.PENDING, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    run_after: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
