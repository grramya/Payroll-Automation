"""database.py — SQLAlchemy engine, models, and session factory for Finance Suite."""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from pydantic import BaseModel
from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index,
    Integer, LargeBinary, String, Text, UniqueConstraint, create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from dotenv import load_dotenv
load_dotenv()

_USER     = os.environ.get("DB_USER",     "postgres")
_PASSWORD = os.environ.get("DB_PASSWORD", "")
_HOST     = os.environ.get("DB_HOST",     "localhost")
_PORT     = os.environ.get("DB_PORT",     "5432")
_NAME     = os.environ.get("DB_NAME",     "finance_suite")

DATABASE_URL = f"postgresql+psycopg2://{_USER}:{_PASSWORD}@{_HOST}:{_PORT}/{_NAME}"

engine       = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # detect stale connections before use
    pool_size=20,         # sustained concurrent connections
    max_overflow=10,      # burst headroom above pool_size
    pool_recycle=3600,    # recycle connections hourly to avoid server-side timeouts
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ── Slow query logging ────────────────────────────────────────────────────────
# Queries that take longer than this threshold are written to stderr.
# Set SLOW_QUERY_MS=0 to disable. Default: 200ms.
import time as _time
from sqlalchemy import event as _sa_event

_SLOW_QUERY_MS = int(os.environ.get("SLOW_QUERY_MS", "200"))


@_sa_event.listens_for(engine, "before_cursor_execute")
def _before_query(conn, cursor, statement, parameters, context, executemany):
    if _SLOW_QUERY_MS > 0:
        context._query_start = _time.monotonic()


@_sa_event.listens_for(engine, "after_cursor_execute")
def _after_query(conn, cursor, statement, parameters, context, executemany):
    if _SLOW_QUERY_MS <= 0:
        return
    start = getattr(context, "_query_start", None)
    if start is None:
        return
    elapsed_ms = (_time.monotonic() - start) * 1000
    if elapsed_ms >= _SLOW_QUERY_MS:
        import sys as _sys
        # Truncate to 300 chars to avoid flooding logs
        snippet = statement.replace("\n", " ")[:300]
        print(
            f"[slow-query] {elapsed_ms:.0f}ms — {snippet}",
            file=_sys.stderr, flush=True,
        )


class Base(DeclarativeBase):
    pass


# ── Auth ───────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    username   = Column(String(255), unique=True, nullable=False)
    password   = Column(Text, nullable=False)
    role       = Column(String(50), nullable=False, default="user")
    created    = Column(DateTime(timezone=True), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    # Permission columns removed — moved to UserPermission table (issue #6)
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),
    )


class UserPermission(Base):
    """One row per (user, module) pair. Replaces flat boolean columns on User."""
    __tablename__ = "user_permissions"
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    module  = Column(String(50), primary_key=True)   # 'payroll' | 'fpa' | 'portco'
    dept    = Column(String(100), nullable=True)      # only meaningful for 'portco'
    __table_args__ = (
        Index("ix_user_permissions_user_id", "user_id"),
    )


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti        = Column(String(255), primary_key=True)
    revoked_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


# ── Payroll JE Sessions ────────────────────────────────────────────────────────

class JeSession(Base):
    __tablename__ = "je_sessions"
    id           = Column(String(255), primary_key=True)
    owner_id     = Column(Integer, ForeignKey("users.id", ondelete="NO ACTION"), nullable=False)
    # payload_path points to a JSON file on the sessions volume (migration 0011).
    # payload JSONB is kept for backward compat with rows written before 0011.
    payload_path = Column(Text, nullable=True)
    payload      = Column(JSONB, nullable=True)
    saved_at     = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        Index("ix_je_sessions_owner_id", "owner_id"),
    )


# ── PortCo Reporting ──────────────────────────────────────────────────────────

class PortcoMetric(Base):
    """Normalized metric storage — one row per (metric_id, month, sheet).
    Replaces the PortcoDataStore singleton JSONB blob (issue #2).
    """
    __tablename__ = "portco_metrics"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    metric_id   = Column(String(255), nullable=False)   # e.g. "Finance Revenue"
    month       = Column(String(7),   nullable=False)   # YYYY-MM
    sheet       = Column(String(10),  nullable=False)   # 'actuals' | 'budget'
    value       = Column(Float,       nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        UniqueConstraint("metric_id", "month", "sheet", name="uq_portco_metric"),
        Index("ix_portco_metrics_sheet", "sheet"),
        Index("ix_portco_metrics_month", "month"),
    )


