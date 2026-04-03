# =============================================================================
# processing/aggregator.py — Aggregate payroll data and produce JE line items
# =============================================================================
"""
Two types of JE lines are produced:

1. REGULAR (department-level aggregation)
   - All mapped pay items EXCEPT the three special columns
   - Grouped by (Department, Journal Description, GL Account)
   - One output row per unique combination  → Class = Department

2. SPECIAL (employee-level)
   - Commission 1         → "[Name] - Bonus"            per employee
   - Reimbursement-Non Taxable → "Reimb [Name]"          per employee (Vendor = Name)
   - Separation Pay Recurring  → "[Name]'s Separation Pay" per employee

Special note on Company Paid Benefits:
   Posted amount = Company Paid Benefits - Totals  MINUS  Profit Sharing
   Profit Sharing is posted separately to the 401k-ER account (it has its own
   mapping row and is processed normally as part of the aggregation loop).
"""

from __future__ import annotations

import pandas as pd
from collections import defaultdict

from config import (
    SPECIAL_COLUMNS,
    COMPANY_WIDE_COLUMNS,
    DEPARTMENT_COLUMN,
    EMPLOYEE_NAME_COLUMN,
    PAY_ITEM_JOURNAL_DESCRIPTIONS,
    PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS,
    DEPARTMENT_TO_CLASS,
)
from processing.mapper import get_allocation, get_gl_account, get_account_id


# ---------------------------------------------------------------------------
# Regular aggregation (department-level)
# ---------------------------------------------------------------------------

def aggregate_by_department(
    df: pd.DataFrame,
    pay_item_map: dict,
    dept_allocation: dict,
    pay_item_id_map: dict = None,
) -> list[dict]:
    """
    For every pay item in the mapping (excluding special columns), sum amounts
    by department and return one JE line per (dept, description, GL account).

    Returns
    -------
    list of dicts, each representing one JE line with keys:
        Journal Description, Account, Debit, Credit, Class
    """
    # Pay items to aggregate = all mapped items minus special and company-wide columns
    exclude_set = set(SPECIAL_COLUMNS) | set(COMPANY_WIDE_COLUMNS)
    agg_items = [col for col in pay_item_map if col not in exclude_set]

    pay_item_id_map = pay_item_id_map or {}

    # Accumulator: (dept, journal_description, gl_account, account_id) → net amount
    bucket: defaultdict[tuple, float] = defaultdict(float)

    for dept, dept_df in df.groupby(DEPARTMENT_COLUMN):
        allocation = get_allocation(str(dept), dept_allocation)

        for col in agg_items:
            if col not in dept_df.columns:
                continue

            amount = float(dept_df[col].fillna(0).sum())
            if amount == 0:
                continue

            # ----------------------------------------------------------------
            # Special rule: Company Paid Benefits - Totals
            #   Post (total - Profit Sharing) to Health Insurance GL.
            #   Profit Sharing is posted separately when col == "Profit Sharing".
            # ----------------------------------------------------------------
            if col == "Company Paid Benefits - Totals":
                profit_sharing = (
                    float(dept_df["Profit Sharing"].fillna(0).sum())
                    if "Profit Sharing" in dept_df.columns
                    else 0.0
                )
                amount = amount - profit_sharing
                if amount == 0:
                    continue

            gl = get_gl_account(col, allocation, pay_item_map)
            if not gl:
                continue

            acct_id = get_account_id(col, allocation, pay_item_id_map)

            # Use COGS-specific description for COGS departments where applicable
            if allocation == "COGS" and col in PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS:
                desc = PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS[col]
            else:
                desc = PAY_ITEM_JOURNAL_DESCRIPTIONS.get(col, col)

            key = (str(dept), desc, gl, acct_id)
            bucket[key] += amount

    # Convert accumulator to JE line dicts
    je_lines: list[dict] = []
    for (dept, desc, gl, acct_id), amount in bucket.items():
        if abs(amount) < 0.005:
            continue
        je_lines.append(
            _make_line(
                description=desc,
                account=gl,
                account_id=acct_id,
                amount=round(amount, 2),
                dept_class=dept,
            )
        )

    return je_lines


# ---------------------------------------------------------------------------
# Company-wide column processing (single total line, no department/employee)
# ---------------------------------------------------------------------------

def aggregate_company_wide(
    df: pd.DataFrame,
    pay_item_map: dict,
    invoice_df: pd.DataFrame | None = None,
    pay_item_id_map: dict = None,
) -> list[dict]:
    """
    Sum company-wide columns and post as a single JE line each.
    No department split, no Class, no Employee — just a grand total.

    These columns (e.g. 'Invoice Level Charges - Totals') live in a
    non-employee summary row in the payroll file — they are filtered out
    by read_payroll_file(). Pass invoice_df (from read_invoice_level_rows)
    so the correct values are used instead of the always-zero employee df.
    """
    pay_item_id_map = pay_item_id_map or {}
    je_lines: list[dict] = []

    for col in COMPANY_WIDE_COLUMNS:
        # Prefer the invoice-level rows df; fall back to employee df
        if invoice_df is not None and col in invoice_df.columns:
            source = invoice_df
        elif col in df.columns:
            source = df
        else:
            continue

        amount = float(source[col].fillna(0).sum())
        if abs(amount) < 0.005:
            continue

        # Both COGS and Indirect map to the same GL for these columns
        gl = get_gl_account(col, "Indirect", pay_item_map)
        if not gl:
            continue

        acct_id = get_account_id(col, "Indirect", pay_item_id_map)
        desc = PAY_ITEM_JOURNAL_DESCRIPTIONS.get(col, col)
        je_lines.append(
            _make_line(
                description=desc,
                account=gl,
                account_id=acct_id,
                amount=round(amount, 2),
                dept_class=None,
                vendor=None,
                employee=None,
            )
        )

    return je_lines


