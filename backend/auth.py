"""auth.py — PostgreSQL-backed authentication for Finance Suite."""
from __future__ import annotations

import uuid
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends, Request, Cookie
from fastapi.security import OAuth2PasswordBearer

import os
from dotenv import load_dotenv
load_dotenv()

from database import (
    get_db, init_db as _db_init,
    User, UserPermission, RevokedToken, ActivityLogEntry,
)

SECRET_KEY                = os.environ.get("PJE_SECRET_KEY", "payroll-je-secret-key-change-in-production")
ALGORITHM                 = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8

def verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith(("$2b$", "$2a$", "$2y$")):
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    # Legacy passlib pbkdf2_sha256 hashes — verify without loading the bcrypt backend
    try:
        from passlib.context import CryptContext
        return CryptContext(schemes=["pbkdf2_sha256"]).verify(plain, hashed)
    except Exception:
        return False


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()

# auto_error=False so the dependency returns None instead of raising when
# no Bearer header is present; get_current_user checks the cookie first.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create all tables and seed the admin user on first run."""
    # Validate critical env vars before touching the database
    _validate_env()

    _db_init()

    admin_pw = os.environ.get("PJE_ADMIN_PASSWORD", "")

    with get_db() as db:
        count = db.query(User).filter(User.deleted_at.is_(None)).count()

        if count == 0:
            if not admin_pw:
                admin_pw = str(uuid.uuid4())
                # Write to a file, not to stdout/stderr, so it doesn't appear in log aggregators
                _write_admin_password(admin_pw)
            admin = User(
                username="admin",
                password=hash_password(admin_pw),
                role="admin",
                created=datetime.now(tz=timezone.utc),
            )
            db.add(admin)
            db.flush()
            for module in ("payroll", "fpa", "portco"):
                db.add(UserPermission(user_id=admin.id, module=module))
        else:
            if admin_pw:
                db.query(User).filter(
                    User.username == "admin", User.deleted_at.is_(None)
                ).update({"password": hash_password(admin_pw)})
            # Ensure every admin user has all module permissions
            for admin_user in db.query(User).filter(
                User.role == "admin", User.deleted_at.is_(None)
            ).all():
                for module in ("payroll", "fpa", "portco"):
                    db.merge(UserPermission(user_id=admin_user.id, module=module))

    _purge_expired_revoked_tokens()
    _purge_old_activity_log()


_INSECURE_DEFAULT_KEY = "payroll-je-secret-key-change-in-production"

def _validate_env() -> None:
    """Raise on startup if critical env vars are missing or insecure."""
    encryption_key = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
    if not encryption_key:
        raise RuntimeError(
            "\n\n"
            "  TOKEN_ENCRYPTION_KEY is not set.\n"
            "  QBO OAuth tokens must be encrypted at rest in the database.\n"
            "  Generate a key with:\n"
            "    python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"\n"
            "  Then add TOKEN_ENCRYPTION_KEY=<key> to your .env file.\n"
        )

    secret = os.environ.get("PJE_SECRET_KEY", "")
    is_production = os.environ.get("USE_HTTPS", "false").lower() == "true"

    if is_production and (not secret or secret == _INSECURE_DEFAULT_KEY):
        # Hard failure in production — the default key is public knowledge
        raise RuntimeError(
            "\n\n"
            "  PJE_SECRET_KEY is not set or is using the insecure default value.\n"
            "  This key signs all JWT tokens. Using the default in production\n"
            "  allows anyone to forge authentication tokens.\n"
            "  Generate a strong key:\n"
            "    python -c \"import secrets; print(secrets.token_hex(32))\"\n"
            "  Then set PJE_SECRET_KEY=<key> in your .env file.\n"
        )
    elif not secret or secret == _INSECURE_DEFAULT_KEY:
        # Warning only in development
        print(
            "[WARNING] PJE_SECRET_KEY is using the default insecure value. "
            "Set a strong random key in .env before deploying to production.\n"
            "  Generate: python -c \"import secrets; print(secrets.token_hex(32))\"",
            file=sys.stderr, flush=True,
        )

    if secret and len(secret) < 32:
        print(
            f"[WARNING] PJE_SECRET_KEY is only {len(secret)} characters long. "
            "Recommend at least 32 characters (64 hex chars from secrets.token_hex(32)).",
            file=sys.stderr, flush=True,
        )


