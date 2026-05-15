"""0014 — add bs_bd_preview and bs_bd_excel_bytes to fpa_cache

Adds the Balance Sheet Breakdown columns that were introduced in the model
after migration 0008 created the fpa_cache table.

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "fpa_cache", "bs_bd_preview"):
        op.add_column("fpa_cache", sa.Column("bs_bd_preview", JSONB(), nullable=True))
    if not _column_exists(conn, "fpa_cache", "bs_bd_excel_bytes"):
        op.add_column("fpa_cache", sa.Column("bs_bd_excel_bytes", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("fpa_cache", "bs_bd_excel_bytes")
    op.drop_column("fpa_cache", "bs_bd_preview")
