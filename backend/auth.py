"""auth.py — SQLite-backed authentication for Payroll JE Automation."""
from __future__ import annotations

import sqlite3
import uuid
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends
from fastapi.security import OAuth2PasswordBearer

import os
from dotenv import load_dotenv
load_dotenv()

SECRET_KEY = os.environ.get("PJE_SECRET_KEY", "payroll-je-secret-key-change-in-production")
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8  # tokens expire after 8 hours

_data_dir = Path(os.environ.get("PJE_DATA_DIR", str(Path(__file__).parent)))
DB_PATH   = _data_dir / "auth.db"

pwd_context   = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Database ───────────────────────────────────────────────────────────────────
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create tables and default admin user if they don't exist."""
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                username            TEXT    UNIQUE NOT NULL,
                password            TEXT    NOT NULL,
                role                TEXT    NOT NULL DEFAULT 'user',
                created             TEXT    NOT NULL DEFAULT (datetime('now')),
                can_access_payroll  INTEGER NOT NULL DEFAULT 0,
                can_access_fpa      INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Persistent JWT blacklist — survives server restarts
        conn.execute("""
            CREATE TABLE IF NOT EXISTS revoked_tokens (
                jti        TEXT PRIMARY KEY,
                revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
        """)
        # Migrate existing DB: add permission columns if they don't exist yet
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "can_access_payroll" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN can_access_payroll INTEGER NOT NULL DEFAULT 0")
        if "can_access_fpa" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN can_access_fpa INTEGER NOT NULL DEFAULT 0")

        # Create or sync admin user
        existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        admin_pw = os.environ.get("PJE_ADMIN_PASSWORD", "")

        if existing == 0:
            # First run — create admin
            if not admin_pw:
                admin_pw = str(uuid.uuid4())
                print(
                    f"\n{'='*60}\n"
                    f"  FIRST RUN — Default admin credentials:\n"
                    f"  Username : admin\n"
                    f"  Password : {admin_pw}\n"
                    f"  Change this password or set PJE_ADMIN_PASSWORD in .env\n"
                    f"{'='*60}\n",
                    flush=True,
                    file=sys.stderr,
                )
            conn.execute(
                "INSERT INTO users (username, password, role, can_access_payroll, can_access_fpa) VALUES (?, ?, ?, 1, 1)",
                ("admin", pwd_context.hash(admin_pw), "admin"),
            )
        else:
            # Ensure existing admin has full access
            conn.execute(
                "UPDATE users SET can_access_payroll=1, can_access_fpa=1 WHERE role='admin' AND (can_access_payroll=0 AND can_access_fpa=0)"
            )
            # If PJE_ADMIN_PASSWORD is set in .env, always keep the admin hash in sync with it
            if admin_pw:
                conn.execute(
                    "UPDATE users SET password = ? WHERE username = 'admin'",
                    (pwd_context.hash(admin_pw),),
                )

    # Purge expired tokens from the blacklist on startup
    _purge_expired_revoked_tokens()


def _purge_expired_revoked_tokens() -> None:
    """Remove tokens whose expiry has passed — they can no longer be used anyway."""
    try:
        with get_db() as conn:
            conn.execute(
                "DELETE FROM revoked_tokens WHERE expires_at < datetime('now')"
            )
    except Exception:
        pass


# ── Token blacklist — persisted in SQLite ──────────────────────────────────────

def revoke_token(token: str) -> None:
    """Add a JWT to the SQLite blacklist so it is rejected on every future request."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = payload.get("jti", "")
        exp = payload.get("exp")
        if not jti:
            return
        expires_at_str = (
            datetime.fromtimestamp(exp, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            if exp else "2099-12-31 00:00:00"
        )
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)",
                (jti, expires_at_str),
            )
    except Exception:
        pass


def _is_token_revoked(jti: str) -> bool:
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT 1 FROM revoked_tokens WHERE jti = ?", (jti,)
            ).fetchone()
            return row is not None
    except Exception:
        return False


# ── Password helpers ───────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


# ── JWT helpers ────────────────────────────────────────────────────────────────
def create_access_token(data: dict) -> str:
    payload = data.copy()
    expire = datetime.now(tz=timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload["exp"] = expire
    payload["jti"] = str(uuid.uuid4())
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── User helpers ───────────────────────────────────────────────────────────────
def get_user(username: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None


def authenticate_user(username: str, password: str) -> dict | None:
    user = get_user(username)
    if not user or not verify_password(password, user["password"]):
        return None
    return user


# ── FastAPI dependency ─────────────────────────────────────────────────────────
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_token(token)
    jti = payload.get("jti", "")
    if jti and _is_token_revoked(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = get_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
