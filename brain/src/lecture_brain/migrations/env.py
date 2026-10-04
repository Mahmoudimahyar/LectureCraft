"""Alembic environment for the local operational journal (never an academic database).

The Journal passes an already-open connection through ``config.attributes['connection']`` so the
migration runs inside the same local SQLite file the service is about to use.
"""
from __future__ import annotations

from alembic import context

from lecture_brain.journal.schema import metadata

config = context.config
target_metadata = metadata


def run_migrations() -> None:
    connection = config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Journal migrations run only through Journal.open(); no ad hoc database URL")
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations()
