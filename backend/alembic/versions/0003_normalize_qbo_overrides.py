"""Normalize qbo_overrides: replace single JSONB-array-per-type with one row per item.

Migrates existing data from qbo_overrides into qbo_override_items, then drops
the old table.  Safe to run on a DB where qbo_overrides never existed.

Revision ID: 0003
Revises: 0002
Create Date: 2025-01-01 00:00:02
"""
from __future__ import annotations
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=:t"
    ), {"t": table}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    # Create the new normalized table (idempotent)
    if not _table_exists(conn, "qbo_override_items"):
        op.create_table(
            "qbo_override_items",
            sa.Column("id",        sa.Integer,              primary_key=True, autoincrement=True),
            sa.Column("type",      sa.String(50),           nullable=False),
            sa.Column("data",      JSONB,                   nullable=False),
            sa.Column("source",    sa.String(50),           nullable=True),
            sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_qbo_override_items_type", "qbo_override_items", ["type"])

    # Migrate data from old table if it exists
    if _table_exists(conn, "qbo_overrides"):
        rows = conn.execute(text(
            "SELECT type, rows, source, last_synced FROM qbo_overrides"
        )).fetchall()
        for r in rows:
            override_type, rows_data, source, synced_at = r
            if not rows_data:
                continue
            # rows_data is already a Python list (psycopg2 deserialises JSONB)
            items = rows_data if isinstance(rows_data, list) else json.loads(rows_data)
            for item in items:
                conn.execute(text(
                    "INSERT INTO qbo_override_items (type, data, source, synced_at) "
                    "VALUES (:type, :data::jsonb, :source, :synced_at)"
                ), {
                    "type":      override_type,
                    "data":      json.dumps(item),
                    "source":    source,
                    "synced_at": synced_at,
                })
        op.drop_table("qbo_overrides")


def downgrade() -> None:
    # Recreate qbo_overrides and consolidate items back into JSONB arrays
    conn = op.get_bind()
    if not _table_exists(conn, "qbo_overrides"):
        op.create_table(
            "qbo_overrides",
            sa.Column("type",        sa.String(50),              primary_key=True),
            sa.Column("rows",        JSONB,                      nullable=False),
            sa.Column("last_synced", sa.DateTime(timezone=True), nullable=True),
            sa.Column("source",      sa.String(50),              nullable=True),
        )
    if _table_exists(conn, "qbo_override_items"):
        rows = conn.execute(text(
            "SELECT type, json_agg(data ORDER BY id), source, max(synced_at) "
            "FROM qbo_override_items GROUP BY type, source"
        )).fetchall()
        for override_type, agg_rows, source, last_synced in rows:
            conn.execute(text(
                "INSERT INTO qbo_overrides (type, rows, source, last_synced) "
                "VALUES (:type, :rows::jsonb, :source, :last_synced) "
                "ON CONFLICT (type) DO UPDATE SET rows=EXCLUDED.rows, "
                "last_synced=EXCLUDED.last_synced, source=EXCLUDED.source"
            ), {
                "type":        override_type,
                "rows":        json.dumps(agg_rows) if not isinstance(agg_rows, str) else agg_rows,
                "source":      source,
                "last_synced": last_synced,
            })
        op.drop_table("qbo_override_items")
