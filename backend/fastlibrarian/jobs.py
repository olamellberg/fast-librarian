"""Persistent background job queue + scheduler.

Jobs live in the ``jobs`` table so they survive restarts and are visible in the UI. A job has a
dedup ``key``: enqueueing while an identical job is pending/running is a no-op.
"""

import asyncio
import logging
import traceback
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from .context import AppContext
from .models import Author, Download, DownloadState, Job, JobStatus, db_now, utcnow

log = logging.getLogger("fastlibrarian.jobs")

Handler = Callable[[AppContext, dict[str, Any]], Awaitable[str | None]]
HANDLERS: dict[str, Handler] = {}
MAX_ATTEMPTS = 3


class PermanentError(Exception):
    """Raise from a handler to fail the job without retrying."""


def handler(name: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        HANDLERS[name] = fn
        return fn

    return deco


async def enqueue(
    session: AsyncSession,
    type_: str,
    payload: dict[str, Any] | None = None,
    *,
    key: str | None = None,
    delay: float = 0,
    commit: bool = True,
) -> Job | None:
    payload = payload or {}
    key = key or type_ + ":" + ",".join(f"{k}={payload[k]}" for k in sorted(payload))
    existing = await session.scalar(
        select(Job).where(Job.key == key, Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]))
    )
    if existing:
        return None
    job = Job(type=type_, key=key, payload=payload, run_after=utcnow() + timedelta(seconds=delay))
    session.add(job)
    if commit:
        await session.commit()
    return job


class Worker:
    def __init__(self, ctx: AppContext, concurrency: int = 3, tick: float = 20.0):
        self.ctx = ctx
        self.concurrency = concurrency
        self.tick = tick
        self._tasks: list[asyncio.Task] = []
        self._stop = asyncio.Event()
        self._last_calibre = 0.0
        self._last_poll = 0.0

    async def start(self) -> None:
        async with self.ctx.db.sessionmaker() as s:
            # Jobs that were running when we stopped are retried.
            await s.execute(
                update(Job).where(Job.status == JobStatus.RUNNING).values(status=JobStatus.PENDING)
            )
            await s.commit()
        self._tasks = [asyncio.create_task(self._run(i)) for i in range(self.concurrency)]
        self._tasks.append(asyncio.create_task(self._schedule()))

    async def stop(self) -> None:
        self._stop.set()
        self.ctx.wake.set()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _claim(self) -> Job | None:
        async with self.ctx.db.sessionmaker() as s:
            row = (
                await s.execute(
                    text(
                        "UPDATE jobs SET status='running', started_at=:now, attempts=attempts+1 "
                        "WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_after <= :now "
                        "ORDER BY run_after, id LIMIT 1) RETURNING id"
                    ),
                    {"now": db_now()},
                )
            ).first()
            await s.commit()
            return await s.get(Job, row[0]) if row else None

    async def run_one(self) -> bool:
        """Claim and run a single job. Returns False when nothing was due."""
        job = await self._claim()
        if not job:
            return False
        fn = HANDLERS.get(job.type)
        status, message, retry_in = JobStatus.DONE, None, None
        try:
            if fn is None:
                raise PermanentError(f"unknown job type {job.type}")
            # Handlers may look at _final to record a definitive failure on the last attempt.
            meta = {"_attempt": job.attempts, "_final": job.attempts >= MAX_ATTEMPTS}
            message = await fn(self.ctx, {**job.payload, **meta})
        except PermanentError as e:
            status, message = JobStatus.FAILED, str(e)
        except Exception as e:  # noqa: BLE001 - a job must never kill the worker
            log.warning("job %s %s failed: %s", job.id, job.key, e)
            log.debug(traceback.format_exc())
            message = f"{type(e).__name__}: {e}"
            if job.attempts < MAX_ATTEMPTS:
                status, retry_in = JobStatus.PENDING, 30 * 2**job.attempts
            else:
                status = JobStatus.FAILED
        async with self.ctx.db.sessionmaker() as s:
            values: dict[str, Any] = {"status": status, "message": message}
            if retry_in:
                values["run_after"] = utcnow() + timedelta(seconds=retry_in)
            else:
                values["finished_at"] = utcnow()
            await s.execute(update(Job).where(Job.id == job.id).values(**values))
            await s.commit()
        return True

    async def _run(self, idx: int) -> None:
        while not self._stop.is_set():
            try:
                if await self.run_one():
                    continue
            except Exception:  # noqa: BLE001
                log.exception("worker %s crashed while running a job", idx)
            self.ctx.wake.clear()
            try:
                await asyncio.wait_for(self.ctx.wake.wait(), timeout=5)
            except TimeoutError:
                pass

    async def schedule_once(self) -> None:
        """Enqueue recurring work that is due."""
        loop = asyncio.get_running_loop()
        now = loop.time()
        async with self.ctx.db.sessionmaker() as s:
            settings = await self.ctx.settings(s)
            active = await s.scalar(
                select(func.count())
                .select_from(Download)
                .where(Download.state.in_([DownloadState.DOWNLOADING, DownloadState.COMPLETED]))
            )
            if active and now - self._last_poll >= 30:
                self._last_poll = now
                await enqueue(s, "poll_downloads")
            if now - self._last_calibre >= settings.calibre_sync_minutes * 60 or self._last_calibre == 0:
                self._last_calibre = now
                await enqueue(s, "calibre_sync")
            stale = utcnow() - timedelta(hours=settings.author_refresh_hours)
            ids = await s.scalars(
                select(Author.id).where(
                    Author.monitored.is_(True),
                    (Author.refreshed_at.is_(None)) | (Author.refreshed_at < stale),
                )
            )
            for author_id in ids:
                await enqueue(s, "refresh_author", {"author_id": author_id}, commit=False)
            await s.execute(
                delete(Job).where(
                    Job.status.in_([JobStatus.DONE, JobStatus.FAILED]),
                    Job.finished_at < utcnow() - timedelta(days=7),
                )
            )
            await s.commit()
        self.ctx.wake.set()

    async def _schedule(self) -> None:
        while not self._stop.is_set():
            try:
                await self.schedule_once()
            except Exception:  # noqa: BLE001
                log.exception("scheduler tick failed")
            await asyncio.sleep(self.tick)
