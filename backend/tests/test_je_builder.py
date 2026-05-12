"""Tests for processing/je_builder.py — JE construction and balance invariants."""
from __future__ import annotations

import pandas as pd
import pytest

from processing.je_builder import build_je, export_je_to_bytes


# ── Minimal line item stubs ────────────────────────────────────────────────────

def _debit_credit_pair(
    description: str = "Salary for 05/15/2025",
    debit_account: str = "Salaries - Indirect",
    credit_account: str = "Accrued Expenses:Accrued Payroll",
    amount: float = 10_000.0,
    dept_class: str = "Admin",
) -> tuple[list[dict], list[dict]]:
    """Return (regular_lines, special_lines) for one balanced entry."""
    regular = [
        {
            "Journal Description": description,
            "Account":    debit_account,
            "Account ID": "6000",
            "Debit":      amount,
            "Credit":     0.0,
            "Class":      dept_class,
            "Vendor":     "",
            "Employee":   "",
            "Customer":   "",
        },
        {
            "Journal Description": description,
            "Account":    credit_account,
            "Account ID": "2100",
            "Debit":      0.0,
            "Credit":     amount,
            "Class":      "",
            "Vendor":     "",
            "Employee":   "",
            "Customer":   "",
        },
    ]
    return regular, []


# ── build_je ───────────────────────────────────────────────────────────────────

def test_build_je_returns_dataframe():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-001", entry_date="05/15/2025")
    assert isinstance(je, pd.DataFrame)


def test_build_je_has_required_columns():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-001", entry_date="05/15/2025")
    for col in ["Journal Number", "Entry Date", "Account", "Debit (exc. Tax)", "Credit (exc. Tax)"]:
        assert col in je.columns, f"Missing column: {col}"


def test_build_je_balanced():
    """Total debits must equal total credits — the core accounting identity."""
    regular, special = _debit_credit_pair(amount=12_345.67)
    je = build_je(regular, special, journal_number="JE-001", entry_date="05/15/2025")
    total_debit  = je["Debit (exc. Tax)"].fillna(0).sum()
    total_credit = je["Credit (exc. Tax)"].fillna(0).sum()
    assert abs(total_debit - total_credit) < 0.01, (
        f"JE out of balance: debit={total_debit:.2f} credit={total_credit:.2f}"
    )


def test_build_je_journal_number_applied():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-TEST-42", entry_date="05/15/2025")
    assert (je["Journal Number"] == "JE-TEST-42").all()


def test_build_je_entry_date_applied():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-001", entry_date="06/30/2025")
    assert (je["Entry Date"] == "06/30/2025").all()


def test_build_je_multiple_depts_balanced():
    r1, s1 = _debit_credit_pair(dept_class="Admin", amount=10_000)
    r2, s2 = _debit_credit_pair(dept_class="Sales", amount=15_000)
    je = build_je(r1 + r2, s1 + s2, journal_number="JE-002", entry_date="05/15/2025")
    total_debit  = je["Debit (exc. Tax)"].fillna(0).sum()
    total_credit = je["Credit (exc. Tax)"].fillna(0).sum()
    assert abs(total_debit - total_credit) < 0.01
    assert abs(total_debit - 25_000.0) < 0.01


def test_build_je_with_special_lines():
    regular, _ = _debit_credit_pair(amount=10_000)
    special = [
        {
            "Journal Description": "Sales Commission for Alice Smith",
            "Account":    "Commission Expense",
            "Account ID": "6100",
            "Debit":      750.0,
            "Credit":     0.0,
            "Class":      "Sales",
            "Vendor":     "Alice Smith",
            "Employee":   "",
            "Customer":   "",
        },
        {
            "Journal Description": "Sales Commission for Alice Smith",
            "Account":    "Accrued Expenses:Accrued Payroll",
            "Account ID": "2100",
            "Debit":      0.0,
            "Credit":     750.0,
            "Class":      "",
            "Vendor":     "",
            "Employee":   "",
            "Customer":   "",
        },
    ]
    je = build_je(regular, special, journal_number="JE-003", entry_date="05/15/2025")
    total_debit  = je["Debit (exc. Tax)"].fillna(0).sum()
    total_credit = je["Credit (exc. Tax)"].fillna(0).sum()
    assert abs(total_debit - total_credit) < 0.01


# ── export_je_to_bytes ─────────────────────────────────────────────────────────

def test_export_je_to_bytes_produces_xlsx():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-001", entry_date="05/15/2025")
    raw = export_je_to_bytes(je)
    assert isinstance(raw, bytes)
    assert raw[:4] == b"PK\x03\x04", "Output is not a valid XLSX file"


def test_export_je_to_bytes_readable():
    regular, special = _debit_credit_pair()
    je = build_je(regular, special, journal_number="JE-001", entry_date="05/15/2025")
    raw = export_je_to_bytes(je)
    import io
    df_back = pd.read_excel(io.BytesIO(raw))
    assert len(df_back) > 0
