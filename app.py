# =============================================================================
# app.py — Payroll JE Automation  (Multi-Step Streamlit UI)
# =============================================================================
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import os
import re
import threading
import streamlit as st
import pandas as pd
from io import BytesIO
from datetime import date

# ---------------------------------------------------------------------------
# Page config — FIRST Streamlit call so browser renders immediately
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Payroll JE Automation",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ---------------------------------------------------------------------------
# Global CSS
# ---------------------------------------------------------------------------
st.markdown("""
<style>
/* ── Prevent the "washing out" / fade effect during reruns ──────────────── */
/* Target every level of Streamlit's container hierarchy                      */
[data-testid="stApp"],
[data-testid="stAppViewContainer"],
[data-testid="stMain"],
[data-testid="stAppViewBlockContainer"],
[data-stale="true"],
[data-stale="true"] *,
.block-container,
.main                                      { opacity: 1 !important;
                                             transition: none !important; }

/* Hide file-uploader size limit text */
[data-testid="stFileUploaderDropzoneInstructions"] div small { display: none; }

/* Hide sort/menu icons in data editor */
[data-testid="glideDataEditorContainer"] button,
[data-testid="glideDataEditorContainer"] [class*="headerMenu"],
[data-testid="glideDataEditorContainer"] [class*="sortIcon"],
[data-testid="glideDataEditorContainer"] [class*="sort-icon"],
[data-testid="glideDataEditorContainer"] [aria-label*="sort"],
[data-testid="glideDataEditorContainer"] [aria-label*="menu"] { display: none !important; }
</style>
""", unsafe_allow_html=True)



# ---------------------------------------------------------------------------
# Unmapped columns popup dialog
# ---------------------------------------------------------------------------
@st.dialog("Unmapped Columns Detected")
def _unmapped_dialog(cols: list):
    st.write("The following columns are present in the payroll file but have **No mapping** in the Mapping file:")
    for col in cols:
        st.write(f"• {col}")
    st.write("You can edit the Mapping file in **Step 3** to add them, or skip and download the JE as-is.")
    col_edit, col_skip = st.columns(2)
    with col_edit:
        if st.button("Edit Mapping File", type="primary", width='stretch'):
            st.session_state["unmapped_dialog_shown"] = True
            st.session_state["step_before_mapping"] = 2
            st.session_state["step"] = 3
            st.rerun()
    with col_skip:
        if st.button("Skip for now", width='stretch'):
            st.session_state["unmapped_dialog_shown"] = True
            st.session_state["_scroll_top"] = True
            st.rerun()


@st.dialog("Vendors Not Found")
def _missing_vendors_dialog(missing: list, source: str = "local"):
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
            st.session_state["step"] = 4
            st.rerun()
    with _col_cancel:
        if st.button("Cancel", width='stretch'):
            st.session_state["_missing_vendors_list"] = []
            st.session_state["_missing_vendors_source"] = "local"
            st.rerun()

# ---------------------------------------------------------------------------
# Cached loaders — lazy imports inside so heavy libs load only on first use
# ---------------------------------------------------------------------------
@st.cache_data(show_spinner=False)
def _cached_load_mapping(path_or_bytes):
    from processing.mapper import load_mapping
    return load_mapping(path_or_bytes)

@st.cache_data(show_spinner=False)
def _cached_read_payroll(file_bytes: bytes):
    from processing.reader import parse_all_from_raw
    raw_df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None, dtype=object)
    return parse_all_from_raw(raw_df)

def _read_invoice_date(file_bytes: bytes) -> str:
    """
    Extract Invoice Date from payroll Excel without openpyxl overhead.
    Reads ONLY xl/sharedStrings.xml from the ZIP — tiny file, very fast.
    Falls back to pandas only if ZIP approach fails.
    """
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

    # Fallback: pandas (slower but handles edge cases)
    try:
        raw = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None,
                            nrows=6, dtype=str, engine="openpyxl")
        _PAT2 = re.compile(r'\b(\d{1,2}/\d{1,2}/\d{4})\b')
        for _, row in raw.iterrows():
            for cell in row:
                s = str(cell) if pd.notna(cell) and str(cell) != "nan" else ""
                if "payroll cycle" in s.lower():
                    chunk = s.split("=", 1)[-1] if "=" in s else s
                    m = _PAT2.search(chunk)
                    if m:
                        return m.group(1)
    except Exception:
        pass
    return ""

# ---------------------------------------------------------------------------
# Session-state initialisation
# ---------------------------------------------------------------------------
defaults = {
    "step": 1,
    "step_before_mapping": 1,   # remembers which page opened the mapping editor
    "journal_number_input": "",
    "je_df": None,
    "je_filename": "",
    "je_summary": (0, 0, 0),
    "payroll_gt": None,
    "je_provision": 0.0,
    "unmapped_cols": [],
    "na_mapped_cols": [],
    "unmapped_dialog_shown": False,
    "_last_pf_name": None,
    "_pf_bytes": None,          # cached file bytes — avoids re-reading on Generate
    "_je_bytes": None,
    "_je_bytes_hash": None,
    "_je_original": None,
    "journal_number_saved": "",
    "provision_desc": "",
    "dept_summary": None,
    "_scroll_top": False,       # triggers scroll-to-top on next Step 2 render
    # QBO integration
    "_qbo_accounts_df":     None,
    "_qbo_vendors_df":      None,
    "_qbo_post_result":     None,
    "_missing_vendors_list":   [],
    "_missing_vendors_source": "local",   # "local" = pre-flight, "qbo" = post-time
    "_skip_vendor_check":      False,
    "_regenerate_triggered":   False,     # set by Regenerate JE button to skip re-upload
}
for k, v in defaults.items():
    if k not in st.session_state:
        st.session_state[k] = v

# ---------------------------------------------------------------------------
# Step indicator
# ---------------------------------------------------------------------------


