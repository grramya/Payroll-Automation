"""app_api.py — FastAPI backend for Payroll JE Automation.

Run with:
    uvicorn app_api:app --reload --port 8000
"""
from __future__ import annotations
import base64
import json
import math
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pandas as pd
import threading
import time
from collections import defaultdict

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Body, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm

from auth import (
    init_db, authenticate_user, create_access_token,
    get_current_user, get_user, hash_password, get_db,
    oauth2_scheme, revoke_token,
)

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent / "fpa"))

from dotenv import load_dotenv
load_dotenv()

BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))

from processing.reader import parse_all_from_raw, get_file_metadata
from processing.mapper import load_mapping
from processing.aggregator import (
    aggregate_by_department,
    process_special_columns,
    aggregate_company_wide,
)
from processing.je_builder import build_je, export_je_to_bytes
from processing.validator import validate_payroll_df, validate_mapping, validate_je
from processing.consolidator import append_input_to_consolidated, append_to_consolidated
from processing.logger import log_action_async

app = FastAPI(title="Payroll JE Automation API", version="1.0.0")


@app.get("/api/health", tags=["meta"])
async def health():
    """Liveness probe — used by Docker and load balancers."""
    return {"status": "ok"}

# Initialise auth database on startup
init_db()

_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

_CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

class CSRFMiddleware(BaseHTTPMiddleware):
    """
    Reject state-changing requests (POST/PUT/DELETE/PATCH) that come from a
    different origin.  Bearer-token APIs are already CSRF-resistant because
    browsers cannot set the Authorization header cross-origin, but this adds a
    second layer by checking the Origin/Referer header against the allow-list.
    Requests with no Origin (e.g. curl, server-to-server, Swagger UI) are
    allowed so the API remains usable from tools and scripts.
    """
    async def dispatch(self, request: Request, call_next):
        if request.method not in _CSRF_SAFE_METHODS:
            origin = request.headers.get("origin") or request.headers.get("referer", "")
            if origin:
                # Strip path from referer so "http://localhost:5173/step/2" → "http://localhost:5173"
                from urllib.parse import urlparse as _up
                parsed = _up(origin)
                origin_base = f"{parsed.scheme}://{parsed.netloc}"
                if origin_base not in _origins:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "CSRF check failed: request origin not allowed."},
                    )
        return await call_next(request)

app.add_middleware(CSRFMiddleware)

# ── Paths ──────────────────────────────────────────────────────────────────────
_MAP_PATH    = BASE_DIR / "Mapping" / "Mapping.xlsx"
_CACHE_DIR   = BASE_DIR / "cache"
_CACHE_FILE  = _CACHE_DIR / "qbo_cache.json"
_SESSION_DIR = BASE_DIR / "sessions"
_SESSION_DIR.mkdir(exist_ok=True)

_SESSION_TTL_HOURS = 48  # sessions expire after 48 hours of inactivity

_SKIP_COLS = {
    "Company Code", "Company Name", "Employee ID", "Employee Name",
    "Department Long Descr", "Location Long Descr", "Pay Frequency Descr Long",
    "Invoice Number", "Pay End Date", "Check Date",
}

# ── File-backed session storage ────────────────────────────────────────────────
# Sessions survive server restarts by persisting each session as a JSON file.
# DataFrames are stored as records; raw bytes are base64-encoded.

_sessions: dict[str, dict] = {}  # in-memory cache (populated from disk on startup)


def _session_to_json(s: dict) -> dict:
    """Convert a session dict (with DataFrames/bytes) to a JSON-serialisable form."""
    out = {k: v for k, v in s.items() if k not in ("je_df", "dept_summary", "pf_bytes")}
    if "je_df" in s and s["je_df"] is not None:
        out["je_df_records"] = s["je_df"].to_dict(orient="records")
        out["je_df_columns"] = list(s["je_df"].columns)
    if "dept_summary" in s and s["dept_summary"] is not None:
        out["dept_summary_records"] = s["dept_summary"].to_dict(orient="records")
    if "pf_bytes" in s and s["pf_bytes"]:
        out["pf_bytes_b64"] = base64.b64encode(s["pf_bytes"]).decode()
    return out


def _session_from_json(d: dict) -> dict:
    """Reconstruct a session dict (with DataFrames/bytes) from the persisted JSON form."""
    s = {k: v for k, v in d.items()
         if k not in ("je_df_records", "je_df_columns", "dept_summary_records", "pf_bytes_b64")}
    if "je_df_records" in d:
        cols = d.get("je_df_columns")
        df = pd.DataFrame(d["je_df_records"], columns=cols) if cols else pd.DataFrame(d["je_df_records"])
        s["je_df"] = df
    if "dept_summary_records" in d:
        s["dept_summary"] = pd.DataFrame(d["dept_summary_records"])
    if "pf_bytes_b64" in d:
        s["pf_bytes"] = base64.b64decode(d["pf_bytes_b64"])
    return s


def _session_file(session_id: str) -> Path:
    return _SESSION_DIR / f"{session_id}.json"


def _persist_session(session_id: str, s: dict) -> None:
    """Write session to disk (non-blocking; errors are logged to stderr)."""
    try:
        data = _session_to_json(s)
        data["_saved_at"] = datetime.now(tz=timezone.utc).isoformat()
        _session_file(session_id).write_text(json.dumps(data), encoding="utf-8")
    except Exception as exc:
        print(f"[Session] Failed to persist {session_id}: {exc}", file=sys.stderr, flush=True)


