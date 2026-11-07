"""qBittorrent Web API v2 client (login optional – subnet whitelisting is common)."""

from dataclasses import dataclass
from typing import Any

import httpx

DONE_STATES = {"uploading", "stalledUP", "pausedUP", "stoppedUP", "queuedUP", "forcedUP", "checkingUP"}
ERROR_STATES = {"error", "missingFiles"}


class QBitError(RuntimeError):
    pass


class QBitNotConfigured(QBitError):
    pass


@dataclass
class TorrentStatus:
    hash: str
    name: str
    state: str
    progress: float
    content_path: str
    save_path: str

    @property
    def done(self) -> bool:
        return self.progress >= 1.0 or self.state in DONE_STATES

    @property
    def errored(self) -> bool:
        return self.state in ERROR_STATES


class QBittorrent:
    def __init__(self, client: httpx.AsyncClient, url: str, username: str = "", password: str = ""):
        if not url:
            raise QBitNotConfigured("qBittorrent is not configured (Settings → qBittorrent)")
        self.client = client
        self.url = url.rstrip("/")
        self.username = username
        self.password = password
        self._sid: str | None = None  # session cookie; "" = no login needed
        # qBittorrent's CSRF protection wants a matching Referer/Origin.
        self.headers = {"Referer": self.url, "Origin": self.url}

    async def _login(self) -> None:
        if not self.username:
            self._sid = ""
            return
        try:
            r = await self.client.post(
                f"{self.url}/api/v2/auth/login",
                data={"username": self.username, "password": self.password},
                headers=self.headers,
            )
        except httpx.TransportError as e:
            raise QBitError(f"Cannot reach qBittorrent at {self.url}: {e}") from e
        if r.status_code != 200 or r.text.strip() != "Ok.":
            raise QBitError("qBittorrent login failed (check username/password)")
        self._sid = r.cookies.get("SID") or ""

    async def _req(self, method: str, path: str, **kw: Any) -> httpx.Response:
        if self._sid is None:
            await self._login()
        for attempt in range(2):
            try:
                headers = {**self.headers, **({"Cookie": f"SID={self._sid}"} if self._sid else {})}
                r = await self.client.request(method, f"{self.url}/api/v2{path}", headers=headers, **kw)
            except httpx.TransportError as e:
                raise QBitError(f"Cannot reach qBittorrent at {self.url}: {e}") from e
            if r.status_code == 403 and attempt == 0:
                if not self.username:
                    raise QBitError("qBittorrent requires a login (set username/password)")
                await self._login()
                continue
            if r.status_code >= 400:
                raise QBitError(f"qBittorrent {path} returned HTTP {r.status_code}: {r.text[:200]}")
            return r
        raise QBitError("qBittorrent authentication failed")

    async def test(self) -> str:
        version = (await self._req("GET", "/app/version")).text
        cats = (await self._req("GET", "/torrents/categories")).json()
        return f"qBittorrent {version}, categories: {', '.join(cats) or '(none)'}"

    async def ensure_category(self, category: str) -> None:
        cats = (await self._req("GET", "/torrents/categories")).json()
        if category not in cats:
            await self._req("POST", "/torrents/createCategory", data={"category": category, "savePath": ""})

    async def add(self, *, category: str, torrent: bytes | None = None, magnet: str | None = None) -> None:
        data = {"category": category, "tags": "fastlibrarian"}
        if torrent is not None:
            files = {"torrents": ("release.torrent", torrent, "application/x-bittorrent")}
            r = await self._req("POST", "/torrents/add", data=data, files=files)
        elif magnet:
            r = await self._req("POST", "/torrents/add", data={**data, "urls": magnet})
        else:
            raise QBitError("nothing to add")
        if r.text.strip() not in ("Ok.", ""):
            raise QBitError(f"qBittorrent refused the torrent: {r.text[:200]}")

    async def status(self, hashes: list[str]) -> dict[str, TorrentStatus]:
        if not hashes:
            return {}
        items = (await self._req("GET", "/torrents/info", params={"hashes": "|".join(hashes)})).json()
        out: dict[str, TorrentStatus] = {}
        for t in items:
            st = TorrentStatus(
                hash=t["hash"].lower(),
                name=t.get("name", ""),
                state=t.get("state", ""),
                progress=float(t.get("progress", 0)),
                content_path=t.get("content_path") or "",
                save_path=t.get("save_path") or "",
            )
            out[st.hash] = st
        return out
