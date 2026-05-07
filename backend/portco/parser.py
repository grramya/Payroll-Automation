"""portco/parser.py — Parse MBR Excel files for PortCo Reporting dashboard."""
from __future__ import annotations
from io import BytesIO
from typing import Any

import openpyxl


def _safe_float(v: Any) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        return None if (f != f) else f  # NaN guard
    return None


def _fmt_date(dt: Any) -> str | None:
    if hasattr(dt, "year") and hasattr(dt, "month"):
        return f"{dt.year}-{str(dt.month).zfill(2)}"
    return None


def _find_label_row(rows: list, label: str, col: int = 1) -> int | None:
    for i, row in enumerate(rows):
        if len(row) > col and row[col] == label:
            return i
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Finance sheet
# ─────────────────────────────────────────────────────────────────────────────

def _parse_finance(ws) -> dict:
    rows = list(ws.iter_rows(values_only=True))

    # Company name / report month from first 4 rows
    company_name, report_month = "", ""
    for row in rows[:5]:
        for cell in row:
            if not isinstance(cell, str) or not cell.strip():
                continue
            s = cell.strip()
            if s in ("Finance", "Monthly"):
                continue
            if not company_name:
                company_name = s
            elif not report_month and "Reporting" in s:
                report_month = s

    # Date header row — find the row with the most datetime objects
    date_col_start = 4   # col E (0-indexed)
    dates: list = []
    for row in rows:
        d = [v for v in row[date_col_start:] if hasattr(v, "year")]
        if len(d) > len(dates):
            dates = d

    if not dates:
        return {"months": [], "company_name": company_name, "report_month": report_month}

    months = [_fmt_date(d) for d in dates]
    n = len(months)

    def series(label: str) -> list[float | None]:
        idx = _find_label_row(rows, label)
        if idx is None:
            return [None] * n
        row = rows[idx]
        vals = list(row[date_col_start: date_col_start + n])
        return [_safe_float(v) for v in vals]

    # Gross margin = Revenue + COGS (COGS are negative in the sheet)
    revenue  = series("Revenue")
    cogs_svc = series("(-) Service/Delivery (CoS/CoGS)")
    cogs_prd = series("(-) Product")
    cogs_tch = series("(-) Technology")
    gross_profit = [
        (r or 0) + (s or 0) + (p or 0) + (t or 0)
        for r, s, p, t in zip(revenue, cogs_svc, cogs_prd, cogs_tch)
    ]
    gross_margin_pct = [
        (gp / r * 100) if (r and r != 0) else None
        for gp, r in zip(gross_profit, revenue)
    ]
    ebitda = series("Adj. EBITDA")
    ebitda_margin_pct = [
        (e / r * 100) if (r and r != 0) else None
        for e, r in zip(ebitda, revenue)
    ]
    cash_raw = series("(-) Cash")
    cash = [abs(v) if v is not None else None for v in cash_raw]

    return {
        "months": months,
        "company_name": company_name,
        "report_month": report_month,
        "income_statement": {
            "ARR":            series("ARR"),
            "Revenue":        revenue,
            "COGS_Service":   cogs_svc,
            "COGS_Product":   cogs_prd,
            "COGS_Technology":cogs_tch,
            "Exp_Sales":      series("(-) Sales"),
            "Exp_Marketing":  series("(-) Marketing"),
            "Exp_CS":         series("(-) Customer Success"),
            "Exp_GA":         series("(-) G&A"),
            "GrossProfit":    gross_profit,
            "GrossMarginPct": gross_margin_pct,
            "EBITDA":         ebitda,
            "EBITDAMarginPct":ebitda_margin_pct,
        },
        "balance_sheet": {
            "Cash":    cash,
            "NetDebt": series("Net Debt"),
            "Debt":    series("Debt & Debt-like Items"),
        },
        "headcount": {
            "Employees":   series("Employees"),
            "VeArc":       series("VeArc"),
            "ThirdParty":  series("3rd Party Providers"),
        },
        "rule_200": {
            "NewLogoGrowth":    series("New Logo ARR Growth (annualized)"),
            "NRR":              series("NRR (annualized)"),
            "GrossMargin":      series("Gross Margin"),
            "EBITDAMargin":     series("EBITDA Margin"),
            "Score":            series("Score"),
            "NewLogoGrowthYTD": series("New Logo ARR Growth (YTD)"),
            "NRRYTD":           series("NRR (YTD)"),
            "GrossMarginYTD":   series("Gross Margin (YTD)"),
            "EBITDAMarginYTD":  series("EBITDA Margin (YTD)"),
            "ScoreYTD":         series("Score (YTD)"),
        },
        "zero_based": {
            "AvgPersonnelCostPerSquad": series("Avg. Personnel Cost per Squad"),
            "PTOverhead":               series("P&T Overhead"),
            "MktgExpPerARR":            series("Mktg exp. per $1 ARR"),
            "SalesExpPerARR":           series("Sales exp. per $1 ARR"),
            "CSExpPerARR":              series("C.S. exp. per $1 ARR"),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Actuals / Budget sheet (same structure)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_actuals(ws) -> dict:
    rows = list(ws.iter_rows(values_only=True))

    # Find header row (contains 'Department' in col B)
    header_idx = None
    for i, row in enumerate(rows):
        if len(row) > 1 and row[1] == "Department":
            header_idx = i
            break

    if header_idx is None:
        return {"months": [], "data": {}}

    header = rows[header_idx]
    date_col_start = 7   # col H (Dept, Cat, ID, Line Item, Units, Assignee = 6 cols after col A)
    dates = [v for v in header[date_col_start:] if hasattr(v, "year")]
    months = [_fmt_date(d) for d in dates]
    n = len(months)

    data: dict[str, dict[str, list]] = {}
    for row in rows[header_idx + 1:]:
        dept = row[1] if len(row) > 1 else None
        line_item = row[4] if len(row) > 4 else None
        if not dept or not line_item:
            continue
        vals = list(row[date_col_start: date_col_start + n])
        if dept not in data:
            data[dept] = {}
        data[dept][line_item] = [_safe_float(v) for v in vals]

    return {"months": months, "data": data}


# ─────────────────────────────────────────────────────────────────────────────
# Executive Summary sheet
# ─────────────────────────────────────────────────────────────────────────────

def _parse_exec_summary(ws) -> list[dict]:
    rows = list(ws.iter_rows(values_only=True))
    results = []
    skip = {"", "Concertiv", "Executive Summary", "What Went Well",
            "What Did Not Go Well", "Focus Areas for next month"}
    for row in rows:
        dept = row[1] if len(row) > 1 else None
        if not dept or not isinstance(dept, str):
            continue
        dept = dept.strip()
        if dept in skip or "Reporting" in dept:
            continue
        went_well = str(row[2] or "").strip() if len(row) > 2 else ""
        not_well  = str(row[3] or "").strip() if len(row) > 3 else ""
        focus     = str(row[4] or "").strip() if len(row) > 4 else ""
        if went_well or not_well or focus:
            results.append({
                "section":    dept,
                "went_well":  went_well,
                "not_well":   not_well,
                "focus":      focus,
            })
    return results


# ─────────────────────────────────────────────────────────────────────────────
# MetricMap parser — returns {metric_id: {YYYY-MM: value}}
# metric_id = "{Department} {Line Item}"  (matches frontend METRIC_DEFS ids)
# ─────────────────────────────────────────────────────────────────────────────

def _sheet_to_metric_map(ws) -> dict[str, dict[str, float]]:
    """Convert an Actuals or Budget sheet to MetricMap format."""
    rows = list(ws.iter_rows(values_only=True))

    # Find header row (Department in col B, index 1)
    header_idx = None
    for i, row in enumerate(rows):
        if len(row) > 1 and row[1] == "Department":
            header_idx = i
            break
    if header_idx is None:
        return {}

    header = rows[header_idx]

    # Dynamically detect where dates begin (first datetime in header)
    date_col_start = next(
        (j for j, v in enumerate(header) if hasattr(v, "year")),
        None,
    )
    if date_col_start is None:
        return {}

    dates = [v for v in header[date_col_start:] if hasattr(v, "year")]
    months = [_fmt_date(d) for d in dates]
    n = len(months)

    metric_map: dict[str, dict[str, float]] = {}
    for row in rows[header_idx + 1:]:
        dept = str(row[1]).strip() if len(row) > 1 and row[1] else None
        line_item = str(row[4]).strip() if len(row) > 4 and row[4] else None
        if not dept or not line_item:
            continue

        metric_id = f"{dept} {line_item}"
        vals = list(row[date_col_start: date_col_start + n])

        month_map: dict[str, float] = {}
        for month, val in zip(months, vals):
            if not month:
                continue
            f = _safe_float(val)
            if f is not None:
                month_map[month] = f

        if month_map:
            metric_map[metric_id] = month_map

    return metric_map


def parse_mbr_to_metric_map(file_bytes: bytes) -> dict:
    """Parse MBR Excel and return {actuals: MetricMap, budget: MetricMap}.
    MetricMap = {metric_id: {YYYY-MM: value}}
    """
    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
    actuals = _sheet_to_metric_map(wb["Actuals"]) if "Actuals" in wb.sheetnames else {}
    budget  = _sheet_to_metric_map(wb["Budget"])  if "Budget"  in wb.sheetnames else {}
    return {"actuals": actuals, "budget": budget}


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def parse_mbr_file(file_bytes: bytes) -> dict:
    """Parse an MBR Excel workbook and return structured dashboard data."""
    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)

    finance = _parse_finance(wb["Finance"]) if "Finance" in wb.sheetnames else {}
    company_name = finance.pop("company_name", "")
    report_month = finance.pop("report_month", "")

    actuals = _parse_actuals(wb["Actuals"]) if "Actuals" in wb.sheetnames else {"months": [], "data": {}}
    budget  = _parse_actuals(wb["Budget"])  if "Budget"  in wb.sheetnames else {"months": [], "data": {}}
    exec_summary = (
        _parse_exec_summary(wb["Executive_Summary"])
        if "Executive_Summary" in wb.sheetnames else []
    )

    return {
        "company_name":  company_name,
        "report_month":  report_month,
        "finance":       finance,
        "actuals":       actuals,
        "budget":        budget,
        "exec_summary":  exec_summary,
    }
