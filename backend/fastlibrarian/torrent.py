"""Minimal torrent helpers: info-hash from a .torrent file or a magnet link."""

import base64
import hashlib
import re
from urllib.parse import parse_qs, urlparse


class BencodeError(ValueError):
    pass


def _info_span(data: bytes) -> tuple[int, int]:
    """Return the byte span of the top-level ``info`` dict value."""

    def skip(i: int) -> int:
        c = data[i : i + 1]
        if c == b"i":
            end = data.index(b"e", i)
            return end + 1
        if c in (b"l", b"d"):
            i += 1
            while data[i : i + 1] != b"e":
                i = skip(i)
            return i + 1
        if c.isdigit():
            colon = data.index(b":", i)
            length = int(data[i:colon])
            return colon + 1 + length
        raise BencodeError(f"bad token at {i}")

    if data[:1] != b"d":
        raise BencodeError("not a bencoded dict")
    i = 1
    try:
        while data[i : i + 1] != b"e":
            colon = data.index(b":", i)
            klen = int(data[i:colon])
            key = data[colon + 1 : colon + 1 + klen]
            vstart = colon + 1 + klen
            vend = skip(vstart)
            if key == b"info":
                return vstart, vend
            i = vend
    except (IndexError, ValueError) as e:
        raise BencodeError(str(e)) from e
    raise BencodeError("no info dict")


def info_hash_from_torrent(data: bytes) -> str:
    start, end = _info_span(data)
    return hashlib.sha1(data[start:end]).hexdigest()


def info_hash_from_magnet(magnet: str) -> str | None:
    qs = parse_qs(urlparse(magnet).query)
    for xt in qs.get("xt", []):
        m = re.fullmatch(r"urn:btih:([0-9a-fA-F]{40}|[A-Z2-7a-z]{32})", xt)
        if not m:
            continue
        h = m.group(1)
        if len(h) == 32:
            h = base64.b32decode(h.upper()).hex()
        return h.lower()
    return None
