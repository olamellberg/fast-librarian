"""User-editable settings, stored as one JSON document in the ``settings`` table."""

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Setting

SETTINGS_KEY = "app"
SECRET_FIELDS = ("prowlarr_api_key", "qbit_password", "google_books_api_key")
MASK = "********"


class AppSettings(BaseModel):
    # Prowlarr
    prowlarr_url: str = ""
    prowlarr_api_key: str = ""
    prowlarr_categories: list[int] = Field(default_factory=lambda: [7000, 7020])  # Books, Books/EBook
    prowlarr_indexer_ids: list[int] = Field(default_factory=list)  # empty = all enabled indexers

    # qBittorrent
    qbit_url: str = ""
    qbit_username: str = ""
    qbit_password: str = ""
    qbit_category: str = "books"
    # Optional path mapping when qBittorrent sees downloads under a different path than we do.
    qbit_path_from: str = ""
    qbit_path_to: str = ""

    # Delivery to Calibre-Web Automated
    ingest_dir: str = "/cwa-book-ingest"
    calibre_library_dir: str = "/calibre-library"
    import_mode: str = "copy"  # copy | hardlink

    # Metadata
    google_books_api_key: str = ""  # optional ISBN fallback

    # Search / matching
    preferred_formats: list[str] = Field(default_factory=lambda: ["epub", "azw3", "mobi", "pdf"])
    languages: list[str] = Field(default_factory=list)  # OpenLibrary 3-letter codes; empty = all
    min_seeders: int = 1
    min_score: float = 60.0
    max_size_mb: int = 150

    # Scheduling
    author_refresh_hours: int = 24
    calibre_sync_minutes: int = 10

    def masked(self) -> dict:
        data = self.model_dump()
        for f in SECRET_FIELDS:
            if data[f]:
                data[f] = MASK
        return data


async def load_settings(session: AsyncSession) -> AppSettings:
    row = await session.get(Setting, SETTINGS_KEY)
    return AppSettings.model_validate(row.value) if row else AppSettings()


async def save_settings(session: AsyncSession, new: dict) -> AppSettings:
    """Merge ``new`` into stored settings. Masked secrets are kept as-is."""
    current = await load_settings(session)
    data = current.model_dump()
    for k, v in new.items():
        if k in SECRET_FIELDS and v == MASK:
            continue
        if k in data:
            data[k] = v
    validated = AppSettings.model_validate(data)
    row = await session.get(Setting, SETTINGS_KEY)
    if row:
        row.value = validated.model_dump()
    else:
        session.add(Setting(key=SETTINGS_KEY, value=validated.model_dump()))
    await session.commit()
    return validated
