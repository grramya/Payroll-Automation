"""
views/shared.py — Design system, session state, sidebar, and page-level helpers.
Imported by app.py and every view module.
"""
import os
import re
import threading
from pathlib import Path
from datetime import date
from io import BytesIO

import streamlit as st
import pandas as pd

# ---------------------------------------------------------------------------
# Base directory
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent.parent   # project root

# ---------------------------------------------------------------------------
# Processing imports — eager at startup to avoid first-click latency
# ---------------------------------------------------------------------------
try:
    from processing.aggregator   import aggregate_by_department, process_special_columns, aggregate_company_wide
    from processing.je_builder   import build_je
    from processing.validator    import validate_payroll_df, validate_mapping, validate_je
    from processing.consolidator import append_input_to_consolidated
    from processing.logger       import log_action_async, compute_je_diff
    _processing_loaded = True
except Exception:
    _processing_loaded = False


# ---------------------------------------------------------------------------
# Cached loaders
# ---------------------------------------------------------------------------
@st.cache_data(show_spinner=False)
def cached_load_mapping(path_or_bytes):
    from processing.mapper import load_mapping
    return load_mapping(path_or_bytes)


@st.cache_data(show_spinner=False)
def cached_read_payroll(file_bytes: bytes):
    from processing.reader import parse_all_from_raw
    raw_df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None, dtype=object)
    return parse_all_from_raw(raw_df)


def read_invoice_date(file_bytes: bytes) -> str:
    """Fast extraction of Invoice Date from payroll Excel via ZIP parse."""
    import zipfile
    import xml.etree.ElementTree as ET
    _NS  = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    _PAT = re.compile(r'\b(\d{1,2}/\d{1,2}/\d{4})\b')
    try:
        with zipfile.ZipFile(BytesIO(file_bytes)) as zf:
            if "xl/sharedStrings.xml" in zf.namelist():
                with zf.open("xl/sharedStrings.xml") as fh:
                    tree = ET.parse(fh)
                for t_elem in tree.iter(f"{_NS}t"):
                    text = t_elem.text or ""
                    if "payroll cycle" in text.lower():
                        chunk = text.split("=", 1)[-1] if "=" in text else text
                        m = _PAT.search(chunk)
                        if m:
                            return m.group(1)
    except Exception:
        pass
    try:
        raw = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None,
                            nrows=6, dtype=str, engine="openpyxl")
        for _, row in raw.iterrows():
            for cell in row:
                s = str(cell) if pd.notna(cell) and str(cell) != "nan" else ""
                if "payroll cycle" in s.lower():
                    chunk = s.split("=", 1)[-1] if "=" in s else s
                    m = _PAT.search(chunk)
                    if m:
                        return m.group(1)
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# Session-state defaults
# ---------------------------------------------------------------------------
DEFAULTS: dict = {
    "step": 1,
    "step_before_mapping": 1,
    "journal_number_input": f"Salary for {date.today().strftime('%m/%d/%Y')}",
    "je_df": None,
    "je_filename": "",
    "je_summary": (0, 0, 0),
    "payroll_gt": None,
    "je_provision": 0.0,
    "unmapped_cols": [],
    "na_mapped_cols": [],
    "unmapped_dialog_shown": False,
    "_last_pf_name": None,
    "_pf_bytes": None,
    "_je_bytes": None,
    "_je_bytes_hash": None,
    "_je_original": None,
    "journal_number_saved": "",
    "provision_desc": "",
    "dept_summary": None,
    "_scroll_top": False,
    "_qbo_accounts_df": None,
    "_qbo_vendors_df": None,
    "_qbo_post_result": None,
    "_missing_vendors_list": [],
    "_missing_vendors_source": "local",
    "_skip_vendor_check": False,
    "_regenerate_triggered": False,
    "_val_no_file": False,
    "_val_no_journal": False,
    "_val_no_mapping": False,
    "_screen_height": 900,
}


def init_session_state():
    for k, v in DEFAULTS.items():
        if k not in st.session_state:
            st.session_state[k] = v