# ===========================================================================
# STEP 1 — Upload Payroll File
# ===========================================================================
if st.session_state["step"] == 1:

    # ── Fast-path: auto-regenerate when coming back from Step 3 Mapping editor ──
    # Runs BEFORE any widgets render so no intermediate st.rerun() can steal the flag.
    if st.session_state.get("_regenerate_triggered") and st.session_state.get("_pf_bytes"):
        st.session_state["_regenerate_triggered"] = False
        _regen_jn   = st.session_state.get("journal_number_saved") or st.session_state.get("journal_number_input", "")
        _regen_prov = st.session_state.get("provision_desc", "")
        # Derive entry date from the existing JE; fall back to today
        _regen_date = date.today()
        _existing_je4regen = st.session_state.get("je_df")
        if _existing_je4regen is not None and "Entry Date" in _existing_je4regen.columns:
            try:
                from datetime import datetime as _dt_regen
                _regen_date = _dt_regen.strptime(
                    str(_existing_je4regen["Entry Date"].dropna().iloc[0]), "%m/%d/%Y"
                ).date()
            except Exception:
                pass

        with st.spinner("Regenerating Journal Entry with updated mapping…"):
            try:
                from processing.aggregator   import aggregate_by_department, process_special_columns, aggregate_company_wide
                from processing.je_builder   import build_je
                from processing.validator    import validate_mapping, validate_je
                from processing.consolidator import append_input_to_consolidated
                from processing.logger       import log_action_async

                _regen_map_path = Path(__file__).parent / "Mapping" / "Mapping.xlsx"
                _cached_load_mapping.clear()
                _r_pay_map, _r_dept_alloc, _r_known, _r_id_map = _cached_load_mapping(str(_regen_map_path))

                _r_bytes = st.session_state["_pf_bytes"]
                _r_df, _r_full_df, _r_inv_df, _r_gt = _cached_read_payroll(_r_bytes)

                _r_reg   = aggregate_by_department(_r_df, _r_pay_map, _r_dept_alloc, _r_id_map)
                _r_comp  = aggregate_company_wide(_r_df, _r_pay_map, _r_inv_df, _r_id_map)
                _r_spec  = process_special_columns(_r_df, _r_pay_map, _r_dept_alloc, _r_id_map)

                _r_je = build_je(
                    regular_lines=_r_reg + _r_comp,
                    special_lines=_r_spec,
                    journal_number=_regen_jn,
                    entry_date=_regen_date.strftime("%m/%d/%Y"),
                    provision_description=_regen_prov,
                )
                validate_je(_r_je)

                _r_buf = BytesIO()
                _r_je.to_excel(_r_buf, index=False)

                _r_stem = re.sub(
                    r"^Invoice_Supporting_Details[\s_\-]*",
                    "",
                    Path(st.session_state.get("_last_pf_name", "payroll.xlsx")).stem,
                    flags=re.IGNORECASE,
                ).strip()

                _r_prov_val = round(float(
                    _r_je["Credit (exc. Tax)"]
                    .where(_r_je["Account"] == "Accrued Expenses:Accrued Payroll", 0)
                    .fillna(0).sum()
                ), 2)

                _r_dept_summary = (
                    _r_df.groupby("Department Long Descr")
                    .agg(Employees=("Employee ID", "count"))
                    .reset_index()
                    .rename(columns={"Department Long Descr": "Department"})
                )
                st.session_state.update({
                    "je_df":                _r_je,
                    "je_filename":          f"JE for {_r_stem}.xlsx",
                    "je_summary":           (len(_r_je), len(_r_reg), len(_r_spec)),
                    "payroll_gt":           _r_gt,
                    "je_provision":         _r_prov_val,
                    "journal_number_saved": _regen_jn,
                    "dept_summary":         _r_dept_summary,
                    "unmapped_cols":        [],
                    "unmapped_dialog_shown": False,
                    "_je_bytes":            _r_buf.getvalue(),
                    "_je_bytes_hash":       id(_r_je),
                    "_je_original":         _r_je.copy(),
                    "_qbo_post_result":     None,
                })
                log_action_async(
                    action="JE Regenerated",
                    input_file=st.session_state.get("_last_pf_name", ""),
                    output_file=f"JE for {_r_stem}.xlsx",
                    journal_number=_regen_jn,
                    details="JE regenerated after Mapping file update.",
                )
                st.session_state["step"] = 2
                st.session_state["_scroll_top"] = True
                st.rerun()
            except Exception as _r_err:
                st.error(f"Regeneration failed: {_r_err}")
                with st.expander("Error details"):
                    st.exception(_r_err)
        st.stop()   # don't render Step 1 UI below — user stays here only on error

    st.markdown("""
    <style>
    .section-badge {
        display: inline-flex; align-items: center; justify-content: center;
        background: #19973D; color: white; border-radius: 50%;
        width: 28px; height: 28px; font-size: 14px; font-weight: 700;
        margin-right: 10px; flex-shrink: 0;
    }
    .section-header {
        display: flex; align-items: center;
        font-size: 20px; font-weight: 700; color: #1a1a1a;
        margin: 0 0 6px 0;
    }
    .section-hint {
        color: #666; font-size: 13px; margin: 0 0 14px 38px;
    }
    </style>
    """, unsafe_allow_html=True)

    st.markdown("""
    <style>
    div[data-testid="stExpander"] { margin-bottom: 4px !important; }
    </style>
    """, unsafe_allow_html=True)

    # ── Title left │ 3 expanders right (same row, beside Deploy) ──────────────
    _top_left, _top_right = st.columns([3, 2])
    with _top_left:
        st.title("Payroll Automation")
        st.caption("Generate a QuickBooks-ready Journal Entry from your payroll Invoice Supporting Details file.")
    with _top_right:
        with st.expander("Mapping Settings  (Advanced — leave as default unless told otherwise)"):
            _map_col1, _map_col2 = st.columns([3, 1])
            with _map_col1:
                use_default_mapping = st.checkbox("Use default Mapping.xlsx", value=True)
            with _map_col2:
                if st.button("Edit Mapping", width='stretch', help="Open the Mapping editor to add or update column mappings before generating the JE"):
                    st.session_state["step_before_mapping"] = 1
                    st.session_state["step"] = 3
                    st.rerun()
            custom_map_file = None
            if not use_default_mapping:
                custom_map_file = st.file_uploader(
                    "Upload custom Mapping file", type=["xlsx"], key="mf"
                )
            default_map_path = Path(__file__).parent / "Mapping" / "Mapping.xlsx"

        _log_file = Path(__file__).parent / "logs" / "Activity_Log.xlsx"
        with st.expander("Activity Log", expanded=False):
            if not _log_file.exists():
                st.caption("No activity recorded yet. Logs appear here after JE generation and downloads.")
            else:
                _log_df = pd.read_excel(_log_file, dtype=str).fillna("")
                st.dataframe(_log_df, use_container_width=True, hide_index=True, height=280)
                st.download_button(
                    label="Download Full Log",
                    data=_log_file.read_bytes(),
                    file_name="Activity_Log.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    width='stretch',
                )

        _con_dir = Path(__file__).parent / "consolidated"
        _con_je   = _con_dir / "Consolidated_Payroll.xlsx"
        _con_inp  = _con_dir / "Consolidated_Inputs.xlsx"
        _either_exists = _con_je.exists() or _con_inp.exists()
        with st.expander("Download Consolidated Files", expanded=False):
            if not _either_exists:
                st.caption("No consolidated files yet. They are created automatically when you generate and download a JE.")
            else:
                _col1, _col2 = st.columns(2)
                with _col1:
                    if _con_je.exists():
                        st.download_button(
                            label="Consolidated JE",
                            data=_con_je.read_bytes(),
                            file_name="Consolidated_Payroll.xlsx",
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            width='stretch',
                        )
                    else:
                        st.caption("Consolidated JE not available yet.")
                with _col2:
                    if _con_inp.exists():
                        st.download_button(
                            label="Consolidated Inputs",
                            data=_con_inp.read_bytes(),
                            file_name="Consolidated_Inputs.xlsx",
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            width='stretch',
                        )
                    else:
                        st.caption("Consolidated Inputs not available yet.")

    st.divider()

    # ── Section 1: Upload ─────────────────────────────────────────────────────
    st.markdown('<div class="section-header"><span class="section-badge">1</span>Upload Payroll File</div>', unsafe_allow_html=True)
    st.markdown('<p class="section-hint">Drag and drop or browse for the Invoice Supporting Details Excel file (.xlsx) from your payroll processor.</p>', unsafe_allow_html=True)

    payroll_file = st.file_uploader(
        "Payroll file",
        type=["xlsx"],
        key="pf",
        label_visibility="collapsed",
    )

    # Auto-detect Journal Number + background prefetch on new file upload
    _uploaded = st.session_state.get("pf")
    # Track by "name + size" so a new file with the same filename still triggers re-detection
    _pf_key = f"{_uploaded.name}_{_uploaded.size}" if _uploaded else None
    if _uploaded is not None and st.session_state.get("_last_pf_name") != _pf_key:
        # ── Mark as seen FIRST — prevents any risk of an infinite rerun loop ──
        st.session_state["_last_pf_name"] = _pf_key
        # ── Always clear old journal number immediately so the field never
        #    shows the previous file's date when detection fails ──────────────
        st.session_state["journal_number_input"] = ""
        try:
            _fbytes = _uploaded.getvalue()
            st.session_state["_pf_bytes"] = _fbytes
            _inv_date = _read_invoice_date(_fbytes)
            if _inv_date:
                st.session_state["journal_number_input"] = f"Salary for {_inv_date}"

            # Warm the payroll cache in background while user fills settings
            def _prefetch(_b=_fbytes):
                try:
                    _cached_read_payroll(_b)
                except Exception:
                    pass
            threading.Thread(target=_prefetch, daemon=True).start()
        except Exception:
            pass
        # ── No st.rerun() needed — the text_input below renders AFTER this
        #    block in the same pass and picks up the updated session state ────

    st.divider()

    # ── Section 2: Journal Settings ───────────────────────────────────────────
    st.markdown('<div class="section-header"><span class="section-badge">2</span>Journal Settings</div>', unsafe_allow_html=True)
    st.markdown('<p class="section-hint">Review and confirm the journal details. Journal Number is auto-filled from the payroll file.</p>', unsafe_allow_html=True)

    col_a, col_b = st.columns(2)
    with col_a:
        journal_number = st.text_input(
            "Journal Number",
            key="journal_number_input",
            help="Auto-filled from the payroll file's Invoice Date. Edit if needed.",
        )
    with col_b:
        entry_date = st.date_input("Entry Date", value=date.today())

    provision_desc = st.text_input(
        "Provision Description (optional)",
        value=st.session_state["provision_desc"],
        placeholder=f"e.g. Provision for {date.today().strftime('%d %b %Y')}",
        help="Label for the balancing credit row. Leave blank for auto-label.",
    )
    st.session_state["provision_desc"] = provision_desc

    st.divider()

    # ── Section 3: Generate ───────────────────────────────────────────────────
    st.markdown('<div class="section-header"><span class="section-badge">3</span>Generate Journal Entry</div>', unsafe_allow_html=True)
    st.markdown('<p class="section-hint">Click below to process the payroll file and build the QuickBooks-ready Journal Entry.</p>', unsafe_allow_html=True)

    run = st.button(
        "Generate Journal Entry",
        type="primary",
        width='stretch',
    )

    if run:
        # Validate before doing any heavy work
        if not payroll_file:
            st.warning("Please upload the payroll file before generating.")
            st.stop()
        if not journal_number or not journal_number.strip():
            st.warning("Please enter a Journal Number (e.g. 'Salary for 01/30/2026').")
            st.stop()
        if not use_default_mapping and not custom_map_file:
            st.warning("Please upload a custom mapping file, or select 'Use default Mapping.xlsx'.")
            st.stop()

        # Resolve mapping source
        if use_default_mapping:
            if not default_map_path.exists():
                st.error(f"Default mapping file not found:\n`{default_map_path}`")
                st.stop()
            map_source = str(default_map_path)
        else:
            _mbytes = custom_map_file.read()
            map_source = _mbytes

        # Lazy imports — only load heavy modules now
        from processing.aggregator   import aggregate_by_department, process_special_columns, aggregate_company_wide
        from processing.je_builder   import build_je
        from processing.validator    import validate_payroll_df, validate_mapping, validate_je
        from processing.consolidator import append_input_to_consolidated
        from processing.logger       import log_action_async, compute_je_diff

        with st.spinner("Generating Journal Entry — please wait…"):
            try:
                # Reuse bytes stored during upload (avoids re-reading the file)
                file_bytes = st.session_state.get("_pf_bytes") or payroll_file.read()

                # Save input file
                inputs_dir = Path(__file__).parent / "inputs"
                inputs_dir.mkdir(exist_ok=True)
                (inputs_dir / payroll_file.name).write_bytes(file_bytes)

                # Read payroll — hits cache instantly if prefetch completed
                df, full_df, invoice_df, payroll_grand_total = _cached_read_payroll(file_bytes)

                pf_issues = validate_payroll_df(df, payroll_file.name)
                if pf_issues:
                    for iss in pf_issues:
                        st.error(iss)
                    st.stop()

                # Load mapping (cached) — clear cache first to ensure 4-value result
                _cached_load_mapping.clear()
                map_key = map_source if isinstance(map_source, str) else map_source
                pay_item_map, dept_allocation, known_items, pay_item_id_map = _cached_load_mapping(map_key)

                map_issues = validate_mapping(pay_item_map, dept_allocation)
                for iss in map_issues:
                    st.warning(iss)

                # Aggregate
                regular_lines = aggregate_by_department(df, pay_item_map, dept_allocation, pay_item_id_map)
                company_lines = aggregate_company_wide(df, pay_item_map, invoice_df, pay_item_id_map)
                special_lines = process_special_columns(df, pay_item_map, dept_allocation, pay_item_id_map)

                je_df = build_je(
                    regular_lines=regular_lines + company_lines,
                    special_lines=special_lines,
                    journal_number=journal_number,
                    entry_date=entry_date.strftime("%m/%d/%Y"),
                    provision_description=provision_desc,
                )

                validate_je(je_df)

                # Grand total comparison
                je_provision = round(
                    float(
                        je_df["Credit (exc. Tax)"]
                        .where(je_df["Account"] == "Accrued Expenses:Accrued Payroll", 0)
                        .fillna(0).sum()
                    ),
                    2,
                )

                # Build output filename
                input_stem = Path(payroll_file.name).stem
                clean_stem = re.sub(
                    r"^Invoice_Supporting_Details[\s_\-]*", "", input_stem, flags=re.IGNORECASE
                ).strip()

                # Unmapped column detection
                known_norm  = {k.strip().lower() for k in known_items}
                mapped_norm = {k.strip().lower() for k in pay_item_map}
                skip_cols   = {
                    "Company Code", "Company Name", "Employee ID", "Employee Name",
                    "Department Long Descr", "Location Long Descr", "Pay Frequency Descr Long",
                    "Invoice Number", "Pay End Date", "Check Date",
                }
                skip_cols |= {c for c in df.columns if str(c).lower().startswith("unnamed")}

                unmapped_cols = [
                    c for c in df.columns
                    if c not in skip_cols and c.strip().lower() not in known_norm
                ]
                na_mapped_cols = [
                    c for c in df.columns
                    if c not in skip_cols
                    and c.strip().lower() in known_norm
                    and c.strip().lower() not in mapped_norm
                ]

                dept_summary = (
                    df.groupby("Department Long Descr")
                    .agg(Employees=("Employee ID", "count"))
                    .reset_index()
                    .rename(columns={"Department Long Descr": "Department"})
                )

                # Build plain download bytes now (inside spinner — fast write-only export)
                _dl_buf = BytesIO()
                je_df.to_excel(_dl_buf, index=False)
                _dl_bytes = _dl_buf.getvalue()
                _dl_hash  = id(je_df)   # object identity — unique per generate run

                # Persist to session state
                st.session_state.update({
                    "je_df":               je_df,
                    "je_filename":         f"JE for {clean_stem}.xlsx",
                    "je_summary":          (len(je_df), len(regular_lines), len(special_lines)),
                    "payroll_gt":          payroll_grand_total,
                    "je_provision":        je_provision,
                    "journal_number_saved": journal_number,
                    "unmapped_cols":       unmapped_cols,
                    "na_mapped_cols":      na_mapped_cols,
                    "unmapped_dialog_shown": False,
                    "dept_summary":        dept_summary,
                    "_je_bytes":           _dl_bytes,   # ready for download button
                    "_je_bytes_hash":      _dl_hash,    # track by object id
                })

                # Store original JE for diff comparison on download
                st.session_state["_je_original"] = je_df.copy()

                # Log JE generation
                log_action_async(
                    action="JE Generated",
                    input_file=payroll_file.name,
                    output_file=f"JE for {clean_stem}.xlsx",
                    journal_number=journal_number,
                    details=f"{len(je_df)} lines ({len(regular_lines)} dept-level + {len(special_lines)} employee-level + 1 provision)",
                )

                # Append raw input file to consolidated — run synchronously so
                # every cycle is guaranteed written before the next upload arrives
                _raw_bytes_snap = st.session_state.get("_pf_bytes")
                if _raw_bytes_snap:
                    append_input_to_consolidated(_raw_bytes_snap, journal_number)

                # Advance to Page 2 — clear previous post result so it
                # doesn't show as a leftover from an earlier JE session
                st.session_state["_qbo_post_result"] = None
                st.session_state["step"] = 2
                st.session_state["_scroll_top"] = True
                st.rerun()

            except KeyError as e:
                st.error(f"Missing expected column: {e} — check that the file is an Invoice Supporting Detail export.")
                with st.expander("Full error"):
                    st.exception(e)
            except Exception as e:
                st.error(f"Unexpected error: {e}")
                with st.expander("Full error"):
                    st.exception(e)


