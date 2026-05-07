"""Add FK constraints from je_sessions.owner and activity_log.username → users.username.

Since users are soft-deleted (never hard-deleted), these FKs enforce that
sessions/log rows only reference real usernames, with no practical risk of
violation during normal operation.

Revision ID: 0006
Revises: 0005
Create Date: 2025-01-01 00:00:05
"""
from __future__ import annotations
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _constraint_exists(conn, table: str, name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE table_schema='public' AND table_name=:t AND constraint_name=:n"
    ), {"t": table, "n": name}).fetchone()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()

    # je_sessions.owner → users.username (NO ACTION preserves sessions after soft-delete)
    if not _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner"):
        op.create_foreign_key(
            "fk_je_sessions_owner",
            "je_sessions", "users",
            ["owner"], ["username"],
            ondelete="NO ACTION",
        )

    # activity_log.username → users.username (SET NULL keeps log rows after soft-delete)
    if not _constraint_exists(conn, "activity_log", "fk_activity_log_username"):
        op.create_foreign_key(
            "fk_activity_log_username",
            "activity_log", "users",
            ["username"], ["username"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _constraint_exists(conn, "activity_log", "fk_activity_log_username"):
        op.drop_constraint("fk_activity_log_username", "activity_log", type_="foreignkey")
    if _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner"):
        op.drop_constraint("fk_je_sessions_owner", "je_sessions", type_="foreignkey")