# ── Budget Planning ───────────────────────────────────────────────────────────

class BudgetEmployeeCost(Base):
    """Employee cost budget entries — one row per employee per department per year."""
    __tablename__ = "budget_employee_cost"
    id                 = Column(Integer, primary_key=True, autoincrement=True)
    department         = Column(String(255), nullable=False)
    year               = Column(Integer, nullable=False)
    geography          = Column(String(100), nullable=False)   # Concertiv | India | US | Vearc…
    name               = Column(String(255), nullable=False)
    title              = Column(String(255), nullable=False)
    start_date         = Column(Date, nullable=True)
    base_salary        = Column(Float, nullable=False)
    bonus_pct          = Column(Float, nullable=True)           # decimal, e.g. 0.10 = 10%
    bonus_amount       = Column(Float, nullable=True)
    taxes_benefits_pct = Column(Float, nullable=False, default=0)
    hike_cycle_pct     = Column(Float, nullable=True)           # Concertiv only
    payroll_expenses   = Column(Float, nullable=True)           # Concertiv only, per-employee/month
    tech_stipend       = Column(Float, nullable=True)           # Concertiv only, per-employee/month
    created_at         = Column(DateTime(timezone=True), nullable=False)
    updated_at         = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        Index("ix_budget_emp_cost_dept_year", "department", "year"),
    )


class BudgetOtherCost(Base):
    """Other cost budget entries — one row per vendor/expense line per department per year."""
    __tablename__ = "budget_other_cost"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    department       = Column(String(255), nullable=False)
    year             = Column(Integer, nullable=False)
    cost_grouping    = Column(String(255), nullable=False)
    vendor_name      = Column(String(255), nullable=False)
    memo_description = Column(Text, nullable=True)
    amount           = Column(Float, nullable=False)
    created_at       = Column(DateTime(timezone=True), nullable=False)
    updated_at       = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        Index("ix_budget_other_cost_dept_year", "department", "year"),
    )


# ── QBO OAuth Tokens ──────────────────────────────────────────────────────────

class QboToken(Base):
    __tablename__ = "qbo_tokens"
    company       = Column(String(100), primary_key=True)
    access_token  = Column(Text, nullable=False)   # encrypted at rest
    refresh_token = Column(Text, nullable=False)   # encrypted at rest
    realm_id      = Column(String(100), nullable=False, default="")
    token_type    = Column(String(50),  nullable=False, default="Bearer")
    expires_at    = Column(DateTime(timezone=True), nullable=False)


# ── QBO Overrides (accounts / vendors / classes) ──────────────────────────────

class QboOverrideItem(Base):
    __tablename__ = "qbo_override_items"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    type      = Column(String(50), nullable=False)   # 'accounts' | 'vendors' | 'classes'
    data      = Column(JSONB, nullable=False)
    source    = Column(String(50), nullable=True)    # 'qbo' | 'manual'
    synced_at = Column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        Index("ix_qbo_override_items_type", "type"),
    )


# ── FPA Report Cache ──────────────────────────────────────────────────────────

class FpaCache(Base):
    """Singleton row for the pre-generated FPA report cache.

    Binary Excel outputs are stored as bytea columns so PostgreSQL does not
    have to parse multi-MB base64 text through the JSONB engine on every
    write.  Lightweight metadata (summary, previews) stays in JSONB.
    """
    __tablename__ = "fpa_cache"
    id                     = Column(Integer, primary_key=True, default=1)
    company_name           = Column(Text,        nullable=True)
    cached_at              = Column(DateTime(timezone=True), nullable=False)
    summary                = Column(JSONB,       nullable=True)
    preview                = Column(JSONB,       nullable=True)
    bs_preview             = Column(JSONB,       nullable=True)
    bsi_preview            = Column(JSONB,       nullable=True)
    pl_preview             = Column(JSONB,       nullable=True)
    comp_pl_preview        = Column(JSONB,       nullable=True)
    comp_pl_bd_preview     = Column(JSONB,       nullable=True)
    excel_bytes            = Column(LargeBinary, nullable=True)
    bs_excel_bytes         = Column(LargeBinary, nullable=True)
    bsi_excel_bytes        = Column(LargeBinary, nullable=True)
    pl_excel_bytes         = Column(LargeBinary, nullable=True)
    comp_pl_excel_bytes    = Column(LargeBinary, nullable=True)
    comp_pl_bd_excel_bytes = Column(LargeBinary, nullable=True)
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_fpa_cache_singleton"),
    )


