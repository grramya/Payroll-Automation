# =============================================================================
# processing/validator.py — Input validation and sanity checks
# =============================================================================

import pandas as pd
from config import EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN


def validate_payroll_df(df: pd.DataFrame, file_label: str = "file") -> list[str]:
    """
    Check that a parsed payroll DataFrame has the expected structure.
    Returns a list of error/warning strings (empty = all good).
    """
    issues = []

    required_cols = [EMPLOYEE_ID_COLUMN, DEPARTMENT_COLUMN, EMPLOYEE_NAME_COLUMN]
    for col in required_cols:
        if col not in df.columns:
            issues.append(f"{file_label}: Missing required column '{col}'.")

    if df.empty:
        issues.append(f"{file_label}: No employee rows found after filtering.")

    return issues


def validate_mapping(pay_item_map: dict, dept_allocation: dict) -> list[str]:
    """
    Confirm the mapping was parsed successfully.
    Returns a list of error strings (empty = all good).
    """
    issues = []

    if not pay_item_map:
        issues.append("Mapping file: No pay item GL accounts were loaded.")

    if not dept_allocation:
        issues.append("Mapping file: No department allocation rules were loaded.")

    # Warn if core pay items are missing (case-insensitive check)
    core_items = ["Regular", "Employer Paid Taxes - Totals", "Company Paid Benefits - Totals"]
    map_keys_lower = {k.strip().lower() for k in pay_item_map}
    for item in core_items:
        if item.strip().lower() not in map_keys_lower:
            issues.append(f"Mapping file: Pay item '{item}' not found — check mapping sheet.")

    return issues


def validate_je(je_df: pd.DataFrame) -> list[str]:
    """
    Verify the generated JE is balanced (total debits ≈ total credits).
    Returns a list of warning strings.
    """
    issues = []

    total_debit  = je_df["Debit (exc. Tax)"].fillna(0).sum()
    total_credit = je_df["Credit (exc. Tax)"].fillna(0).sum()
    diff = abs(total_debit - total_credit)

    if diff > 0.02:
        issues.append(
            f"JE is out of balance by ${diff:,.2f} "
            f"(Total Debit={total_debit:,.2f}, Total Credit={total_credit:,.2f})."
        )

    if je_df.empty:
        issues.append("No JE lines were generated — check mapping and payroll data.")

    return issues
