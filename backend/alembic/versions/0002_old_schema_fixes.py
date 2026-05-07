"""Apply all legacy _migrate_schema() fixes for existing databases.

Each step is idempotent — safe to run on a DB that already has these applied.
New installs stamp past this revision via init_db().

Revision ID: 0002
Revises: 0001
Create Date: 2025-01-01 00:00:01
"""
from __future__ import annotations
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_type(conn, table: str, col: str) -> str | None:
    row = conn.execute(text(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": col}).fetchone()
    return row[0].lower() if row else None


def _col_exists(conn, table: str, col: str) -> bool:
    return _col_type(conn, table, col) is not None


def _constraint_exists(conn, table: str, name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE table_schema='public' AND table_name=:t AND constraint_name=:n"
    ), {"t": table, "n": name}).fetchone()
    return row is not None


def _index_exists(conn, name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:n"
    ), {"n": name}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    # Fix 1 — convert String timestamps → TIMESTAMPTZ
    if _col_type(conn, "users", "created") == "character varying":
        conn.execute(text(
            "ALTER TABLE users ALTER COLUMN created TYPE TIMESTAMPTZ "
            "USING CASE WHEN created ~ '^\\d{4}-\\d{2}-\\d{2}' "
            "THEN (created || ' UTC')::TIMESTAMPTZ "
            "ELSE '1970-01-01 00:00:00+00'::TIMESTAMPTZ END"
        ))

    if _col_type(conn, "revoked_tokens", "revoked_at") == "character varying":
        conn.execute(text(
            "ALTER TABLE revoked_tokens ALTER COLUMN revoked_at TYPE TIMESTAMPTZ "
            "USING CASE WHEN revoked_at ~ '^\\d{4}-\\d{2}-\\d{2}' "
            "THEN (revoked_at || ' UTC')::TIMESTAMPTZ "
            "ELSE '1970-01-01 00:00:00+00'::TIMESTAMPTZ END"
        ))

    if _col_type(conn, "revoked_tokens", "expires_at") == "character varying":
        conn.execute(text(
            "ALTER TABLE revoked_tokens ALTER COLUMN expires_at TYPE TIMESTAMPTZ "
            "USING CASE WHEN expires_at ~ '^\\d{4}-\\d{2}-\\d{2}' "
            "THEN (expires_at || ' UTC')::TIMESTAMPTZ "
            "ELSE '2099-12-31 00:00:00+00'::TIMESTAMPTZ END"
        ))

    if _col_type(conn, "activity_log", "timestamp") == "character varying":
        conn.execute(text(
            'ALTER TABLE activity_log ALTER COLUMN "timestamp" TYPE TIMESTAMPTZ '
            'USING CASE WHEN "timestamp" ~ \'^\\d{4}-\\d{2}-\\d{2}\' '
            'THEN ("timestamp" || \' UTC\')::TIMESTAMPTZ '
            "ELSE '1970-01-01 00:00:00+00'::TIMESTAMPTZ END"
        ))

    if _col_type(conn, "qbo_overrides", "last_synced") == "character varying":
        conn.execute(text(
            "ALTER TABLE qbo_overrides ALTER COLUMN last_synced TYPE TIMESTAMPTZ "
            "USING CASE WHEN last_synced IS NULL THEN NULL "
            "WHEN last_synced ~ '^\\d{4}-\\d{2}-\\d{2}' "
            "THEN last_synced::TIMESTAMPTZ ELSE NULL END"
        ))

    # Fix 8 — qbo_tokens.expires_at: double precision → TIMESTAMPTZ
    if _col_type(conn, "qbo_tokens", "expires_at") == "double precision":
        conn.execute(text(
            "ALTER TABLE qbo_tokens ALTER COLUMN expires_at TYPE TIMESTAMPTZ "
            "USING to_timestamp(expires_at)"
        ))

    # Fix 9 — soft-delete column
    if not _col_exists(conn, "users", "deleted_at"):
        conn.execute(text("ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ"))

    # Fix 10 — pf_bytes column (will be dropped in 0005; added here so existing DBs
    # that never got it can safely proceed to the drop migration)
    if not _col_exists(conn, "je_sessions", "pf_bytes"):
        conn.execute(text("ALTER TABLE je_sessions ADD COLUMN pf_bytes BYTEA"))

    # Fix 2 — indexes
    if not _index_exists(conn, "ix_je_sessions_owner"):
        conn.execute(text("CREATE INDEX ix_je_sessions_owner ON je_sessions (owner)"))
    if not _index_exists(conn, "ix_activity_log_user"):
        conn.execute(text('CREATE INDEX ix_activity_log_user ON activity_log ("user")'))
    if not _index_exists(conn, "ix_activity_log_timestamp"):
        conn.execute(text('CREATE INDEX ix_activity_log_timestamp ON activity_log ("timestamp")'))

    # Fix 3 — portco_data singleton constraint
    if not _constraint_exists(conn, "portco_data", "ck_portco_data_singleton"):
        conn.execute(text(
            "ALTER TABLE portco_data ADD CONSTRAINT ck_portco_data_singleton "
            "CHECK (id = 1) NOT VALID"
        ))

    # Fix 6 — role CHECK constraint
    if not _constraint_exists(conn, "users", "ck_users_role"):
        conn.execute(text(
            "ALTER TABLE users ADD CONSTRAINT ck_users_role "
            "CHECK (role IN ('admin', 'user')) NOT VALID"
        ))


def downgrade() -> None:
    pass  # legacy fixes are not reversible
