"""Drop je_sessions.pf_bytes — payroll files now live on the filesystem.

The column is no longer written or read by the application.  Any bytes still
stored here are orphaned; they are intentionally discarded on upgrade.

Revision ID: 0005
Revises: 0004
Create Date: 2025-01-01 00:00:04
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_exists(conn, table: str, col: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": col}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()
    if _col_exists(conn, "je_sessions", "pf_bytes"):
        op.drop_column("je_sessions", "pf_bytes")


def downgrade() -> None:
    conn = op.get_bind()
    if not _col_exists(conn, "je_sessions", "pf_bytes"):
        op.add_column("je_sessions", sa.Column("pf_bytes", sa.LargeBinary(), nullable=True))