def _load_sessions_from_disk() -> None:
    """On startup: load all non-expired session files into the in-memory cache."""
    cutoff = time.time() - _SESSION_TTL_HOURS * 3600
    for f in _SESSION_DIR.glob("*.json"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
                continue
            d = json.loads(f.read_text(encoding="utf-8"))
            sid = f.stem
            _sessions[sid] = _session_from_json(d)
        except Exception as exc:
            print(f"[Session] Could not load {f.name}: {exc}", file=sys.stderr, flush=True)


_load_sessions_from_disk()


# ── Per-user JE generation rate limiter ───────────────────────────────────────
_gen_attempts: dict[str, list[float]] = defaultdict(list)
_GEN_MAX_CALLS  = 3
_GEN_WINDOW_SEC = 60


def _check_generate_rate(username: str) -> None:
    now = time.time()
    _gen_attempts[username] = [t for t in _gen_attempts[username] if now - t < _GEN_WINDOW_SEC]
    if len(_gen_attempts[username]) >= _GEN_MAX_CALLS:
        raise HTTPException(
            status_code=429,
            detail="Too many JE generations. Wait a moment before trying again.",
        )
    _gen_attempts[username].append(now)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_session(session_id: str, current_user: dict | None = None) -> dict:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    s = _sessions[session_id]
    # Enforce ownership — admins may access any session
    if current_user and current_user.get("role") != "admin":
        if s.get("owner") != current_user["username"]:
            raise HTTPException(status_code=403, detail="Access denied: this session belongs to another user")
    return s


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    """Convert DataFrame to JSON-serializable list of dicts (handles NaN/Inf)."""
    records = df.to_dict(orient="records")
    clean = []
    for row in records:
        clean_row = {}
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                clean_row[k] = None
            else:
                clean_row[k] = v
        clean.append(clean_row)
    return clean


def _detect_unmapped(
    df: pd.DataFrame, known_items: set, pay_item_map: dict
) -> tuple[list, list]:
    skip = _SKIP_COLS | {c for c in df.columns if str(c).lower().startswith("unnamed")}
    known_norm = {k.strip().lower() for k in known_items}
    mapped_norm = {k.strip().lower() for k in pay_item_map}
    unmapped = [c for c in df.columns if c not in skip and c.strip().lower() not in known_norm]
    na_mapped = [
        c for c in df.columns
        if c not in skip and c.strip().lower() in known_norm and c.strip().lower() not in mapped_norm
    ]
    return unmapped, na_mapped


def _run_pipeline_from_raw(raw_df: pd.DataFrame, journal_number: str, entry_date: str, provision_desc: str):
    """Run the full pipeline from a pre-parsed raw DataFrame (header=None)."""
    df, full_df, invoice_df, payroll_grand_total = parse_all_from_raw(raw_df)

    pay_item_map, dept_allocation, known_items, pay_item_id_map = load_mapping(str(_MAP_PATH))
    map_warnings = validate_mapping(pay_item_map, dept_allocation)

    regular_lines = aggregate_by_department(df, pay_item_map, dept_allocation, pay_item_id_map)
    company_lines = aggregate_company_wide(df, pay_item_map, invoice_df, pay_item_id_map)
    special_lines = process_special_columns(df, pay_item_map, dept_allocation, pay_item_id_map)

    prov_id_entry = pay_item_id_map.get("Provision for date", {})
    provision_account_id = prov_id_entry.get("COGS") or prov_id_entry.get("Indirect") or ""

    je_df = build_je(
        regular_lines=regular_lines + company_lines,
        special_lines=special_lines,
        journal_number=journal_number,
        entry_date=entry_date,
        provision_description=provision_desc,
        provision_account_id=provision_account_id,
    )
    validate_je(je_df)

    je_provision = round(
        float(
            je_df["Credit (exc. Tax)"]
            .where(je_df["Account"] == "Accrued Expenses:Accrued Payroll", 0)
            .fillna(0)
            .sum()
        ),
        2,
    )
    unmapped_cols, na_mapped_cols = _detect_unmapped(df, known_items, pay_item_map)
    dept_summary = (
        df.groupby("Department Long Descr")
        .agg(Employees=("Employee ID", "count"))
        .reset_index()
        .rename(columns={"Department Long Descr": "Department"})
    )

    return (
        je_df,
        {
            "total": len(je_df),
            "regular": len(regular_lines),
            "special": len(special_lines),
        },
        {
            "payroll_gt": payroll_grand_total,
            "je_provision": je_provision,
            "unmapped_cols": unmapped_cols,
            "na_mapped_cols": na_mapped_cols,
            "dept_summary": dept_summary,
            "map_warnings": map_warnings,
        },
    )


def _run_pipeline(pf_bytes: bytes, journal_number: str, entry_date: str, provision_desc: str):
    """Convenience wrapper: read Excel bytes then run the pipeline."""
    raw_df = pd.read_excel(BytesIO(pf_bytes), sheet_name=0, header=None, dtype=object)
    return _run_pipeline_from_raw(raw_df, journal_number, entry_date, provision_desc)


def _safe_append_input(file_bytes: bytes, journal_number: str) -> None:
    """Background-safe wrapper for append_input_to_consolidated (errors suppressed)."""
    try:
        append_input_to_consolidated(file_bytes, journal_number)
    except Exception:
        pass


# ── QBO background cache ───────────────────────────────────────────────────────

def _save_qbo_cache(data: dict) -> None:
    import json as _json
    _CACHE_DIR.mkdir(exist_ok=True)
    _CACHE_FILE.write_text(_json.dumps(data), encoding="utf-8")


def _refresh_qbo_cache() -> tuple[bool, str]:
    """Fetch all QBO transactions, run the FP&A transform, and persist to disk cache.

    Silently no-ops when QBO is not yet authenticated. Called both by the
    background scheduler and by the manual SSE fetch endpoint.
    """
    import base64 as _b64
    import pandas as _pd
    from datetime import datetime as _dt, date as _date

    company_name   = os.environ.get("QBO_AUTO_FETCH_COMPANY_NAME",    "Concertiv")
    include_broker = os.environ.get("QBO_AUTO_FETCH_INCLUDE_BROKER",  "false").lower() == "true"

    try:
        from qbo.auth import is_authenticated, get_company_info
        if not is_authenticated():
            return False, "QBO not authenticated — skipping cache refresh"
    except Exception as exc:
        return False, f"Auth check failed: {exc}"

    try:
        from fpa.qbo_fetch import fetch_company_transactions
        from fpa.transform import run_transform_from_df

        today = _date.today().isoformat()
        main_df  = fetch_company_transactions("main", "1900-01-01", today)
        combined = main_df

        if include_broker:
            try:
                if get_company_info("broker").get("connected"):
                    broker_df = fetch_company_transactions("broker", "1900-01-01", today)
                    combined  = _pd.concat([main_df, broker_df], ignore_index=True)
            except Exception:
                pass

        (
            excel_bytes, summary, preview,
            bs_bytes, bs_preview,
            bsi_bytes, bsi_preview,
            pl_bytes, pl_preview,
            comp_pl_bytes, comp_pl_preview,
            comp_pl_bd_bytes, comp_pl_bd_preview,
        ) = run_transform_from_df(combined, company_name)

        _save_qbo_cache({
            "cached_at":            _dt.now().isoformat(),
            "company_name":         company_name,
            "summary":              summary,
            "preview":              preview,
            "excel_b64":            _b64.b64encode(excel_bytes).decode(),
            "bs_excel_b64":         _b64.b64encode(bs_bytes).decode(),
            "bs_preview":           bs_preview,
            "bsi_excel_b64":        _b64.b64encode(bsi_bytes).decode(),
            "bsi_preview":          bsi_preview,
            "pl_excel_b64":         _b64.b64encode(pl_bytes).decode(),
            "pl_preview":           pl_preview,
            "comp_pl_excel_b64":    _b64.b64encode(comp_pl_bytes).decode(),
            "comp_pl_preview":      comp_pl_preview,
            "comp_pl_bd_excel_b64": _b64.b64encode(comp_pl_bd_bytes).decode(),
            "comp_pl_bd_preview":   comp_pl_bd_preview,
        })
        return True, f"Cached {len(combined):,} rows at {_dt.now().isoformat()}"

    except Exception as exc:
        import traceback as _tb
        return False, f"{exc}\n{_tb.format_exc()}"


def _qbo_auto_fetch_loop() -> None:
    """Daemon thread:
    • First startup: fetch immediately (30 s delay) if no cache exists yet.
    • Mapping watch: rebuilds the cache automatically within ~60 s of any
      change to fpa/mapping_data.py — no manual refresh needed.
    • Daily run: full re-fetch at QBO_AUTO_FETCH_TIME (default 10:00 local).
    """
    from datetime import datetime as _dt

    _mapping_py = BASE_DIR / "fpa" / "mapping_data.py"

    if not _CACHE_FILE.exists():
        time.sleep(30)
        _refresh_qbo_cache()

    fetch_time_str = os.environ.get("QBO_AUTO_FETCH_TIME", "11:30")
    hour, minute   = map(int, fetch_time_str.split(":"))

    last_mtime      = _mapping_py.stat().st_mtime if _mapping_py.exists() else 0.0
    last_daily_date = None

    while True:
        time.sleep(60)
        now = _dt.now()

        # ── Mapping file changed? rebuild cache immediately ───────────────────
        if _mapping_py.exists():
            mtime = _mapping_py.stat().st_mtime
            if mtime != last_mtime:
                last_mtime = mtime
                _refresh_qbo_cache()
                continue

        # ── Daily scheduled run ───────────────────────────────────────────────
        if now.hour == hour and now.minute == minute and last_daily_date != now.date():
            last_daily_date = now.date()
            _refresh_qbo_cache()


threading.Thread(target=_qbo_auto_fetch_loop, daemon=True, name="qbo-auto-fetch").start()


# ── Brute-force / rate-limit protection ───────────────────────────────────────
# Tracks failed login timestamps per key (username or IP).
# After _MAX_ATTEMPTS failures within _WINDOW seconds → locked for _LOCKOUT seconds.

_login_attempts: dict[str, list[float]] = defaultdict(list)
_MAX_ATTEMPTS = 5
_WINDOW       = 15 * 60   # sliding 15-minute window
_LOCKOUT      = 15 * 60   # lockout duration

def _check_lockout(key: str) -> None:
    now = time.time()
    # Prune attempts older than the window
    _login_attempts[key] = [t for t in _login_attempts[key] if now - t < _WINDOW]
    if len(_login_attempts[key]) >= _MAX_ATTEMPTS:
        wait = int(_LOCKOUT - (now - _login_attempts[key][0]))
        mins = max(1, (wait + 59) // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {mins} minute(s).",
        )

def _record_attempt(key: str) -> None:
    _login_attempts[key].append(time.time())

def _clear_attempts(key: str) -> None:
    _login_attempts.pop(key, None)


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    username = form_data.username.strip()
    ip = request.client.host if request.client else "unknown"

    # Enforce lockout before touching the database
    _check_lockout(f"user:{username}")
    _check_lockout(f"ip:{ip}")

    user = authenticate_user(username, form_data.password)
    if not user:
        _record_attempt(f"user:{username}")
        _record_attempt(f"ip:{ip}")
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Success — clear counters
    _clear_attempts(f"user:{username}")
    _clear_attempts(f"ip:{ip}")

    token = create_access_token({"sub": user["username"], "role": user["role"]})
    return {
        "access_token": token, "token_type": "bearer",
        "username": user["username"], "role": user["role"],
        "can_access_payroll": bool(user.get("can_access_payroll", 0)),
        "can_access_fpa": bool(user.get("can_access_fpa", 0)),
    }


@app.post("/api/auth/logout")
async def logout(token: str = Depends(oauth2_scheme)):
    """Blacklist the supplied JWT so it is rejected on all future requests."""
    revoke_token(token)
    return {"ok": True}


@app.post("/api/auth/reset-password")
async def reset_password(body: dict = Body(...)):
    """
    Forgot-password flow — no JWT or old password required.
    Caller provides username + new password. Identity is verified by
    the admin-controlled environment (internal tool, no public exposure).
    """
    username = body.get("username", "").strip()
    new_pw   = body.get("new_password", "")

    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    with get_db() as conn:
        result = conn.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (hash_password(new_pw), username),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="No account found with that username.")
    return {"ok": True}