# ===========================================================================
# STEP 2 — JE Preview & Download
# ===========================================================================
elif st.session_state["step"] == 2:
    # ── Show unmapped popup FIRST before anything else renders ───────────────
    if st.session_state["unmapped_cols"] and not st.session_state["unmapped_dialog_shown"]:
        _unmapped_dialog(st.session_state["unmapped_cols"])

    # ── Show missing vendors popup if triggered by Post button ───────────────
    if st.session_state.get("_missing_vendors_list"):
        _missing_vendors_dialog(
            st.session_state["_missing_vendors_list"],
            source=st.session_state.get("_missing_vendors_source", "local"),
        )

    st.subheader("Journal Entry Preview")

    # ── Summary ──────────────────────────────────────────────────────────────
    total_lines, reg_lines, spec_lines = st.session_state["je_summary"]
    st.success(
        f"Journal Entry generated — **{total_lines} lines** "
        f"({reg_lines} dept-level + {spec_lines} employee-level + 1 provision)"
    )

    # ── Grand total validation ────────────────────────────────────────────────
    payroll_gt   = st.session_state["payroll_gt"]
    je_provision = st.session_state["je_provision"]
    if payroll_gt is not None:
        diff = round(abs(payroll_gt - je_provision), 2)
        if diff < 0.02:
            st.write(f"Grand total matched — Payroll: {payroll_gt:,.2f}  |  JE Provision: {je_provision:,.2f}")
        else:
            st.error(
                f" Grand total mismatch — "
                f"Payroll: {payroll_gt:,.2f}  |  JE Provision: {je_provision:,.2f}  |  Difference: {diff:,.2f}"
            )

    # ── Unmapped column alert ─────────────────────────────────────────────────
    unmapped = st.session_state["unmapped_cols"]
    if unmapped:
        st.warning(
            f"**{len(unmapped)} column(s)** in the payroll file have no mapping and were skipped: "
            + ", ".join(f"`{c}`" for c in unmapped)
        )
        if st.button("Edit Mapping File", type="secondary"):
            st.session_state["step_before_mapping"] = 2
            st.session_state["step"] = 3
            st.rerun()

    # ── NA-mapped expander ────────────────────────────────────────────────────
    na_mapped = st.session_state["na_mapped_cols"]
    if na_mapped:
        with st.expander("Columns intentionally skipped (mapped as NA in Mapping.xlsx)"):
            for c in na_mapped:
                st.write(f"• {c}")

    # ── Department summary ────────────────────────────────────────────────────
    with st.expander("Department Summary", expanded=False):
        st.dataframe(st.session_state["dept_summary"], use_container_width=True)

    # ── Editable JE preview ───────────────────────────────────────────────────
    st.caption("Click any cell to edit · Empty row at bottom to add · Select row + Delete/Backspace to remove")

    edited_df = st.data_editor(
        st.session_state["je_df"],
        key="je_editor",
        width='stretch',
        height=520,
        num_rows="dynamic",
        hide_index=True,
        column_config={
            "Debit (exc. Tax)":  st.column_config.NumberColumn(format="%.2f"),
            "Credit (exc. Tax)": st.column_config.NumberColumn(format="%.2f"),
        },
    )
    # Persist edits for the download callback
    st.session_state["je_df"] = edited_df

    # ── Download bytes — rebuild only when user actually edits ────────────
    # Check Streamlit's editor state dict (O(1)) — no DataFrame comparison needed.
    # Bytes were pre-built during the Generate spinner; we only regenerate on real edits.
    _editor_state = st.session_state.get("je_editor", {})
    _has_edits = bool(
        _editor_state.get("edited_rows")
        or _editor_state.get("added_rows")
        or _editor_state.get("deleted_rows")
    )
    if _has_edits:
        _buf = BytesIO()
        edited_df.to_excel(_buf, index=False)
        st.session_state["_je_bytes"] = _buf.getvalue()
    elif st.session_state["_je_bytes"] is None:
        # Safety fallback (bytes should always be set by the Generate step)
        _buf = BytesIO()
        edited_df.to_excel(_buf, index=False)
        st.session_state["_je_bytes"] = _buf.getvalue()

    excel_bytes = st.session_state["_je_bytes"]

    # ── Download & navigation ─────────────────────────────────────────────────
    def _on_download():
        # Run synchronously — eliminates race conditions on the consolidated file
        _snap_df   = st.session_state["je_df"].copy()
        _snap_orig = st.session_state.get("_je_original")
        _snap_jn   = st.session_state["journal_number_saved"]
        _snap_fn   = st.session_state["je_filename"]
        _snap_inp  = st.session_state.get("_last_pf_name", "")
        try:
            from processing.je_builder   import export_je_to_bytes
            from processing.consolidator import append_to_consolidated
            from processing.logger       import log_action_async, compute_je_diff
            _formatted = export_je_to_bytes(_snap_df)
            # Save locally (works during session; ephemeral on cloud)
            je_dir = Path(__file__).parent / "JE"
            je_dir.mkdir(exist_ok=True)
            (je_dir / _snap_fn).write_bytes(_formatted)
            append_to_consolidated(je_df=_snap_df, journal_number=_snap_jn)
            # Log download with any edits (logger uses its own background thread)
            _diff = compute_je_diff(_snap_orig, _snap_df)
            log_action_async(
                action="JE Downloaded",
                input_file=_snap_inp,
                output_file=_snap_fn,
                journal_number=_snap_jn,
                details="File saved to JE folder and appended to consolidated.",
                changes=_diff,
            )
        except Exception:
            pass

    col_dl, col_back = st.columns([4, 1])
    with col_dl:
        st.download_button(
            label="Download Journal Entry (Excel)",
            data=excel_bytes,
            file_name=st.session_state["je_filename"],
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            width='stretch',
            type="primary",
            on_click=_on_download,
        )
    with col_back:
        _back_slot = st.empty()
        if _back_slot.button("← Back to Upload", width='stretch'):
            _back_slot.empty()
            st.session_state["step"] = 1
            st.rerun()

    # ── Section 4: Post to QuickBooks Online ─────────────────────────────────
    st.divider()
    st.markdown("""
    <style>
    .section-badge {
        display: inline-flex; align-items: center; justify-content: center;
        background: #19973D; color: white; border-radius: 50%;
        width: 28px; height: 28px; font-size: 14px; font-weight: 700;
        margin-right: 10px; flex-shrink: 0;
    }
    .section-header {
        display: flex; align-items: center;
        font-size: 20px; font-weight: 700; color: #1a1a1a;
        margin: 0 0 6px 0;
    }
    .section-hint { color: #666; font-size: 13px; margin: 0 0 14px 38px; }
    </style>
    """, unsafe_allow_html=True)
    st.markdown('<div class="section-header"><span class="section-badge">4</span>Post to QuickBooks Online</div>', unsafe_allow_html=True)
    st.markdown('<p class="section-hint">Review and post the generated Journal Entry directly to your QBO Sandbox company.</p>', unsafe_allow_html=True)

    try:
        from qbo.config import are_credentials_set
        from qbo.auth import is_authenticated, TokenStore as _TS4
        _creds_ok4  = are_credentials_set()
        _qbo_auth4  = is_authenticated() if _creds_ok4 else False
        _qbo_store4 = _TS4.load() if _qbo_auth4 else None
    except Exception:
        _creds_ok4 = False
        _qbo_auth4  = False
        _qbo_store4 = None

    if not _creds_ok4:
        st.warning(
            "QBO credentials not set up. "
            "Copy `.env.example` → `.env` and add your Client ID & Secret, then restart."
        )
    elif not _qbo_auth4:
        st.warning("Not connected to QuickBooks Online.")
        _col_conn4, _ = st.columns([2, 3])
        with _col_conn4:
            if st.button("Connect to QBO", width='stretch', type="primary", key="s2_connect_qbo"):
                st.session_state["step"] = 4
                st.rerun()
    else:
        st.success(f"Connected  |  Realm: `{_qbo_store4.realm_id}`")

        _col_qa4, _ = st.columns([2, 3])
        with _col_qa4:
            if st.button("QBO Settings / Chart of Accounts / Vendor List", width='stretch', key="s2_qbo_settings"):
                st.session_state["step"] = 4
                st.rerun()

        _post_note4 = st.text_input(
            "Private Note (optional)",
            value="",
            placeholder="Internal memo visible only in QBO",
            key="s2_qbo_private_note",
        )
        _post_btn4 = st.button(
            "Post Journal Entry to QuickBooks",
            type="primary",
            width='stretch',
            key="s2_post_btn",
        )
        if _post_btn4:
            _je_df_post4 = st.session_state.get("je_df")

            # ── Vendor pre-flight check against saved Vendor List ─────────────
            if not st.session_state.get("_skip_vendor_check", False):
                _vend_df_check = st.session_state.get("_qbo_vendors_df")
                if _vend_df_check is None:
                    from qbo.config import VENDORS_OVERRIDE_PATH as _vop_check
                    if _vop_check.exists():
                        _vend_df_check = pd.read_csv(_vop_check, dtype=str).fillna("")
                if _vend_df_check is not None and not _vend_df_check.empty and _je_df_post4 is not None:
                    _known_vendors = set(
                        str(n).strip().lower()
                        for n in _vend_df_check.get("Display Name", pd.Series(dtype=str))
                        if str(n).strip()
                    )
                    _je_vendors_needed = [
                        str(v).strip()
                        for v in _je_df_post4.get("Vendor", pd.Series(dtype=str)).dropna()
                        if str(v).strip() and str(v).strip().lower() not in ("nan", "none", "")
                    ]
                    _missing_v = sorted({
                        v for v in _je_vendors_needed
                        if v.lower() not in _known_vendors
                    })
                    if _missing_v:
                        st.session_state["_missing_vendors_list"]   = _missing_v
                        st.session_state["_missing_vendors_source"] = "local"
                        st.rerun()
            # Reset skip flag after one use
            st.session_state["_skip_vendor_check"] = False

            with st.spinner("Posting to QuickBooks Online…"):
                try:
                    from qbo.api import QBOClient
                    from datetime import date as _date4
                    _qbo_client4  = QBOClient()
                    _account_map4 = _qbo_client4.fetch_account_map()
                    _class_map4   = _qbo_client4.fetch_class_map()
                    _vendor_map4  = _qbo_client4.fetch_vendor_map()
                    _payload4     = _qbo_client4.build_je_payload(
                        je_df          = _je_df_post4,
                        journal_number = st.session_state["journal_number_saved"],
                        txn_date       = _date4.today().strftime("%m/%d/%Y"),
                        private_note   = _post_note4,
                        account_map    = _account_map4,
                        class_map      = _class_map4,
                        vendor_map     = _vendor_map4,
                    )
                    _result4 = _qbo_client4.create_journal_entry(_payload4)
                    st.session_state["_qbo_post_result"] = _result4
                    from processing.logger import log_action_async
                    log_action_async(
                        action="JE Posted to QBO",
                        input_file=st.session_state.get("_last_pf_name", ""),
                        output_file=st.session_state["je_filename"],
                        journal_number=st.session_state["journal_number_saved"],
                        details=(
                            f"QBO JE ID: {_result4.get('Id')} | "
                            f"DocNumber: {_result4.get('DocNumber','N/A')} | "
                            f"Realm: {_qbo_store4.realm_id}"
                        ),
                    )
                    st.success(
                        f"Journal Entry posted!  "
                        f"QBO JE ID: **{_result4.get('Id')}**  |  "
                        f"Doc Number: **{_result4.get('DocNumber', 'N/A')}**"
                    )
                    st.info("Verify: https://app.quickbooks.com → Accounting → Journal Entries")
                except Exception as _qbo_err4:
                    # ── Vendor-not-found ValidationError → show the popup ──────
                    _err_msg4 = str(_qbo_err4)
                    if "vendors were not found in QBO" in _err_msg4:
                        import re as _re4
                        _parsed_vendors = _re4.findall(r"vendor '([^']+)'", _err_msg4)
                        if _parsed_vendors:
                            st.session_state["_missing_vendors_list"]   = _parsed_vendors
                            st.session_state["_missing_vendors_source"] = "qbo"
                            st.rerun()
                        else:
                            st.error(f"Failed to post to QBO: {_qbo_err4}")
                    else:
                        st.error(f"Failed to post to QBO: {_qbo_err4}")
                        with st.expander("Error details"):
                            st.exception(_qbo_err4)

        _prev4 = st.session_state.get("_qbo_post_result")
        if _prev4:
            with st.expander("Last QBO Post Result", expanded=False):
                import json as _json4
                st.code(_json4.dumps(_prev4, indent=2, default=str), language="json")

    # ── Scroll to top — runs AFTER all content is rendered so nothing is blocked
    if st.session_state.get("_scroll_top"):
        st.session_state["_scroll_top"] = False
        st.components.v1.html(
            "<script>"
            "var m=window.parent.document.querySelector('[data-testid=\"stMain\"]');"
            "if(m)m.scrollTo({top:0,behavior:'instant'});"
            "</script>",
            height=0,
        )


