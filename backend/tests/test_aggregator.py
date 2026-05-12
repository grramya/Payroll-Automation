"""Tests for processing/aggregator.py — department-level aggregation."""
from __future__ import annotations

import pandas as pd
import pytest

from processing.aggregator import (
    aggregate_by_department,
    process_special_columns,
    aggregate_company_wide,
)
from config import DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN


# ── Fixtures: correct pay_item_map and dept_allocation formats ─────────────────

@pytest.fixture
def two_dept_df():
    return pd.DataFrame({
        "Employee ID":          ["E001", "E002", "E003"],
        EMPLOYEE_NAME_COLUMN:   ["Alice", "Bob",  "Carol"],
        DEPARTMENT_COLUMN:      ["Admin", "Admin", "Sales"],
        "Regular":              [5000.0,  3000.0,  6000.0],
        "Employer Paid Taxes - Totals":   [500.0, 300.0, 600.0],
        "Company Paid Benefits - Totals": [300.0, 180.0, 360.0],
        "Profit Sharing":                 [100.0,  60.0, 120.0],
    })


@pytest.fixture
def pay_item_map():
    # Correct format: {pay_item: {"COGS": gl, "Indirect": gl}}
    return {
        "Regular":                        {"COGS": "Salaries - COGS",     "Indirect": "Salaries - Indirect"},
        "Employer Paid Taxes - Totals":   {"COGS": "Payroll Tax - COGS",  "Indirect": "Payroll Tax Expense"},
        "Company Paid Benefits - Totals": {"COGS": "Benefits - COGS",     "Indirect": "Employee Benefits"},
        "Profit Sharing":                 {"COGS": "401k ER - COGS",      "Indirect": "401k ER Contribution"},
    }


@pytest.fixture
def dept_allocation():
    # Correct format: {department: "COGS" | "Indirect"}
    return {
        "Admin":  "Indirect",
        "Sales":  "Indirect",
        "Travel": "COGS",
    }


# ── aggregate_by_department ────────────────────────────────────────────────────

def test_aggregate_produces_lines(two_dept_df, pay_item_map, dept_allocation):
    lines = aggregate_by_department(two_dept_df, pay_item_map, dept_allocation)
    assert len(lines) > 0


def test_aggregate_amounts_sum_correctly(two_dept_df, pay_item_map, dept_allocation):
    lines = aggregate_by_department(two_dept_df, pay_item_map, dept_allocation)
    # Total salary = 5000 + 3000 (Admin) + 6000 (Sales) = 14000
    salary_lines = [l for l in lines if "Salaries" in l.get("Account", "")]
    total = sum(abs(l.get("Debit", 0)) or abs(l.get("Credit", 0)) for l in salary_lines)
    assert abs(total - 14000.0) < 0.01


def test_aggregate_skips_zero_amounts(two_dept_df, pay_item_map, dept_allocation):
    two_dept_df = two_dept_df.copy()
    two_dept_df["Regular"] = 0.0
    lines = aggregate_by_department(two_dept_df, pay_item_map, dept_allocation)
    salary_lines = [l for l in lines if "Salaries" in l.get("Account", "")]
    assert len(salary_lines) == 0


def test_aggregate_excludes_special_columns(pay_item_map, dept_allocation):
    df = pd.DataFrame({
        "Employee ID":          ["E001"],
        EMPLOYEE_NAME_COLUMN:   ["Alice"],
        DEPARTMENT_COLUMN:      ["Admin"],
        "Regular":              [5000.0],
        "Commission 1":         [500.0],   # special column — must NOT be aggregated here
        "Employer Paid Taxes - Totals":   [500.0],
        "Company Paid Benefits - Totals": [300.0],
        "Profit Sharing":                 [100.0],
    })
    pay_item_map_with_commission = {
        **pay_item_map,
        "Commission 1": {"COGS": "Commission Expense", "Indirect": "Commission Expense"},
    }
    lines = aggregate_by_department(df, pay_item_map_with_commission, dept_allocation)
    commission_lines = [l for l in lines if "Commission" in l.get("Account", "")]
    assert len(commission_lines) == 0, "Commission 1 is a special column, must not be aggregated"


# ── process_special_columns ────────────────────────────────────────────────────

def test_process_special_columns_commission():
    df = pd.DataFrame({
        "Employee ID":          ["E001"],
        EMPLOYEE_NAME_COLUMN:   ["Alice Smith"],
        DEPARTMENT_COLUMN:      ["Sales"],
        "Commission 1":         [750.0],
        "Regular":              [5000.0],
        "Employer Paid Taxes - Totals":   [500.0],
        "Company Paid Benefits - Totals": [300.0],
        "Profit Sharing":                 [100.0],
    })
    pay_item_map = {
        "Commission 1": {"COGS": "Commission Expense", "Indirect": "Commission Expense"},
    }
    dept_allocation = {"Sales": "Indirect"}
    lines = process_special_columns(df, pay_item_map, dept_allocation)
    commission_lines = [l for l in lines if "Commission" in l.get("Account", "")]
    assert len(commission_lines) > 0
    amounts = [abs(l.get("Debit", 0)) + abs(l.get("Credit", 0)) for l in commission_lines]
    assert abs(sum(amounts) - 750.0) < 0.01


def test_process_special_columns_skips_zero():
    df = pd.DataFrame({
        "Employee ID":          ["E001"],
        EMPLOYEE_NAME_COLUMN:   ["Alice"],
        DEPARTMENT_COLUMN:      ["Sales"],
        "Commission 1":         [0.0],
        "Regular":              [5000.0],
        "Employer Paid Taxes - Totals":   [500.0],
        "Company Paid Benefits - Totals": [300.0],
        "Profit Sharing":                 [100.0],
    })
    pay_item_map = {
        "Commission 1": {"COGS": "Commission Expense", "Indirect": "Commission Expense"},
    }
    dept_allocation = {"Sales": "Indirect"}
    lines = process_special_columns(df, pay_item_map, dept_allocation)
    commission_lines = [l for l in lines if "Commission" in l.get("Account", "")]
    assert len(commission_lines) == 0


# ── aggregate_company_wide ─────────────────────────────────────────────────────

def test_aggregate_company_wide_produces_lines():
    df = pd.DataFrame({
        "Employee ID":                    ["E001"],
        EMPLOYEE_NAME_COLUMN:             ["Alice"],
        DEPARTMENT_COLUMN:                ["Admin"],
        "Invoice Level Charges - Totals": [250.0],
        "Regular":                        [5000.0],
        "Employer Paid Taxes - Totals":   [500.0],
        "Company Paid Benefits - Totals": [300.0],
        "Profit Sharing":                 [100.0],
    })
    # aggregate_company_wide uses COMPANY_WIDE_COLUMNS from config, not pay_item_map keys
    pay_item_map = {
        "Invoice Level Charges - Totals": {
            "COGS": "Invoice Charges", "Indirect": "Invoice Charges",
        },
    }
    lines = aggregate_company_wide(df, pay_item_map)
    assert isinstance(lines, list)
