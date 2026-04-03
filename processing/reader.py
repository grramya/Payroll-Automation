# =============================================================================
# processing/reader.py — Read and parse payroll Invoice Supporting Detail files
# =============================================================================
"""
Payroll files have this structure:
  Row 0 : Title row ("Invoice Supporting Details")
  Row 1 : Company Code, Page No
  Row 2 : Company Name, Run Date
  Row 3 : Payroll Cycle info
  Row 4 : Section headers (Gross Wages, Employer Paid Taxes, …)
  Row 5 : Actual column headers  ← header row
  Row 6+: Data rows (first row is usually a company-level summary with no Employee ID)

Only rows with a valid Employee ID are real employee rows.
Columns that had zero activity in a given period are omitted from that file;
the combiner fills them with 0 when joining the two files.
"""

import re
import pandas as pd
from config import PAYROLL_HEADER_ROW, EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, GRAND_TOTAL_COLUMNS

_DATE_RE = re.compile(r'\b(\d{1,2}/\d{1,2}/\d{4})\b')

# Columns that are always non-numeric (metadata / identifier columns)
_META_COLUMNS = {
    "Company Code",
    "Company Name",
    "Employee ID",
    "Employee Name",
    "Department Long Descr",
    "Location Long Descr",
    "Pay Frequency Descr Long",
    "Invoice Number",
    "Pay End Date",
    "Check Date",
}


def read_payroll_file(file_source) -> pd.DataFrame:
    """
    Read a single payroll Excel file and return a clean DataFrame of employee rows.

    Parameters
    ----------
    file_source : str | Path | file-like object
        Path to the Excel file or a file-like object (e.g. Streamlit UploadedFile).

    Returns
    -------
    pd.DataFrame
        One row per employee, all pay columns converted to float (NaN → 0).
    """
    df = pd.read_excel(file_source, sheet_name=0, header=PAYROLL_HEADER_ROW)

    # Keep only rows with a valid Employee ID (filters out company summary / totals rows)
    df = df[df[EMPLOYEE_ID_COLUMN].notna()].copy()

    # Drop rows where the Department column is also null (extra safety)
    df = df[df[DEPARTMENT_COLUMN].notna()].copy()

    # Coerce all pay columns to numeric; non-numeric cells (labels etc.) become 0
    pay_cols = [c for c in df.columns if c not in _META_COLUMNS]
    for col in pay_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    # Ensure Employee ID is stored as string to prevent float formatting
    df[EMPLOYEE_ID_COLUMN] = df[EMPLOYEE_ID_COLUMN].astype(str)

    # Strip whitespace from string columns
    for col in [c for c in _META_COLUMNS if c in df.columns]:
        if df[col].dtype == object:
            df[col] = df[col].str.strip()

    df = df.reset_index(drop=True)
    return df


def read_full_payroll_file(file_source) -> pd.DataFrame:
    """
    Read the payroll file exactly as-is — all rows including the grand total row.
    Used ONLY for the consolidated inputs file so it mirrors the source exactly.

    Unlike read_payroll_file(), this does NOT filter by Employee ID and does NOT
    coerce values to numeric — preserving labels, totals and original formatting.
    """
    df = pd.read_excel(file_source, sheet_name=0, header=PAYROLL_HEADER_ROW)

    # Drop fully-empty rows (Excel sometimes adds blank rows at the bottom)
    df = df.dropna(how="all").copy()

    # Drop unnamed columns (internal openpyxl artefacts beyond the data range)
    df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed:")]

    # Strip whitespace from string columns so labels look clean
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace("nan", "")   # pandas reads blank as "nan"

    return df.reset_index(drop=True)


def combine_payroll_files(file1, file2) -> pd.DataFrame:
    """
    Combine two payroll files for the same period (e.g. 15th-cycle and EOM-cycle).

    Handles the case where different files have different columns:
    missing columns are filled with 0.

    Parameters
    ----------
    file1 : str | Path | file-like object
    file2 : str | Path | file-like object

    Returns
    -------
    pd.DataFrame
        Combined employee-level data with all columns from both files.
    """
    df1 = read_payroll_file(file1)
    df2 = read_payroll_file(file2)

    # Concatenate; sort=False preserves column order from df1 first
    combined = pd.concat([df1, df2], ignore_index=True, sort=False)

    # Fill missing pay columns (present in one file but not the other) with 0
    pay_cols = [c for c in combined.columns if c not in _META_COLUMNS]
    combined[pay_cols] = combined[pay_cols].fillna(0.0)

    return combined


