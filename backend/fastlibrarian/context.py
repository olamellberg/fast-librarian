"""Application context: the long-lived objects shared by API handlers and background jobs."""

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from .appsettings import AppSettings, load_settings
from .clients.qbittorrent import QBittorrent
from .db import Database
from .env import Env
from .http import MetadataHttp
from .indexers.prowlarr import Prowlarr
from .metadata.googlebooks import GoogleBooks
from .metadata.openlibrary import OpenLibrary


@dataclass
class AppContext:
    env: Env
    db: Database
    http: httpx.AsyncClient  # for our own services (Prowlarr, qBittorrent)
    meta_http: MetadataHttp  # for public metadata APIs
    wake: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def tmp_dir(self) -> Path:
        return self.env.config_dir / "tmp"

    @property
    def openlibrary(self) -> OpenLibrary:
        return OpenLibrary(self.meta_http)

    def googlebooks(self, s: AppSettings) -> GoogleBooks | None:
        return GoogleBooks(self.meta_http, s.google_books_api_key) if s.google_books_api_key else None

    def prowlarr(self, s: AppSettings) -> Prowlarr:
        return Prowlarr(self.http, s.prowlarr_url, s.prowlarr_api_key)

    def qbit(self, s: AppSettings) -> QBittorrent:
        return QBittorrent(self.http, s.qbit_url, s.qbit_username, s.qbit_password)

    async def settings(self, session: AsyncSession | None = None) -> AppSettings:
        if session is not None:
            return await load_settings(session)
        async with self.db.sessionmaker() as s:
            return await load_settings(s)
