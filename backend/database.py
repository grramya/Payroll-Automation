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
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index,
    Integer, String, Text, create_engine,
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

engine       = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ── Auth ───────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id                 = Column(Integer, primary_key=True, autoincrement=True)
    username           = Column(String(255), unique=True, nullable=False)
    password           = Column(Text, nullable=False)
    role               = Column(String(50), nullable=False, default="user")
    created            = Column(DateTime(timezone=True), nullable=False)
    deleted_at         = Column(DateTime(timezone=True), nullable=True)
    can_access_payroll = Column(Boolean, nullable=False, default=False)
    can_access_fpa     = Column(Boolean, nullable=False, default=False)
    can_access_portco  = Column(Boolean, nullable=False, default=False)
    portco_dept        = Column(String(100), nullable=True)
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),
    )


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti        = Column(String(255), primary_key=True)
    revoked_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


# ── Payroll JE Sessions ────────────────────────────────────────────────────────

class JeSession(Base):
    __tablename__ = "je_sessions"
    id       = Column(String(255), primary_key=True)
    # Fix 6: FK to users.username; NO ACTION keeps sessions after soft-delete
    owner    = Column(String(255), ForeignKey("users.username", ondelete="NO ACTION"), nullable=False)
    payload  = Column(JSONB, nullable=False)
    # pf_bytes removed — payroll files are now stored on the filesystem (Fix 1)
    saved_at = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        Index("ix_je_sessions_owner", "owner"),
    )


# ── PortCo Reporting ──────────────────────────────────────────────────────────

class PortcoDataStore(Base):
    __tablename__ = "portco_data"
    id         = Column(Integer, primary_key=True, autoincrement=False, default=1)
    data       = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_portco_data_singleton"),
    )


# ── QBO OAuth Tokens ──────────────────────────────────────────────────────────

class QboToken(Base):
    __tablename__ = "qbo_tokens"
    company       = Column(String(100), primary_key=True)
    # access_token and refresh_token are encrypted at rest (Fix 3)
    access_token  = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    realm_id      = Column(String(100), nullable=False, default="")
    token_type    = Column(String(50), nullable=False, default="Bearer")
    expires_at    = Column(DateTime(timezone=True), nullable=False)


# ── QBO Overrides (accounts / vendors / classes) ──────────────────────────────
# Fix 2: replaced the single-row-per-type JSONB blob (qbo_overrides) with a
# normalized table — one DB row per override entry, enabling row-level CRUD.

class QboOverrideItem(Base):
    __tablename__ = "qbo_override_items"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    type      = Column(String(50), nullable=False)   # 'accounts' | 'vendors' | 'classes'
    data      = Column(JSONB, nullable=False)         # one override row (arbitrary dict)
    source    = Column(String(50), nullable=True)     # 'qbo' | 'manual'
    synced_at = Column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        Index("ix_qbo_override_items_type", "type"),
    )


# ── Activity Log ──────────────────────────────────────────────────────────────

class ActivityLogEntry(Base):
    __tablename__ = "activity_log"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    timestamp      = Column(DateTime(timezone=True), nullable=False)
    # Fix 4: renamed from 'user' (reserved keyword) to 'username'
    # Fix 6: FK to users.username; SET NULL keeps log rows after soft-delete
    username       = Column(String(255), ForeignKey("users.username", ondelete="SET NULL"), nullable=True)
    ip_address     = Column(String(100), nullable=True)
    hostname       = Column(String(255), nullable=True)
    action         = Column(String(255), nullable=False)
    input_file     = Column(Text, nullable=True)
    output_file    = Column(Text, nullable=True)
    journal_number = Column(String(255), nullable=True)
    details        = Column(Text, nullable=True)
    changes_made   = Column(Text, nullable=True)
    __table_args__ = (
        Index("ix_activity_log_username", "username"),
        Index("ix_activity_log_timestamp", "timestamp"),
    )


# ── Pydantic schemas for JSONB validation ─────────────────────────────────────

class JeSessionPayloadSchema(BaseModel):
    model_config = {"extra": "allow"}
    je_df_records:        list[dict[str, Any]] = []
    je_df_columns:        list[str]            = []
    dept_summary_records: list[dict[str, Any]] = []
    je_filename:          str                  = ""


class PortcoDataSchema(BaseModel):
    actuals: dict[str, Any] = {}
    budget:  dict[str, Any] = {}
    year:    int             = 0


class QboOverrideRowSchema(BaseModel):
    model_config = {"extra": "allow"}


# ── Token encryption (Fix 3) ──────────────────────────────────────────────────

def _build_fernet() -> "Fernet | None":
    key = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
    if not key:
        return None
    try:
        return Fernet(key.encode())
    except Exception:
        return None

_fernet = _build_fernet()


def encrypt_token(t: str) -> str:
    """Encrypt an OAuth token before DB storage. No-op if TOKEN_ENCRYPTION_KEY is unset."""
    if _fernet is None or not t:
        return t
    return _fernet.encrypt(t.encode()).decode()


def decrypt_token(t: str) -> str:
    """Decrypt an OAuth token read from DB. Falls back to plaintext for pre-encryption tokens."""
    if _fernet is None or not t:
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


# ── Database initialisation with Alembic (Fix 5) ─────────────────────────────

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


def init_db() -> None:
    """Create all tables (idempotent), then run pending Alembic migrations."""
    from sqlalchemy import inspect
    inspector = inspect(engine)
    is_fresh  = "users" not in inspector.get_table_names()
    Base.metadata.create_all(bind=engine)
    _run_alembic(stamp_if_fresh=is_fresh)