# ---------------------------------------------------------------------------
# Special column processing (employee-level)
# ---------------------------------------------------------------------------

def process_special_columns(
    df: pd.DataFrame,
    pay_item_map: dict,
    dept_allocation: dict,
    pay_item_id_map: dict = None,
) -> list[dict]:
    """
    Process the three special columns at the individual employee level.

    Commission 1
        → Journal Description: "{Employee Name} - Bonus"
        → Account: COGS or Indirect based on department
        → Employee field set

    Reimbursement-Non Taxable
        → Journal Description: "Reimb {Employee Name}"
        → Account: Accounts Payable (same for COGS and Indirect)
        → Vendor field set to employee name

    Separation Pay Recurring
        → Journal Description: "{Employee Name}'s Separation Pay"
        → Account: Accrued Expenses:Accrued Expense
        → Employee field set
    """
    pay_item_id_map = pay_item_id_map or {}
    je_lines: list[dict] = []

    for col in SPECIAL_COLUMNS:
        if col not in df.columns:
            continue

        # Only rows with a non-zero value for this column
        active = df[df[col].fillna(0) != 0].copy()
        if active.empty:
            continue

        for _, row in active.iterrows():
            amount = float(row[col])
            if amount == 0 or pd.isna(amount):
                continue

            # Use Employee Name; fall back to Employee ID if name is blank/NaN
            raw_name = row.get(EMPLOYEE_NAME_COLUMN, "")
            emp_name = str(raw_name).strip() if pd.notna(raw_name) else ""
            if not emp_name or emp_name.lower() == "nan":
                emp_id = str(row.get("Employee ID", "Unknown")).strip()
                emp_name = f"Employee {emp_id}"
            dept = str(row[DEPARTMENT_COLUMN]).strip()
            allocation = get_allocation(dept, dept_allocation)
            gl = get_gl_account(col, allocation, pay_item_map)
            if not gl:
                continue

            acct_id = get_account_id(col, allocation, pay_item_id_map)

            if col == "Commission 1":
                # Book3 format: "Sales Commission for FirstName LastName"
                desc     = f"Sales Commission for {emp_name}"
                vendor   = None
                employee = None          # Employee column is blank in Book3

            elif col == "Reimbursement-Non Taxable":
                # Book3 format: "Reimb LastName,FirstName" — Vendor = "FirstName LastName"
                desc     = f"Reimb {emp_name}"
                # Convert "Last,First" → "First Last" for Vendor field
                if "," in emp_name:
                    parts  = emp_name.split(",", 1)
                    vendor = f"{parts[1].strip()} {parts[0].strip()}"
                else:
                    vendor = emp_name
                employee = None          # Employee column is blank in Book3

            elif col == "Separation Pay Recurring":
                # Book3 format: "FirstName LastName Separation Pay" (no apostrophe-s)
                desc     = f"{emp_name} Separation Pay"
                vendor   = None
                employee = None          # Employee column is blank in Book3

            else:
                desc     = col
                vendor   = None
                employee = None

            line = _make_line(
                description=desc,
                account=gl,
                account_id=acct_id,
                amount=round(amount, 2),
                dept_class=dept,
            )
            line["Vendor"] = vendor
            line["Employee"] = employee
            je_lines.append(line)

    return je_lines


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _make_line(
    description: str,
    account: str,
    amount: float,
    account_id: str = "",
    dept_class: str | None = None,
    vendor: str | None = None,
    employee: str | None = None,
) -> dict:
    """Build a single JE line dict with Debit/Credit fields.

    Class mapping rules (matching Book3 reference):
      - Rows whose GL account contains 'Accrued' → Class = blank
        (Bonus, Separation Pay, Provision entries have no class)
      - All other rows → Class = hierarchical cost-centre code from
        DEPARTMENT_TO_CLASS; falls back to raw dept name if not in map
    """
    # Blank Class for Accrued-account rows; translate dept → QBO class otherwise
    if dept_class and "accrued" not in account.lower():
        mapped_class = DEPARTMENT_TO_CLASS.get(str(dept_class).strip(), str(dept_class).strip())
    else:
        mapped_class = None

    return {
        "Journal Description": description,
        "Account":             account,
        "Account ID":          account_id or None,
        "Debit":               round(amount, 2) if amount > 0 else 0.0,
        "Credit":              round(-amount, 2) if amount < 0 else 0.0,
        "Class":               mapped_class,
        "Vendor":              vendor,
        "Employee":            employee,
    }
