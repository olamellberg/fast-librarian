"""Process-level settings from environment variables (things needed before the DB exists).

Everything a user configures at runtime (Prowlarr, qBittorrent, folders, ...) lives in the
database instead – see ``appsettings.py``.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Env(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FL_", env_file=".env", extra="ignore")

    config_dir: Path = Path("/config")
    host: str = "0.0.0.0"
    port: int = 8790
    log_level: str = "INFO"
    # Disable the login screen entirely (e.g. when an auth proxy sits in front).
    auth_disabled: bool = False
    # Directory with the built frontend (index.html + assets). Empty = API only.
    static_dir: Path | None = None
    # Background worker; tests turn it off and drive jobs explicitly.
    run_worker: bool = True

    @property
    def db_path(self) -> Path:
        return self.config_dir / "fastlibrarian.db"

    @property
    def secret_file(self) -> Path:
        return self.config_dir / "secret.key"


@lru_cache
def get_env() -> Env:
    return Env()
