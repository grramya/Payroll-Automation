"""app_api.py — FastAPI backend for Payroll JE Automation.

Run with:
    uvicorn app_api:app --reload --port 8000
"""
from __future__ import annotations
import math
import os
import re
import sys
import uuid
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

from processing.reader import parse_all_from_raw
from processing.mapper import load_mapping
from processing.aggregator import (
    aggregate_by_department,
    process_special_columns,
    aggregate_company_wide,
)
from processing.je_builder import build_je
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

# ── In-memory session storage ──────────────────────────────────────────────────
_sessions: dict[str, dict] = {}
_MAP_PATH = BASE_DIR / "Mapping" / "Mapping.xlsx"

_SKIP_COLS = {
    "Company Code", "Company Name", "Employee ID", "Employee Name",
    "Department Long Descr", "Location Long Descr", "Pay Frequency Descr Long",
    "Invoice Number", "Pay End Date", "Check Date",
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_session(session_id: str) -> dict:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    return _sessions[session_id]


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
    return {
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


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate_je(
    file: UploadFile = File(...),
    journal_number: str = Form(...),
    entry_date: str = Form(...),
    provision_desc: str = Form(""),
    _: dict = _auth,
):
    file_bytes = await file.read()
    filename = file.filename or "payroll.xlsx"

    # Single Excel read — validate on the already-parsed result instead of re-reading
    raw_df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None, dtype=object)
    df_check, _, _, _ = parse_all_from_raw(raw_df)
    issues = validate_payroll_df(df_check, filename)
    if issues:
        raise HTTPException(status_code=422, detail={"errors": issues})

    je_df, summary, ctx = _run_pipeline_from_raw(raw_df, journal_number, entry_date, provision_desc)

    clean_stem = re.sub(
        r"^Invoice_Supporting_Details[\s_\-]*", "",
        Path(filename).stem,
        flags=re.IGNORECASE,
    ).strip()
    je_filename = f"JE for {clean_stem}.xlsx"

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "je_df": je_df,
        "je_filename": je_filename,
        "summary": summary,
        "payroll_gt": ctx["payroll_gt"],
        "je_provision": ctx["je_provision"],
        "journal_number": journal_number,
        "entry_date": entry_date,
        "provision_desc": provision_desc,
        "unmapped_cols": ctx["unmapped_cols"],
        "na_mapped_cols": ctx["na_mapped_cols"],
        "dept_summary": ctx["dept_summary"],
        "pf_bytes": file_bytes,
        "pf_name": filename,
    }

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
async def get_je(session_id: str, _: dict = _auth):
    s = _get_session(session_id)
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
async def update_je(session_id: str, body: dict = Body(...), _: dict = _auth):
    s = _get_session(session_id)
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

    log_action_async(
        action="JE Edited",
        input_file=s.get("pf_name", ""),
        output_file=s["je_filename"],
        journal_number=s.get("journal_number", ""),
        details=f"{len(je_df)} lines after edit",
    )
    return {"ok": True, "je_provision": je_provision}


@app.get("/api/je/{session_id}/download")
async def download_je(session_id: str, _: dict = _auth):
    s = _get_session(session_id)
    je_df = s["je_df"]
    buf = BytesIO()
    je_df.to_excel(buf, index=False)
    buf.seek(0)
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
async def regenerate_je(session_id: str, body: dict = Body(...), _: dict = _auth):
    s = _get_session(session_id)
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
async def post_to_qbo(session_id: str, _: dict = _auth):
    import asyncio
    from qbo.api import QBOClient

    s = _get_session(session_id)
    je_df = s["je_df"]

    def _do_post():
        try:
            client = QBOClient()
        except FileNotFoundError:
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")

        # All three maps read from local CSVs — no parallel threads needed
        account_map = client.fetch_account_map()
        class_map   = client.fetch_class_map()
        vendor_map  = client.fetch_vendor_map()

        payload = QBOClient.build_je_payload(
            je_df,
            journal_number=s.get("journal_number", ""),
            txn_date=s.get("entry_date", ""),
            private_note=s.get("provision_desc", ""),
            account_map=account_map,
            class_map=class_map,
            vendor_map=vendor_map,
        )
        return client.create_journal_entry(payload)

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


def _read_qbo_csv(path: Path) -> dict:
    if path.exists():
        df = pd.read_csv(str(path), dtype=str).fillna("")
        return {"rows": _df_to_records(df), "columns": list(df.columns), "source": "local"}
    return {"rows": [], "columns": [], "source": "none"}


def _save_qbo_csv(path: Path, rows: list) -> None:
    path.parent.mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(str(path), index=False)


@app.get("/api/qbo/accounts")
async def qbo_accounts(_: dict = _auth):
    return _read_qbo_csv(_QBO_ACCOUNTS_CSV)


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
        client = QBOClient()
        df = client.get_accounts_dataframe()
        _save_qbo_csv(_QBO_ACCOUNTS_CSV, _df_to_records(df))
        return {"rows": _df_to_records(df), "columns": list(df.columns), "source": "qbo"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/qbo/vendors")
async def qbo_vendors(_: dict = _auth):
    return _read_qbo_csv(_QBO_VENDORS_CSV)


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
        client = QBOClient()
        df = client.get_vendors_dataframe()
        _save_qbo_csv(_QBO_VENDORS_CSV, _df_to_records(df))
        return {"rows": _df_to_records(df), "columns": list(df.columns), "source": "qbo"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_QBO_CLASSES_CSV = BASE_DIR / "qbo" / "classes_override.csv"


@app.get("/api/qbo/classes")
async def qbo_classes(_: dict = _auth):
    return _read_qbo_csv(_QBO_CLASSES_CSV)


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
        client = QBOClient()
        df = client.get_classes_dataframe()
        _save_qbo_csv(_QBO_CLASSES_CSV, _df_to_records(df))
        return {"rows": _df_to_records(df), "columns": list(df.columns), "source": "qbo"}
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
