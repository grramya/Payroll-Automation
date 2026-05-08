"""processing/logger.py — Audit logging for Finance Suite (PostgreSQL-backed)."""
from __future__ import annotations

import os
import sys
import socket
import threading
import traceback
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone

# Add project root so database.py is importable from this sub-package
sys.path.insert(0, str(Path(__file__).parent.parent))
from database import get_db, ActivityLogEntry

# Column order (kept for Excel download compatibility)
_COLUMNS = [
    "Timestamp", "User", "IP Address", "Hostname",
    "Action", "Input File", "Output File",
    "Journal Number", "Details", "Changes Made",
]


def _get_system_info() -> tuple[str, str, str]:
    username = (
        os.environ.get("USERNAME")
        or os.environ.get("USER")
        or os.environ.get("LOGNAME")
        or "Unknown"
    )
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "Unknown"
    try:
        ip = socket.gethostbyname(hostname)
    except Exception:
        ip = "Unknown"
    return username, hostname, ip


def compute_je_diff(original_df: pd.DataFrame, edited_df: pd.DataFrame) -> list[dict]:
    """Return a structured list of change dicts (stored as JSONB, issue #5).

    Each dict has 'type' ('added' | 'deleted' | 'changed') plus context fields.
    """
    if original_df is None:
        return [{"type": "error", "msg": "Original not available"}]

    changes: list[dict] = []
    orig_len = len(original_df)
    edit_len = len(edited_df)

    for i in range(orig_len, edit_len):
        row  = edited_df.iloc[i]
        changes.append({
            "type":    "added",
            "row":     i + 1,
            "desc":    str(row.get("Journal Description", "")),
            "account": str(row.get("Account", "")),
            "debit":   str(row.get("Debit (exc. Tax)", "")),
            "credit":  str(row.get("Credit (exc. Tax)", "")),
        })

    for i in range(edit_len, orig_len):
        row = original_df.iloc[i]
        changes.append({
            "type":    "deleted",
            "row":     i + 1,
            "desc":    str(row.get("Journal Description", "")),
            "account": str(row.get("Account", "")),
        })

    min_len     = min(orig_len, edit_len)
    shared_cols = [c for c in original_df.columns if c in edited_df.columns]
    for i in range(min_len):
        for col in shared_cols:
            orig_val = original_df.iloc[i][col]
            edit_val = edited_df.iloc[i][col]
            o_str = "" if pd.isna(orig_val) or orig_val is None else str(orig_val).strip()
            e_str = "" if pd.isna(edit_val) or edit_val is None else str(edit_val).strip()
            if o_str != e_str:
                changes.append({
                    "type":  "changed",
                    "row":   i + 1,
                    "desc":  str(original_df.iloc[i].get("Journal Description", f"Row {i + 1}")),
                    "field": col,
                    "from":  o_str,
                    "to":    e_str,
                })

    return changes


def log_action(
    action: str,
    input_file:     str = "",
    output_file:    str = "",
    journal_number: str = "",
    details:        str = "",
    changes:        list[dict] | None = None,   # JSONB list — replaces pipe string (issue #5)
) -> None:
    """Insert one audit row into the activity_log table."""
    try:
        username, hostname, ip = _get_system_info()
        with get_db() as db:
            db.add(ActivityLogEntry(
                timestamp=datetime.now(tz=timezone.utc),
                username=username,
                ip_address=ip,
                hostname=hostname,
                action=action,
                input_file=input_file,
                output_file=output_file,
                journal_number=journal_number,
                details=details,
                changes_made=changes if changes else None,
            ))
    except Exception as _exc:
        print(
            f"[Activity Log] WRITE FAILED: {_exc}\n{traceback.format_exc()}",
            file=sys.stderr,
            flush=True,
        )


def log_action_async(**kwargs) -> None:
    """Fire-and-forget: log in a background thread so the UI is never blocked."""
    threading.Thread(target=log_action, kwargs=kwargs, daemon=True).start()
