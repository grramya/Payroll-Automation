"""auth.py — PostgreSQL-backed authentication for Finance Suite."""
from __future__ import annotations

import uuid
import sys
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends
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

pwd_context   = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create all tables and seed the admin user on first run."""
    _db_init()

    admin_pw = os.environ.get("PJE_ADMIN_PASSWORD", "")

    with get_db() as db:
        count = db.query(User).filter(User.deleted_at.is_(None)).count()

        if count == 0:
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
            admin = User(
                username="admin",
                password=pwd_context.hash(admin_pw),
                role="admin",
                created=datetime.now(tz=timezone.utc),
            )
            db.add(admin)
            db.flush()   # materialise admin.id before creating permissions
            for module in ("payroll", "fpa", "portco"):
                db.add(UserPermission(user_id=admin.id, module=module))
        else:
            if admin_pw:
                db.query(User).filter(
                    User.username == "admin", User.deleted_at.is_(None)
                ).update({"password": pwd_context.hash(admin_pw)})
            # Ensure every admin user has all module permissions
            for admin_user in db.query(User).filter(
                User.role == "admin", User.deleted_at.is_(None)
            ).all():
                for module in ("payroll", "fpa", "portco"):
                    db.merge(UserPermission(user_id=admin_user.id, module=module))

    _purge_expired_revoked_tokens()
    _purge_old_activity_log()


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
    try:
        with get_db() as db:
            return db.query(RevokedToken).filter(RevokedToken.jti == jti).first() is not None
    except Exception:
        return False


# ── Password helpers ───────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


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
            db.flush()   # materialise user.id
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
        # Full replace: delete existing permissions then insert requested ones
        db.query(UserPermission).filter(UserPermission.user_id == user.id).delete()
        if can_payroll:
            db.add(UserPermission(user_id=user.id, module="payroll"))
        if can_fpa:
            db.add(UserPermission(user_id=user.id, module="fpa"))
        if can_portco:
            db.add(UserPermission(user_id=user.id, module="portco", dept=portco_dept))
        return True


# ── FastAPI dependency ─────────────────────────────────────────────────────────

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
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
