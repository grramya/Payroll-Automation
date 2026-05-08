"""Normalize all 6 database storage issues:
  1. je_sessions.owner (String FK→username) → owner_id (Integer FK→users.id)
  2. portco_data singleton JSONB → portco_metrics normalized table
  3. activity_log.username — drop FK (keep as plain Text for audit integrity)
  4. activity_log.changes_made — TEXT → JSONB
  5. user_permissions table (replaces boolean columns on users)
  6. portco_data table dropped

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-07 00:00:00
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Schema introspection helpers ──────────────────────────────────────────────

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


def _column_udt(conn, table: str, column: str) -> str | None:
    """Return the PostgreSQL UDT name for a column (e.g. 'text', 'jsonb', 'int4')."""
    row = conn.execute(text(
        "SELECT udt_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return row[0] if row else None


def _constraint_exists(conn, table: str, name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE table_schema='public' AND table_name=:t AND constraint_name=:n"
    ), {"t": table, "n": name}).fetchone()
    return row is not None


def _index_exists(conn, index_name: str) -> bool:
    row = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:n"
    ), {"n": index_name}).fetchone()
    return row is not None


# ── Upgrade ───────────────────────────────────────────────────────────────────

def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. user_permissions table (issue #6) ─────────────────────────────────
    if not _table_exists(conn, "user_permissions"):
        op.create_table(
            "user_permissions",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("module",  sa.String(50), nullable=False),
            sa.Column("dept",    sa.String(100), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id", "module"),
        )
        op.create_index("ix_user_permissions_user_id", "user_permissions", ["user_id"])

    # Migrate boolean columns → permission rows (only if boolean columns still exist)
    if _column_exists(conn, "users", "can_access_payroll"):
        conn.execute(text("""
            INSERT INTO user_permissions (user_id, module, dept)
            SELECT id, 'payroll', NULL      FROM users WHERE can_access_payroll = TRUE
            UNION ALL
            SELECT id, 'fpa',     NULL      FROM users WHERE can_access_fpa     = TRUE
            UNION ALL
            SELECT id, 'portco',  portco_dept FROM users WHERE can_access_portco  = TRUE
            ON CONFLICT DO NOTHING
        """))
        for col in ("can_access_payroll", "can_access_fpa", "can_access_portco", "portco_dept"):
            if _column_exists(conn, "users", col):
                op.drop_column("users", col)

    # ── 2. je_sessions.owner → owner_id (issue #1) ───────────────────────────
    if not _column_exists(conn, "je_sessions", "owner_id"):
        op.add_column("je_sessions", sa.Column("owner_id", sa.Integer(), nullable=True))
        # Populate from users table via username match
        conn.execute(text("""
            UPDATE je_sessions js
            SET    owner_id = u.id
            FROM   users u
            WHERE  js.owner = u.username
        """))
        # Remove sessions whose owner username no longer exists in users
        conn.execute(text("DELETE FROM je_sessions WHERE owner_id IS NULL"))
        op.alter_column("je_sessions", "owner_id", nullable=False)

    # Drop old string FK and column
    if _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner"):
        op.drop_constraint("fk_je_sessions_owner", "je_sessions", type_="foreignkey")
    if _index_exists(conn, "ix_je_sessions_owner"):
        op.drop_index("ix_je_sessions_owner", table_name="je_sessions")
    if _column_exists(conn, "je_sessions", "owner"):
        op.drop_column("je_sessions", "owner")

    # Create integer FK and index
    if not _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner_id"):
        op.create_foreign_key(
            "fk_je_sessions_owner_id", "je_sessions", "users",
            ["owner_id"], ["id"], ondelete="NO ACTION",
        )
    if not _index_exists(conn, "ix_je_sessions_owner_id"):
        op.create_index("ix_je_sessions_owner_id", "je_sessions", ["owner_id"])

    # ── 3. activity_log.username — drop FK (issue #1) ────────────────────────
    if _constraint_exists(conn, "activity_log", "fk_activity_log_username"):
        op.drop_constraint("fk_activity_log_username", "activity_log", type_="foreignkey")

    # ── 4. activity_log.changes_made — TEXT → JSONB (issue #5) ───────────────
    if _column_exists(conn, "activity_log", "changes_made"):
        col_type = _column_udt(conn, "activity_log", "changes_made")
        if col_type and col_type.lower() != "jsonb":
            # Null out existing pipe-separated text — cannot auto-convert to JSON
            conn.execute(text("UPDATE activity_log SET changes_made = NULL"))
            conn.execute(text(
                "ALTER TABLE activity_log "
                "ALTER COLUMN changes_made TYPE jsonb USING NULL::jsonb"
            ))

    # ── 5. portco_metrics table (issue #2) ───────────────────────────────────
    if not _table_exists(conn, "portco_metrics"):
        op.create_table(
            "portco_metrics",
            sa.Column("id",          sa.Integer(),              primary_key=True, autoincrement=True),
            sa.Column("metric_id",   sa.String(255),            nullable=False),
            sa.Column("month",       sa.String(7),              nullable=False),
            sa.Column("sheet",       sa.String(10),             nullable=False),
            sa.Column("value",       sa.Float(),                nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("metric_id", "month", "sheet", name="uq_portco_metric"),
        )
        op.create_index("ix_portco_metrics_sheet", "portco_metrics", ["sheet"])
        op.create_index("ix_portco_metrics_month", "portco_metrics", ["month"])

    # Migrate from portco_data singleton JSONB (if old table exists)
    if _table_exists(conn, "portco_data"):
        conn.execute(text("""
            INSERT INTO portco_metrics (metric_id, month, sheet, value, uploaded_at)
            SELECT
                metric_key,
                month_key,
                'actuals',
                (month_value #>> '{}')::float,
                NOW()
            FROM  portco_data
            CROSS JOIN LATERAL jsonb_each(data -> 'actuals') AS a(metric_key, metric_val)
            CROSS JOIN LATERAL jsonb_each(a.metric_val)      AS m(month_key,  month_value)
            WHERE jsonb_typeof(month_value) = 'number'
            ON CONFLICT (metric_id, month, sheet) DO NOTHING
        """))
        conn.execute(text("""
            INSERT INTO portco_metrics (metric_id, month, sheet, value, uploaded_at)
            SELECT
                metric_key,
                month_key,
                'budget',
                (month_value #>> '{}')::float,
                NOW()
            FROM  portco_data
            CROSS JOIN LATERAL jsonb_each(data -> 'budget') AS b(metric_key, metric_val)
            CROSS JOIN LATERAL jsonb_each(b.metric_val)     AS m(month_key,  month_value)
            WHERE jsonb_typeof(month_value) = 'number'
            ON CONFLICT (metric_id, month, sheet) DO NOTHING
        """))
        op.drop_table("portco_data")


# ── Downgrade ─────────────────────────────────────────────────────────────────

def downgrade() -> None:
    conn = op.get_bind()

    # ── 5. Restore portco_data singleton ─────────────────────────────────────
    if _table_exists(conn, "portco_metrics") and not _table_exists(conn, "portco_data"):
        op.create_table(
            "portco_data",
            sa.Column("id",         sa.Integer(),              primary_key=True),
            sa.Column("data",       JSONB,                     nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("id = 1", name="ck_portco_data_singleton"),
        )
        conn.execute(text("""
            INSERT INTO portco_data (id, data, updated_at)
            VALUES (
                1,
                jsonb_build_object(
                    'actuals', COALESCE((
                        SELECT jsonb_object_agg(metric_id, month_map)
                        FROM (
                            SELECT metric_id,
                                   jsonb_object_agg(month, value) AS month_map
                            FROM   portco_metrics WHERE sheet = 'actuals'
                            GROUP BY metric_id
                        ) a
                    ), '{}'::jsonb),
                    'budget', COALESCE((
                        SELECT jsonb_object_agg(metric_id, month_map)
                        FROM (
                            SELECT metric_id,
                                   jsonb_object_agg(month, value) AS month_map
                            FROM   portco_metrics WHERE sheet = 'budget'
                            GROUP BY metric_id
                        ) b
                    ), '{}'::jsonb),
                    'year', EXTRACT(YEAR FROM NOW())::int
                ),
                NOW()
            )
            ON CONFLICT DO NOTHING
        """))

    if _table_exists(conn, "portco_metrics"):
        op.drop_table("portco_metrics")

    # ── 4. Restore activity_log.changes_made to TEXT ─────────────────────────
    if _column_exists(conn, "activity_log", "changes_made"):
        col_type = _column_udt(conn, "activity_log", "changes_made")
        if col_type and col_type.lower() == "jsonb":
            conn.execute(text("UPDATE activity_log SET changes_made = NULL"))
            conn.execute(text(
                "ALTER TABLE activity_log "
                "ALTER COLUMN changes_made TYPE text USING NULL::text"
            ))

    # ── 3. Restore activity_log username FK ──────────────────────────────────
    if not _constraint_exists(conn, "activity_log", "fk_activity_log_username"):
        op.create_foreign_key(
            "fk_activity_log_username", "activity_log", "users",
            ["username"], ["username"], ondelete="SET NULL",
        )

    # ── 2. Restore je_sessions.owner string column ────────────────────────────
    if not _column_exists(conn, "je_sessions", "owner"):
        op.add_column("je_sessions", sa.Column("owner", sa.String(255), nullable=True))
        conn.execute(text("""
            UPDATE je_sessions js
            SET    owner = u.username
            FROM   users u
            WHERE  js.owner_id = u.id
        """))
        op.alter_column("je_sessions", "owner", nullable=False)

    if _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner_id"):
        op.drop_constraint("fk_je_sessions_owner_id", "je_sessions", type_="foreignkey")
    if _index_exists(conn, "ix_je_sessions_owner_id"):
        op.drop_index("ix_je_sessions_owner_id", table_name="je_sessions")
    if _column_exists(conn, "je_sessions", "owner_id"):
        op.drop_column("je_sessions", "owner_id")

    if not _constraint_exists(conn, "je_sessions", "fk_je_sessions_owner"):
        op.create_foreign_key(
            "fk_je_sessions_owner", "je_sessions", "users",
            ["owner"], ["username"], ondelete="NO ACTION",
        )
    if not _index_exists(conn, "ix_je_sessions_owner"):
        op.create_index("ix_je_sessions_owner", "je_sessions", ["owner"])

    # ── 1. Restore user boolean columns ──────────────────────────────────────
    if not _column_exists(conn, "users", "can_access_payroll"):
        op.add_column("users", sa.Column("can_access_payroll", sa.Boolean(), nullable=False, server_default="false"))
        op.add_column("users", sa.Column("can_access_fpa",     sa.Boolean(), nullable=False, server_default="false"))
        op.add_column("users", sa.Column("can_access_portco",  sa.Boolean(), nullable=False, server_default="false"))
        op.add_column("users", sa.Column("portco_dept",        sa.String(100), nullable=True))
        conn.execute(text("""
            UPDATE users u
            SET
                can_access_payroll = EXISTS(
                    SELECT 1 FROM user_permissions p
                    WHERE p.user_id = u.id AND p.module = 'payroll'
                ),
                can_access_fpa = EXISTS(
                    SELECT 1 FROM user_permissions p
                    WHERE p.user_id = u.id AND p.module = 'fpa'
                ),
                can_access_portco = EXISTS(
                    SELECT 1 FROM user_permissions p
                    WHERE p.user_id = u.id AND p.module = 'portco'
                ),
                portco_dept = (
                    SELECT dept FROM user_permissions p
                    WHERE p.user_id = u.id AND p.module = 'portco'
                    LIMIT 1
                )
        """))

    if _table_exists(conn, "user_permissions"):
        op.drop_index("ix_user_permissions_user_id", table_name="user_permissions")
        op.drop_table("user_permissions")