# ---------------------------------------------------------------------------
# Dialogs (must be defined at module level for @st.dialog)
# ---------------------------------------------------------------------------
@st.dialog("Unmapped Columns Detected")
def unmapped_dialog(cols: list):
    st.write("The following columns are present in the payroll file but have **No mapping** in the Mapping file:")
    for col in cols:
        st.write(f"• {col}")
    st.write("You can edit the Mapping file in **Edit Mapping** to add them, or skip and download the JE as-is.")
    col_edit, col_skip = st.columns(2)
    with col_edit:
        if st.button("Edit Mapping File", type="primary", width='stretch'):
            st.session_state["unmapped_dialog_shown"] = True
            st.session_state["step_before_mapping"] = 2
            navigate_to_step(3)
    with col_skip:
        if st.button("Skip for now", width='stretch'):
            st.session_state["unmapped_dialog_shown"] = True
            st.session_state["_scroll_top"] = True
            st.rerun()


@st.dialog("Vendors Not Found")
def missing_vendors_dialog(missing: list, source: str = "local"):
    if source == "qbo":
        st.error(
            "The following vendors exist in the JE but were **not found in QBO**. "
            "You must add them in QBO first:  \n"
            "**QuickBooks → Expenses → Vendors → New Vendor**"
        )
    else:
        st.warning(
            "The following vendors appear in the JE but were **not found** in your saved Vendor List. "
            "QBO may reject the JE if these vendors don't exist in your QBO company."
        )
    for v in missing:
        st.write(f"• {v}")
    _col_edit, _col_cancel = st.columns(2)
    with _col_edit:
        if st.button("Edit Vendor List", type="primary", width='stretch'):
            st.session_state["_missing_vendors_list"] = []
            st.session_state["_missing_vendors_source"] = "local"
            navigate_to_step(4)
    with _col_cancel:
        if st.button("Cancel", width='stretch'):
            st.session_state["_missing_vendors_list"] = []
            st.session_state["_missing_vendors_source"] = "local"
            st.rerun()


# ---------------------------------------------------------------------------
# UI chrome helpers
# ---------------------------------------------------------------------------
_STEP_LABELS = {1: "Generate JE", 2: "JE Preview", 3: "Edit Mapping", 4: "QuickBooks", 5: "Activity Log"}
_STEP_ICONS  = {1: "edit_document", 2: "table_view", 3: "edit_note", 4: "cloud_sync", 5: "history"}
_NAV = [(1, "Generate JE"), (2, "JE Preview"), (3, "Edit Mapping"), (4, "QuickBooks"), (5, "Activity Log")]
_STEP_URLS = {1: "generate-je", 2: "je-preview", 3: "edit-mapping", 4: "quickbooks", 5: "activity-log"}


def navigate_to_step(step: int):
    """Navigate to a step, updating the URL via st.switch_page."""
    pages = st.session_state.get("_pages", {})
    if step in pages:
        st.switch_page(pages[step])
    else:
        st.session_state["step"] = step
        st.rerun()


