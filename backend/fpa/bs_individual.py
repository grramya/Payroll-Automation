"""
BS (Individual) generator — mirrors the layout and logic of
'BS (Individual)' in Financials_Modul (output) 1.xlsx.

Column structure (same as Excel, rows 3-5):
  A  Particulars
  B  {company_name}                       (= Concertiv Inc.)
  C  Concertiv Insurance Brokers, Inc.    (blank — no data in current upload)
  D  Eliminations                         (blank — no inter-company data)
  E  Consolidated BS                      (= B + C + D)

Month-selector logic:
  • The Excel shows balances "As of {date}" — changing the date recalculates.
  • We replicate this by computing, for each available BS month, the last
    Balance per account using only rows on or before that month.
  • Preview ships ALL months; the frontend month-picker switches views.

Value logic:
  1. For a given "as-of" month, filter BS rows to months ≤ as-of month.
  2. Sort by date; take the LAST Balance per account (cumulative running
     balance — the last entry IS the end-of-period account balance).
  3. Net Income = cumulative sum of P&L Amounts through the as-of month.
  4. Retained Earnings = plug: Total Assets − Liabilities − CS − PS − APIC − NI.
"""

import io
import re
from datetime import datetime

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


def _sort_months(months: list) -> list:
    """Sort 'Mmm-yy' strings chronologically."""
    def _key(m):
        try:
            return datetime.strptime(m, "%b-%y")
        except Exception:
            return datetime.min
    return sorted(months, key=_key)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _leaf(full_name: str) -> str:
    """Strip leading account number; return leaf segment of colon-separated name.
    '131010 Prepaid Expenses:Prepaid Expense' → 'Prepaid Expense'
    '120010 Accounts Receivable' → 'Accounts Receivable'
    """
    n = re.sub(r"^\d+\s+", "", str(full_name).strip())
    return n.split(":")[-1].strip() if ":" in n else n


# ── Classification → BS section mapping ──────────────────────────────────────

# Maps each BS (Individual) section group to a list of Classification (Line Item) values
BS_GROUPS: dict[str, list[str]] = {
    "Bank Accounts":         ["Cash and Cash equivalents"],
    "Accounts Receivable":   ["Accounts Receivable"],
    "Other Current Assets":  ["Prepaid expenses and other current assets",
                               "Deposit or Advances"],
    "Fixed Assets":          ["Tangible Assets, net of accumulated depreciation"],
    "Goodwill":              ["Goodwill, net of accumulated amortization"],
    "Intangible Assets":     ["Intangible assets, net of accumulated amortization"],
    "ROU Operating Leases":  ["Operating lease right-of-use assets"],
    "ROU Finance Leases":    ["Finance lease right-of-use assets"],
    "Accounts Payable":      ["Accounts Payable"],
    "Accrued Expenses":      ["Accrued expenses"],
    "Deferred Revenue":      ["Deferred Revenue"],
    "Due to Employees":      ["Due to Employee's"],
    "Lease - Current":       ["Current portion of operating lease liabilities"],
    "Statutory Dues":        ["Statutory Dues"],
    "Long-Term Liabilities": ["Operating lease liabilities, net of current portion",
                               "Other Long term Liabilities"],
    "Common Stock":          ["Common Stock"],
    "Preferred Stock":       ["Preferred Stock"],
    "APIC":                  ["Additional paid-in capital"],
}


# ── Value computation ─────────────────────────────────────────────────────────

