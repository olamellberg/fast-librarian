# syntax=docker/dockerfile:1
# FastLibrarian – single image: React frontend (static) + FastAPI backend.

# ---- frontend build ---------------------------------------------------------
FROM node:24.15.0-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM python:3.12.7-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.11.2 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    FL_CONFIG_DIR=/config \
    FL_STATIC_DIR=/app/static \
    PUID=1000 \
    PGID=1000 \
    UMASK=002

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/fastlibrarian ./fastlibrarian
RUN uv sync --frozen --no-dev --no-editable
COPY --from=web /web/dist ./static
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8790
VOLUME ["/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8790/api/health', timeout=4)"]
ENTRYPOINT ["/entrypoint.sh"]
