"""0012 — add payroll_config and app_config tables

payroll_config: DB-backed replacement for the hardcoded dicts in config.py.
app_config:     Generic key/value store for runtime-editable settings (e.g.
                the AI chatbot system prompt).

Both tables are seeded by the application on first startup.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_config",
        sa.Column("key",        sa.String(255), primary_key=True),
        sa.Column("value_json", sa.Text(),      nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "app_config",
        sa.Column("key",        sa.String(255), primary_key=True),
        sa.Column("value",      sa.Text(),      nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_config")
    op.drop_table("payroll_config")