@app.post("/api/auth/change-own-password")
async def change_own_password(request: Request, body: dict = Body(...)):
    """
    Change password without a JWT — caller proves identity via old credentials.
    Used from the login page so users can update their password before signing in.
    """
    username = body.get("username", "").strip()
    old_pw   = body.get("old_password", "")
    new_pw   = body.get("new_password", "")

    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    # Verify current credentials before allowing any change
    user = authenticate_user(username, old_pw)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or current password.")

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (hash_password(new_pw), username),
        )
    return {"ok": True}


@app.get("/api/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "role": current_user["role"],
        "can_access_payroll": bool(current_user.get("can_access_payroll", 0)),
        "can_access_fpa": bool(current_user.get("can_access_fpa", 0)),
    }


@app.post("/api/auth/change-password")
async def change_password(body: dict = Body(...), current_user: dict = Depends(get_current_user)):
    old_pw = body.get("old_password", "")
    new_pw = body.get("new_password", "")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
    from auth import verify_password
    if not verify_password(old_pw, current_user["password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (hash_password(new_pw), current_user["username"]),
        )
    return {"ok": True}


# ── Shorthand auth dependency ───────────────────────────────────────────────────
_auth = Depends(get_current_user)


def _require_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── User management routes (admin only) ────────────────────────────────────────

@app.get("/api/auth/users")
async def list_users(_: dict = Depends(_require_admin)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, username, role, created, can_access_payroll, can_access_fpa FROM users ORDER BY id"
        ).fetchall()
    return {"users": [dict(r) for r in rows]}


@app.post("/api/auth/users")
async def create_user(body: dict = Body(...), _: dict = Depends(_require_admin)):
    username = body.get("username", "").strip()
    password = body.get("password", "")
    role = body.get("role", "user")
    can_payroll = 1 if body.get("can_access_payroll") else 0
    can_fpa     = 1 if body.get("can_access_fpa") else 0
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not password or len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, password, role, can_access_payroll, can_access_fpa) VALUES (?, ?, ?, ?, ?)",
                (username, hash_password(password), role, can_payroll, can_fpa),
            )
    except Exception:
        raise HTTPException(status_code=409, detail="Username already exists")
    return {"ok": True}