# ── FPA Account / Department Mapping ─────────────────────────────────────────

class FpaAccountMap(Base):
    """One row per account name: maps it to financial-statement groupings.

    Seeded from fpa/mapping_data.py on first startup; can be updated in-place
    without a code change or redeploy.
    """
    __tablename__ = "fpa_account_map"
    account_name        = Column(Text,        primary_key=True)
    financial_statement = Column(String(100), nullable=True)
    main_grouping       = Column(String(100), nullable=True)
    secondary_grouping  = Column(String(100), nullable=True)
    classification      = Column(String(255), nullable=True)


class FpaDeptMap(Base):
    """One row per (account_name, dept_class) pair: maps to classification columns.

    dept_class is NULL when the mapping applies regardless of department.
    Seeded from fpa/mapping_data.py on first startup.
    """
    __tablename__ = "fpa_dept_map"
    id               = Column(Integer,    primary_key=True, autoincrement=True)
    account_name     = Column(Text,        nullable=False)
    dept_class       = Column(String(255), nullable=True)   # NULL = any dept
    classification_2 = Column(String(255), nullable=True)
    classification_3 = Column(String(255), nullable=True)
    department       = Column(String(255), nullable=True)
    dept_group_bd    = Column(String(255), nullable=True)
    __table_args__ = (
        UniqueConstraint("account_name", "dept_class", name="uq_fpa_dept_map"),
        Index("ix_fpa_dept_map_account", "account_name"),
    )


# ── Activity Log ──────────────────────────────────────────────────────────────

class ActivityLogEntry(Base):
    __tablename__ = "activity_log"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    timestamp      = Column(DateTime(timezone=True), nullable=False)
    # username kept as plain Text — no FK so audit rows survive user deletion (issue #1)
    username       = Column(String(255), nullable=True)
    ip_address     = Column(String(100), nullable=True)
    hostname       = Column(String(255), nullable=True)
    action         = Column(String(255), nullable=False)
    input_file     = Column(Text, nullable=True)
    output_file    = Column(Text, nullable=True)
    journal_number = Column(String(255), nullable=True)
    details        = Column(Text, nullable=True)
    # JSONB list[dict] instead of pipe-separated Text for structured querying (issue #5)
    changes_made   = Column(JSONB, nullable=True)
    __table_args__ = (
        Index("ix_activity_log_username", "username"),
        Index("ix_activity_log_timestamp", "timestamp"),
    )


# ── Payroll Configuration (DB-backed, replaces hardcoded config.py dicts) ─────

class PayrollConfigEntry(Base):
    """One row per configuration key.  value is stored as JSON text so it can
    hold scalars, lists, or dicts without schema changes.

    Keys mirror the constants in config.py (SPECIAL_COLUMNS, DEPARTMENT_TO_CLASS, …).
    Seeded from config.py defaults on first startup; editable via the admin API.
    """
    __tablename__ = "payroll_config"
    key        = Column(String(255), primary_key=True)
    value_json = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


# ── Application-wide configuration (system prompt, feature flags, …) ──────────

class AppConfig(Base):
    """Generic key/value store for application-level settings that should be
    editable without a code deployment (e.g. the AI chatbot system prompt).
    """
    __tablename__ = "app_config"
    key        = Column(String(255), primary_key=True)
    value      = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


# ── Pydantic schemas for JSONB validation ─────────────────────────────────────

class JeSessionPayloadSchema(BaseModel):
    model_config = {"extra": "allow"}
    je_df_records:        list[dict[str, Any]] = []
    je_df_columns:        list[str]            = []
    dept_summary_records: list[dict[str, Any]] = []
    je_filename:          str                  = ""


class QboOverrideRowSchema(BaseModel):
    model_config = {"extra": "allow"}


# ── Token encryption ──────────────────────────────────────────────────────────

