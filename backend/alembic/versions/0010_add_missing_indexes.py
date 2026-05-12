"""0010 — add missing indexes for performance

Adds indexes that were identified during the production audit:

- activity_log.action         (filtered queries by action type)
- activity_log.timestamp DESC (paginated time-range queries, newest-first)
- je_sessions.saved_at        (TTL purge queries)
- portco_metrics composite    (metric_id, month) for time-series lookups
- qbo_override_items composite (company, type) for per-company lookups
  Note: qbo_override_items has no 'company' column — the type index already
  exists; we add a covering index on (type, source) for sync-status queries.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # activity_log — fast action-type filtering (used by the new filter API)
    op.create_index(
        "ix_activity_log_action",
        "activity_log",
        ["action"],
        postgresql_ops={"action": "text_pattern_ops"},  # supports ILIKE prefix scans
    )

    # activity_log — DESC index matches the default ORDER BY id DESC / timestamp DESC
    op.create_index(
        "ix_activity_log_timestamp_desc",
        "activity_log",
        [sa.text("timestamp DESC")],
    )

    # je_sessions — TTL cleanup on startup queries by saved_at
    op.create_index(
        "ix_je_sessions_saved_at",
        "je_sessions",
        ["saved_at"],
    )

    # portco_metrics — composite for time-series queries: WHERE metric_id=? ORDER BY month
    op.create_index(
        "ix_portco_metrics_metric_month",
        "portco_metrics",
        ["metric_id", "month"],
    )

    # qbo_override_items — covering index for sync-status / type + source queries
    op.create_index(
        "ix_qbo_override_items_type_source",
        "qbo_override_items",
        ["type", "source"],
    )


def downgrade() -> None:
    op.drop_index("ix_qbo_override_items_type_source", table_name="qbo_override_items")
    op.drop_index("ix_portco_metrics_metric_month",    table_name="portco_metrics")
    op.drop_index("ix_je_sessions_saved_at",           table_name="je_sessions")
    op.drop_index("ix_activity_log_timestamp_desc",    table_name="activity_log")
    op.drop_index("ix_activity_log_action",            table_name="activity_log")
