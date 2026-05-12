"""Shared pytest fixtures for the processing pipeline test suite."""
from __future__ import annotations

import io
import pytest
import pandas as pd
import openpyxl


# ── Minimal payroll DataFrame fixture ─────────────────────────────────────────

@pytest.fixture
def minimal_payroll_df() -> pd.DataFrame:
    """Two-employee payroll DataFrame with the minimum columns required."""
    return pd.DataFrame({
        "Employee ID":          ["E001", "E002"],
        "Employee Name":        ["Alice Smith", "Bob Jones"],
        "Department Long Descr":["Admin",        "Sales"],
        "Regular":              [5000.0,          6000.0],
        "Employer Paid Taxes - Totals":   [500.0, 600.0],
        "Company Paid Benefits - Totals": [300.0, 360.0],
        "Profit Sharing":                 [100.0, 120.0],
    })


@pytest.fixture
def cogs_payroll_df() -> pd.DataFrame:
    """One-employee payroll DataFrame for a COGS department (Travel)."""
    return pd.DataFrame({
        "Employee ID":          ["E010"],
        "Employee Name":        ["Carol Lee"],
        "Department Long Descr":["Travel"],
        "Regular":              [4000.0],
        "Employer Paid Taxes - Totals":   [400.0],
        "Company Paid Benefits - Totals": [240.0],
        "Profit Sharing":                 [80.0],
    })


@pytest.fixture
def special_columns_df() -> pd.DataFrame:
    """Payroll DataFrame that includes all three special (employee-level) columns."""
    return pd.DataFrame({
        "Employee ID":              ["E020", "E021"],
        "Employee Name":            ["Dave Brown", "Eve White"],
        "Department Long Descr":    ["Sales",       "Admin"],
        "Regular":                  [3000.0,         2500.0],
        "Commission 1":             [800.0,           0.0],
        "Reimbursement-Non Taxable":[0.0,             150.0],
        "Separation Pay Recurring": [0.0,             0.0],
        "Employer Paid Taxes - Totals":   [300.0,     250.0],
        "Company Paid Benefits - Totals": [180.0,     150.0],
        "Profit Sharing":                 [60.0,      50.0],
    })


# ── Minimal mapping fixtures ───────────────────────────────────────────────────

@pytest.fixture
def pay_item_map() -> dict:
    """Map from payroll column → GL account name."""
    return {
        "Regular":                        "Salaries - Indirect",
        "Employer Paid Taxes - Totals":   "Payroll Tax Expense",
        "Company Paid Benefits - Totals": "Employee Benefits",
        "Profit Sharing":                 "401k ER Contribution",
        "Commission 1":                   "Commission Expense",
        "Reimbursement-Non Taxable":      "Employee Reimbursements",
    }


@pytest.fixture
def dept_allocation() -> dict:
    """Map from department → (debit side allocation dict, credit account)."""
    return {
        "Admin":  ({"Admin": 1.0}, "Accrued Payroll"),
        "Sales":  ({"Sales": 1.0}, "Accrued Payroll"),
        "Travel": ({"Travel": 1.0}, "Accrued Payroll"),
    }


# ── Excel fixture builder ─────────────────────────────────────────────────────

def _make_payroll_excel(df: pd.DataFrame) -> io.BytesIO:
    """Write a DataFrame into the payroll file layout (header at row 5)."""
    from config import PAYROLL_HEADER_ROW
    buf = io.BytesIO()
    wb = openpyxl.Workbook()
    ws = wb.active
    # Rows 0-4: filler header rows (matching PAYROLL_HEADER_ROW = 5)
    for _ in range(PAYROLL_HEADER_ROW):
        ws.append([""] * len(df.columns))
    # Row 5: column headers
    ws.append(list(df.columns))
    # Rows 6+: data
    for row in df.itertuples(index=False):
        ws.append(list(row))
    wb.save(buf)
    buf.seek(0)
    return buf


@pytest.fixture
def payroll_excel_bytes(minimal_payroll_df) -> bytes:
    return _make_payroll_excel(minimal_payroll_df).read()