def _compute(df: pd.DataFrame, as_of_month: str | None = None) -> tuple[dict, float, str]:
    """
    Returns:
      acct_balances  – {group_key: {account_display_name: balance}}
      net_income     – cumulative sum of P&L Amounts through as_of_month
      as_of_label    – e.g. 'Apr-26'

    If as_of_month is given, only BS/P&L rows up to and including that month
    are considered, matching the Excel "As of {date}" date-picker logic.
    """
    df = df.copy()
    df["_date_parsed"] = pd.to_datetime(df["Date"], format="%m/%d/%Y", errors="coerce")
    df = df.sort_values("_date_parsed")

    bs_all = df[df["_Financials"] == "Balance Sheet"].copy()
    bs_all = bs_all[bs_all["_Month"].notna() & bs_all["Balance"].notna()]
    pl_all = df[df["_Financials"] == "Profit and Loss A/c"].copy()

    all_bs_months = _sort_months(bs_all["_Month"].dropna().unique().tolist())
    all_pl_months = _sort_months(pl_all["_Month"].dropna().unique().tolist())

    if as_of_month and as_of_month in all_bs_months:
        idx = all_bs_months.index(as_of_month)
        bs = bs_all[bs_all["_Month"].isin(set(all_bs_months[:idx + 1]))]
        as_of_label = as_of_month
    else:
        bs = bs_all
        as_of_label = all_bs_months[-1] if all_bs_months else "N/A"

    if as_of_month and as_of_month in all_pl_months:
        idx = all_pl_months.index(as_of_month)
        pl = pl_all[pl_all["_Month"].isin(set(all_pl_months[:idx + 1]))]
    else:
        pl = pl_all

    net_income = float(pl["Amount"].sum())

    # Last Balance per account within the filtered window
    last_bal = (
        bs.sort_values("_date_parsed")
        .groupby(["Account", "_Classification"])["Balance"]
        .last()
    )

    acct_balances: dict[str, dict[str, float]] = {g: {} for g in BS_GROUPS}
    for (acct, cls), bal in last_bal.items():
        for group, cls_list in BS_GROUPS.items():
            if cls in cls_list:
                display = _leaf(acct)
                key = display
                suffix = 1
                while key in acct_balances[group]:
                    key = f"{display} ({suffix})"
                    suffix += 1
                acct_balances[group][key] = float(bal)
                break

    return acct_balances, net_income, as_of_label


def _group_total(acct_balances: dict, groups: list[str]) -> float:
    return sum(
        bal
        for g in groups
        for bal in acct_balances.get(g, {}).values()
    )


# ── Build row list ────────────────────────────────────────────────────────────

def _build_rows(acct_balances: dict, net_income: float) -> list[tuple]:
    """
    Returns list of (label, value, row_type) where row_type is one of:
      'title_main' | 'title_sub' | 'section' | 'subsection' |
      'group_header' | 'account' | 'group_total' |
      'total' | 'grand_total' | 'equity_item' | 'check' | 'blank'
    """
    R = []

    def G(key):
        return acct_balances.get(key, {})

    def add_group(header_label, group_keys, indent="   "):
        """Append header + individual accounts + total. Returns group total."""
        if isinstance(group_keys, str):
            group_keys = [group_keys]
        total = sum(b for gk in group_keys for b in G(gk).values())
        R.append((header_label, None, "group_header"))
        for gk in group_keys:
            for name, bal in sorted(G(gk).items()):
                R.append((indent + "   " + name, bal, "account"))
        R.append(("Total " + header_label.strip(), total, "group_total"))
        return total

    # ── ASSETS ───────────────────────────────────────────────────────────────
    R.append(("ASSETS", None, "section"))
    R.append(("   Current Assets", None, "subsection"))

    bank = add_group("      Bank Accounts",       "Bank Accounts")
    ar   = add_group("      Accounts Receivable", "Accounts Receivable")
    oca  = add_group("      Other Current Assets",
                     ["Other Current Assets"], indent="      ")
    total_ca = bank + ar + oca
    R.append(("   Total Current Assets", total_ca, "total"))

    R.append(("   Fixed Assets", None, "subsection"))
    fa = add_group("      Fixed Assets",          "Fixed Assets")
    R.append(("   Total Fixed Assets", fa, "total"))

    R.append(("   Other Assets", None, "subsection"))
    gw     = add_group("      Goodwill",              "Goodwill")
    ia     = add_group("      Intangible Assets",     "Intangible Assets")
    rou_op = add_group("      ROU - Operating Leases","ROU Operating Leases")
    rou_fi = add_group("      ROU - Finance Leases",  "ROU Finance Leases")
    total_oa = gw + ia + rou_op + rou_fi
    R.append(("   Total Other Assets", total_oa, "total"))

    total_assets = total_ca + fa + total_oa
    R.append(("TOTAL ASSETS", total_assets, "grand_total"))

    R.append((None, None, "blank"))

    # ── LIABILITIES AND EQUITY ────────────────────────────────────────────────
    R.append(("LIABILITIES AND EQUITY", None, "section"))
    R.append(("   Liabilities", None, "subsection"))
    R.append(("      Current Liabilities", None, "subsection"))

    ap  = add_group("         Accounts Payable",   "Accounts Payable",  indent="         ")
    R.append(("         Other Current Liabilities", None, "subsection"))
    ae  = add_group("            Accrued Expenses", "Accrued Expenses",  indent="            ")
    dr  = add_group("            Deferred Revenue", "Deferred Revenue",  indent="            ")
    dte = add_group("            Due to Employees", "Due to Employees",  indent="            ")
    lcl = add_group("            Lease Payable - Current",
                    "Lease - Current",               indent="            ")
    std = add_group("            Statutory Dues",   "Statutory Dues",    indent="            ")

    total_ocl = ae + dr + dte + lcl + std
    R.append(("         Total Other Current Liabilities", total_ocl, "total"))
    total_cl = ap + total_ocl
    R.append(("      Total Current Liabilities", total_cl, "total"))

    lt = add_group("      Long-Term Liabilities", "Long-Term Liabilities", indent="      ")
    total_liab = total_cl + lt
    R.append(("   Total Liabilities", total_liab, "total"))

    # ── Equity ────────────────────────────────────────────────────────────────
    R.append(("   Equity", None, "subsection"))
    cs   = add_group("      Common Stock",          "Common Stock",  indent="      ")
    ps   = add_group("      Preferred Stock",       "Preferred Stock", indent="      ")
    apic_accts = add_group("      Additional Paid-In Capital",
                           "APIC",                  indent="      ")
    # Retained Earnings = plug so that BS ties
    retained = total_assets - total_liab - cs - ps - apic_accts - net_income
    R.append(("      Retained Earnings", retained, "equity_item"))
    R.append(("      Net Income (Period)", net_income, "equity_item"))

    total_equity = cs + ps + apic_accts + retained + net_income
    R.append(("   Total Equity", total_equity, "total"))

    total_l_and_e = total_liab + total_equity
    R.append(("TOTAL LIABILITIES AND EQUITY", total_l_and_e, "grand_total"))

    R.append((None, None, "blank"))
    check = total_assets - total_l_and_e
    R.append(("Check (Assets − Liabilities & Equity)", check, "check"))

    return R


