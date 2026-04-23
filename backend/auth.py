"""auth.py — SQLite-backed authentication for Payroll JE Automation."""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends
from fastapi.security import OAuth2PasswordBearer

# ── Config ─────────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
load_dotenv()
SECRET_KEY = os.environ.get("PJE_SECRET_KEY", "payroll-je-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = None  # No expiry — token is valid until logout

# When PJE_DATA_DIR is set (Docker), the database lives there so it can
# be stored on a named volume separate from the application code.
_data_dir = Path(os.environ.get("PJE_DATA_DIR", str(Path(__file__).parent)))
DB_PATH   = _data_dir / "auth.db"

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ── Token blacklist — invalidated on logout ────────────────────────────────────
# In-memory set; cleared on server restart (acceptable for internal tool).
# Replace with Redis for multi-process / persistent revocation.
_revoked_tokens: set[str] = set()

def revoke_token(token: str) -> None:
    """Add a JWT to the blacklist so it is rejected on every future request."""
    _revoked_tokens.add(token)


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
        # Migrate existing DB: add permission columns if they don't exist yet
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "can_access_payroll" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN can_access_payroll INTEGER NOT NULL DEFAULT 0")
        if "can_access_fpa" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN can_access_fpa INTEGER NOT NULL DEFAULT 0")

        # Create default admin if no users exist
        existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if existing == 0:
            conn.execute(
                "INSERT INTO users (username, password, role, can_access_payroll, can_access_fpa) VALUES (?, ?, ?, 1, 1)",
                ("admin", pwd_context.hash("admin123"), "admin"),
            )
        else:
            # Ensure existing admin has full access
            conn.execute(
                "UPDATE users SET can_access_payroll=1, can_access_fpa=1 WHERE role='admin' AND (can_access_payroll=0 AND can_access_fpa=0)"
            )


# ── Password helpers ───────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


# ── JWT helpers ────────────────────────────────────────────────────────────────
def create_access_token(data: dict) -> str:
    payload = data.copy()
    # jti (JWT ID) makes every login produce a unique token,
    # so revoking one session never affects a later login by the same user.
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
    if token in _revoked_tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = get_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
