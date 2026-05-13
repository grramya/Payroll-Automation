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
    get_current_user, get_user, hash_password,
    oauth2_scheme, revoke_token, verify_password,
    list_all_users, create_user_record, delete_user_record,
    update_user_password, update_user_permissions,
    get_user_password_hash,                      # Fix 5: for password verification without exposing hash
)
from database import (
    get_db, JeSession, PortcoMetric, QboOverrideItem, ActivityLogEntry,
    JeSessionPayloadSchema, QboOverrideRowSchema,
    BudgetEmployeeCost, BudgetOtherCost,
)

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent / "fpa"))
_sys.path.insert(0, str(Path(__file__).parent / "portco"))

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
from chat import router as chat_router

# ── OpenTelemetry auto-instrumentation ───────────────────────────────────────
# Initialised before FastAPI app creation so the middleware is injected correctly.
# Silently no-ops if the OTEL endpoint is not configured (development mode).
def _setup_otel() -> None:
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        provider = TracerProvider()
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
        trace.set_tracer_provider(provider)

        # SQLAlchemy engine instrumented after engine creation in database.py
        SQLAlchemyInstrumentor().instrument(engine=None, enable_commenter=True)
        print("[otel] Tracing enabled → " + endpoint, file=sys.stderr, flush=True)
        return provider  # type: ignore[return-value]
    except Exception as exc:
        print(f"[otel] Could not initialise tracing: {exc}", file=sys.stderr, flush=True)

_otel_provider = _setup_otel()

app = FastAPI(title="Payroll JE Automation API", version="1.0.0")

# Wire FastAPI instrumentation after app creation
if _otel_provider:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        pass

# ── Standardised error response ────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel

class ApiError(_BaseModel):
    """Machine-readable error envelope returned by every 4xx/5xx response.

    Frontend code should check `error.response.data.code` for programmatic
    handling and display `error.response.data.message` to users.
    """
    code:    str            # snake_case identifier: "INVALID_FILE", "SESSION_NOT_FOUND"
    message: str            # human-readable sentence
    detail:  dict | None = None  # optional structured payload (e.g. field errors)


def _err(code: str, message: str, status_code: int = 400, detail: dict | None = None) -> HTTPException:
    """Convenience wrapper that produces an HTTPException with an ApiError body."""
    return HTTPException(
        status_code=status_code,
        detail=ApiError(code=code, message=message, detail=detail).model_dump(exclude_none=True),
    )


@app.get("/api/health", tags=["meta"])
async def health():
    """Liveness probe — used by Docker and load balancers."""
    return {"status": "ok"}

# Initialise auth database on startup
init_db()

# Seed payroll_config and app_config tables from defaults on first run
try:
    from database import get_db as _get_db_seed
    from config_loader import seed_payroll_config as _seed_payroll_config
    from chat import SYSTEM_PROMPT as _SYSTEM_PROMPT_DEFAULT
    from database import AppConfig as _AppConfig
    with _get_db_seed() as _seed_db:
        n_cfg = _seed_payroll_config(_seed_db)
        if n_cfg:
            print(f"[startup] Seeded {n_cfg} payroll_config rows", file=sys.stderr, flush=True)
        # Seed the chat system prompt only if the key is absent
        if not _seed_db.query(_AppConfig).filter_by(key="chat_system_prompt").first():
            from datetime import datetime as _dt, timezone as _tz
            _seed_db.add(_AppConfig(
                key="chat_system_prompt",
                value=_SYSTEM_PROMPT_DEFAULT,
                updated_at=_dt.now(tz=_tz.utc),
            ))
            print("[startup] Seeded chat_system_prompt in app_config", file=sys.stderr, flush=True)
except Exception as _seed_exc:
    print(f"[startup] Config seed warning: {_seed_exc}", file=sys.stderr, flush=True)

_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    # Explicit allow-lists prevent accidental exposure of non-standard HTTP methods
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["Content-Disposition"],  # needed for download filename
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

# ── File upload validation ─────────────────────────────────────────────────────

_XLSX_MAGIC = b"PK\x03\x04"          # OOXML (.xlsx/.xlsm) ZIP magic bytes
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB hard ceiling

async def _read_and_validate_excel(file: UploadFile) -> bytes:
    """Read an UploadFile, enforce size limit, and verify Excel magic bytes.

    Returns the raw file bytes on success. Raises HTTP 400/413 on failure.
    """
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise _err(
            "FILE_TOO_LARGE",
            f"File exceeds the {_MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
            status_code=413,
        )
    if not data.startswith(_XLSX_MAGIC):
        raise _err(
            "INVALID_FILE_TYPE",
            "Only Excel (.xlsx / .xlsm) files are accepted. "
            "Please do not rename other file types to .xlsx.",
        )
    return data


# ── Paths ──────────────────────────────────────────────────────────────────────
_MAP_PATH    = BASE_DIR / "Mapping" / "Mapping.xlsx"
_SESSION_DIR = BASE_DIR / "sessions"
_SESSION_DIR.mkdir(exist_ok=True)

_SESSION_TTL_HOURS = 48  # sessions expire after 48 hours of inactivity

# Fix 1: payroll file bytes are stored on the filesystem, not as BYTEA in the DB.
# Files are named <session_id>.pf and co-located with other session artefacts.
def _pf_path(session_id: str) -> Path:
    return _SESSION_DIR / f"{session_id}.pf"

def _save_pf_bytes(session_id: str, data: bytes) -> None:
    _pf_path(session_id).write_bytes(data)

def _load_pf_bytes(session_id: str) -> bytes | None:
    p = _pf_path(session_id)
    return p.read_bytes() if p.exists() else None

def _delete_pf_bytes(session_id: str) -> None:
    p = _pf_path(session_id)
    if p.exists():
        p.unlink(missing_ok=True)

_SKIP_COLS = {
    "Company Code", "Company Name", "Employee ID", "Employee Name",
    "Department Long Descr", "Location Long Descr", "Pay Frequency Descr Long",
    "Invoice Number", "Pay End Date", "Check Date",
}

# ── DB-backed session storage ─────────────────────────────────────────────────
# Sessions survive server restarts via the je_sessions PostgreSQL table.
# DataFrames are stored as records; raw bytes are base64-encoded.

_sessions: dict[str, dict] = {}  # in-memory cache (populated from DB on startup)

_MAX_SESSION_JSON_MB = 10  # warn when a single session payload exceeds this size (issue #3)


