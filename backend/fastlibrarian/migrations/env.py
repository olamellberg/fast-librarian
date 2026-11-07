"""Alembic environment (sync SQLite). Run programmatically from ``Database.migrate``."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from fastlibrarian import models  # noqa: F401 - registers tables on Base.metadata
from fastlibrarian.db import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_online() -> None:
    connectable = config.attributes.get("connection") or engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
