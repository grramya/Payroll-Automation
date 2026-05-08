"""Create fpa_account_map and fpa_dept_map tables.

Moves FP&A account/department mappings from the hardcoded Python module
(fpa/mapping_data.py) into queryable, updatable DB tables.
Data is seeded by init_db() via database.seed_fpa_mappings().

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-07 00:00:09
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=:t"
    ), {"t": table}).fetchone()
    return row is not None


def _index_exists(conn, index_name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:n"
    ), {"n": index_name}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "fpa_account_map"):
        op.create_table(
            "fpa_account_map",
            sa.Column("account_name",        sa.Text(),        primary_key=True),
            sa.Column("financial_statement", sa.String(100),   nullable=True),
            sa.Column("main_grouping",       sa.String(100),   nullable=True),
            sa.Column("secondary_grouping",  sa.String(100),   nullable=True),
            sa.Column("classification",      sa.String(255),   nullable=True),
        )

    if not _table_exists(conn, "fpa_dept_map"):
        op.create_table(
            "fpa_dept_map",
            sa.Column("id",               sa.Integer(),    primary_key=True, autoincrement=True),
            sa.Column("account_name",     sa.Text(),       nullable=False),
            sa.Column("dept_class",       sa.String(255),  nullable=True),
            sa.Column("classification_2", sa.String(255),  nullable=True),
            sa.Column("classification_3", sa.String(255),  nullable=True),
            sa.Column("department",       sa.String(255),  nullable=True),
            sa.Column("dept_group_bd",    sa.String(255),  nullable=True),
            sa.UniqueConstraint("account_name", "dept_class", name="uq_fpa_dept_map"),
        )
        if not _index_exists(conn, "ix_fpa_dept_map_account"):
            op.create_index("ix_fpa_dept_map_account", "fpa_dept_map", ["account_name"])


def downgrade() -> None:
    op.drop_table("fpa_dept_map")
    op.drop_table("fpa_account_map")
