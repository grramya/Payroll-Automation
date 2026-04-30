# =============================================================================
# fpa/qbo_fetch.py — Fetch QBO transaction data directly via the REST API
# =============================================================================
"""
Pulls a GeneralLedger (Transaction Detail by Account) report from QuickBooks
Online for a given date range and company, then returns a DataFrame in the
same format that fpa/transform.py expects (matching QB Transaction Detail
.xlsx columns).

The GeneralLedger report is the API equivalent of QBO's "Transaction Detail
by Account" report — it groups rows by account with a running balance column.

Usage:
    from fpa.qbo_fetch import fetch_company_transactions
    df = fetch_company_transactions("main", "2024-01-01", "2024-12-31")
    # pass df to run_transform_from_df(df, company_name)
"""

import logging

import pandas as pd
import requests

from qbo import config
from qbo.auth import get_valid_token_for_company

_log = logging.getLogger(__name__)

# Note: the GeneralLedger report ignores custom column IDs.
# We send no columns parameter so QBO returns its default set,
# which includes Amount and Balance.

# QBO column title → internal DataFrame column name
_COL_RENAME = {
    "Date":             "Date",
    "Transaction Type": "Transaction Type",
    "Num":              "Num",
    "Name":             "Name",
    "Class":            "Class",
    "Memo/Description": "Memo/Description",
    "Split":            "Split",
    "Amount":           "Amount",
    "Balance":          "Balance",
}

_EMPTY_COLS = [
    "Date", "Transaction Type", "Num", "Name", "Account", "Account ID",
    "Class", "Memo/Description", "Split", "Amount", "Balance",
]