def _session_to_json(s: dict) -> dict:
    """Convert a session dict (with DataFrames/bytes) to a JSON-serialisable form."""
    # owner_id is stored as a DB column, not in the JSONB payload
    out = {k: v for k, v in s.items() if k not in ("je_df", "dept_summary", "pf_bytes", "owner_id")}
    if "je_df" in s and s["je_df"] is not None:
        out["je_df_records"] = s["je_df"].to_dict(orient="records")
        out["je_df_columns"] = list(s["je_df"].columns)
    if "dept_summary" in s and s["dept_summary"] is not None:
        out["dept_summary_records"] = s["dept_summary"].to_dict(orient="records")
    # Size cap warning — session is still saved; this surfaces runaway payloads (issue #3)
    size_mb = len(json.dumps(out).encode()) / (1024 * 1024)
    if size_mb > _MAX_SESSION_JSON_MB:
        print(
            f"[Session] WARNING: payload is {size_mb:.1f} MB "
            f"(threshold {_MAX_SESSION_JSON_MB} MB) — consider purging old sessions",
            file=sys.stderr, flush=True,
        )
    return out


def _session_from_json(d: dict) -> dict:
    """Reconstruct a session dict (DataFrames only) from the persisted JSONB payload."""
    s = {k: v for k, v in d.items()
         if k not in ("je_df_records", "je_df_columns", "dept_summary_records", "pf_bytes_b64")}
    if "je_df_records" in d:
        cols = d.get("je_df_columns")
        df = pd.DataFrame(d["je_df_records"], columns=cols) if cols else pd.DataFrame(d["je_df_records"])
        s["je_df"] = df
    if "dept_summary_records" in d:
        s["dept_summary"] = pd.DataFrame(d["dept_summary_records"])
    return s


def _payload_json_path(session_id: str) -> Path:
    return _SESSION_DIR / f"{session_id}.json"


def _persist_session(session_id: str, s: dict) -> None:
    """Upsert session: payload written to a JSON file on the sessions volume.

    Storing payload on disk (not as JSONB in PostgreSQL) keeps the je_sessions
    rows slim and avoids TOAST overhead for large JE payloads.
    """
    try:
        payload = _session_to_json(s)
        JeSessionPayloadSchema(**payload)
        pf = s.get("pf_bytes")
        if pf:
            _save_pf_bytes(session_id, pf)

        # Write payload to filesystem
        payload_path = _payload_json_path(session_id)
        payload_path.write_text(json.dumps(payload), encoding="utf-8")

        with get_db() as db:
            row = db.query(JeSession).filter(JeSession.id == session_id).first()
            if row:
                row.payload_path = str(payload_path)
                row.payload      = None   # clear legacy JSONB once file exists
                row.saved_at     = datetime.now(tz=timezone.utc)
            else:
                db.add(JeSession(
                    id=session_id,
                    owner_id=s.get("owner_id"),
                    payload_path=str(payload_path),
                    payload=None,
                    saved_at=datetime.now(tz=timezone.utc),
                ))
    except Exception as exc:
        print(f"[Session] Failed to persist {session_id}: {exc}", file=sys.stderr, flush=True)


def _load_sessions_from_db() -> None:
    """On startup: load all non-expired sessions from DB into the in-memory cache."""
    from datetime import timedelta
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=_SESSION_TTL_HOURS)
    try:
        with get_db() as db:
            rows = db.query(JeSession).filter(JeSession.saved_at >= cutoff).all()
            for row in rows:
                # Prefer filesystem payload (new path), fall back to legacy JSONB
                raw_payload: dict | None = None
                if row.payload_path:
                    p = Path(row.payload_path)
                    if p.exists():
                        try:
                            raw_payload = json.loads(p.read_text(encoding="utf-8"))
                        except Exception:
                            pass
                if raw_payload is None and row.payload:
                    raw_payload = row.payload
                if raw_payload is None:
                    continue
                s = _session_from_json(raw_payload)
                pf = _load_pf_bytes(row.id)
                if pf:
                    s["pf_bytes"] = pf
                elif "pf_bytes_b64" in raw_payload:
                    s["pf_bytes"] = base64.b64decode(raw_payload["pf_bytes_b64"])
                s["owner_id"] = row.owner_id
                _sessions[row.id] = s
            # Purge expired rows and their on-disk artefacts
            expired = db.query(JeSession).filter(JeSession.saved_at < cutoff).all()
            for row in expired:
                _delete_pf_bytes(row.id)
                if row.payload_path:
                    Path(row.payload_path).unlink(missing_ok=True)
            db.query(JeSession).filter(JeSession.saved_at < cutoff).delete()
    except Exception as exc:
        print(f"[Session] Could not load sessions from DB: {exc}", file=sys.stderr, flush=True)


_load_sessions_from_db()


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

def _validate_session_id(session_id: str) -> None:
    """Reject non-UUID session IDs before they are used in filesystem paths.

    Session IDs are always Python uuid4() strings. Any other value is invalid
    and could be a path-traversal attempt (e.g. '../secrets').
    """
    import uuid as _uuid
    try:
        _uuid.UUID(session_id, version=4)
    except ValueError:
        raise _err("INVALID_SESSION_ID", "Invalid session identifier.")
    candidate = _pf_path(session_id).resolve()
    if not str(candidate).startswith(str(_SESSION_DIR.resolve())):
        raise _err("INVALID_SESSION_ID", "Invalid session identifier.")


def _get_session(session_id: str, current_user: dict | None = None) -> dict:
    _validate_session_id(session_id)
    if session_id not in _sessions:
        raise _err("SESSION_NOT_FOUND", "Session not found or expired.", status_code=404)
    s = _sessions[session_id]
    if current_user and current_user.get("role") != "admin":
        if s.get("owner_id") != current_user["id"]:
            raise _err("SESSION_FORBIDDEN", "Access denied: this session belongs to another user.", status_code=403)
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


# ── QBO / FPA cache helpers ───────────────────────────────────────────────────

