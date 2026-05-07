"""Rename activity_log."user" → activity_log.username.

'user' is a PostgreSQL reserved keyword; quoting it everywhere is error-prone.
Also renames the index.  Idempotent — checks column name before acting.

Revision ID: 0004
Revises: 0003
Create Date: 2025-01-01 00:00:03
"""
from __future__ import annotations
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_exists(conn, table: str, col: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": col}).fetchone()
    return row is not None


def _index_exists(conn, name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:n"
    ), {"n": name}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    # Drop old index before renaming column (index references the column name)
    if _index_exists(conn, "ix_activity_log_user"):
        conn.execute(text("DROP INDEX ix_activity_log_user"))

    if _col_exists(conn, "activity_log", "user"):
        conn.execute(text('ALTER TABLE activity_log RENAME COLUMN "user" TO username'))

    # Recreate index with new name
    if not _index_exists(conn, "ix_activity_log_username"):
        conn.execute(text("CREATE INDEX ix_activity_log_username ON activity_log (username)"))


def downgrade() -> None:
    conn = op.get_bind()

    if _index_exists(conn, "ix_activity_log_username"):
        conn.execute(text("DROP INDEX ix_activity_log_username"))

    if _col_exists(conn, "activity_log", "username"):
        conn.execute(text('ALTER TABLE activity_log RENAME COLUMN username TO "user"'))

    if not _index_exists(conn, "ix_activity_log_user"):
        conn.execute(text('CREATE INDEX ix_activity_log_user ON activity_log ("user")'))
