# =============================================================================
# processing/logger.py — Audit logging for Payroll JE Automation
# =============================================================================
"""
Logs every significant user action to logs/Activity_Log.xlsx.

Captured fields per entry:
  Timestamp, User, IP Address, Hostname, Action,
  Input File, Output File, Journal Number, Details, Changes Made
"""

import os
import socket
import threading
import pandas as pd
from pathlib import Path
from datetime import datetime

LOG_DIR  = Path(__file__).parent.parent / "logs"
LOG_FILE = LOG_DIR / "Activity_Log.xlsx"

# Column order for the log sheet
_COLUMNS = [
    "Timestamp", "User", "IP Address", "Hostname",
    "Action", "Input File", "Output File",
    "Journal Number", "Details", "Changes Made",
]


# ---------------------------------------------------------------------------
# System info helpers
# ---------------------------------------------------------------------------

def _get_system_info() -> tuple[str, str, str]:
    """Return (username, hostname, ip)."""
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


# ---------------------------------------------------------------------------
# Diff helper — compare original vs edited JE DataFrames
# ---------------------------------------------------------------------------

def compute_je_diff(original_df: pd.DataFrame, edited_df: pd.DataFrame) -> str:
    """
    Return a human-readable summary of changes between the original generated
    JE and the (possibly edited) version the user downloaded.
    Returns "No changes" if both DataFrames are identical.
    """
    if original_df is None:
        return "Original not available"

    changes = []
    orig_len = len(original_df)
    edit_len = len(edited_df)

    # Added rows
    if edit_len > orig_len:
        for i in range(orig_len, edit_len):
            row = edited_df.iloc[i]
            desc    = row.get("Journal Description", "")
            account = row.get("Account", "")
            debit   = row.get("Debit (exc. Tax)", "")
            credit  = row.get("Credit (exc. Tax)", "")
            changes.append(
                f"[Added row {i+1}] Desc: '{desc}' | Account: '{account}'"
                f" | Debit: {debit} | Credit: {credit}"
            )

    # Deleted rows
    if edit_len < orig_len:
        for i in range(edit_len, orig_len):
            row = original_df.iloc[i]
            desc    = row.get("Journal Description", "")
            account = row.get("Account", "")
            changes.append(f"[Deleted row {i+1}] Desc: '{desc}' | Account: '{account}'")

    # Modified cells in common rows
    min_len = min(orig_len, edit_len)
    shared_cols = [c for c in original_df.columns if c in edited_df.columns]
    for i in range(min_len):
        for col in shared_cols:
            orig_val = original_df.iloc[i][col]
            edit_val = edited_df.iloc[i][col]
            # Normalise for comparison (NaN, None, empty)
            o_str = "" if pd.isna(orig_val) or orig_val is None else str(orig_val).strip()
            e_str = "" if pd.isna(edit_val) or edit_val is None else str(edit_val).strip()
            if o_str != e_str:
                desc = original_df.iloc[i].get("Journal Description", f"Row {i+1}")
                changes.append(
                    f"[Row {i+1} – '{desc}'] {col}: '{o_str}' → '{e_str}'"
                )

    return " | ".join(changes) if changes else "No changes"


# ---------------------------------------------------------------------------
# Core logger
# ---------------------------------------------------------------------------

def log_action(
    action: str,
    input_file:     str = "",
    output_file:    str = "",
    journal_number: str = "",
    details:        str = "",
    changes:        str = "",
) -> None:
    """
    Append one row to Activity_Log.xlsx.
    Thread-safe; silently ignores any write errors so it never
    interrupts the main application flow.
    """
    try:
        LOG_DIR.mkdir(exist_ok=True)
        username, hostname, ip = _get_system_info()

        entry = {
            "Timestamp":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "User":           username,
            "IP Address":     ip,
            "Hostname":       hostname,
            "Action":         action,
            "Input File":     input_file,
            "Output File":    output_file,
            "Journal Number": journal_number,
            "Details":        details,
            "Changes Made":   changes,
        }

        _LOCK.acquire()
        try:
            if LOG_FILE.exists():
                existing = pd.read_excel(LOG_FILE, dtype=str)
                # Ensure all expected columns are present
                for col in _COLUMNS:
                    if col not in existing.columns:
                        existing[col] = ""
                df = pd.concat(
                    [existing[_COLUMNS], pd.DataFrame([entry])[_COLUMNS]],
                    ignore_index=True,
                )
            else:
                df = pd.DataFrame([entry])[_COLUMNS]

            with pd.ExcelWriter(LOG_FILE, engine="openpyxl") as writer:
                df.to_excel(writer, index=False, sheet_name="Activity Log")
                ws = writer.sheets["Activity Log"]
                # Auto-width columns
                for col_cells in ws.columns:
                    max_len = max(
                        (len(str(c.value)) for c in col_cells if c.value), default=10
                    )
                    ws.column_dimensions[col_cells[0].column_letter].width = min(max_len + 4, 60)
        finally:
            _LOCK.release()

    except Exception:
        pass  # logging must never crash the app


# Thread lock so background threads don't corrupt the file
_LOCK = threading.Lock()


def log_action_async(**kwargs) -> None:
    """Fire-and-forget: log in a background thread so the UI is never blocked."""
    threading.Thread(target=log_action, kwargs=kwargs, daemon=True).start()