# ── Excel writer ──────────────────────────────────────────────────────────────

def run_bs_individual(df: pd.DataFrame, company_name: str) -> bytes:
    """Write Excel for latest month with 5 columns (Particulars + 4 company cols)."""
    acct_balances, net_income, as_of = _compute(df)
    rows = _build_rows(acct_balances, net_income)

    wb = Workbook()
    ws = wb.active
    ws.title = "BS (Individual)"

    # ── Styles ───────────────────────────────────────────────────────────────
    def F(bold=False, size=9, color="000000", italic=False):
        return Font(name="Calibri", bold=bold, size=size, color=color, italic=italic)

    DARK_NAVY  = PatternFill("solid", fgColor="0F172A")
    DARK_BLUE  = PatternFill("solid", fgColor="1E3A5F")
    MED_BLUE   = PatternFill("solid", fgColor="EBF2FB")
    LIGHT_GRAY = PatternFill("solid", fgColor="F1F5F9")
    GREEN_FILL = PatternFill("solid", fgColor="F0FDF4")
    RED_FILL   = PatternFill("solid", fgColor="FEF2F2")
    SUBSEC_BG  = PatternFill("solid", fgColor="F8FAFC")

    AL = Alignment(horizontal="left",   vertical="center")
    AR = Alignment(horizontal="right",  vertical="center")
    AC = Alignment(horizontal="center", vertical="center")

    thin  = Side(border_style="thin",   color="CBD5E1")
    thick = Side(border_style="medium", color="64748B")
    TOP1  = Border(top=thin)
    TOP2  = Border(top=thick)

    NUM = "#,##0.00"

    # ── Title block (mirrors Excel rows 1-3) ─────────────────────────────────
    ws.append([company_name, None, None, None, None])
    ws["A1"].font = F(bold=True, size=14, color="0F172A"); ws.row_dimensions[1].height = 22

    ws.append(["Balance Sheet", None, None, None, None])
    ws["A2"].font = F(bold=True, size=11, color="1E3A5F")

    ws.append([f"As of {as_of}", None, None, None, None])
    ws["A3"].font = F(size=9, color="64748B")

    ws.append([None] * 5)  # spacer

    # ── Column header row (mirrors Excel row 5) ───────────────────────────────
    headers = ["Particulars", company_name,
               "Concertiv Insurance Brokers, Inc.", "Eliminations", "Consolidated BS"]
    ws.append(headers)
    for ci in range(1, 6):
        c = ws.cell(5, ci)
        c.font      = F(bold=True, size=9, color="FFFFFF")
        c.fill      = DARK_BLUE
        c.alignment = AL if ci == 1 else AC
    ws.row_dimensions[5].height = 16

    # ── Data rows ─────────────────────────────────────────────────────────────
    for label, value, rtype in rows:

        if rtype == "blank":
            ws.append([None] * 5)
            continue

        # co_b (Insurance Brokers) and elim always 0; cons = value
        # co_b (Insurance Brokers) and elim always blank; cons = value
        ws.append([label, value, None, None, value])
        r  = ws.max_row
        ca = ws.cell(r, 1)   # Particulars
        cb = ws.cell(r, 2)   # company_name
        ce = ws.cell(r, 5)   # Consolidated

        ca.alignment = AL
        for cell in (cb, ce):
            if value is not None:
                cell.number_format = NUM
                cell.alignment     = AR

        def fill_all(fill):
            for ci in range(1, 6): ws.cell(r, ci).fill = fill

        if rtype == "section":
            fill_all(DARK_NAVY)
            ca.font = F(bold=True, size=9, color="FFFFFF")
            for ci in range(2, 6): ws.cell(r, ci).font = F(bold=True, size=9, color="FFFFFF")
            ws.row_dimensions[r].height = 15

        elif rtype == "subsection":
            fill_all(SUBSEC_BG)
            ca.font = F(bold=True, size=9, color="1E293B")

        elif rtype == "group_header":
            fill_all(MED_BLUE)
            ca.font = F(bold=True, size=9, color="1E40AF")
            for ci in range(2, 6): ws.cell(r, ci).font = F(bold=True, size=9, color="1E40AF")
            ws.row_dimensions[r].height = 14

        elif rtype in ("account", "equity_item"):
            ca.font = F(size=9, color="334155")
            val_color = "DC2626" if value is not None and value < 0 else "334155"
            cb.font = F(size=9, color=val_color)
            ce.font = F(size=9, color=val_color)

        elif rtype == "group_total":
            fill_all(MED_BLUE)
            for ci in range(1, 6):
                c = ws.cell(r, ci)
                c.font   = F(bold=True, size=9, color="1E40AF")
                c.border = TOP1

        elif rtype == "total":
            fill_all(LIGHT_GRAY)
            for ci in range(1, 6):
                c = ws.cell(r, ci)
                c.font   = F(bold=True, size=9)
                c.border = TOP1

        elif rtype == "grand_total":
            fill_all(DARK_BLUE)
            for ci in range(1, 6):
                c = ws.cell(r, ci)
                c.font   = F(bold=True, size=10, color="FFFFFF")
                c.border = TOP2
            ws.row_dimensions[r].height = 16

        elif rtype == "check":
            is_zero = value is not None and abs(value) < 0.01
            fill_all(GREEN_FILL if is_zero else RED_FILL)
            txt = "166534" if is_zero else "991B1B"
            ca.font = F(bold=True, size=9, color=txt)
            cb.font = F(bold=True, size=9, color=txt)
            ce.font = F(bold=True, size=9, color=txt)

    # ── Column widths ─────────────────────────────────────────────────────────
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 26
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 16
    ws.freeze_panes = "B6"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── Preview payload ───────────────────────────────────────────────────────────

