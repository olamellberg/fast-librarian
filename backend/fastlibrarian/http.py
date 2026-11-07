"""Shared outgoing HTTP: one pooled client, per-host politeness and a small TTL cache."""

import asyncio
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from . import __version__

USER_AGENT = f"FastLibrarian/{__version__}"


class HostLimiter:
    """Allow at most one request per ``min_interval`` seconds per host."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}

    async def wait(self, host: str) -> None:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            delta = time.monotonic() - self._last.get(host, 0.0)
            if delta < self.min_interval:
                await asyncio.sleep(self.min_interval - delta)
            self._last[host] = time.monotonic()


class TTLCache:
    def __init__(self, ttl: float, max_items: int = 2000):
        self.ttl = ttl
        self.max_items = max_items
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        hit = self._data.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        self._data.pop(key, None)
        return None

    def set(self, key: str, value: Any) -> None:
        if len(self._data) >= self.max_items:
            # drop the oldest ~10 %
            for k in sorted(self._data, key=lambda k: self._data[k][0])[: self.max_items // 10]:
                del self._data[k]
        self._data[key] = (time.monotonic() + self.ttl, value)


class MetadataHttp:
    """GET-JSON helper for public metadata APIs (rate-limited, cached, retried)."""

    def __init__(self, client: httpx.AsyncClient, min_interval: float = 0.35, ttl: float = 6 * 3600):
        self.client = client
        self.limiter = HostLimiter(min_interval)
        self.cache = TTLCache(ttl)

    async def get_json(self, url: str, params: dict[str, Any] | None = None, cache: bool = True) -> Any:
        key = str(httpx.URL(url, params=params))
        if cache and (hit := self.cache.get(key)) is not None:
            return hit
        host = urlparse(url).netloc
        last_exc: Exception | None = None
        for attempt in range(3):
            await self.limiter.wait(host)
            try:
                resp = await self.client.get(url, params=params)
                if resp.status_code == 404:
                    return None
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                resp.raise_for_status()
                data = resp.json()
                if cache:
                    self.cache.set(key, data)
                return data
            except (httpx.TransportError, httpx.HTTPStatusError) as e:
                last_exc = e
                await asyncio.sleep(1.5 * (attempt + 1))
        assert last_exc is not None
        raise last_exc


def make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
