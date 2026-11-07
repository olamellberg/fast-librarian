"""ASGI application factory and entrypoint."""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import __version__, services  # noqa: F401 - services registers job handlers
from .api import public, router
from .auth import load_or_create_secret
from .context import AppContext
from .db import Database
from .env import Env, get_env
from .http import MetadataHttp, make_client
from .jobs import Worker

log = logging.getLogger("fastlibrarian")


def create_app(env: Env | None = None) -> FastAPI:
    env = env or get_env()
    env.config_dir.mkdir(parents=True, exist_ok=True)
    db = Database(env.db_path)
    db.migrate()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        http = make_client()
        meta = MetadataHttp(make_client())
        ctx = AppContext(env=env, db=db, http=http, meta_http=meta)
        app.state.ctx = ctx
        worker = Worker(ctx) if env.run_worker else None
        if worker:
            await worker.start()
        app.state.worker = worker
        log.info("FastLibrarian %s started (config: %s)", __version__, env.config_dir)
        try:
            yield
        finally:
            if worker:
                await worker.stop()
            await http.aclose()
            await meta.client.aclose()
            await db.dispose()

    app = FastAPI(
        title="FastLibrarian",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.db = db
    app.add_middleware(
        SessionMiddleware,
        secret_key=load_or_create_secret(env.secret_file),
        session_cookie="fastlibrarian_session",
        max_age=60 * 60 * 24 * 30,
        same_site="lax",
    )
    app.include_router(public)
    app.include_router(router)

    static = env.static_dir
    if static and (static / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")
        index = static / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "not found")
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(index)

    return app


def run() -> None:
    env = get_env()
    logging.basicConfig(level=env.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        create_app(env),
        host=env.host,
        port=env.port,
        log_level=env.log_level.lower(),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    run()