def render_sidebar():
    """Persistent sidebar: navigation, QBO status, quick downloads."""
    current_step = st.session_state["step"]
    with st.sidebar:
        st.markdown('<span class="sb-lbl">Navigation</span>', unsafe_allow_html=True)
        for _sn, _label in _NAV:
            _disabled = (_sn == 2 and st.session_state.get("je_df") is None)
            _btype = "primary" if current_step == _sn else "secondary"
            if st.button(_label, key=f"_nav_{_sn}", type=_btype,
                         width='stretch', disabled=_disabled):
                if _sn != 1:
                    st.session_state["_val_no_file"]    = False
                    st.session_state["_val_no_journal"] = False
                    st.session_state["_val_no_mapping"] = False
                navigate_to_step(_sn)

        st.divider()

        # QBO status chip
        st.markdown('<span class="sb-lbl">QBO Status</span>', unsafe_allow_html=True)
        try:
            from qbo.config import are_credentials_set as _sb_acs
            from qbo.auth  import is_authenticated as _sb_ia, TokenStore as _sb_TS
            _sb_c = _sb_acs()
            _sb_a = _sb_ia() if _sb_c else False
            _sb_s = _sb_TS.load() if _sb_a else None
        except Exception:
            _sb_c = False; _sb_a = False; _sb_s = None

        if _sb_a and _sb_s:
            _rid = str(_sb_s.realm_id)
            _rid_short = (_rid[:13] + "\u2026") if len(_rid) > 13 else _rid
            st.markdown(f"""
            <div class="sb-chip ok" role="status">
                <span class="material-icons-round" aria-hidden="true">cloud_done</span>Connected
            </div>
            <div class="sb-chip-detail">Realm: {_rid_short}</div>
            """, unsafe_allow_html=True)
        elif _sb_c:
            st.markdown("""
            <div class="sb-chip warn" role="status">
                <span class="material-icons-round" aria-hidden="true">cloud_off</span>Not Connected
            </div>""", unsafe_allow_html=True)
        else:
            st.markdown("""
            <div class="sb-chip err" role="status">
                <span class="material-icons-round" aria-hidden="true">warning_amber</span>Not Configured
            </div>""", unsafe_allow_html=True)

        st.divider()

        # Quick downloads
        st.markdown('<span class="sb-lbl">Quick Downloads</span>', unsafe_allow_html=True)
        _cdir = BASE_DIR / "consolidated"
        _any  = False
        for _fname, _key in [("Consolidated_Payroll.xlsx", "sb_dl_je"),
                              ("Consolidated_Inputs.xlsx",  "sb_dl_ip")]:
            _p = _cdir / _fname
            if _p.exists():
                st.download_button(_fname.replace(".xlsx","").replace("_"," "),
                                   data=_p.read_bytes(), file_name=_fname,
                                   mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                   width='stretch', key=_key)
                _any = True
        if not _any:
            st.caption("Downloads appear here after your first JE.")


def render_progress_steps(current: int):
    """MUI-style horizontal stepper (steps 1-4 only)."""
    _steps = [(1, "Generate JE"), (2, "JE Preview"), (3, "Edit Mapping"), (4, "QuickBooks")]
    html = ['<nav class="mstepper" aria-label="Workflow progress">']
    for n, lbl in _steps:
        if n < current:
            cls, inner = "done", '<span class="material-icons-round" aria-hidden="true">check</span>'
            aria = f'aria-label="Step {n}: {lbl}, completed"'
        elif n == current:
            cls, inner = "active", str(n)
            aria = f'aria-label="Step {n}: {lbl}, current" aria-current="step"'
        else:
            cls, inner = "pending", str(n)
            aria = f'aria-label="Step {n}: {lbl}, not yet started"'
        html.append(
            f'<div class="mstep {cls}" {aria}>'
            f'  <div class="mstep-c" aria-hidden="true">{inner}</div>'
            f'  <div class="mstep-lbl">{lbl}</div>'
            f'</div>'
        )
    html.append('</nav>')
    st.markdown("".join(html), unsafe_allow_html=True)


def render_page_header(icon: str, title: str, subtitle: str = "",
                       back_step: int | None = None, back_label: str = "← Back"):
    """Page header. back_step/back_label are accepted but ignored — sidebar handles navigation."""
    _render_header_html(icon, title, subtitle)


def _render_header_html(icon: str, title: str, subtitle: str):
    _sub = f'<p class="pg-hdr-sub">{subtitle}</p>' if subtitle else ""
    st.markdown(f"""
    <div class="pg-hdr" role="region" aria-label="{title}">
        <div class="pg-hdr-icon" aria-hidden="true">
            <span class="material-icons-round">{icon}</span>
        </div>
        <div class="pg-hdr-text">
            <div class="pg-hdr-title" role="heading" aria-level="1">{title}</div>
            {_sub}
        </div>
    </div>
    """, unsafe_allow_html=True)


def render_main_anchor():
    """Invisible anchor targeted by skip-to-content link."""
    st.markdown('<div id="main-content" tabindex="-1" style="outline:none"></div>',
                unsafe_allow_html=True)


def scroll_to_top():
    """Inject a scroll-to-top after all content is rendered."""
    if st.session_state.get("_scroll_top"):
        st.session_state["_scroll_top"] = False
        st.components.v1.html(
            "<script>"
            "var m=window.parent.document.querySelector('[data-testid=\"stMain\"]');"
            "if(m)m.scrollTo({top:0,behavior:'instant'});"
            "</script>",
            height=0,
        )
