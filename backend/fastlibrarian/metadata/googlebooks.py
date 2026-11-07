"""Google Books – optional ISBN fallback. Only used when an API key is configured, because the
shared anonymous quota is routinely exhausted (HTTP 429)."""

from dataclasses import dataclass

from ..http import MetadataHttp

BASE = "https://www.googleapis.com/books/v1/volumes"


@dataclass
class GBVolume:
    title: str
    authors: list[str]


class GoogleBooks:
    def __init__(self, http: MetadataHttp, api_key: str):
        self.http = http
        self.api_key = api_key

    async def by_isbn(self, isbn13: str) -> GBVolume | None:
        data = await self.http.get_json(BASE, {"q": f"isbn:{isbn13}", "key": self.api_key})
        for item in (data or {}).get("items", []):
            info = item.get("volumeInfo", {})
            if info.get("title"):
                return GBVolume(title=info["title"], authors=info.get("authors") or [])
        return None