def get_bs_individual_preview(df: pd.DataFrame) -> dict:
    """
    Return JSON-serialisable preview for the frontend.

    Shape:
      {
        months:        ["Jan-24", ...],
        as_of:         "Feb-26",        (latest available month)
        rows_by_month: {
          "Feb-26": [
            {label, co_a, co_b, elim, cons, type},
            ...
          ],
          ...
        }
      }

    co_b (Insurance Brokers) and elim (Eliminations) are always 0 since
    the current upload contains only one company's data.
    cons (Consolidated) = co_a + co_b + elim = co_a.
    """
    bs_df = df[df["_Financials"] == "Balance Sheet"].copy()
    all_bs_months = _sort_months(bs_df["_Month"].dropna().unique().tolist())

    if not all_bs_months:
        return {"months": [], "as_of": "N/A", "rows_by_month": {}}

    rows_by_month: dict = {}
    for month in all_bs_months:
        acct_balances, net_income, _ = _compute(df, as_of_month=month)
        raw_rows = _build_rows(acct_balances, net_income)
        rows_by_month[month] = [
            {
                "label": lbl,
                "co_a":  round(val, 2) if val is not None else None,
                "co_b":  0.0,
                "elim":  0.0,
                "cons":  round(val, 2) if val is not None else None,
                "type":  rt,
            }
            for lbl, val, rt in raw_rows
        ]

    return {
        "months":        all_bs_months,
        "as_of":         all_bs_months[-1],
        "rows_by_month": rows_by_month,
    }