# ===========================================================================
# STEP 4 — QuickBooks Online Settings (OAuth + Chart of Accounts)
# ===========================================================================
elif st.session_state["step"] == 4:
    st.title("QuickBooks Online — Settings")
    st.caption(
        "Connect your QBO Sandbox company, view your Chart of Accounts, "
        "and manage your OAuth credentials."
    )

    # ── Credential check ──────────────────────────────────────────────────────
    try:
        from qbo.config import are_credentials_set
        _creds_ok = are_credentials_set()
    except Exception:
        _creds_ok = False

    if not _creds_ok:
        st.error(
            "**QBO credentials not configured.**  "
            "Copy `.env.example` → `.env` in the project root, fill in "
            "`QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`, then **restart the app**."
        )
        st.code(
            "# .env  (project root)\nQBO_CLIENT_ID=your_client_id_here\nQBO_CLIENT_SECRET=your_client_secret_here",
            language="bash",
        )
        if st.button("← Back"):
            st.session_state["step"] = st.session_state.get("step_before_mapping", 2)
            st.rerun()
        st.stop()

    # ── Authentication status ─────────────────────────────────────────────────
    from qbo.auth import (
        is_authenticated, revoke_tokens, TokenStore,
        get_authorization_url, exchange_redirect_url,
    )
    _qbo_auth   = is_authenticated()
    _qbo_store  = TokenStore.load()

    st.markdown("### Authentication")
    if _qbo_auth and _qbo_store:
        from datetime import datetime as _dt
        _exp = _dt.fromtimestamp(_qbo_store.expires_at).strftime("%Y-%m-%d %H:%M")
        _col_s, _col_r = st.columns([3, 1])
        with _col_s:
            st.success(
                f"Connected to QBO  |  "
                f"Realm ID: `{_qbo_store.realm_id}`  |  "
                f"Token expires: `{_exp}`"
            )
        with _col_r:
            if st.button("Disconnect", type="secondary", width='stretch'):
                with st.spinner("Revoking tokens…"):
                    try:
                        revoke_tokens()
                        st.success("Disconnected.")
                        st.rerun()
                    except Exception as _e:
                        st.error(f"Revoke failed: {_e}")


    else:
        st.warning("Not connected to QuickBooks Online.")

        # ── Step 1: generate the auth URL ──────────────────────────────────────
        from qbo.config import are_credentials_set as _creds_ok_auth
        if not _creds_ok_auth():
            st.error(
                "QBO credentials are not set. "
                "Add `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` to your Streamlit Secrets "
                "(cloud) or `.env` file (local)."
            )
        else:
            _auth_url_val, _auth_state_val = get_authorization_url()
            # Store state for CSRF check when the redirect URL is submitted
            st.session_state.setdefault("_qbo_auth_state", _auth_state_val)

            st.markdown(
                "**Step 1 —** Open the Intuit authorization page and log in / approve access:"
            )
            st.markdown(
                f"[🔗 Open Intuit Authorization Page]({_auth_url_val})",
                unsafe_allow_html=False,
            )
            st.divider()
            st.markdown(
                "**Step 2 —** After approving, copy the **full URL** from your browser "
                "address bar and paste it below:"
            )
            _redirect_paste = st.text_input(
                "Redirect URL",
                placeholder="https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?code=…",
                key="qbo_redirect_paste",
                label_visibility="collapsed",
            )
            if st.button("Connect to QuickBooks Online", type="primary", width='stretch'):
                if not _redirect_paste.strip():
                    st.error("Please paste the redirect URL from your browser first.")
                else:
                    with st.spinner("Exchanging authorization code for tokens…"):
                        try:
                            _store = exchange_redirect_url(
                                _redirect_paste.strip(),
                                st.session_state.get("_qbo_auth_state", ""),
                            )
                            st.success(f"Connected!  Realm ID: `{_store.realm_id}`")
                            st.rerun()
                        except Exception as _e:
                            st.error(f"Authentication failed: {_e}")
                            with st.expander("Error details"):
                                st.exception(_e)

    # ── Chart of Accounts viewer ───────────────────────────────────────────────
    if _qbo_auth:
        st.divider()
        st.markdown("### Chart of Accounts")
        st.caption(
            "Fetch your QBO Sandbox accounts, edit names or add rows directly in the table, "
            "and save locally. Saved changes persist across sessions."
        )

        _col_fa, _ = st.columns([2, 3])
        with _col_fa:
            if st.button("Fetch Chart of Accounts", width='stretch'):
                with st.spinner("Fetching from QBO…"):
                    try:
                        from qbo.api import QBOClient
                        _client = QBOClient()
                        _df_accts = _client.get_accounts_dataframe()
                        st.session_state["_qbo_accounts_df"] = _df_accts
                    except Exception as _e:
                        st.error(f"Failed to fetch accounts: {_e}")

        # Load saved local/shared overrides if they exist
        from qbo.config import ACCOUNTS_OVERRIDE_PATH as _accts_override_path
        if st.session_state.get("_qbo_accounts_df") is None and _accts_override_path.exists():
            st.session_state["_qbo_accounts_df"] = pd.read_csv(_accts_override_path, dtype=str).fillna("")

        _df_disp = st.session_state.get("_qbo_accounts_df")
        if _df_disp is not None and not _df_disp.empty:
            # Sort by Account ID numerically
            _id_col = next((c for c in _df_disp.columns if "id" in c.lower()), None)
            if _id_col:
                _df_disp = _df_disp.copy()
                _df_disp["_sort"] = pd.to_numeric(_df_disp[_id_col], errors="coerce")
                _df_disp = _df_disp.sort_values("_sort").drop(columns=["_sort"]).reset_index(drop=True)
            st.caption("You can edit any row directly in the table below. Click **Save Changes** to persist.")
            _edited_df = st.data_editor(
                _df_disp,
                width='stretch',
                hide_index=True,
                height=380,
                num_rows="dynamic",
            )
            _btn_col1, _btn_col2 = st.columns([1, 1])
            with _btn_col1:
                if st.button("Save Changes", width='stretch'):
                    _accts_override_path.parent.mkdir(parents=True, exist_ok=True)
                    _edited_df.to_csv(_accts_override_path, index=False)
                    st.session_state["_qbo_accounts_df"] = _edited_df
                    _is_shared = bool(os.environ.get("ACCOUNTS_OVERRIDE_PATH", "").strip())
                    if _is_shared:
                        st.success(f"Changes saved and synced to shared path:\n`{_accts_override_path}`")
                    else:
                        st.success("Changes saved. To share with other devices, set `ACCOUNTS_OVERRIDE_PATH` in `.env` to a shared folder path.")
            with _btn_col2:
                st.download_button(
                    "Download Account List (CSV)",
                    data=_edited_df.to_csv(index=False).encode(),
                    file_name="QBO_Chart_of_Accounts.csv",
                    mime="text/csv",
                    width='stretch',
                )
        elif _df_disp is not None and _df_disp.empty:
            st.info("No accounts returned from QBO.")

    # ── Vendor List ───────────────────────────────────────────────────────────
    if _qbo_auth:
        st.divider()
        st.markdown("### Vendor List")
        st.caption(
            "Fetch your QBO vendors, edit or add rows directly in the table, "
            "and save locally. Saved changes persist across sessions."
        )

        _col_fv, _ = st.columns([2, 3])
        with _col_fv:
            if st.button("Fetch Vendor List", width='stretch'):
                with st.spinner("Fetching from QBO…"):
                    try:
                        from qbo.api import QBOClient as _QBOClientV
                        _client_v = _QBOClientV()
                        _df_vendors = _client_v.get_vendors_dataframe()
                        st.session_state["_qbo_vendors_df"] = _df_vendors
                    except Exception as _e:
                        st.error(f"Failed to fetch vendors: {_e}")

        # Auto-load from local CSV if session state is empty and file exists
        from qbo.config import VENDORS_OVERRIDE_PATH as _vendors_override_path
        if st.session_state.get("_qbo_vendors_df") is None and _vendors_override_path.exists():
            st.session_state["_qbo_vendors_df"] = pd.read_csv(
                _vendors_override_path, dtype=str
            ).fillna("")

        _df_vend_disp = st.session_state.get("_qbo_vendors_df")
        if _df_vend_disp is not None and not _df_vend_disp.empty:
            # ── Sort: vendors referenced in current JE on top, then alphabetically ──
            _je_vend_names: set = set()
            _current_je = st.session_state.get("je_df")
            if _current_je is not None and "Vendor" in _current_je.columns:
                _je_vend_names = {
                    str(v).strip().lower()
                    for v in _current_je["Vendor"].dropna()
                    if str(v).strip() and str(v).strip().lower() not in ("nan", "none", "")
                }
            if _je_vend_names and "Display Name" in _df_vend_disp.columns:
                _df_vend_disp = _df_vend_disp.copy()
                _df_vend_disp["_in_je"] = (
                    _df_vend_disp["Display Name"].str.strip().str.lower().isin(_je_vend_names)
                )
                _df_vend_disp = (
                    _df_vend_disp
                    .sort_values(["_in_je", "Display Name"], ascending=[False, True])
                    .drop(columns=["_in_je"])
                    .reset_index(drop=True)
                )
            st.caption("You can edit any row directly in the table below. Click **Save Changes** to persist.")
            _edited_vend_df = st.data_editor(
                _df_vend_disp,
                width='stretch',
                hide_index=True,
                height=380,
                num_rows="dynamic",
            )
            _vbtn_col1, _vbtn_col2 = st.columns([1, 1])
            with _vbtn_col1:
                if st.button("Save Changes", width='stretch', key="save_vendors_btn"):
                    _vendors_override_path.parent.mkdir(parents=True, exist_ok=True)
                    _edited_vend_df.to_csv(_vendors_override_path, index=False)
                    st.session_state["_qbo_vendors_df"] = _edited_vend_df
                    st.success("Vendor list saved.")
            with _vbtn_col2:
                st.download_button(
                    "Download Vendor List (CSV)",
                    data=_edited_vend_df.to_csv(index=False).encode(),
                    file_name="QBO_Vendor_List.csv",
                    mime="text/csv",
                    width='stretch',
                    key="dl_vendors_btn",
                )
        elif _df_vend_disp is not None and _df_vend_disp.empty:
            st.info("No vendors returned from QBO.")

    # ── How account mapping works ─────────────────────────────────────────────
    with st.expander("How account mapping works", expanded=False):
        st.markdown("""
When you click **Post Journal Entry to QuickBooks**, the app:

1. Fetches your **Chart of Accounts** from QBO to build a name → ID lookup table.
2. Matches each row in your JE by **Account name** (the value in the `Account` column of your JE).
3. Uses the matched **Account ID** to fill `AccountRef.value` in the QBO API payload.
4. Posts the entry via `POST /v3/company/{realmId}/journalentry`.

**Tip:** If an account name in your JE doesn't exactly match a QBO account name,
the API call will fail for that line. Use the Chart of Accounts table above to confirm
the exact names and copy them into your `Mapping.xlsx` GL account columns.
        """)

    st.divider()
    if st.button("← Back to JE Preview", width='stretch'):
        st.session_state["step"] = 2
        st.session_state["_scroll_top"] = True
        st.rerun()