@app.delete("/api/auth/users/{username}")
async def delete_user(username: str, current_user: dict = Depends(_require_admin)):
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    with get_db() as conn:
        result = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@app.put("/api/auth/users/{username}/reset-password")
async def reset_user_password(username: str, body: dict = Body(...), _: dict = Depends(_require_admin)):
    new_pw = body.get("password", "")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    with get_db() as conn:
        result = conn.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (hash_password(new_pw), username),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@app.put("/api/auth/users/{username}/permissions")
async def update_user_permissions(username: str, body: dict = Body(...), _: dict = Depends(_require_admin)):
    can_payroll = 1 if body.get("can_access_payroll") else 0
    can_fpa     = 1 if body.get("can_access_fpa") else 0
    with get_db() as conn:
        result = conn.execute(
            "UPDATE users SET can_access_payroll = ?, can_access_fpa = ? WHERE username = ?",
            (can_payroll, can_fpa, username),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ── FP&A Routes ────────────────────────────────────────────────────────────────

def _require_fpa(current_user: dict = Depends(get_current_user)):
    if not current_user.get("can_access_fpa") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="FP&A access not granted")
    return current_user


@app.post("/api/fpa/meta")
async def fpa_meta(input_file: UploadFile = File(...), _: dict = Depends(get_current_user)):
    try:
        from fpa.transform import get_file_meta
        input_bytes = await input_file.read()
        return get_file_meta(input_bytes)
    except Exception:
        return {"company_name": ""}


@app.post("/api/fpa/transform")
async def fpa_transform(
    input_file:   UploadFile = File(...),
    company_name: str        = Form(default="Acme Corp, Inc."),
    _: dict = Depends(_require_fpa),
):
    import base64 as _b64
    try:
        input_bytes = await input_file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File read error: {e}")
    try:
        from fpa.transform import run_transform
        (
            excel_bytes, summary, preview,
            bs_bytes, bs_preview,
            bsi_bytes, bsi_preview,
            pl_bytes, pl_preview,
            comp_pl_bytes, comp_pl_preview,
            comp_pl_bd_bytes, comp_pl_bd_preview,
        ) = run_transform(input_bytes, company_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transform error: {e}")
    from datetime import datetime as _dt
    return {
        "cached_at":            _dt.now().isoformat(),
        "summary":              summary,
        "preview":              preview,
        "excel_b64":            _b64.b64encode(excel_bytes).decode(),
        "bs_excel_b64":         _b64.b64encode(bs_bytes).decode(),
        "bs_preview":           bs_preview,
        "bsi_excel_b64":        _b64.b64encode(bsi_bytes).decode(),
        "bsi_preview":          bsi_preview,
        "pl_excel_b64":         _b64.b64encode(pl_bytes).decode(),
        "pl_preview":           pl_preview,
        "comp_pl_excel_b64":    _b64.b64encode(comp_pl_bytes).decode(),
        "comp_pl_preview":      comp_pl_preview,
        "comp_pl_bd_excel_b64": _b64.b64encode(comp_pl_bd_bytes).decode(),
        "comp_pl_bd_preview":   comp_pl_bd_preview,
    }


# ── QBO OAuth callback (handles both main and broker company auth) ─────────────

# In-memory state store for CSRF protection (nonce → company)
_qbo_oauth_states: dict[str, str] = {}


@app.get("/api/fpa/qbo-auth-url")
async def fpa_qbo_auth_url(
    company: str = "main",
    _: dict = Depends(get_current_user),
):
    """
    Generate the Intuit OAuth 2.0 authorization URL for the given company.
    company: 'main' | 'broker'
    Returns the URL plus whether callback-mode or paste-mode should be used.
    """
    import secrets as _secrets
    import urllib.parse as _parse
    from qbo import config as _cfg

    if company not in ("main", "broker"):
        raise HTTPException(status_code=400, detail="company must be 'main' or 'broker'")

    nonce = _secrets.token_urlsafe(16)
    state = f"{company}:{nonce}"
    _qbo_oauth_states[nonce] = company

    params = {
        "client_id":     _cfg.CLIENT_ID,
        "response_type": "code",
        "scope":         _cfg.SCOPES,
        "redirect_uri":  _cfg.REDIRECT_URI,
        "state":         state,
    }
    auth_url = _cfg.AUTHORIZATION_URL + "?" + _parse.urlencode(params)

    # Detect whether we are using the Playground URL (paste-mode) or our own callback
    playground_url = "developer.intuit.com/v2/OAuth2Playground"
    use_paste_mode = playground_url in _cfg.REDIRECT_URI

    return {
        "auth_url":       auth_url,
        "company":        company,
        "paste_mode":     use_paste_mode,
        "redirect_uri":   _cfg.REDIRECT_URI,
    }


@app.post("/api/fpa/qbo-exchange-url")
async def fpa_qbo_exchange_url(
    body: dict = Body(...),
    _: dict = Depends(get_current_user),
):
    """
    Accept the full redirect URL the user copied from the browser after Intuit
    authorization (paste-mode flow) and exchange the code for tokens.

    Body: { "redirect_url": "https://...", "company": "main"|"broker" }
    """
    import urllib.parse as _parse
    from qbo.auth import exchange_code_for_tokens_for_company

    redirect_url = (body.get("redirect_url") or "").strip()
    company      = body.get("company", "main")

    if not redirect_url:
        raise HTTPException(status_code=400, detail="redirect_url is required")
    if company not in ("main", "broker"):
        raise HTTPException(status_code=400, detail="company must be 'main' or 'broker'")

    parsed = _parse.urlparse(redirect_url)
    qs     = _parse.parse_qs(parsed.query)

    if "error" in qs:
        raise HTTPException(status_code=400, detail=f"Intuit error: {qs['error'][0]}")

    code     = qs.get("code",    [""])[0]
    realm_id = qs.get("realmId", [""])[0]

    if not code:
        raise HTTPException(
            status_code=400,
            detail="No authorization code found in the URL. Copy the full URL from the browser address bar."
        )

    try:
        store = exchange_code_for_tokens_for_company(code, realm_id, company)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"connected": True, "realm_id": store.realm_id, "company": company}