def _write_admin_password(password: str) -> None:
    """Write the auto-generated admin password to a local file (not to logs)."""
    from pathlib import Path
    pw_file = Path(__file__).parent / "admin_password.txt"
    try:
        pw_file.write_text(
            f"Auto-generated admin credentials (first-run only)\n"
            f"Username : admin\n"
            f"Password : {password}\n\n"
            f"Delete this file and set PJE_ADMIN_PASSWORD in .env to prevent regeneration.\n"
        )
        print(
            f"\n{'='*60}\n"
            f"  FIRST RUN — admin credentials written to:\n"
            f"  {pw_file}\n"
            f"  Change password or set PJE_ADMIN_PASSWORD in .env\n"
            f"{'='*60}\n",
            file=sys.stderr, flush=True,
        )
    except Exception:
        # Last-resort fallback: print to stderr only if we can't write the file
        print(
            f"\n{'='*60}\n"
            f"  FIRST RUN — Default admin credentials:\n"
            f"  Username : admin\n"
            f"  Password : {password}\n"
            f"  Change this password or set PJE_ADMIN_PASSWORD in .env\n"
            f"{'='*60}\n",
            file=sys.stderr, flush=True,
        )


def _purge_expired_revoked_tokens() -> None:
    try:
        now = datetime.now(tz=timezone.utc)
        with get_db() as db:
            db.query(RevokedToken).filter(RevokedToken.expires_at < now).delete()
    except Exception:
        pass


def _purge_old_activity_log() -> None:
    """Delete activity_log rows older than 1 year to prevent unbounded growth."""
    try:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=365)
        with get_db() as db:
            db.query(ActivityLogEntry).filter(ActivityLogEntry.timestamp < cutoff).delete()
    except Exception:
        pass


# ── Redis client (optional — gracefully degrades to DB-only if unavailable) ────

def _build_redis():
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis as _redis
        client = _redis.from_url(url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        client.ping()
        return client
    except Exception as exc:
        print(f"[auth] Redis unavailable ({exc}), falling back to DB-only revocation checks.",
              file=sys.stderr, flush=True)
        return None

_redis_client = _build_redis()
_REDIS_REVOKED_PREFIX = "revoked:"


# ── Token blacklist ────────────────────────────────────────────────────────────

def revoke_token(token: str) -> None:
    try:
        payload    = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti        = payload.get("jti", "")
        exp        = payload.get("exp")
        if not jti:
            return
        expires_at = (
            datetime.fromtimestamp(exp, tz=timezone.utc)
            if exp else datetime(2099, 12, 31, tzinfo=timezone.utc)
        )
        ttl = max(int((expires_at - datetime.now(tz=timezone.utc)).total_seconds()), 1)

        # Write to Redis (fast path) + DB (durable fallback)
        if _redis_client:
            try:
                _redis_client.setex(f"{_REDIS_REVOKED_PREFIX}{jti}", ttl, "1")
            except Exception:
                pass

        with get_db() as db:
            if not db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
                db.add(RevokedToken(
                    jti=jti,
                    revoked_at=datetime.now(tz=timezone.utc),
                    expires_at=expires_at,
                ))
    except Exception:
        pass


def _is_token_revoked(jti: str) -> bool:
    # Fast path: Redis cache hit avoids a DB round-trip on every authenticated request
    if _redis_client:
        try:
            if _redis_client.exists(f"{_REDIS_REVOKED_PREFIX}{jti}"):
                return True
            # Confirmed not revoked via Redis — trust it (cache miss means not revoked)
            return False
        except Exception:
            pass  # Redis down — fall through to DB
    # DB fallback (also used on Redis cache miss if Redis is available but key absent)
    try:
        with get_db() as db:
            return db.query(RevokedToken).filter(RevokedToken.jti == jti).first() is not None
    except Exception:
        return False




# ── JWT helpers ────────────────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    payload        = data.copy()
    payload["exp"] = datetime.now(tz=timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
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


# ── Permission helpers ─────────────────────────────────────────────────────────

def _load_permissions(db, user_id: int) -> dict:
    """Return a permissions dict sourced from the user_permissions table."""
    perms = db.query(UserPermission).filter(UserPermission.user_id == user_id).all()
    modules = {p.module for p in perms}
    portco_perm = next((p for p in perms if p.module == "portco"), None)
    return {
        "can_access_payroll": "payroll" in modules,
        "can_access_fpa":     "fpa"     in modules,
        "can_access_portco":  "portco"  in modules,
        "portco_dept":        portco_perm.dept if portco_perm else None,
    }


def _row_to_dict(user: User, perms: dict) -> dict:
    return {
        "id":                 user.id,
        "username":           user.username,
        "role":               user.role,
        "created":            user.created.isoformat() if user.created else None,
        "can_access_payroll": int(perms.get("can_access_payroll", False)),
        "can_access_fpa":     int(perms.get("can_access_fpa",     False)),
        "can_access_portco":  int(perms.get("can_access_portco",  False)),
        "portco_dept":        perms.get("portco_dept"),
    }


# ── User helpers ───────────────────────────────────────────────────────────────

def get_user_password_hash(username: str) -> str | None:
    """Return the stored password hash for a non-deleted user, or None if not found."""
    with get_db() as db:
        user = db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).first()
        return user.password if user else None


def get_user(username: str) -> dict | None:
    with get_db() as db:
        user = db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).first()
        if not user:
            return None
        perms = _load_permissions(db, user.id)
        return _row_to_dict(user, perms)


