"""Add fpa_cache table with typed columns for binary Excel files.

Replaces the filesystem-based qbo_cache.json with a DB-backed singleton
so the pre-generated FPA report cache survives server restarts and redeploys.
Binary Excel content is stored as bytea (not base64 JSONB) to avoid
multi-MB text blobs inside the JSONB engine.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-07 00:00:08
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=:t"
    ), {"t": table}).fetchone()
    return row is not None


def _column_exists(conn, table: str, column: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "fpa_cache"):
        op.create_table(
            "fpa_cache",
            sa.Column("id",                      sa.Integer(),              primary_key=True),
            sa.Column("company_name",             sa.Text(),                 nullable=True),
            sa.Column("cached_at",                sa.DateTime(timezone=True), nullable=False),
            sa.Column("summary",                  JSONB(),                   nullable=True),
            sa.Column("preview",                  JSONB(),                   nullable=True),
            sa.Column("bs_preview",               JSONB(),                   nullable=True),
            sa.Column("bsi_preview",              JSONB(),                   nullable=True),
            sa.Column("pl_preview",               JSONB(),                   nullable=True),
            sa.Column("comp_pl_preview",          JSONB(),                   nullable=True),
            sa.Column("comp_pl_bd_preview",       JSONB(),                   nullable=True),
            sa.Column("excel_bytes",              sa.LargeBinary(),          nullable=True),
            sa.Column("bs_excel_bytes",           sa.LargeBinary(),          nullable=True),
            sa.Column("bsi_excel_bytes",          sa.LargeBinary(),          nullable=True),
            sa.Column("pl_excel_bytes",           sa.LargeBinary(),          nullable=True),
            sa.Column("comp_pl_excel_bytes",      sa.LargeBinary(),          nullable=True),
            sa.Column("comp_pl_bd_excel_bytes",   sa.LargeBinary(),          nullable=True),
            sa.CheckConstraint("id = 1", name="ck_fpa_cache_singleton"),
        )
        return

    # Table already exists in old form (data JSONB) — migrate to new schema.
    # Drop old data column, add new typed columns.
    if _column_exists(conn, "fpa_cache", "data"):
        # Wipe the singleton row — binary content in JSONB cannot be converted
        conn.execute(text("DELETE FROM fpa_cache"))
        op.drop_column("fpa_cache", "data")

    for col_name, col_type in [
        ("company_name",           sa.Text()),
        ("summary",                JSONB()),
        ("preview",                JSONB()),
        ("bs_preview",             JSONB()),
        ("bsi_preview",            JSONB()),
        ("pl_preview",             JSONB()),
        ("comp_pl_preview",        JSONB()),
        ("comp_pl_bd_preview",     JSONB()),
        ("excel_bytes",            sa.LargeBinary()),
        ("bs_excel_bytes",         sa.LargeBinary()),
        ("bsi_excel_bytes",        sa.LargeBinary()),
        ("pl_excel_bytes",         sa.LargeBinary()),
        ("comp_pl_excel_bytes",    sa.LargeBinary()),
        ("comp_pl_bd_excel_bytes", sa.LargeBinary()),
    ]:
        if not _column_exists(conn, "fpa_cache", col_name):
            op.add_column("fpa_cache", sa.Column(col_name, col_type, nullable=True))


def downgrade() -> None:
    op.drop_table("fpa_cache")