def _save_fpa_cache(data: dict) -> None:
    """Persist the FPA report cache to DB (fpa_cache singleton row).

    `data` is the same dict the SSE endpoint emits as the 'done' event:
    base64-encoded Excel blobs are decoded to raw bytes before storage so
    PostgreSQL stores bytea instead of multi-MB JSONB text.
    """
    import base64 as _b64
    from datetime import datetime as _dt, timezone
    from database import FpaCache, get_db

    def _decode(key: str) -> bytes | None:
        val = data.get(key)
        return _b64.b64decode(val) if val else None

    raw_at = data.get("cached_at")
    if raw_at:
        cached_at = _dt.fromisoformat(raw_at)
        if cached_at.tzinfo is None:
            cached_at = cached_at.replace(tzinfo=timezone.utc)
    else:
        cached_at = _dt.now(timezone.utc)

    with get_db() as db:
        row = db.query(FpaCache).filter_by(id=1).first()
        if row is None:
            row = FpaCache(id=1)
            db.add(row)
        row.company_name           = data.get("company_name")
        row.cached_at              = cached_at
        row.summary                = data.get("summary")
        row.preview                = data.get("preview")
        row.bs_preview             = data.get("bs_preview")
        row.bsi_preview            = data.get("bsi_preview")
        row.pl_preview             = data.get("pl_preview")
        row.comp_pl_preview        = data.get("comp_pl_preview")
        row.comp_pl_bd_preview     = data.get("comp_pl_bd_preview")
        row.excel_bytes            = _decode("excel_b64")
        row.bs_excel_bytes         = _decode("bs_excel_b64")
        row.bsi_excel_bytes        = _decode("bsi_excel_b64")
        row.pl_excel_bytes         = _decode("pl_excel_b64")
        row.comp_pl_excel_bytes    = _decode("comp_pl_excel_b64")
        row.comp_pl_bd_excel_bytes = _decode("comp_pl_bd_excel_b64")


def _load_fpa_cache() -> dict | None:
    """Read the FPA cache row and reconstruct the frontend-compatible dict.

    Returns None if no cache row exists yet.
    """
    import base64 as _b64
    from database import FpaCache, get_db

    def _enc(b: bytes | None) -> str | None:
        return _b64.b64encode(b).decode() if b else None

    with get_db() as db:
        row = db.query(FpaCache).filter_by(id=1).first()
        if row is None:
            return None
        # Build dict inside the session — avoids DetachedInstanceError after
        # db.commit() expires ORM objects (expire_on_commit=True default).
        return {
            "cached_at":            row.cached_at.isoformat() if row.cached_at else None,
            "company_name":         row.company_name,
            "summary":              row.summary,
            "preview":              row.preview,
            "excel_b64":            _enc(row.excel_bytes),
            "bs_excel_b64":         _enc(row.bs_excel_bytes),
            "bs_preview":           row.bs_preview,
            "bsi_excel_b64":        _enc(row.bsi_excel_bytes),
            "bsi_preview":          row.bsi_preview,
            "pl_excel_b64":         _enc(row.pl_excel_bytes),
            "pl_preview":           row.pl_preview,
            "comp_pl_excel_b64":    _enc(row.comp_pl_excel_bytes),
            "comp_pl_preview":      row.comp_pl_preview,
            "comp_pl_bd_excel_b64": _enc(row.comp_pl_bd_excel_bytes),
            "comp_pl_bd_preview":   row.comp_pl_bd_preview,
        }


def _fpa_cache_exists() -> bool:
    from database import FpaCache, get_db
    with get_db() as db:
        return db.query(FpaCache.id).filter_by(id=1).first() is not None


