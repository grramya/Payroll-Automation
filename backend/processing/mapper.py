# =============================================================================
# processing/mapper.py — Load and apply the GL mapping rules
# =============================================================================
"""
Mapping file structure (no header row in Excel; all columns are by index):

  Col 0 : Pay Item name
  Col 1 : COGS GL Account
  Col 2 : Indirect GL Account
  Col 3 : COGS Account ID (QBO)
  Col 4 : Indirect Account ID (QBO)
  Col 6 : Department Long Descr
  Col 7 : Allocation  ("COGS" or "Indirect")

Rows with values in col 6/7 but NOT col 1/2  → Department allocation table
Rows with values in col 0/1/2 but NOT col 6/7 → Pay item GL mapping table
"""

import pandas as pd

# Sentinel values to skip for pay item names (column 0)
_IGNORE_PAY_ITEMS = {"nan", "", "COGS", "Indirect"}

# Sentinel values that mean "no GL account assigned" for GL columns (col 1/2)
_IGNORE_GL = {"nan", "", "COGS", "Indirect", "NA", "N/A", "na", "n/a"}

# Sentinel values to skip for department names (column 5)
_IGNORE_DEPTS = {"nan", "", "Department Long Descr"}


def load_mapping(mapping_source) -> tuple[dict, dict, set, dict]:
    """
    Parse the Mapping Excel file and return lookup dictionaries plus a
    set of all known pay items (including those mapped to NA).

    Parameters
    ----------
    mapping_source : str | Path | file-like object

    Returns
    -------
    pay_item_map : dict
        { pay_item_name : {"COGS": gl_account, "Indirect": gl_account} }
        Only items that have a real GL account (not NA).

    dept_allocation : dict
        { department_name : "COGS" | "Indirect" }

    known_items : set
        ALL pay item names present in the mapping file, including those with
        NA as the GL account. Used to distinguish intentionally-skipped
        columns from truly-unknown columns.

    pay_item_id_map : dict
        { pay_item_name : {"COGS": account_id, "Indirect": account_id} }
        QBO Account IDs from columns 3 & 4 of the mapping file.
        Empty string where no ID is specified.
    """
    df = pd.read_excel(mapping_source, sheet_name=0, header=None)

    pay_item_map: dict    = {}
    dept_allocation: dict = {}
    known_items: set      = set()
    pay_item_id_map: dict = {}

    for _, row in df.iterrows():
        # ---- Pay item GL mapping (columns 0, 1, 2) -------------------------
        pay_item    = _clean(row, 0)
        cogs_gl     = _clean(row, 1)
        indirect_gl = _clean(row, 2)
        cogs_id     = _clean(row, 3)   # QBO Account ID for COGS GL
        indirect_id = _clean(row, 4)   # QBO Account ID for Indirect GL

        if pay_item and pay_item not in _IGNORE_PAY_ITEMS:
            # Track ALL known pay items (even NA-mapped ones)
            known_items.add(pay_item)

            # Only add to pay_item_map if it has a real GL account
            if cogs_gl and cogs_gl not in _IGNORE_GL:
                pay_item_map[pay_item] = {
                    "COGS":     cogs_gl,
                    "Indirect": indirect_gl if indirect_gl not in _IGNORE_GL else cogs_gl,
                }
                pay_item_id_map[pay_item] = {
                    "COGS":     cogs_id,
                    "Indirect": indirect_id if indirect_id else cogs_id,
                }

        # ---- Department allocation mapping (columns 6, 7) ------------------
        dept  = _clean(row, 6)
        alloc = _clean(row, 7)

        if dept and alloc and dept not in _IGNORE_DEPTS:
            dept_allocation[dept] = alloc

    return pay_item_map, dept_allocation, known_items, pay_item_id_map


def get_allocation(dept: str, dept_allocation: dict) -> str:
    """
    Return 'COGS' or 'Indirect' for a department.
    Defaults to 'Indirect' if the department is not in the mapping.
    """
    return dept_allocation.get(dept.strip(), "Indirect")


def get_account_id(pay_item: str, allocation: str, pay_item_id_map: dict) -> str:
    """
    Return the QBO Account ID for a given pay item and allocation type.
    Returns empty string if not found or not set.
    """
    key = _norm(pay_item)
    entry = pay_item_id_map.get(key)
    if entry is None:
        key_lower = key.lower()
        entry = next(
            (v for k, v in pay_item_id_map.items() if k.lower() == key_lower),
            None,
        )
    return (entry or {}).get(allocation, "")


def get_gl_account(pay_item: str, allocation: str, pay_item_map: dict) -> str:
    """
    Return the GL account string for a given pay item and allocation type.
    Returns empty string if not found.

    Two-pass lookup:
      1. Exact match (after strip) — handles the normal case
      2. Case-insensitive fallback — handles minor casing/whitespace differences
         between the payroll file column names and the mapping file entries
    """
    key = _norm(pay_item)
    entry = pay_item_map.get(key)
    if entry is None:
        key_lower = key.lower()
        entry = next(
            (v for k, v in pay_item_map.items() if k.lower() == key_lower),
            None,
        )
    return (entry or {}).get(allocation, "")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _clean(row: pd.Series, col_idx: int) -> str:
    """Extract and clean a cell value from a pandas Series by integer index."""
    try:
        val = row.iloc[col_idx]
        if pd.isna(val):
            return ""
        # _norm collapses ALL unicode whitespace (including \xa0 non-breaking space)
        return _norm(str(val))
    except (IndexError, KeyError):
        return ""


def _norm(s: str) -> str:
    """Normalize whitespace: split on any unicode whitespace, rejoin with single space."""
    return " ".join(s.split())