def fetch_company_transactions(
    company: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch Transaction Detail by Account from QBO for the given company and
    date range.  Uses the GeneralLedger report endpoint which returns proper
    running balances per account — equivalent to a QB Transaction Detail by
    Account .xlsx export.

    Parameters
    ----------
    company    : 'main' or 'broker'
    start_date : ISO date string e.g. '2024-01-01'
    end_date   : ISO date string e.g. '2024-12-31'

    Returns a DataFrame with columns matching the QB Transaction Detail export.
    Raises FileNotFoundError if the company is not authenticated.
    Raises RuntimeError on QBO API errors.
    """
    store    = get_valid_token_for_company(company)
    realm_id = _get_realm_id(company, store)

    url = (
        f"{config.BASE_URL}/{config.API_VERSION}"
        f"/company/{realm_id}/reports/GeneralLedger"
    )
    params = {
        "start_date":   start_date,
        "end_date":     end_date,
        "minorversion": 65,
    }
    headers = {
        "Authorization": f"Bearer {store.access_token}",
        "Accept":        "application/json",
    }

    resp = requests.get(url, params=params, headers=headers, timeout=120)
    if not resp.ok:
        raise RuntimeError(
            f"QBO GeneralLedger API error [{resp.status_code}] for '{company}': "
            f"{resp.text[:500]}"
        )

    data = resp.json()

    # Save raw response for debugging — delete this block once Amount/Balance are working
    import json as _json, pathlib as _pl
    _debug_path = _pl.Path(__file__).parent.parent / "qbo_gl_debug.json"
    _debug_path.write_text(_json.dumps(data, indent=2), encoding="utf-8")
    print(f"[qbo_fetch] Saved raw GL response → {_debug_path}", flush=True)

    return _parse_gl_report(data)


def _get_realm_id(company: str, store) -> str:
    """Resolve realm_id: prefer the stored token value, fall back to .env."""
    if store.realm_id:
        return store.realm_id
    realm_id = config.MAIN_REALM_ID if company == "main" else config.BROKER_REALM_ID
    if not realm_id:
        raise ValueError(
            f"No realm_id available for '{company}' company. "
            "Set QBO_MAIN_REALM_ID or QBO_BROKER_REALM_ID in .env, "
            "or authenticate via the FP&A page to auto-populate."
        )
    return realm_id


def _parse_gl_report(report: dict) -> pd.DataFrame:
    """
    Convert a QBO GeneralLedger report JSON into a flat DataFrame.

    The GeneralLedger report is nested: top-level rows are Section rows, one
    per account.  Each section's Header contains the account name and ID.
    Data rows within a section are individual transactions.

    We flatten this into one row per transaction, injecting the account name
    and ID from the section header.
    """
    columns = report.get("Columns", {}).get("Column", [])
    col_titles = [c.get("ColTitle", f"col_{i}") for i, c in enumerate(columns)]

    _log.info("QBO GeneralLedger columns: %s", col_titles)

    flat_rows: list[dict] = []
    for row in report.get("Rows", {}).get("Row", []):
        _extract_gl_section(row, col_titles, flat_rows, account_name="", account_id="")

    if not flat_rows:
        return pd.DataFrame(columns=_EMPTY_COLS)

    df = pd.DataFrame(flat_rows)

    # Log a sample row so we can see actual column values
    _log.info("QBO GL sample row: %s", flat_rows[0] if flat_rows else {})

    # Replace empty strings with None FIRST so all checks below work correctly
    df = df.replace("", None)

    # Rename QBO titles to internal names
    df = df.rename(columns={k: v for k, v in _COL_RENAME.items() if k in df.columns})

    # Fuzzy fallback for Balance (e.g. "Acct. Balance", "Account Balance", "Bal")
    if "Balance" not in df.columns or df["Balance"].isna().all():
        match = next(
            (c for c in df.columns if "bal" in c.lower() and c != "Balance"),
            None,
        )
        if match:
            df = df.rename(columns={match: "Balance"})
            _log.info("Fuzzy-matched balance column '%s' → 'Balance'", match)

    # If Amount is still missing/empty, look for Debit/Credit column(s)
    if "Amount" not in df.columns or df["Amount"].isna().all():
        debit_col  = next((c for c in df.columns if "debit"  in c.lower()), None)
        credit_col = next((c for c in df.columns if "credit" in c.lower()), None)
        _log.info("Debit col: %s  Credit col: %s", debit_col, credit_col)
        if debit_col and credit_col and debit_col == credit_col:
            # QBO returns a single signed "Debit/Credit" column — use it directly
            df["Amount"] = pd.to_numeric(df[debit_col], errors="coerce")
            _log.info("Using single signed column '%s' as Amount", debit_col)
        elif debit_col and credit_col:
            debit  = pd.to_numeric(df[debit_col],  errors="coerce").fillna(0)
            credit = pd.to_numeric(df[credit_col], errors="coerce").fillna(0)
            df["Amount"] = debit - credit
            _log.info("Built Amount from '%s' - '%s'", debit_col, credit_col)
        elif debit_col:
            df["Amount"] = pd.to_numeric(df[debit_col], errors="coerce")
        elif credit_col:
            df["Amount"] = -pd.to_numeric(df[credit_col], errors="coerce")

    # Numeric conversion
    for col in ("Amount", "Balance"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    _log.info("Final columns: %s", df.columns.tolist())
    _log.info("Amount nulls: %d / %d", df["Amount"].isna().sum() if "Amount" in df.columns else -1, len(df))

    return df


def _extract_gl_section(
    row: dict,
    col_titles: list[str],
    out: list[dict],
    account_name: str,
    account_id: str,
) -> None:
    """
    Recursively walk a GeneralLedger row tree.

    Section rows carry the account name/ID in their Header; Data rows are
    individual transactions.  Summary rows (subtotals) are skipped.
    """
    row_type = row.get("type", "")

    if row_type == "Section":
        # Extract account name and ID from section header
        header_data = row.get("Header", {}).get("ColData", [])
        if header_data:
            account_name = header_data[0].get("value", account_name) or account_name
            account_id   = header_data[0].get("id",    account_id)   or account_id

        for sub in row.get("Rows", {}).get("Row", []):
            _extract_gl_section(sub, col_titles, out, account_name, account_id)

    elif row_type == "Data":
        col_data = row.get("ColData", [])
        values = {
            col_titles[i]: (col_data[i]["value"] if i < len(col_data) else "")
            for i in range(len(col_titles))
        }
        values["Account"]    = account_name
        values["Account ID"] = account_id
        out.append(values)
    # "Summary" type rows are account subtotals — skip them