@app.get("/api/qbo/callback")
async def qbo_oauth_callback(
    code: str = "",
    realmId: str = "",
    state: str = "",
    error: str = "",
):
    """
    OAuth 2.0 redirect endpoint — Intuit calls this after the user authorizes.
    Exchanges the code for tokens, saves per-company token file, then returns
    a small HTML page the user can close.
    """
    from fastapi.responses import HTMLResponse
    from qbo.auth import exchange_code_for_tokens_for_company

    if error:
        return HTMLResponse(
            f"<h2 style='color:red;font-family:sans-serif'>Authorization failed</h2>"
            f"<p>{error}</p><p>You can close this tab.</p>",
            status_code=400,
        )

    # Parse state to determine company
    company = "main"
    if ":" in state:
        nonce = state.split(":", 1)[1]
        company = _qbo_oauth_states.pop(nonce, "main")

    try:
        exchange_code_for_tokens_for_company(code, realmId, company)
    except Exception as exc:
        return HTMLResponse(
            f"<h2 style='color:red;font-family:sans-serif'>Token exchange failed</h2>"
            f"<p>{exc}</p><p>You can close this tab.</p>",
            status_code=500,
        )

    label = "Main Company" if company == "main" else "Broker Company"
    return HTMLResponse(
        f"<h2 style='color:green;font-family:sans-serif'>"
        f"Connected: {label}</h2>"
        f"<p style='font-family:sans-serif'>You can close this tab and return to the app.</p>"
        f"<script>window.close();</script>"
    )


@app.get("/api/fpa/qbo-status")
async def fpa_qbo_status(_: dict = Depends(get_current_user)):
    """Return QBO connection status for both main and broker companies."""
    from qbo.auth import get_company_info
    from qbo import config as _cfg
    return {
        "main":   {**get_company_info("main"),   "company_name": "Concertiv"},
        "broker": {**get_company_info("broker"), "company_name": _cfg.BROKER_COMPANY_NAME},
        "sandbox": _cfg.USE_SANDBOX,
    }


@app.post("/api/fpa/qbo-fetch")
async def fpa_qbo_fetch(
    body: dict = Body(...),
    _: dict = Depends(_require_fpa),
):
    """
    Stream fetch progress via SSE, then deliver the full result as the final event.

    Events: { step, msg }  — progress updates
             { step: "done", data: {...} }  — final result
             { step: "error", msg: "..." }  — failure
    """
    import asyncio
    import base64 as _b64
    import json
    import traceback as _tb
    import pandas as _pd
    from fastapi.responses import StreamingResponse
    from fpa.qbo_fetch import fetch_company_transactions
    from fpa.transform import run_transform_from_df

    from datetime import date as _date
    company_name   = body.get("company_name", "Concertiv").strip()
    start_date     = "1900-01-01"
    end_date       = _date.today().isoformat()
    include_broker = bool(body.get("include_broker", False))

    def _evt(step: str, msg: str = "", **extra) -> str:
        return f"data: {json.dumps({'step': step, 'msg': msg, **extra})}\n\n"

    async def generate():
        try:
            yield _evt("connecting", "Authenticating with QuickBooks Online…")

            # ── Fetch main company ────────────────────────────────────────────
            yield _evt("fetching_main", "Fetching all transactions from QBO…")
            try:
                main_df = await asyncio.to_thread(
                    fetch_company_transactions, "main", start_date, end_date
                )
            except FileNotFoundError as e:
                yield _evt("error", str(e)); return
            except Exception as e:
                yield _evt("error", f"QBO fetch error: {e}"); return

            combined_df = main_df

            # ── Optionally fetch broker ───────────────────────────────────────
            if include_broker:
                yield _evt("fetching_broker", "Fetching broker company transactions…")
                try:
                    broker_df = await asyncio.to_thread(
                        fetch_company_transactions, "broker", start_date, end_date
                    )
                    combined_df = _pd.concat([main_df, broker_df], ignore_index=True)
                except FileNotFoundError as e:
                    yield _evt("error", str(e)); return
                except Exception as e:
                    yield _evt("error", f"Broker fetch error: {e}"); return

            # ── Stream raw rows so the UI can show them immediately ───────────
            raw_rows = _df_to_records(combined_df)
            yield _evt("rows", f"Fetched {len(raw_rows):,} transactions from QBO.",
                       total=len(raw_rows), rows=raw_rows)

            # ── Transform ─────────────────────────────────────────────────────
            yield _evt("transforming", f"Running FP&A transform on {len(combined_df):,} rows…")
            try:
                result_tuple = await asyncio.to_thread(
                    run_transform_from_df, combined_df, company_name
                )
            except Exception as e:
                yield _evt("error", f"Transform error: {e}\n{_tb.format_exc()}"); return

            (
                excel_bytes, summary, preview,
                bs_bytes, bs_preview,
                bsi_bytes, bsi_preview,
                pl_bytes, pl_preview,
                comp_pl_bytes, comp_pl_preview,
                comp_pl_bd_bytes, comp_pl_bd_preview,
            ) = result_tuple

            yield _evt("packaging", "Packaging reports…")

            from datetime import datetime as _dt2
            result = {
                "cached_at":            _dt2.now().isoformat(),
                "summary":              summary,
                "preview":              preview,
                "excel_b64":            _b64.b64encode(excel_bytes).decode(),
                "bs_excel_b64":         _b64.b64encode(bs_bytes).decode(),
                "bs_preview":           bs_preview,
                "bsi_excel_b64":        _b64.b64encode(bsi_bytes).decode(),
                "bsi_preview":          bsi_preview,
                "pl_excel_b64":         _b64.b64encode(pl_bytes).decode(),
                "pl_preview":           pl_preview,
                "comp_pl_excel_b64":    _b64.b64encode(comp_pl_bytes).decode(),
                "comp_pl_preview":      comp_pl_preview,
                "comp_pl_bd_excel_b64": _b64.b64encode(comp_pl_bd_bytes).decode(),
                "comp_pl_bd_preview":   comp_pl_bd_preview,
            }

            # Persist so next app load serves this data from cache
            try:
                _save_qbo_cache({"company_name": company_name, **result})
            except Exception:
                pass

            yield _evt("done", "All reports ready.", data=result)

        except Exception as e:
            yield _evt("error", f"Unexpected error: {e}\n{_tb.format_exc()}")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/fpa/qbo-cache/status")