def _build_fernet() -> "Fernet | None":
    key = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
    if not key:
        return None
    try:
        return Fernet(key.encode())
    except Exception as exc:
        import sys as _sys
        print(f"[database] Invalid TOKEN_ENCRYPTION_KEY: {exc}", file=_sys.stderr, flush=True)
        return None

_fernet = _build_fernet()


def encrypt_token(t: str) -> str:
    """Encrypt an OAuth token before DB storage. Raises if TOKEN_ENCRYPTION_KEY is not configured."""
    if not t:
        return t
    if _fernet is None:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is required but not set. "
            "QBO tokens cannot be stored without encryption."
        )
    return _fernet.encrypt(t.encode()).decode()


def decrypt_token(t: str) -> str:
    """Decrypt an OAuth token read from DB. Falls back to plaintext for legacy unencrypted tokens."""
    if not t:
        return t
    if _fernet is None:
        return t
    try:
        return _fernet.decrypt(t.encode()).decode()
    except Exception:
        # Token was stored before encryption was enabled — return as-is
        return t


# ── Session factory ───────────────────────────────────────────────────────────

@contextmanager
def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ── Database initialisation with Alembic ─────────────────────────────────────

def _run_alembic(stamp_if_fresh: bool) -> None:
    """Run Alembic migrations, or stamp head on a brand-new install."""
    try:
        from alembic.config import Config
        from alembic import command
        cfg = Config(str(Path(__file__).parent / "alembic.ini"))
        if stamp_if_fresh:
            command.stamp(cfg, "head")
        else:
            command.upgrade(cfg, "head")
    except Exception as exc:
        import sys
        print(f"[Alembic] Migration warning: {exc}", file=sys.stderr, flush=True)


def seed_fpa_mappings(db, force: bool = False) -> int:
    """Populate fpa_account_map and fpa_dept_map from mapping_data.py.

    Skips if both tables already have rows (unless force=True).
    Returns the number of rows inserted.
    """
    if not force and db.query(FpaAccountMap).count() > 0 and db.query(FpaDeptMap).count() > 0:
        return 0

    try:
        from fpa.mapping_data import ACCOUNT_MAP, DEPT_MAP
    except Exception as exc:
        import sys
        print(f"[seed_fpa_mappings] Could not import mapping_data: {exc}", file=sys.stderr)
        return 0

    if force:
        db.query(FpaAccountMap).delete()
        db.query(FpaDeptMap).delete()
        db.flush()

    account_rows = [
        FpaAccountMap(
            account_name=k,
            financial_statement=v.get("Financial Statement"),
            main_grouping=v.get("Main Grouping"),
            secondary_grouping=v.get("Secondary Grouping"),
            classification=v.get("Classification (Line Item)"),
        )
        for k, v in ACCOUNT_MAP.items()
    ]
    db.bulk_save_objects(account_rows)

    dept_rows = [
        FpaDeptMap(
            account_name=acct,
            dept_class=dept,
            classification_2=vals.get("Classification 2"),
            classification_3=vals.get("Classification 3"),
            department=vals.get("Department (Class)"),
            dept_group_bd=vals.get("Department Group (BD)"),
        )
        for (acct, dept), vals in DEPT_MAP.items()
    ]
    db.bulk_save_objects(dept_rows)
    db.flush()

    return len(account_rows) + len(dept_rows)


def init_db() -> None:
    """Run pending Alembic migrations, then create any remaining tables."""
    from sqlalchemy import inspect
    inspector = inspect(engine)
    is_fresh  = "users" not in inspector.get_table_names()
    # Alembic must run before create_all so that its DDL statements are not
    # pre-empted by create_all (which causes DuplicateTable errors that roll
    # back the entire migration transaction, including earlier steps in the run).
    _run_alembic(stamp_if_fresh=is_fresh)
    Base.metadata.create_all(bind=engine)

    # Seed mapping tables from mapping_data.py on first install
    try:
        with get_db() as db:
            n = seed_fpa_mappings(db)
            if n:
                import sys
                print(f"[init_db] Seeded {n} FPA mapping rows", file=sys.stderr, flush=True)
    except Exception as exc:
        import sys
        print(f"[init_db] FPA mapping seed warning: {exc}", file=sys.stderr, flush=True)