def read_invoice_level_rows(file_source) -> pd.DataFrame:
    """
    Read only the pure invoice-level rows from the payroll file.

    The payroll file has two types of non-employee rows:
      1. Company summary row  — no Employee ID, but has Gross Wages / Taxes etc. summed
      2. Invoice detail row   — no Employee ID, Gross Wages = 0, only invoice charges

    We want ONLY the invoice detail rows (type 2) so we don't double-count amounts
    that are already captured from employee rows via aggregate_by_department.
    """
    df = pd.read_excel(file_source, sheet_name=0, header=PAYROLL_HEADER_ROW)

    # Step 1: only rows with no Employee ID
    df = df[df[EMPLOYEE_ID_COLUMN].isna()].copy()

    # Step 2: coerce all pay columns to numeric
    pay_cols = [c for c in df.columns if c not in _META_COLUMNS]
    for col in pay_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    # Step 3: exclude company-level summary rows — they have Gross Wages > 0
    # Invoice-level rows have 0 in all regular pay columns
    if "Gross Wages - Totals" in df.columns:
        df = df[df["Gross Wages - Totals"].fillna(0) == 0]

    # Step 4: drop duplicate rows — the invoice section always has a detail row
    # AND a section-total row with identical values. Keeping both would
    # double-count every amount. Drop duplicates so only one copy remains.
    pay_cols_present = [c for c in df.columns if c not in _META_COLUMNS]
    if pay_cols_present:
        df = df.drop_duplicates(subset=pay_cols_present, keep="first")

    return df.reset_index(drop=True)


def read_payroll_grand_total(file_source) -> float | None:
    """
    Read the payroll file grand total (column AT) from the highlighted totals columns.

    The grand total row is identified by "Grand Totals" in the Company Code column.
    Column AT formula = Gross Wages + ER Taxes + Benefits + Fees +
                        Workers Comp + Returned Deductions + Invoice Level Charges
    This value should equal the JE provision (total debits − explicit credits).

    Returns None if the grand total row cannot be found.
    """
    df = pd.read_excel(file_source, sheet_name=0, header=PAYROLL_HEADER_ROW)

    # Locate the grand total row by "Grand Totals" in Company Code column
    company_col = "Company Code"
    if company_col not in df.columns:
        return None

    mask = df[company_col].astype(str).str.strip().str.lower() == "grand totals"
    grand_row = df[mask]
    if grand_row.empty:
        return None

    # Sum the 7 highlighted totals columns from that row
    total = 0.0
    for col in GRAND_TOTAL_COLUMNS:
        if col in grand_row.columns:
            val = grand_row.iloc[0][col]
            total += float(val) if pd.notna(val) else 0.0

    return round(total, 2)


def _safe_strip(series: pd.Series) -> pd.Series:
    """Strip whitespace from string entries only; leave non-strings untouched."""
    return series.apply(lambda x: x.strip() if isinstance(x, str) else x)