async def fpa_qbo_cache_status(_: dict = Depends(get_current_user)):
    """Return cache metadata without the heavy b64 blobs (used for 'Last refreshed' UI)."""
    if not _CACHE_FILE.exists():
        return {"cached": False}
    import json as _json
    from datetime import datetime as _dt
    try:
        data      = _json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
        cached_at = data.get("cached_at")
        age_min   = None
        if cached_at:
            age_min = round((_dt.now() - _dt.fromisoformat(cached_at)).total_seconds() / 60, 1)
        _STALE_AFTER_HOURS = 24
        is_stale = (age_min is not None) and (age_min > _STALE_AFTER_HOURS * 60)
        return {
            "cached":       True,
            "cached_at":    cached_at,
            "age_minutes":  age_min,
            "is_stale":     is_stale,
            "company_name": data.get("company_name"),
            "total_rows":   data.get("summary", {}).get("total_rows"),
        }
    except Exception:
        return {"cached": False}


@app.get("/api/fpa/qbo-cache")
async def fpa_qbo_cache(_: dict = Depends(get_current_user)):
    """Return the full cached FP&A result (same shape as the SSE 'done' event data)."""
    if not _CACHE_FILE.exists():
        raise HTTPException(status_code=404, detail="No cache available yet — QBO fetch has not run")
    import json as _json
    try:
        return _json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/api/parse-file")
async def parse_file_metadata(
    file: UploadFile = File(...),
    _: dict = _auth,
):
    file_bytes = await file.read()
    meta = get_file_metadata(BytesIO(file_bytes))
    return {"journal_number": meta.get("journal_number", ""), "invoice_date": meta.get("invoice_date", "")}


@app.post("/api/generate")
async def generate_je(
    file: UploadFile = File(...),
    journal_number: str = Form(...),
    entry_date: str = Form(...),
    provision_desc: str = Form(""),
    current_user: dict = Depends(get_current_user),
):
    # Per-user rate limit
    _check_generate_rate(current_user["username"])

    # Validate journal_number
    jn = journal_number.strip()
    if not jn:
        raise HTTPException(status_code=422, detail={"errors": ["Journal Number is required."]})
    if len(jn) > 200:
        raise HTTPException(status_code=422, detail={"errors": ["Journal Number is too long (max 200 characters)."]})

    # Validate entry_date format (must be MM/DD/YYYY)
    from datetime import datetime as _dt
    try:
        _dt.strptime(entry_date.strip(), "%m/%d/%Y")
    except ValueError:
        raise HTTPException(status_code=422, detail={"errors": [f"Entry Date '{entry_date}' is invalid. Expected MM/DD/YYYY."]})

    file_bytes = await file.read()
    filename = file.filename or "payroll.xlsx"

    # Single Excel read — validate on the already-parsed result instead of re-reading
    raw_df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None, dtype=object)
    df_check, _, _, _ = parse_all_from_raw(raw_df)
    issues = validate_payroll_df(df_check, filename)
    if issues:
        raise HTTPException(status_code=422, detail={"errors": issues})

    je_df, summary, ctx = _run_pipeline_from_raw(raw_df, jn, entry_date.strip(), provision_desc)

    clean_stem = re.sub(
        r"^Invoice_Supporting_Details[\s_\-]*", "",
        Path(filename).stem,
        flags=re.IGNORECASE,
    ).strip()
    je_filename = f"JE for {clean_stem}.xlsx"

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "owner": current_user["username"],
        "je_df": je_df,
        "je_filename": je_filename,
        "summary": summary,
        "payroll_gt": ctx["payroll_gt"],
        "je_provision": ctx["je_provision"],
        "journal_number": jn,
        "entry_date": entry_date.strip(),
        "provision_desc": provision_desc,
        "unmapped_cols": ctx["unmapped_cols"],
        "na_mapped_cols": ctx["na_mapped_cols"],
        "dept_summary": ctx["dept_summary"],
        "pf_bytes": file_bytes,
        "pf_name": filename,
    }
    threading.Thread(
        target=_persist_session, args=(session_id, _sessions[session_id]), daemon=True
    ).start()

    # Persist input file synchronously (needed for audit trail)
    # If the file is open in another program (e.g. Excel), skip silently.
    inputs_dir = BASE_DIR / "inputs"
    inputs_dir.mkdir(exist_ok=True)
    try:
        (inputs_dir / filename).write_bytes(file_bytes)
    except PermissionError:
        pass

    # Append to consolidated inputs in the background — slow openpyxl cell-copy
    # does not need to block the HTTP response
    threading.Thread(
        target=_safe_append_input,
        args=(file_bytes, journal_number),
        daemon=True,
    ).start()

    log_action_async(
        action="JE Generated",
        input_file=filename,
        output_file=je_filename,
        journal_number=journal_number,
        details=f"{summary['total']} lines ({summary['regular']} dept + {summary['special']} employee + 1 provision)",
    )

    return {
        "session_id": session_id,
        "je_rows": _df_to_records(je_df),
        "columns": list(je_df.columns),
        "je_filename": je_filename,
        "summary": summary,
        "payroll_gt": ctx["payroll_gt"],
        "je_provision": ctx["je_provision"],
        "unmapped_cols": ctx["unmapped_cols"],
        "na_mapped_cols": ctx["na_mapped_cols"],
        "dept_summary": _df_to_records(ctx["dept_summary"]),
        "warnings": ctx["map_warnings"],
    }


@app.get("/api/je/{session_id}")
async def get_je(session_id: str, current_user: dict = Depends(get_current_user)):
    s = _get_session(session_id, current_user)
    je_df = s["je_df"]
    return {
        "je_rows": _df_to_records(je_df),
        "columns": list(je_df.columns),
        "je_filename": s["je_filename"],
        "summary": s["summary"],
        "payroll_gt": s["payroll_gt"],
        "je_provision": s["je_provision"],
        "unmapped_cols": s["unmapped_cols"],
        "na_mapped_cols": s["na_mapped_cols"],
        "dept_summary": _df_to_records(s["dept_summary"]),
    }


