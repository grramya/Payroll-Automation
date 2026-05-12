"""Tests for processing/validator.py — payroll validation checks."""
from __future__ import annotations

import pandas as pd
import pytest

from processing.validator import validate_payroll_df, validate_mapping, validate_je
from config import EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN


# ── validate_payroll_df ────────────────────────────────────────────────────────

def test_validate_payroll_df_clean():
    df = pd.DataFrame({
        EMPLOYEE_ID_COLUMN:   ["E001"],
        DEPARTMENT_COLUMN:    ["Admin"],
        EMPLOYEE_NAME_COLUMN: ["Alice"],
        "Regular":            [1000.0],
    })
    assert validate_payroll_df(df) == []


def test_validate_payroll_df_missing_required_column():
    df = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["E001"],
        # DEPARTMENT_COLUMN missing intentionally
        EMPLOYEE_NAME_COLUMN: ["Alice"],
    })
    issues = validate_payroll_df(df)
    assert any(DEPARTMENT_COLUMN in i for i in issues)


def test_validate_payroll_df_empty():
    df = pd.DataFrame(columns=[EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN])
    issues = validate_payroll_df(df)
    assert any("No employee rows" in i for i in issues)


def test_validate_payroll_df_labels_file():
    df = pd.DataFrame(columns=[EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN])
    issues = validate_payroll_df(df, file_label="period_1")
    assert all("period_1" in i for i in issues)


# ── validate_mapping ───────────────────────────────────────────────────────────

def test_validate_mapping_clean():
    pay_item_map = {
        "Regular":                        "Salaries",
        "Employer Paid Taxes - Totals":   "Payroll Tax",
        "Company Paid Benefits - Totals": "Benefits",
    }
    dept_allocation = {"Admin": ({"Admin": 1.0}, "Accrued Payroll")}
    assert validate_mapping(pay_item_map, dept_allocation) == []


def test_validate_mapping_empty_pay_item_map():
    issues = validate_mapping({}, {"Admin": ({"Admin": 1.0}, "Accrued")})
    assert any("No pay item" in i for i in issues)


def test_validate_mapping_empty_dept_allocation():
    issues = validate_mapping({"Regular": "Salaries"}, {})
    assert any("department" in i.lower() for i in issues)


def test_validate_mapping_missing_core_item_warns():
    pay_item_map = {"Regular": "Salaries"}   # missing Employer Paid Taxes…
    dept_allocation = {"Admin": ({"Admin": 1.0}, "Accrued")}
    issues = validate_mapping(pay_item_map, dept_allocation)
    assert any("Employer Paid Taxes" in i for i in issues)


# ── validate_je ────────────────────────────────────────────────────────────────

def test_validate_je_balanced():
    je = pd.DataFrame({
        "Debit (exc. Tax)":  [1000.0, 0.0],
        "Credit (exc. Tax)": [0.0,    1000.0],
    })
    assert validate_je(je) == []


def test_validate_je_imbalanced_warns():
    je = pd.DataFrame({
        "Debit (exc. Tax)":  [1000.0, 0.0],
        "Credit (exc. Tax)": [0.0,     999.0],   # $1 out of balance
    })
    issues = validate_je(je)
    assert len(issues) > 0


def test_validate_je_tolerance_accepted():
    je = pd.DataFrame({
        "Debit (exc. Tax)":  [1000.0, 0.0],
        "Credit (exc. Tax)": [0.0,    1000.001],  # sub-cent rounding — within tolerance
    })
    assert validate_je(je) == []