def authenticate_user(username: str, password: str) -> dict | None:
    with get_db() as db:
        user = db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).first()
        if not user or not verify_password(password, user.password):
            return None
        perms = _load_permissions(db, user.id)
        return _row_to_dict(user, perms)


def list_all_users() -> list[dict]:
    with get_db() as db:
        users = (
            db.query(User)
            .filter(User.deleted_at.is_(None))
            .order_by(User.id)
            .all()
        )
        return [_row_to_dict(u, _load_permissions(db, u.id)) for u in users]


def create_user_record(
    username: str, password_hash: str, role: str,
    can_payroll: bool, can_fpa: bool, can_portco: bool,
    portco_dept: str | None,
) -> None:
    with get_db() as db:
        # Resurrect a previously soft-deleted user with the same username
        existing = db.query(User).filter(User.username == username).first()
        if existing is not None:
            if existing.deleted_at is None:
                raise ValueError("Username already exists")
            existing.password   = password_hash
            existing.role       = role
            existing.created    = datetime.now(tz=timezone.utc)
            existing.deleted_at = None
            db.flush()
            user = existing
        else:
            user = User(
                username=username,
                password=password_hash,
                role=role,
                created=datetime.now(tz=timezone.utc),
            )
            db.add(user)
            db.flush()
        db.query(UserPermission).filter(UserPermission.user_id == user.id).delete()
        if can_payroll:
            db.add(UserPermission(user_id=user.id, module="payroll"))
        if can_fpa:
            db.add(UserPermission(user_id=user.id, module="fpa"))
        if can_portco:
            db.add(UserPermission(user_id=user.id, module="portco", dept=portco_dept))


def delete_user_record(username: str) -> bool:
    """Soft-delete — set deleted_at instead of removing the row."""
    with get_db() as db:
        return db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).update({"deleted_at": datetime.now(tz=timezone.utc)}) > 0


def update_user_password(username: str, new_hash: str) -> bool:
    with get_db() as db:
        return db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).update({"password": new_hash}) > 0


def update_user_permissions(
    username: str,
    can_payroll: bool, can_fpa: bool, can_portco: bool,
    portco_dept: str | None,
) -> bool:
    with get_db() as db:
        user = db.query(User).filter(
            User.username == username,
            User.deleted_at.is_(None),
        ).first()
        if not user:
            return False
        db.query(UserPermission).filter(UserPermission.user_id == user.id).delete()
        if can_payroll:
            db.add(UserPermission(user_id=user.id, module="payroll"))
        if can_fpa:
            db.add(UserPermission(user_id=user.id, module="fpa"))
        if can_portco:
            db.add(UserPermission(user_id=user.id, module="portco", dept=portco_dept))
        return True


# ── FastAPI dependency ─────────────────────────────────────────────────────────

def get_current_user(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> dict:
    """Resolve the current user from an httpOnly cookie (preferred) or Bearer header.

    Priority:
      1. access_token httpOnly cookie — set by the /login endpoint
      2. Authorization: Bearer <token> header — supports Swagger UI and API clients
    """
    # Cookie takes priority over Bearer header
    token = request.cookies.get("access_token") or bearer_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload  = decode_token(token)
    jti      = payload.get("jti", "")
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