@app.put("/api/je/{session_id}")
async def update_je(session_id: str, body: dict = Body(...), current_user: dict = Depends(get_current_user)):
    s = _get_session(session_id, current_user)
    rows = body.get("rows", [])
    je_df = pd.DataFrame(rows)
    s["je_df"] = je_df

    je_provision = round(
        float(
            je_df["Credit (exc. Tax)"]
            .where(je_df["Account"] == "Accrued Expenses:Accrued Payroll", 0)
            .fillna(0)
            .sum()
        ),
        2,
    )
    s["je_provision"] = je_provision
    threading.Thread(target=_persist_session, args=(session_id, s), daemon=True).start()

    log_action_async(
        action="JE Edited",
        input_file=s.get("pf_name", ""),
        output_file=s["je_filename"],
        journal_number=s.get("journal_number", ""),
        details=f"{len(je_df)} lines after edit",
    )
    return {"ok": True, "je_provision": je_provision}


@app.get("/api/je/{session_id}/download")
async def download_je(session_id: str, current_user: dict = Depends(get_current_user)):
    s = _get_session(session_id, current_user)
    je_df = s["je_df"]
    je_bytes = export_je_to_bytes(je_df)
    buf = BytesIO(je_bytes)
    filename = s["je_filename"]
    try:
        append_to_consolidated(je_df, s.get("journal_number", ""))
    except Exception:
        pass
    log_action_async(
        action="JE Downloaded",
        input_file=s.get("pf_name", ""),
        output_file=filename,
        journal_number=s.get("journal_number", ""),
    )
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/regenerate/{session_id}")
async def regenerate_je(session_id: str, body: dict = Body(...), current_user: dict = Depends(get_current_user)):
    s = _get_session(session_id, current_user)
    pf_bytes = s.get("pf_bytes")
    if not pf_bytes:
        raise HTTPException(status_code=400, detail="No payroll file in session")

    journal_number = body.get("journal_number", s.get("journal_number", ""))
    entry_date = body.get("entry_date", s.get("entry_date", ""))
    provision_desc = body.get("provision_desc", s.get("provision_desc", ""))

    je_df, summary, ctx = _run_pipeline(pf_bytes, journal_number, entry_date, provision_desc)

    s.update(
        {
            "je_df": je_df,
            "summary": summary,
            "je_provision": ctx["je_provision"],
            "journal_number": journal_number,
            "entry_date": entry_date,
            "provision_desc": provision_desc,
            "unmapped_cols": ctx["unmapped_cols"],
            "na_mapped_cols": ctx["na_mapped_cols"],
        }
    )
    threading.Thread(target=_persist_session, args=(session_id, s), daemon=True).start()

    log_action_async(
        action="JE Regenerated",
        input_file=s.get("pf_name", ""),
        output_file=s["je_filename"],
        journal_number=journal_number,
        details="JE regenerated after Mapping file update.",
    )

    return {
        "je_rows": _df_to_records(je_df),
        "columns": list(je_df.columns),
        "summary": summary,
        "je_provision": ctx["je_provision"],
        "unmapped_cols": ctx["unmapped_cols"],
        "na_mapped_cols": ctx["na_mapped_cols"],
    }


@app.get("/api/mapping")
async def get_mapping(_: dict = _auth):
    if not _MAP_PATH.exists():
        raise HTTPException(status_code=404, detail="Mapping file not found")
    map_df = pd.read_excel(_MAP_PATH, sheet_name=0, header=None, dtype=str).fillna("")
    for id_c in [3, 4]:
        if id_c < len(map_df.columns):
            map_df[id_c] = map_df[id_c].str.replace(r"\.0$", "", regex=True)
    cols = [
        "Pay Item", "COGS GL Account", "Indirect GL Account",
        "COGS ID", "Indirect ID", "_col5", "Department", "Allocation", "Notes",
    ]
    if len(map_df.columns) >= 9:
        map_df.columns = cols
    return {"rows": _df_to_records(map_df), "columns": list(map_df.columns)}


@app.put("/api/mapping")
async def save_mapping(body: dict = Body(...), _: dict = _auth):
    rows = body.get("rows", [])
    map_df = pd.DataFrame(rows)
    with pd.ExcelWriter(str(_MAP_PATH), engine="openpyxl") as writer:
        map_df.to_excel(writer, index=False, header=False, sheet_name="Sheet1")
    log_action_async(
        action="Mapping Updated",
        input_file="Mapping.xlsx",
        output_file="Mapping.xlsx",
        details="Mapping file edited and saved via UI.",
    )
    return {"ok": True}


