"""config_loader.py — DB-backed payroll configuration loader.

On startup, seeds the payroll_config table from config.py defaults if the table
is empty.  Processing modules call get_payroll_config() to obtain a live dict
that reflects any admin edits without a code deployment.

The module-level PAYROLL_CONFIG singleton is loaded once at import time and
refreshed by calling reload_payroll_config() (e.g. after an admin save).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

# ── Default values (mirrors config.py) ────────────────────────────────────────

_DEFAULTS: dict[str, Any] = {
    "SPECIAL_COLUMNS": [
        "Commission 1",
        "Reimbursement-Non Taxable",
        "Separation Pay Recurring",
    ],
    "COMPANY_WIDE_COLUMNS": [
        "Invoice Level Charges - Totals",
    ],
    "GRAND_TOTAL_COLUMNS": [
        "Gross Wages - Totals",
        "Employer Paid Taxes - Totals",
        "Company Paid Benefits - Totals",
        "Fees - Totals",
        "Workers Compensation - Totals",
        "Returned Deductions - Totals",
        "Invoice Level Charges - Totals",
    ],
    "COGS_DEPARTMENTS": ["Travel", "Market Data"],
    "DEPARTMENT_TO_CLASS": {
        "Procurement":    "COGS:Procurement",
        "Market Data":    "COGS:Procurement:Tech & MD:Market Data",
        "Travel":         "COGS:Procurement:Travel",
        "Client Expert":  "Client Service:Client Expert",
        "Client Success": "Client Service:Client Success",
        "Admin":          "G&A:Admin",
        "Operations":     "G&A:Operations",
        "Product":        "R&D:Product",
        "Marketing":      "S&M:Marketing",
        "Sales":          "S&M:Sales",
        "Technology":     "Technology",
    },
    "EMPLOYEE_ID_COLUMN":   "Employee ID",
    "DEPARTMENT_COLUMN":    "Department Long Descr",
    "EMPLOYEE_NAME_COLUMN": "Employee Name",
    "PAYROLL_HEADER_ROW":   5,
    "PAY_ITEM_JOURNAL_DESCRIPTIONS": {
        "Regular":                        "Salary",
        "Discretionary Time Off":         "Salary",
        "Overtime":                       "Salary",
        "Holiday Pay":                    "Salary",
        "Electronics Nontaxable":         "Tech Stipend",
        "Discretionary Bonus":            "Bonus",
        "Nondiscretionary Retention BNS": "Bonus",
        "Employer Paid Taxes - Totals":   "Payroll Taxes",
        "Company Paid Benefits - Totals": "Health Insurance/Benefits - ER",
        "Profit Sharing":                 "401k",
        "Workers Compensation - Totals":  "Worker's comp",
        "Fees - Totals":                  "Payroll Benefit Admin Fees",
        "Returned Deductions - Totals":   "Returned Deductions",
        "Invoice Level Charges - Totals": "Invoice Level Charges",
        "Commission 1":                   "Commission",
        "Reimbursement-Non Taxable":      "Reimbursement",
        "Separation Pay Recurring":       "Separation Pay",
    },
    "PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS": {
        "Employer Paid Taxes - Totals":   "COS - Payroll Taxes",
        "Company Paid Benefits - Totals": "COGS - Health Insurance/Benefits - ER",
        "Profit Sharing":                 "COGS - 401k",
    },
    "JE_DESCRIPTION_ORDER": {
        "Salary":                              10,
        "Tech Stipend":                        15,
        "Bonus":                               20,
        "Commission":                          25,
        "Separation Pay":                      30,
        "Health Insurance/Benefits - ER":      40,
        "COGS - Health Insurance/Benefits - ER": 41,
        "Payroll Benefit Admin Fees":          50,
        "Invoice Level Charges":               55,
        "Payroll Taxes":                       60,
        "COS - Payroll Taxes":                 61,
        "Returned Deductions":                 70,
        "Worker's comp":                       80,
        "401k":                                90,
        "COGS - 401k":                         91,
        "Reimbursement":                       100,
    },
    "JE_COLUMNS": [
        "Post?", "Journal Number", "Entry Date", "Journal Description",
        "Account", "Account ID", "Customer", "Vendor", "Employee",
        "Location", "Class", "Tax Rate", "Tax Application ON", "Currency",
        "Debit (exc. Tax)", "Credit (exc. Tax)", "Adjustment", "QBO Edit ID",
    ],
}


def _load_from_db() -> dict[str, Any]:
    """Read all payroll_config rows from the DB. Returns defaults if DB is unavailable."""
    try:
        from database import get_db, PayrollConfigEntry
        with get_db() as db:
            rows = db.query(PayrollConfigEntry).all()
            if not rows:
                return dict(_DEFAULTS)
            return {r.key: json.loads(r.value_json) for r in rows}
    except Exception:
        return dict(_DEFAULTS)


def seed_payroll_config(db) -> int:
    """Insert default config rows if the table is empty. Returns count inserted."""
    from database import PayrollConfigEntry
    if db.query(PayrollConfigEntry).count() > 0:
        return 0
    now = datetime.now(tz=timezone.utc)
    rows = [
        PayrollConfigEntry(key=k, value_json=json.dumps(v), updated_at=now)
        for k, v in _DEFAULTS.items()
    ]
    db.bulk_save_objects(rows)
    db.flush()
    return len(rows)


# ── Module-level singleton ─────────────────────────────────────────────────────

PAYROLL_CONFIG: dict[str, Any] = _load_from_db()


def reload_payroll_config() -> None:
    """Refresh the in-process config dict from the DB (call after admin save)."""
    global PAYROLL_CONFIG
    PAYROLL_CONFIG = _load_from_db()


def get_payroll_config() -> dict[str, Any]:
    return PAYROLL_CONFIG
