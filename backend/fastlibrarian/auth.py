"""Single/multi-user login with argon2 password hashes and a signed session cookie."""

import secrets
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import HTTPException, Request, status

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(hash_: str, password: str) -> bool:
    try:
        return _ph.verify(hash_, password)
    except VerificationError:
        return False


def load_or_create_secret(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        return path.read_text().strip()
    secret = secrets.token_urlsafe(48)
    path.write_text(secret)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return secret


def require_user(request: Request) -> str:
    """FastAPI dependency: the logged-in username (or 'admin' when auth is disabled)."""
    if request.app.state.ctx.env.auth_disabled:
        return "admin"
    user = request.session.get("user")
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not logged in")
    return user
