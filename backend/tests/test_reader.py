"""Tests for processing/reader.py — payroll file parsing."""
from __future__ import annotations

import io
import pandas as pd
import pytest
import openpyxl

from processing.reader import read_payroll_file, get_file_metadata
from config import PAYROLL_HEADER_ROW, EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN


def _make_excel(df: pd.DataFrame) -> io.BytesIO:
    buf = io.BytesIO()
    wb = openpyxl.Workbook()
    ws = wb.active
    for _ in range(PAYROLL_HEADER_ROW):
        ws.append([""] * max(len(df.columns), 1))
    ws.append(list(df.columns))
    for row in df.itertuples(index=False):
        ws.append(list(row))
    wb.save(buf)
    buf.seek(0)
    return buf


# ── read_payroll_file ──────────────────────────────────────────────────────────

def test_read_payroll_file_returns_employee_rows():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN:   ["E001", None, "E002"],   # None row = company summary
        DEPARTMENT_COLUMN:    ["Admin", "Admin", "Sales"],
        "Employee Name":      ["Alice", "TOTALS", "Bob"],
        "Regular":            [1000.0, 99999.0, 2000.0],
    })
    buf = _make_excel(raw)
    df = read_payroll_file(buf)
    assert len(df) == 2, "Should exclude the row with no Employee ID"
    assert list(df[EMPLOYEE_ID_COLUMN]) == ["E001", "E002"]


def test_read_payroll_file_coerces_pay_columns_to_float():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["E001"],
        DEPARTMENT_COLUMN:  ["Admin"],
        "Employee Name":    ["Alice"],
        "Regular":          ["1,234.56"],   # string with comma
    })
    buf = _make_excel(raw)
    df = read_payroll_file(buf)
    assert df["Regular"].dtype == float
    assert df["Regular"].iloc[0] == 0.0   # non-numeric coerced to 0


def test_read_payroll_file_strips_whitespace():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["  E001  "],
        DEPARTMENT_COLUMN:  ["  Admin  "],
        "Employee Name":    ["  Alice  "],
        "Regular":          [500.0],
    })
    buf = _make_excel(raw)
    df = read_payroll_file(buf)
    assert df[EMPLOYEE_ID_COLUMN].iloc[0] == "E001"
    assert df[DEPARTMENT_COLUMN].iloc[0] == "Admin"


def test_read_payroll_file_drops_missing_department():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["E001", "E002"],
        DEPARTMENT_COLUMN:  [None, "Sales"],
        "Employee Name":    ["Alice", "Bob"],
        "Regular":          [1000.0, 2000.0],
    })
    buf = _make_excel(raw)
    df = read_payroll_file(buf)
    assert len(df) == 1
    assert df[DEPARTMENT_COLUMN].iloc[0] == "Sales"


def test_read_payroll_file_missing_pay_column_filled_with_zero():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["E001"],
        DEPARTMENT_COLUMN:  ["Admin"],
        "Employee Name":    ["Alice"],
        # "Regular" is intentionally absent
        "Employer Paid Taxes - Totals": [100.0],
    })
    buf = _make_excel(raw)
    df = read_payroll_file(buf)
    assert "Regular" not in df.columns   # column simply absent from this file


# ── get_file_metadata ──────────────────────────────────────────────────────────

def test_get_file_metadata_returns_dict():
    raw = pd.DataFrame({
        EMPLOYEE_ID_COLUMN: ["E001"],
        DEPARTMENT_COLUMN:  ["Admin"],
        "Employee Name":    ["Alice"],
        "Regular":          [1000.0],
    })
    buf = _make_excel(raw)
    meta = get_file_metadata(buf)
    assert isinstance(meta, dict)