def _refresh_qbo_cache() -> tuple[bool, str]:
    """Fetch all QBO transactions, run the FP&A transform, and persist to disk cache.

    Silently no-ops when QBO is not yet authenticated. Called both by the
    background scheduler and by the manual SSE fetch endpoint.
    """
    import base64 as _b64
    import pandas as _pd
    from datetime import datetime as _dt, date as _date, timezone as _tz

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

        _save_fpa_cache({
            "cached_at":            _dt.now(_tz.utc).isoformat(),
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
    • First startup: fetch immediately (30 s delay) if no DB cache row exists.
    • Mapping watch: if fpa/mapping_data.py changes on disk, re-seeds the DB
      mapping tables, reloads in-memory lookups, then rebuilds the FPA cache.
    • Daily run: full re-fetch at QBO_AUTO_FETCH_TIME (default 11:30 local).
    """
    from datetime import datetime as _dt

    _mapping_py = BASE_DIR / "fpa" / "mapping_data.py"

    import sys as _sys
    if _fpa_cache_exists():
        print("[qbo-auto-fetch] cache found in DB — skipping startup fetch", file=_sys.stderr, flush=True)
    else:
        print("[qbo-auto-fetch] no cache found — fetching in 30 s…", file=_sys.stderr, flush=True)
        time.sleep(30)
        ok, msg = _refresh_qbo_cache()
        print(f"[qbo-auto-fetch] startup fetch: ok={ok} — {msg}", file=_sys.stderr, flush=True)

    fetch_time_str = os.environ.get("QBO_AUTO_FETCH_TIME", "11:30")
    hour, minute   = map(int, fetch_time_str.split(":"))

    last_mtime      = _mapping_py.stat().st_mtime if _mapping_py.exists() else 0.0
    last_daily_date = None

    while True:
        time.sleep(60)
        now = _dt.now()

        # ── Mapping file changed? reseed DB, reload in-memory state, rebuild cache
        if _mapping_py.exists():
            mtime = _mapping_py.stat().st_mtime
            if mtime != last_mtime:
                last_mtime = mtime
                try:
                    from database import seed_fpa_mappings, get_db
                    from fpa.transform import reload_mappings
                    with get_db() as db:
                        seed_fpa_mappings(db, force=True)
                    reload_mappings()
                except Exception:
                    pass
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
        raise _err("INVALID_CREDENTIALS", "Invalid username or password.", status_code=401)

    # Success — clear counters
    _clear_attempts(f"user:{username}")
    _clear_attempts(f"ip:{ip}")

    from fastapi.responses import JSONResponse as _JSONResponse
    token = create_access_token({"sub": user["username"], "role": user["role"]})

    # Use Lax instead of Strict so the cookie survives top-level navigations
    # (e.g., OAuth redirects that return to the app). Strict is preferred for
    # pure SPA flows but breaks redirect-based OAuth callbacks.
    use_secure = os.environ.get("USE_HTTPS", "false").lower() == "true"
    samesite   = os.environ.get("COOKIE_SAMESITE", "lax").lower()  # 'lax' | 'strict' | 'none'

    response = _JSONResponse(content={
        "username":           user["username"],
        "role":               user["role"],
        "can_access_payroll": bool(user.get("can_access_payroll", 0)),
        "can_access_fpa":     bool(user.get("can_access_fpa", 0)),
        "can_access_portco":  bool(user.get("can_access_portco", 0)),
        "portco_dept":        user.get("portco_dept"),
    })
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,         # JS cannot read this cookie
        samesite=samesite,     # CSRF protection
        secure=use_secure,     # require HTTPS in production
        max_age=8 * 3600,      # match ACCESS_TOKEN_EXPIRE_HOURS
        path="/",
    )
    return response


@app.post("/api/auth/logout")
async def logout(request: Request):
    """Blacklist the current token (cookie or Bearer) and clear the auth cookie."""
    from fastapi.responses import JSONResponse as _JSONResponse

    # Resolve token: cookie takes priority, then Bearer header
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if token:
        revoke_token(token)

    use_secure = os.environ.get("USE_HTTPS", "false").lower() == "true"
    samesite   = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    response   = _JSONResponse(content={"ok": True})
    response.delete_cookie("access_token", path="/", samesite=samesite, secure=use_secure)
    return response


@app.post("/api/auth/reset-password")
async def reset_password(body: dict = Body(...)):
    username = body.get("username", "").strip()
    new_pw   = body.get("new_password", "")

    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    if not update_user_password(username, hash_password(new_pw)):
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

    update_user_password(username, hash_password(new_pw))
    return {"ok": True}


@app.get("/api/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "role": current_user["role"],
        "can_access_payroll": bool(current_user.get("can_access_payroll", 0)),
        "can_access_fpa": bool(current_user.get("can_access_fpa", 0)),
        "can_access_portco": bool(current_user.get("can_access_portco", 0)),
        "portco_dept": current_user.get("portco_dept"),
    }


@app.post("/api/auth/change-password")
async def change_password(body: dict = Body(...), current_user: dict = Depends(get_current_user)):
    old_pw = body.get("old_password", "")
    new_pw = body.get("new_password", "")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
    # Fix 5: fetch hash on demand rather than keeping it in the user dict
    stored_hash = get_user_password_hash(current_user["username"]) or ""
    if not verify_password(old_pw, stored_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    update_user_password(current_user["username"], hash_password(new_pw))
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
    return {"users": list_all_users()}


_VALID_PORTCO_DEPTS = {None, "proddev", "sales", "marketing", "cs", "finance"}

@app.post("/api/auth/users")
async def create_user(body: dict = Body(...), _: dict = Depends(_require_admin)):
    username = body.get("username", "").strip()
    password = body.get("password", "")
    role = body.get("role", "user")
    can_payroll  = 1 if body.get("can_access_payroll") else 0
    can_fpa      = 1 if body.get("can_access_fpa") else 0
    can_portco   = 1 if body.get("can_access_portco") else 0
    portco_dept  = body.get("portco_dept") or None
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not password or len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    if portco_dept not in _VALID_PORTCO_DEPTS:
        raise HTTPException(status_code=400, detail="Invalid portco_dept value")
    try:
        create_user_record(username, hash_password(password), role, bool(can_payroll), bool(can_fpa), bool(can_portco), portco_dept)
    except Exception:
        raise HTTPException(status_code=409, detail="Username already exists")
    return {"ok": True}


@app.delete("/api/auth/users/{username}")
async def delete_user(username: str, current_user: dict = Depends(_require_admin)):
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if not delete_user_record(username):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@app.put("/api/auth/users/{username}/reset-password")
async def reset_user_password(username: str, body: dict = Body(...), _: dict = Depends(_require_admin)):
    new_pw = body.get("password", "")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if not update_user_password(username, hash_password(new_pw)):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@app.put("/api/auth/users/{username}/permissions")
async def update_user_permissions_route(username: str, body: dict = Body(...), _: dict = Depends(_require_admin)):
    can_payroll = bool(body.get("can_access_payroll"))
    can_fpa     = bool(body.get("can_access_fpa"))
    can_portco  = bool(body.get("can_access_portco"))
    portco_dept = body.get("portco_dept") or None
    if portco_dept not in _VALID_PORTCO_DEPTS:
        raise HTTPException(status_code=400, detail="Invalid portco_dept value")
    if not update_user_permissions(username, can_payroll, can_fpa, can_portco, portco_dept):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ── FP&A Routes ────────────────────────────────────────────────────────────────

def _require_fpa(current_user: dict = Depends(get_current_user)):
    if not current_user.get("can_access_fpa") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="FP&A access not granted")
    return current_user


def _require_portco(current_user: dict = Depends(get_current_user)):
    if not current_user.get("can_access_portco") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="PortCo Reporting access not granted")
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
        input_bytes = await _read_and_validate_excel(input_file)
    except HTTPException:
        raise
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

            from datetime import datetime as _dt2, timezone as _tz2
            result = {
                "cached_at":            _dt2.now(_tz2.utc).isoformat(),
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

            # Persist to DB so the cache survives server restarts and redeploys
            try:
                _save_fpa_cache({"company_name": company_name, **result})
            except Exception as _save_exc:
                import sys, traceback as _tb2
                print(f"[fpa-cache] save failed: {_save_exc}\n{_tb2.format_exc()}", file=sys.stderr, flush=True)

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
    """Return cache metadata without Excel blobs (used for 'Last refreshed' UI)."""
    from datetime import datetime as _dt, timezone
    from database import FpaCache, get_db
    try:
        with get_db() as db:
            row = db.query(FpaCache).filter_by(id=1).first()
        if row is None:
            return {"cached": False}
        now     = _dt.now(timezone.utc)
        age_min = round((now - row.cached_at).total_seconds() / 60, 1)
        return {
            "cached":       True,
            "cached_at":    row.cached_at.isoformat(),
            "age_minutes":  age_min,
            "is_stale":     age_min > 24 * 60,
            "company_name": row.company_name,
            "total_rows":   (row.summary or {}).get("total_rows"),
        }
    except Exception:
        return {"cached": False}


@app.get("/api/fpa/qbo-cache")
async def fpa_qbo_cache(_: dict = Depends(get_current_user)):
    """Return cached FP&A metadata and preview data WITHOUT Excel blobs.

    Use the /api/fpa/qbo-cache/report/{report_type} endpoints to download
    individual Excel files on demand instead of loading all blobs at once.
    """
    try:
        data = _load_fpa_cache()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if data is None:
        raise HTTPException(status_code=404, detail="No cache available yet — QBO fetch has not run")
    # Strip the Excel blobs from the metadata response — callers should use
    # /report/{type} to download individual files rather than loading 60 MB at once.
    _BLOB_KEYS = {
        "excel_b64", "bs_excel_b64", "bsi_excel_b64",
        "pl_excel_b64", "comp_pl_excel_b64", "comp_pl_bd_excel_b64",
    }
    return {k: v for k, v in data.items() if k not in _BLOB_KEYS}


# Report-type → (db_column_attr, suggested_filename)
_FPA_REPORT_MAP: dict[str, tuple[str, str]] = {
    "combined":    ("excel_bytes",            "FPA_Combined.xlsx"),
    "bs":          ("bs_excel_bytes",         "FPA_BalanceSheet.xlsx"),
    "bsi":         ("bsi_excel_bytes",        "FPA_BS_Individual.xlsx"),
    "pl":          ("pl_excel_bytes",         "FPA_PL.xlsx"),
    "comp_pl":     ("comp_pl_excel_bytes",    "FPA_Comparative_PL.xlsx"),
    "comp_pl_bd":  ("comp_pl_bd_excel_bytes", "FPA_Comparative_PL_BD.xlsx"),
}

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@app.get("/api/fpa/qbo-cache/report/{report_type}")
async def fpa_report_download(report_type: str, _: dict = Depends(get_current_user)):
    """Stream a single FP&A Excel report by type without loading all cached blobs.

    report_type: combined | bs | bsi | pl | comp_pl | comp_pl_bd
    """
    if report_type not in _FPA_REPORT_MAP:
        raise _err(
            "INVALID_REPORT_TYPE",
            f"Unknown report type '{report_type}'. "
            f"Valid options: {', '.join(_FPA_REPORT_MAP)}",
        )
    col_attr, filename = _FPA_REPORT_MAP[report_type]
    from database import FpaCache, get_db
    try:
        with get_db() as db:
            # Select only the one blob column needed — avoids loading up to 60 MB
            row = db.query(getattr(FpaCache, col_attr)).filter_by(id=1).first()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if row is None or row[0] is None:
        raise HTTPException(status_code=404, detail="Report not cached yet.")
    blob: bytes = row[0]
    return StreamingResponse(
        iter([blob]),
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── FP&A Mapping CRUD ─────────────────────────────────────────────────────────

@app.get("/api/fpa/mapping/accounts")
async def fpa_get_account_map(_: dict = Depends(_require_fpa)):
    from database import FpaAccountMap, get_db
    with get_db() as db:
        rows = db.query(FpaAccountMap).order_by(FpaAccountMap.account_name).all()
        return [
            {
                "account_name":        r.account_name,
                "financial_statement": r.financial_statement,
                "main_grouping":       r.main_grouping,
                "secondary_grouping":  r.secondary_grouping,
                "classification":      r.classification,
            }
            for r in rows
        ]


@app.put("/api/fpa/mapping/accounts")
async def fpa_save_account_map(rows: list[dict] = Body(...), _: dict = Depends(_require_fpa)):
    from database import FpaAccountMap, get_db
    with get_db() as db:
        db.query(FpaAccountMap).delete()
        db.flush()
        db.bulk_save_objects([
            FpaAccountMap(
                account_name=r.get("account_name", ""),
                financial_statement=r.get("financial_statement"),
                main_grouping=r.get("main_grouping"),
                secondary_grouping=r.get("secondary_grouping"),
                classification=r.get("classification"),
            )
            for r in rows if r.get("account_name")
        ])
    try:
        from fpa.transform import reload_mappings
        reload_mappings()
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/fpa/mapping/dept")
async def fpa_get_dept_map(_: dict = Depends(_require_fpa)):
    from database import FpaDeptMap, get_db
    with get_db() as db:
        rows = db.query(FpaDeptMap).order_by(FpaDeptMap.account_name, FpaDeptMap.dept_class).all()
        return [
            {
                "id":               r.id,
                "account_name":     r.account_name,
                "dept_class":       r.dept_class,
                "classification_2": r.classification_2,
                "classification_3": r.classification_3,
                "department":       r.department,
                "dept_group_bd":    r.dept_group_bd,
            }
            for r in rows
        ]


@app.put("/api/fpa/mapping/dept")
async def fpa_save_dept_map(rows: list[dict] = Body(...), _: dict = Depends(_require_fpa)):
    from database import FpaDeptMap, get_db
    with get_db() as db:
        db.query(FpaDeptMap).delete()
        db.flush()
        db.bulk_save_objects([
            FpaDeptMap(
                account_name=r.get("account_name", ""),
                dept_class=r.get("dept_class") or None,
                classification_2=r.get("classification_2"),
                classification_3=r.get("classification_3"),
                department=r.get("department"),
                dept_group_bd=r.get("dept_group_bd"),
            )
            for r in rows if r.get("account_name")
        ])
    try:
        from fpa.transform import reload_mappings
        reload_mappings()
    except Exception:
        pass
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# PortCo Reporting
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/portco/upload")
async def portco_upload(
    file: UploadFile = File(...),
    _: dict = Depends(_require_portco),
):
    """Upload an MBR Excel file and return structured dashboard JSON."""
    try:
        from portco.parser import parse_mbr_file
        file_bytes = await _read_and_validate_excel(file)
        return parse_mbr_file(file_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {exc}")


# Resolve the sample MBR file path (one level up from backend/)
_SAMPLE_MBR_PATH = BASE_DIR.parent / "MBR reporting sample (Dummy No's).xlsx"


@app.get("/api/portco/load-sample")
async def portco_load_sample(_: dict = Depends(_require_portco)):
    """Read the bundled MBR sample Excel and return actuals + budget as MetricMaps.
    MetricMap = { metric_id: { 'YYYY-MM': value } }
    metric_id = '{Department} {Line Item}'
    """
    if not _SAMPLE_MBR_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Sample file not found at {_SAMPLE_MBR_PATH}",
        )
    try:
        from portco.parser import parse_mbr_to_metric_map
        return parse_mbr_to_metric_map(_SAMPLE_MBR_PATH.read_bytes())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse sample: {exc}")


@app.get("/api/portco/data")
async def portco_get_data(_: dict = Depends(_require_portco)):
    """Return the shared actuals + budget dataset reconstructed from normalized rows (issue #2)."""
    with get_db() as db:
        rows = db.query(PortcoMetric).all()

    actuals: dict[str, dict[str, float]] = {}
    budget:  dict[str, dict[str, float]] = {}
    for row in rows:
        target = actuals if row.sheet == "actuals" else budget
        if row.metric_id not in target:
            target[row.metric_id] = {}
        if row.value is not None:
            target[row.metric_id][row.month] = row.value

    year = datetime.now(tz=timezone.utc).year
    if actuals or budget:
        all_months = [m for d in (*actuals.values(), *budget.values()) for m in d]
        if all_months:
            year = max(int(m[:4]) for m in all_months)

    return {"actuals": actuals, "budget": budget, "year": year}



@app.put("/api/portco/data")
async def portco_save_data(body: dict = Body(...), _: dict = Depends(_require_portco)):
    """Persist actuals + budget as individual metric rows (issue #2)."""
    actuals = body.get("actuals")
    budget  = body.get("budget")
    if not isinstance(actuals, dict) or not isinstance(budget, dict):
        raise HTTPException(status_code=422, detail="actuals and budget must be objects")

    uploaded_at = datetime.now(tz=timezone.utc)
    with get_db() as db:
        db.query(PortcoMetric).delete()
        for sheet_name, sheet_data in (("actuals", actuals), ("budget", budget)):
            for metric_id, months in sheet_data.items():
                if not isinstance(months, dict):
                    continue
                for month, value in months.items():
                    if isinstance(value, (int, float)):
                        db.add(PortcoMetric(
                            metric_id=str(metric_id),
                            month=str(month),
                            sheet=sheet_name,
                            value=float(value),
                            uploaded_at=uploaded_at,
                        ))
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Budget: Employee Cost
# ─────────────────────────────────────────────────────────────────────────────

def _emp_row(r: BudgetEmployeeCost) -> dict:
    return {
        "id":                  r.id,
        "department":          r.department,
        "year":                r.year,
        "geography":           r.geography,
        "name":                r.name,
        "title":               r.title,
        "start_date":          r.start_date.isoformat() if r.start_date else None,
        "base_salary":         r.base_salary,
        "bonus_pct":           r.bonus_pct,
        "bonus_amount":        r.bonus_amount,
        "taxes_benefits_pct":  r.taxes_benefits_pct,
        "hike_cycle_pct":      r.hike_cycle_pct,
        "payroll_expenses":    r.payroll_expenses,
        "tech_stipend":        r.tech_stipend,
    }


def _parse_date(s):
    if not s:
        return None
    from datetime import date
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


@app.get("/api/portco/budget/employee-cost")
async def budget_emp_list(
    year: int,
    department: str | None = None,
    current_user: dict = Depends(_require_portco),
):
    is_admin  = current_user.get("role") == "admin"
    user_dept = current_user.get("portco_dept")
    with get_db() as db:
        q = db.query(BudgetEmployeeCost).filter(BudgetEmployeeCost.year == year)
        if not is_admin and user_dept:
            q = q.filter(BudgetEmployeeCost.department == user_dept)
        elif department:
            q = q.filter(BudgetEmployeeCost.department == department)
        rows = q.order_by(BudgetEmployeeCost.id).all()
        return [_emp_row(r) for r in rows]


@app.post("/api/portco/budget/employee-cost")
async def budget_emp_create(
    body: dict = Body(...),
    current_user: dict = Depends(_require_portco),
):
    dept = body.get("department") or current_user.get("portco_dept")
    if not dept:
        raise HTTPException(status_code=422, detail="department is required")
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        duplicate = db.query(BudgetEmployeeCost).filter(
            BudgetEmployeeCost.department == dept,
            BudgetEmployeeCost.year == int(body["year"]),
            BudgetEmployeeCost.name == str(body["name"]).strip(),
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail=f"An entry for '{body['name']}' already exists in {dept} for {body['year']}.",
            )
        row = BudgetEmployeeCost(
            department        = dept,
            year              = int(body["year"]),
            geography         = str(body["geography"]),
            name              = str(body["name"]),
            title             = str(body["title"]),
            start_date        = _parse_date(body.get("start_date")),
            base_salary       = float(body["base_salary"]),
            bonus_pct         = float(body["bonus_pct"])        if body.get("bonus_pct")        is not None else None,
            bonus_amount      = float(body["bonus_amount"])     if body.get("bonus_amount")     is not None else None,
            taxes_benefits_pct= float(body.get("taxes_benefits_pct") or 0),
            hike_cycle_pct    = float(body["hike_cycle_pct"])   if body.get("hike_cycle_pct")   is not None else None,
            payroll_expenses  = float(body["payroll_expenses"]) if body.get("payroll_expenses") is not None else None,
            tech_stipend      = float(body["tech_stipend"])     if body.get("tech_stipend")     is not None else None,
            created_at        = now,
            updated_at        = now,
        )
        db.add(row)
        db.flush()
        result = _emp_row(row)
    return result


@app.put("/api/portco/budget/employee-cost/{row_id}")
async def budget_emp_update(
    row_id: int,
    body: dict = Body(...),
    _: dict = Depends(_require_portco),
):
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        row = db.query(BudgetEmployeeCost).filter(BudgetEmployeeCost.id == row_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        new_name = str(body["name"]).strip() if "name" in body else None
        if new_name and new_name != row.name:
            duplicate = db.query(BudgetEmployeeCost).filter(
                BudgetEmployeeCost.department == row.department,
                BudgetEmployeeCost.year == row.year,
                BudgetEmployeeCost.name == new_name,
                BudgetEmployeeCost.id != row_id,
            ).first()
            if duplicate:
                raise HTTPException(
                    status_code=409,
                    detail=f"An entry for '{new_name}' already exists in {row.department} for {row.year}.",
                )
        for f in ("geography", "name", "title", "base_salary", "taxes_benefits_pct"):
            if f in body:
                setattr(row, f, body[f])
        if "start_date"       in body: row.start_date       = _parse_date(body["start_date"])
        if "bonus_pct"        in body: row.bonus_pct        = float(body["bonus_pct"])        if body["bonus_pct"]        is not None else None
        if "bonus_amount"     in body: row.bonus_amount     = float(body["bonus_amount"])     if body["bonus_amount"]     is not None else None
        if "hike_cycle_pct"   in body: row.hike_cycle_pct   = float(body["hike_cycle_pct"])   if body["hike_cycle_pct"]   is not None else None
        if "payroll_expenses" in body: row.payroll_expenses = float(body["payroll_expenses"]) if body["payroll_expenses"] is not None else None
        if "tech_stipend"     in body: row.tech_stipend     = float(body["tech_stipend"])     if body["tech_stipend"]     is not None else None
        row.updated_at = now
        result = _emp_row(row)
    return result


@app.delete("/api/portco/budget/employee-cost/{row_id}")
async def budget_emp_delete(
    row_id: int,
    _: dict = Depends(_require_portco),
):
    with get_db() as db:
        row = db.query(BudgetEmployeeCost).filter(BudgetEmployeeCost.id == row_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        db.delete(row)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Budget: Other Cost
# ─────────────────────────────────────────────────────────────────────────────

def _other_row(r: BudgetOtherCost) -> dict:
    return {
        "id":               r.id,
        "department":       r.department,
        "year":             r.year,
        "cost_grouping":    r.cost_grouping,
        "vendor_name":      r.vendor_name,
        "memo_description": r.memo_description,
        "amount":           r.amount,
    }


@app.get("/api/portco/budget/other-cost")
async def budget_other_list(
    year: int,
    department: str | None = None,
    current_user: dict = Depends(_require_portco),
):
    is_admin  = current_user.get("role") == "admin"
    user_dept = current_user.get("portco_dept")
    with get_db() as db:
        q = db.query(BudgetOtherCost).filter(BudgetOtherCost.year == year)
        if not is_admin and user_dept:
            q = q.filter(BudgetOtherCost.department == user_dept)
        elif department:
            q = q.filter(BudgetOtherCost.department == department)
        rows = q.order_by(BudgetOtherCost.id).all()
        return [_other_row(r) for r in rows]


@app.post("/api/portco/budget/other-cost")
async def budget_other_create(
    body: dict = Body(...),
    current_user: dict = Depends(_require_portco),
):
    dept = body.get("department") or current_user.get("portco_dept")
    if not dept:
        raise HTTPException(status_code=422, detail="department is required")
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        row = BudgetOtherCost(
            department       = dept,
            year             = int(body["year"]),
            cost_grouping    = str(body["cost_grouping"]),
            vendor_name      = str(body["vendor_name"]),
            memo_description = body.get("memo_description") or "",
            amount           = float(body["amount"]),
            created_at       = now,
            updated_at       = now,
        )
        db.add(row)
        db.flush()
        result = _other_row(row)
    return result


@app.put("/api/portco/budget/other-cost/{row_id}")
async def budget_other_update(
    row_id: int,
    body: dict = Body(...),
    _: dict = Depends(_require_portco),
):
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        row = db.query(BudgetOtherCost).filter(BudgetOtherCost.id == row_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        for f in ("cost_grouping", "vendor_name", "memo_description", "amount"):
            if f in body:
                setattr(row, f, body[f])
        row.updated_at = now
        result = _other_row(row)
    return result


@app.delete("/api/portco/budget/other-cost/{row_id}")
async def budget_other_delete(
    row_id: int,
    _: dict = Depends(_require_portco),
):
    with get_db() as db:
        row = db.query(BudgetOtherCost).filter(BudgetOtherCost.id == row_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        db.delete(row)
    return {"ok": True}


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/api/parse-file")
async def parse_file_metadata(
    file: UploadFile = File(...),
    _: dict = _auth,
):
    file_bytes = await _read_and_validate_excel(file)
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

    file_bytes = await _read_and_validate_excel(file)
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
        "owner_id": current_user["id"],   # Integer FK — stable across username changes (issue #1)
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


def _read_qbo_override(override_type: str) -> dict:
    """Read a QBO override (accounts/vendors/classes) from the DB."""
    with get_db() as db:
        items = db.query(QboOverrideItem).filter(QboOverrideItem.type == override_type).all()
        if items:
            rows        = [item.data for item in items]
            cols        = list(rows[0].keys()) if rows else []
            last_synced = max((i.synced_at for i in items if i.synced_at), default=None)
            source      = items[0].source
            return {
                "rows":        rows,
                "columns":     cols,
                "source":      "local",
                "last_synced": last_synced.isoformat() if last_synced else None,
                "sync_source": source or "unknown",
            }
    return {"rows": [], "columns": [], "source": "none", "last_synced": None, "sync_source": None}


def _save_qbo_override(override_type: str, rows: list, source: str = "manual") -> None:
    """Replace all QBO overrides of the given type (delete-then-insert for atomicity)."""
    try:
        for row in rows:
            QboOverrideRowSchema(**row)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid QBO override row: {exc}")
    synced_at = datetime.now(tz=timezone.utc)
    with get_db() as db:
        db.query(QboOverrideItem).filter(QboOverrideItem.type == override_type).delete()
        for row in rows:
            db.add(QboOverrideItem(type=override_type, data=row, source=source, synced_at=synced_at))


def _fetch_and_cache_qbo(override_type: str, fetch_fn) -> dict:
    """Fetch live from QBO, persist to DB, and return the data."""
    df        = fetch_fn()
    records   = _df_to_records(df)
    synced_at = datetime.now(tz=timezone.utc)  # Fix 1: DateTime stored in DB
    _save_qbo_override(override_type, records, source="qbo")
    return {
        "rows":        records,
        "columns":     list(df.columns),
        "source":      "qbo",
        "last_synced": synced_at.isoformat(),   # serialise for JSON response
        "sync_source": "qbo",
    }


@app.get("/api/qbo/accounts")
async def qbo_accounts(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo("accounts", QBOClient().get_accounts_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/accounts")
async def save_qbo_accounts(body: dict = Body(...), _: dict = _auth):
    _save_qbo_override("accounts", body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/accounts/sync")
async def sync_qbo_accounts(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo("accounts", QBOClient().get_accounts_dataframe)
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
        return _fetch_and_cache_qbo("vendors", QBOClient().get_vendors_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/vendors")
async def save_qbo_vendors(body: dict = Body(...), _: dict = _auth):
    _save_qbo_override("vendors", body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/vendors/sync")
async def sync_qbo_vendors(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo("vendors", QBOClient().get_vendors_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/qbo/classes")
async def qbo_classes(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo("classes", QBOClient().get_classes_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/qbo/classes")
async def save_qbo_classes(body: dict = Body(...), _: dict = _auth):
    _save_qbo_override("classes", body.get("rows", []))
    return {"ok": True}


@app.post("/api/qbo/classes/sync")
async def sync_qbo_classes(_: dict = _auth):
    try:
        from qbo.auth import is_authenticated
        from qbo.api import QBOClient
        if not is_authenticated():
            raise HTTPException(status_code=401, detail="Not authenticated with QuickBooks")
        return _fetch_and_cache_qbo("classes", QBOClient().get_classes_dataframe)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _fmt_changes(v) -> str:
    """Format the JSONB changes_made list into a human-readable pipe-separated string."""
    if not v:
        return ""
    if isinstance(v, list):
        parts = []
        for c in v:
            t = c.get("type", "changed")
            if t == "added":
                parts.append(
                    f"[Added row {c.get('row','?')}] "
                    f"Desc: '{c.get('desc','')}' | Account: '{c.get('account','')}'"
                )
            elif t == "deleted":
                parts.append(
                    f"[Deleted row {c.get('row','?')}] "
                    f"Desc: '{c.get('desc','')}' | Account: '{c.get('account','')}'"
                )
            else:
                parts.append(
                    f"[Row {c.get('row','?')} – '{c.get('desc','')}'] "
                    f"{c.get('field','')}: '{c.get('from','')}' → '{c.get('to','')}'"
                )
        return " | ".join(parts)
    return str(v)


@app.get("/api/activity-log")
async def get_activity_log(
    action:         str | None = None,
    journal_number: str | None = None,
    date_from:      str | None = None,
    date_to:        str | None = None,
    _: dict = _auth,
):
    from datetime import datetime as _dt
    with get_db() as db:
        q = db.query(ActivityLogEntry)
        if action:
            q = q.filter(ActivityLogEntry.action.ilike(f"%{action}%"))
        if journal_number:
            q = q.filter(ActivityLogEntry.journal_number.ilike(f"%{journal_number}%"))
        if date_from:
            try:
                q = q.filter(ActivityLogEntry.timestamp >= _dt.fromisoformat(date_from).replace(tzinfo=timezone.utc))
            except ValueError:
                pass
        if date_to:
            try:
                q = q.filter(ActivityLogEntry.timestamp <= _dt.fromisoformat(date_to).replace(tzinfo=timezone.utc))
            except ValueError:
                pass
        rows = q.order_by(ActivityLogEntry.id.desc()).all()
    records = [
        {
            "Timestamp":      r.timestamp.isoformat() if r.timestamp else "",
            "User":           r.username or "",
            "IP Address":     r.ip_address or "",
            "Hostname":       r.hostname or "",
            "Action":         r.action,
            "Input File":     r.input_file or "",
            "Output File":    r.output_file or "",
            "Journal Number": r.journal_number or "",
            "Details":        r.details or "",
            "Changes Made":   _fmt_changes(r.changes_made),
        }
        for r in rows
    ]
    cols = ["Timestamp", "User", "IP Address", "Hostname", "Action",
            "Input File", "Output File", "Journal Number", "Details", "Changes Made"]
    return {"rows": records, "columns": cols}


@app.get("/api/activity-log/download")
async def download_activity_log(_: dict = _auth):
    with get_db() as db:
        rows = db.query(ActivityLogEntry).order_by(ActivityLogEntry.id).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No activity log entries found")
    records = [
        {
            "Timestamp":      r.timestamp.isoformat() if r.timestamp else "",
            "User":           r.username or "",
            "IP Address":     r.ip_address or "",
            "Hostname":       r.hostname or "",
            "Action":         r.action,
            "Input File":     r.input_file or "",
            "Output File":    r.output_file or "",
            "Journal Number": r.journal_number or "",
            "Details":        r.details or "",
            "Changes Made":   _fmt_changes(r.changes_made),
        }
        for r in rows
    ]
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(records).to_excel(writer, index=False, sheet_name="Activity Log")
    buf.seek(0)
    return StreamingResponse(
        buf,
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


# ── Payroll config CRUD (admin only) ──────────────────────────────────────────

def _require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise _err("FORBIDDEN", "Admin role required.", status_code=403)
    return current_user


@app.get("/api/admin/payroll-config")
async def get_payroll_config_api(_: dict = Depends(_require_admin)):
    """Return all payroll configuration entries as {key: value} dict."""
    from database import PayrollConfigEntry, get_db
    with get_db() as db:
        rows = db.query(PayrollConfigEntry).all()
    return {r.key: json.loads(r.value_json) for r in rows}


@app.put("/api/admin/payroll-config")
async def save_payroll_config_api(
    updates: dict = Body(...),
    _: dict = Depends(_require_admin),
):
    """Upsert one or more payroll configuration keys."""
    from database import PayrollConfigEntry, get_db
    from config_loader import reload_payroll_config
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        for key, value in updates.items():
            row = db.query(PayrollConfigEntry).filter_by(key=key).first()
            if row:
                row.value_json = json.dumps(value)
                row.updated_at = now
            else:
                db.add(PayrollConfigEntry(key=key, value_json=json.dumps(value), updated_at=now))
    reload_payroll_config()
    return {"updated": list(updates.keys())}


# ── App config CRUD (admin only) — e.g. AI chatbot system prompt ──────────────

@app.get("/api/admin/app-config/{key}")
async def get_app_config(key: str, _: dict = Depends(_require_admin)):
    from database import AppConfig, get_db
    with get_db() as db:
        row = db.query(AppConfig).filter_by(key=key).first()
    if row is None:
        raise _err("NOT_FOUND", f"Config key '{key}' not found.", status_code=404)
    return {"key": key, "value": row.value}


@app.put("/api/admin/app-config/{key}")
async def set_app_config(key: str, body: dict = Body(...), _: dict = Depends(_require_admin)):
    from database import AppConfig, get_db
    value = body.get("value", "")
    now = datetime.now(tz=timezone.utc)
    with get_db() as db:
        row = db.query(AppConfig).filter_by(key=key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(AppConfig(key=key, value=value, updated_at=now))
    return {"key": key, "value": value}


# ── AI chatbot ─────────────────────────────────────────────────────────────────
app.include_router(chat_router)


# ── API versioning ─────────────────────────────────────────────────────────────
# Every route above lives at /api/<path>. We expose the same handlers under
# /api/v1/<path> so future clients can pin to the versioned prefix while
# existing integrations continue to use /api/<path> without change.
#
# Implementation: mount a thin APIRouter that re-exports each group of routes.
# Adding a dedicated v1 router avoids code duplication; route handlers remain
# defined once and are registered on both prefixes.

from fastapi import APIRouter as _APIRouter

_v1 = _APIRouter(prefix="/api/v1")

# Include all existing app routes under the v1 prefix by copying their routes.
# FastAPI stores registered routes in app.routes; we re-mount each on _v1.
for _route in list(app.routes):
    from fastapi.routing import APIRoute as _APIRoute
    if isinstance(_route, _APIRoute) and _route.path.startswith("/api/"):
        # Strip the /api prefix so /api/auth/login → /api/v1/auth/login
        _v1_path = _route.path[len("/api"):]
        _v1.add_api_route(
            _v1_path,
            _route.endpoint,
            methods=list(_route.methods or ["GET"]),
            response_model=_route.response_model,
            status_code=_route.status_code,
            tags=_route.tags,
            summary=_route.summary,
            include_in_schema=False,  # hide v1 duplicates from /docs to reduce noise
        )

app.include_router(_v1)
