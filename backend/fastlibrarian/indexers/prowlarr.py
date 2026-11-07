"""Prowlarr search API (searches all configured indexers in one call)."""

from dataclasses import dataclass, field
from typing import Any

import httpx


class ProwlarrError(RuntimeError):
    pass


class ProwlarrNotConfigured(ProwlarrError):
    pass


@dataclass
class Release:
    guid: str
    title: str
    indexer: str
    indexer_id: int | None
    size: int
    seeders: int
    leechers: int
    download_url: str | None
    magnet_url: str | None
    info_hash: str | None
    publish_date: str | None
    categories: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Release":
        return cls(**{k: d.get(k) for k in cls.__dataclass_fields__})  # type: ignore[arg-type]


def parse_release(item: dict[str, Any]) -> Release | None:
    if item.get("protocol", "torrent") != "torrent":
        return None
    if not (item.get("downloadUrl") or item.get("magnetUrl")):
        return None
    return Release(
        guid=str(item.get("guid") or item.get("downloadUrl") or item.get("magnetUrl")),
        title=item.get("title") or "",
        indexer=item.get("indexer") or "",
        indexer_id=item.get("indexerId"),
        size=int(item.get("size") or 0),
        seeders=int(item.get("seeders") or 0),
        leechers=int(item.get("leechers") or 0),
        download_url=item.get("downloadUrl"),
        magnet_url=item.get("magnetUrl"),
        info_hash=(item.get("infoHash") or None) and str(item["infoHash"]).lower(),
        publish_date=item.get("publishDate"),
        categories=[c["id"] for c in item.get("categories") or [] if isinstance(c, dict) and "id" in c],
    )


class Prowlarr:
    def __init__(self, client: httpx.AsyncClient, url: str, api_key: str):
        if not url or not api_key:
            raise ProwlarrNotConfigured("Prowlarr is not configured (Settings → Prowlarr)")
        self.client = client
        self.url = url.rstrip("/")
        self.headers = {"X-Api-Key": api_key}

    async def _get(self, path: str, params: Any = None, wait: float = 30) -> Any:
        try:
            r = await self.client.get(f"{self.url}{path}", params=params, headers=self.headers, timeout=wait)
        except httpx.TransportError as e:
            raise ProwlarrError(f"Cannot reach Prowlarr at {self.url}: {e}") from e
        if r.status_code == 401:
            raise ProwlarrError("Prowlarr rejected the API key")
        if r.status_code >= 400:
            raise ProwlarrError(f"Prowlarr returned HTTP {r.status_code}: {r.text[:200]}")
        return r.json()

    async def test(self) -> str:
        status = await self._get("/api/v1/system/status")
        indexers = await self._get("/api/v1/indexer")
        enabled = [i["name"] for i in indexers if i.get("enable")]
        return (
            f"Prowlarr {status.get('version', '?')}, {len(enabled)} enabled indexer(s): {', '.join(enabled)}"
        )

    async def search(
        self, query: str, categories: list[int], indexer_ids: list[int] | None = None
    ) -> list[Release]:
        params: list[tuple[str, str | int]] = [("query", query), ("type", "search"), ("limit", 100)]
        params += [("categories", c) for c in categories]
        params += [("indexerIds", i) for i in indexer_ids or []]
        data = await self._get("/api/v1/search", params, wait=90)
        return [r for r in (parse_release(i) for i in data or []) if r]

    async def fetch_torrent(self, url: str) -> tuple[bytes | None, str | None]:
        """Resolve a Prowlarr download link: returns (torrent bytes, None) or (None, magnet)."""
        try:
            r = await self.client.get(url, headers=self.headers, follow_redirects=False, timeout=60)
            hops = 0
            while r.is_redirect and hops < 5:
                loc = r.headers.get("location", "")
                if loc.startswith("magnet:"):
                    return None, loc
                r = await self.client.get(loc, follow_redirects=False, timeout=60)
                hops += 1
        except httpx.TransportError as e:
            raise ProwlarrError(f"Download link failed: {e}") from e
        if r.status_code >= 400:
            raise ProwlarrError(f"Download link returned HTTP {r.status_code}")
        if r.content[:1] != b"d":
            raise ProwlarrError("Download link did not return a .torrent file")
        return r.content, None
