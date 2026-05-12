"""0011 — move je_sessions payload to filesystem

Adds payload_path TEXT to je_sessions so the JSON payload can be stored as a
file on disk (same volume as .pf parquet files) instead of as an unbounded
JSONB blob in PostgreSQL.  The payload column is kept for the transition period
so existing rows can be migrated; it is removed in 0012.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "je_sessions",
        sa.Column("payload_path", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("je_sessions", "payload_path")