@app.post("/api/je/{session_id}/post-qbo")
async def post_to_qbo(session_id: str, current_user: dict = Depends(get_current_user)):
    import asyncio
    from qbo.api import QBOClient

    s = _get_session(session_id, current_user)
    je_df = s["je_df"]

    pf_bytes = s.get("pf_bytes")
    pf_name  = s.get("pf_name") or "Invoice_Supporting_Details.xlsx"

    def _do_post():
        try:
            client = QBOClient()
        except FileNotFoundError:
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")

        account_map = client.fetch_account_map()
        class_map   = client.fetch_class_map()
        vendor_map  = client.fetch_vendor_map()

        if not account_map:
            raise HTTPException(
                status_code=400,
                detail="Chart of Accounts is empty. Go to Step 4 → Chart of Accounts → Sync from QBO first.",
            )

        payload = QBOClient.build_je_payload(
            je_df,
            journal_number=s.get("journal_number", ""),
            txn_date=s.get("entry_date", ""),
            private_note=s.get("provision_desc", ""),
            account_map=account_map,
            class_map=class_map,
            vendor_map=vendor_map,
        )
        result = client.create_journal_entry(payload)
        je_id  = str(result.get("Id", ""))

        # Attach the original payroll input file — required, not optional
        if not pf_bytes:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Journal Entry posted to QBO (ID: {je_id}) but the original payroll file "
                    "could not be attached because the file data is no longer in session. "
                    "Please attach it manually in QBO."
                ),
            )

        client.attach_file_to_je(
            je_id=je_id,
            filename=pf_name,
            file_bytes=pf_bytes,
        )

        return result

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _do_post)
        log_action_async(
            action="JE Posted to QBO",
            input_file=s.get("pf_name", ""),
            output_file=s["je_filename"],
            journal_number=s.get("journal_number", ""),
            details=f"QBO ID: {result.get('Id')}, DocNumber: {result.get('DocNumber')}",
        )
        return {"ok": True, "id": result.get("Id"), "doc_number": result.get("DocNumber")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/qbo/status")
async def qbo_status(_: dict = _auth):
    try:
        from qbo.config import are_credentials_set
        from qbo.auth import is_authenticated, TokenStore

        if not are_credentials_set():
            return {"authenticated": False, "creds_configured": False}
        authenticated = is_authenticated()
        store = TokenStore.load()
        result: dict = {"authenticated": authenticated, "creds_configured": True}
        if store:
            from datetime import datetime as _dt
            result["realm_id"] = store.realm_id
            result["expires"] = _dt.fromtimestamp(store.expires_at).isoformat()
        return result
    except Exception as e:
        return {"authenticated": False, "creds_configured": False, "error": str(e)}


@app.post("/api/qbo/auth-start")
async def qbo_auth_start(_: dict = _auth):
    """Return the OAuth authorization URL so the frontend can open it."""
    try:
        from qbo.auth import get_authorization_url
        url = get_authorization_url()
        return {"auth_url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/qbo/auth-complete")
async def qbo_auth_complete(body: dict = Body(...), _: dict = _auth):
    """Exchange the redirect URL (containing code + state) for tokens."""
    redirect_url = body.get("redirect_url", "")
    try:
        from qbo.auth import exchange_redirect_url
        exchange_redirect_url(redirect_url)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/qbo/disconnect")
async def qbo_disconnect(_: dict = _auth):
    try:
        from qbo.auth import revoke_tokens
        revoke_tokens()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_QBO_ACCOUNTS_CSV = BASE_DIR / "qbo" / "accounts_override.csv"
_QBO_VENDORS_CSV  = BASE_DIR / "qbo" / "vendors_override.csv"


def _csv_meta_path(csv_path: Path) -> Path:
    return csv_path.with_name(csv_path.stem + ".meta.json")


def _read_csv_meta(csv_path: Path) -> dict:
    meta_path = _csv_meta_path(csv_path)
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _write_csv_meta(csv_path: Path, source: str, row_count: int) -> None:
    meta = {
        "last_synced": datetime.now(tz=timezone.utc).isoformat(),
        "source": source,
        "row_count": row_count,
    }
    try:
        _csv_meta_path(csv_path).write_text(json.dumps(meta), encoding="utf-8")
    except Exception:
        pass


def _read_qbo_csv(path: Path) -> dict:
    if path.exists():
        df = pd.read_csv(str(path), dtype=str).fillna("")
        meta = _read_csv_meta(path)
        return {
            "rows": _df_to_records(df),
            "columns": list(df.columns),
            "source": "local",
            "last_synced": meta.get("last_synced"),
            "sync_source": meta.get("source", "unknown"),
        }
    return {"rows": [], "columns": [], "source": "none", "last_synced": None, "sync_source": None}


def _save_qbo_csv(path: Path, rows: list, source: str = "manual") -> None:
    path.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(str(path), index=False)
    _write_csv_meta(path, source=source, row_count=len(rows))


def _fetch_and_cache_qbo(csv_path: Path, fetch_fn) -> dict:
    """Fetch live from QBO, update the local CSV cache, and return the data."""
    df = fetch_fn()
    records = _df_to_records(df)
    _save_qbo_csv(csv_path, records, source="qbo")
    synced_at = datetime.now(tz=timezone.utc).isoformat()
    return {"rows": records, "columns": list(df.columns), "source": "qbo", "last_synced": synced_at, "sync_source": "qbo"}


@app.get("/api/qbo/accounts")
async def qbo_accounts(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_ACCOUNTS_CSV, QBOClient().get_accounts_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/accounts")
async def save_qbo_accounts(body: dict = Body(...), _: dict = _auth):
    _save_qbo_csv(_QBO_ACCOUNTS_CSV, body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/accounts/sync")
async def sync_qbo_accounts(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_ACCOUNTS_CSV, QBOClient().get_accounts_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/qbo/vendors")
async def qbo_vendors(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_VENDORS_CSV, QBOClient().get_vendors_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/vendors")
async def save_qbo_vendors(body: dict = Body(...), _: dict = _auth):
    _save_qbo_csv(_QBO_VENDORS_CSV, body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/vendors/sync")
async def sync_qbo_vendors(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_VENDORS_CSV, QBOClient().get_vendors_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_QBO_CLASSES_CSV = BASE_DIR / "qbo" / "classes_override.csv"


@app.get("/api/qbo/classes")
async def qbo_classes(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_CLASSES_CSV, QBOClient().get_classes_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/classes")
async def save_qbo_classes(body: dict = Body(...), _: dict = _auth):
    _save_qbo_csv(_QBO_CLASSES_CSV, body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/classes/sync")
async def sync_qbo_classes(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo(_QBO_CLASSES_CSV, QBOClient().get_classes_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/activity-log")
async def get_activity_log(_: dict = _auth):
    log_path = BASE_DIR / "logs" / "Activity_Log.xlsx"
    if not log_path.exists():
        return {"rows": [], "columns": []}
    log_df = pd.read_excel(log_path, dtype=str).fillna("")
    log_df = log_df.iloc[::-1].reset_index(drop=True)
    return {"rows": _df_to_records(log_df), "columns": list(log_df.columns)}


@app.get("/api/activity-log/download")
async def download_activity_log(_: dict = _auth):
    log_path = BASE_DIR / "logs" / "Activity_Log.xlsx"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="No activity log found")
    return StreamingResponse(
        BytesIO(log_path.read_bytes()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Activity_Log.xlsx"'},
    )


@app.get("/api/consolidated/je/download")
async def download_consolidated_je(_: dict = _auth):
    from processing.consolidator import CONSOLIDATED_PATH
    if not CONSOLIDATED_PATH.exists():
        raise HTTPException(status_code=404, detail="No consolidated JE file found. Download a JE first to generate it.")
    return StreamingResponse(
        BytesIO(CONSOLIDATED_PATH.read_bytes()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Consolidated_Payroll.xlsx"'},
    )


@app.get("/api/consolidated/inputs/download")
async def download_consolidated_inputs(_: dict = _auth):
    from processing.consolidator import CONSOLIDATED_INPUTS_PATH
    if not CONSOLIDATED_INPUTS_PATH.exists():
        raise HTTPException(status_code=404, detail="No consolidated inputs file found. Generate a JE first to build it.")
    return StreamingResponse(
        BytesIO(CONSOLIDATED_INPUTS_PATH.read_bytes()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Consolidated_Inputs.xlsx"'},
    )