# ===========================================================================
# STEP 3 — Mapping File Editor
# ===========================================================================
elif st.session_state["step"] == 3:
    st.title("Edit Mapping File")
    st.caption(
        "Add or update column mappings below. "
        "Each row defines which GL account a payroll column maps to for COGS and Indirect departments. "
        "Use **NA** if a column should be skipped."
    )

    unmapped = st.session_state["unmapped_cols"]
    if unmapped:
        st.info(
            "**Columns that need mapping:**  "
            + "  ·  ".join(f"`{c}`" for c in unmapped)
            + "\n\nAdd a row for each one in the table below with the correct COGS and Indirect GL accounts."
        )

    default_map_path = Path(__file__).parent / "Mapping" / "Mapping.xlsx"

    try:
        map_df = pd.read_excel(default_map_path, sheet_name=0, header=None, dtype=str).fillna("")
        # Clean up float-formatted ID values that Excel stores as numbers (e.g. "108.0" → "108")
        for _id_c in [3, 4]:
            map_df[_id_c] = map_df[_id_c].str.replace(r"\.0$", "", regex=True)
        # Assign readable column names for display (does NOT change the saved file)
        map_df.columns = [
            "Pay Item", "COGS GL Account", "Indirect GL Account",
            "COGS ID", "Indirect ID",
            "_col5", "Department", "Allocation", "Notes",
        ]

        st.subheader("Mapping Table")
        st.caption(
            "Pay Item = column name from the payroll file (must match exactly).  "
            "COGS GL Account / Indirect GL Account = GL account name.  "
            "COGS ID / Indirect ID = QBO Account ID (editable)."
        )

        edited_map = st.data_editor(
            map_df,
            width='stretch',
            num_rows="dynamic",
            height=500,
            hide_index=True,
            column_config={
                "Pay Item":            st.column_config.TextColumn("Pay Item"),
                "COGS GL Account":     st.column_config.TextColumn("COGS GL Account"),
                "Indirect GL Account": st.column_config.TextColumn("Indirect GL Account"),
                "COGS ID":             st.column_config.TextColumn("COGS ID"),
                "Indirect ID":         st.column_config.TextColumn("Indirect ID"),
                "_col5":               st.column_config.TextColumn(""),
                "Department":          st.column_config.TextColumn("Department"),
                "Allocation":          st.column_config.TextColumn("Allocation"),
                "Notes":               st.column_config.TextColumn("Notes"),
            },
        )

        st.divider()

        col_save, col_regen, _, col_back = st.columns([2, 2, 1, 1])

        with col_save:
            if st.button("Save Mapping", type="primary", width='stretch'):
                try:
                    with pd.ExcelWriter(default_map_path, engine="openpyxl") as writer:
                        # header=False preserves the no-header structure mapper.py expects
                        edited_map.to_excel(writer, index=False, header=False, sheet_name="Sheet1")
                    _cached_load_mapping.clear()   # clear cache so new mapping is used
                    st.session_state["unmapped_cols"] = []
                    st.success("Mapping saved. Click **Regenerate JE** to apply the updated mapping.")
                    from processing.logger import log_action_async
                    log_action_async(
                        action="Mapping Updated",
                        input_file="Mapping.xlsx",
                        output_file="Mapping.xlsx",
                        details="Mapping file edited and saved via UI.",
                    )
                except Exception as e:
                    st.error(f"Could not save mapping: {e}")

        with col_regen:
            if st.button("Regenerate JE with Updated Mapping", width='stretch'):
                _cached_load_mapping.clear()   # force fresh mapping read
                st.session_state["step"] = 1
                st.session_state["_je_bytes"] = None
                st.session_state["_je_bytes_hash"] = None
                st.session_state["_regenerate_triggered"] = True  # auto-run Generate on Step 1
                st.rerun()

        with col_back:
            if st.button("← Back", width='stretch'):
                st.session_state["step"] = st.session_state.get("step_before_mapping", 1)
                st.session_state["_scroll_top"] = True
                st.rerun()

    except FileNotFoundError:
        st.error(f"Mapping file not found at: `{default_map_path}`")
        if st.button("← Back"):
            st.session_state["step"] = st.session_state.get("step_before_mapping", 1)
            st.session_state["_scroll_top"] = True
            st.rerun()
    except Exception as e:
        st.error(f"Could not load mapping file: {e}")
        if st.button("← Back"):
            st.session_state["step"] = st.session_state.get("step_before_mapping", 1)
            st.session_state["_scroll_top"] = True
            st.rerun()