def parse_all_from_raw(raw_df: pd.DataFrame) -> tuple:
    """
    Derive all four outputs from a single already-read raw DataFrame
    (header=None). Eliminates 3 duplicate pd.read_excel() calls.

    Returns
    -------
    (df, full_df, invoice_df, grand_total)
    """
    # ── Promote header row ────────────────────────────────────────────────
    header_row = PAYROLL_HEADER_ROW
    headers    = raw_df.iloc[header_row].tolist()
    # Normalise column names: blank → "Unnamed_N", everything else → str
    headers = [
        str(h).strip() if (pd.notna(h) and str(h).strip() != "") else f"Unnamed_{i}"
        for i, h in enumerate(headers)
    ]
    data = raw_df.iloc[header_row + 1:].copy()
    data.columns = headers
    data = data.reset_index(drop=True)

    # ── full_df: all rows, no filtering, string-clean ─────────────────────
    full_df = data.copy()
    full_df = full_df.dropna(how="all")
    named_cols = [c for c in full_df.columns if not c.startswith("Unnamed_")]
    full_df = full_df[named_cols]
    for col in full_df.columns:
        full_df[col] = _safe_strip(full_df[col])
        # Replace bare "nan" strings left by pandas with empty string
        full_df[col] = full_df[col].replace("nan", "")
    full_df = full_df.reset_index(drop=True)

    # ── df: employee rows only ────────────────────────────────────────────
    df = data[data[EMPLOYEE_ID_COLUMN].notna()].copy()
    df = df[df[DEPARTMENT_COLUMN].notna()].copy()
    pay_cols = [c for c in df.columns if c not in _META_COLUMNS]
    for col in pay_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    df[EMPLOYEE_ID_COLUMN] = df[EMPLOYEE_ID_COLUMN].astype(str)
    for col in [c for c in _META_COLUMNS if c in df.columns]:
        df[col] = _safe_strip(df[col])
    df = df.reset_index(drop=True)

    # ── invoice_df: non-employee, non-gross-wages rows ────────────────────
    inv = data[data[EMPLOYEE_ID_COLUMN].isna()].copy()
    pay_cols_inv = [c for c in inv.columns if c not in _META_COLUMNS]
    for col in pay_cols_inv:
        inv[col] = pd.to_numeric(inv[col], errors="coerce").fillna(0.0)
    if "Gross Wages - Totals" in inv.columns:
        inv = inv[inv["Gross Wages - Totals"].fillna(0) == 0]
    pay_cols_present = [c for c in inv.columns if c not in _META_COLUMNS]
    if pay_cols_present:
        inv = inv.drop_duplicates(subset=pay_cols_present, keep="first")
    invoice_df = inv.reset_index(drop=True)

    # ── grand_total: sum of GRAND_TOTAL_COLUMNS in the grand totals row ──
    grand_total = None
    if "Company Code" in data.columns:
        mask = data["Company Code"].apply(
            lambda x: isinstance(x, str) and x.strip().lower() == "grand totals"
        )
        grand_row = data[mask]
        if not grand_row.empty:
            total = 0.0
            for col in GRAND_TOTAL_COLUMNS:
                if col in grand_row.columns:
                    val = grand_row.iloc[0][col]
                    try:
                        total += float(val) if pd.notna(val) else 0.0
                    except (ValueError, TypeError):
                        pass
            grand_total = round(total, 2)

    return df, full_df, invoice_df, grand_total


def get_file_metadata(file_source) -> dict:
    """
    Extract basic metadata from the payroll file header rows.

    Scans the first 7 rows of the file for any cell containing a date in
    MM/DD/YYYY format — this is the Invoice Date regardless of how the rows
    are labelled in different file versions.

    Builds the default Journal Number as "Salary for MM/DD/YYYY".
    """
    df_raw = pd.read_excel(file_source, sheet_name=0, header=None, nrows=7)
    metadata = {}

    # Company name — typically Row 2, Column 0
    try:
        metadata["company_name"] = str(df_raw.iloc[2, 0]).replace("Company Name : ", "").strip()
    except Exception:
        metadata["company_name"] = ""

    # Find the "Payroll Cycle" row and extract the Invoice Date from it.
    # Format: "Payroll Cycle (Invoice Number, Invoice Date, ...) = 50442500, 01/30/2026, ..."
    # The Invoice Date is the 2nd value after the "=" sign.
    invoice_date = ""
    for row_idx in range(len(df_raw)):
        for cell in df_raw.iloc[row_idx]:
            cell_str = str(cell) if pd.notna(cell) else ""
            if "payroll cycle" in cell_str.lower():
                # Take everything after "=" and find the first date
                after_eq = cell_str.split("=", 1)[-1] if "=" in cell_str else cell_str
                dates = _DATE_RE.findall(after_eq)
                if dates:
                    invoice_date = dates[0]   # e.g. "01/30/2026"
                break
        if invoice_date:
            break

    metadata["invoice_date"]   = invoice_date
    metadata["journal_number"] = f"Salary for {invoice_date}" if invoice_date else ""

    return metadata
