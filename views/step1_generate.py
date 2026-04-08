"""views/step1_generate.py — Generate Journal Entry page."""
import re
import threading
from pathlib import Path
from datetime import date
from io import BytesIO

import streamlit as st
import pandas as pd

from views.shared import (
    BASE_DIR, cached_load_mapping, cached_read_payroll, read_invoice_date,
    render_progress_steps, render_page_header, render_main_anchor, navigate_to_step,
)

# Processing imports (available after shared.py pre-imports them at startup)
try:
    from processing.aggregator   import aggregate_by_department, process_special_columns, aggregate_company_wide
    from processing.je_builder   import build_je
    from processing.validator    import validate_payroll_df, validate_mapping, validate_je
    from processing.consolidator import append_input_to_consolidated
    from processing.logger       import log_action_async
except ImportError:
    pass


def render():
    # ── Fast-path: auto-regenerate after mapping edit ─────────────────────────
    if st.session_state.get("_regenerate_triggered") and st.session_state.get("_pf_bytes"):
        st.session_state["_regenerate_triggered"] = False
        _regen_jn   = st.session_state.get("journal_number_saved") or st.session_state.get("journal_number_input", "")
        _regen_prov = st.session_state.get("provision_desc", "")
        _regen_date = date.today()
        _existing   = st.session_state.get("je_df")
        if _existing is not None and "Entry Date" in _existing.columns:
            try:
                from datetime import datetime as _dt
                _regen_date = _dt.strptime(
                    str(_existing["Entry Date"].dropna().iloc[0]), "%m/%d/%Y"
                ).date()
            except Exception:
                pass

        with st.spinner("Regenerating Journal Entry with updated mapping…"):
            try:
                _map_path = BASE_DIR / "Mapping" / "Mapping.xlsx"
                cached_load_mapping.clear()
                _pay_map, _dept_alloc, _known, _id_map = cached_load_mapping(str(_map_path))
                _bytes = st.session_state["_pf_bytes"]
                _df, _full_df, _inv_df, _gt = cached_read_payroll(_bytes)
                _reg  = aggregate_by_department(_df, _pay_map, _dept_alloc, _id_map)
                _comp = aggregate_company_wide(_df, _pay_map, _inv_df, _id_map)
                _spec = process_special_columns(_df, _pay_map, _dept_alloc, _id_map)
                _je   = build_je(regular_lines=_reg + _comp, special_lines=_spec,
                                 journal_number=_regen_jn,
                                 entry_date=_regen_date.strftime("%m/%d/%Y"),
                                 provision_description=_regen_prov)
                validate_je(_je)
                _buf = BytesIO(); _je.to_excel(_buf, index=False)
                _stem = re.sub(r"^Invoice_Supporting_Details[\s_\-]*", "",
                               Path(st.session_state.get("_last_pf_name", "payroll.xlsx")).stem,
                               flags=re.IGNORECASE).strip()
                _prov_val = round(float(
                    _je["Credit (exc. Tax)"].where(_je["Account"] == "Accrued Expenses:Accrued Payroll", 0).fillna(0).sum()
                ), 2)
                _dept_sum = (_df.groupby("Department Long Descr")
                               .agg(Employees=("Employee ID", "count"))
                               .reset_index()
                               .rename(columns={"Department Long Descr": "Department"}))
                st.session_state.update({
                    "je_df": _je, "je_filename": f"JE for {_stem}.xlsx",
                    "je_summary": (len(_je), len(_reg), len(_spec)),
                    "payroll_gt": _gt, "je_provision": _prov_val,
                    "journal_number_saved": _regen_jn, "dept_summary": _dept_sum,
                    "unmapped_cols": [], "unmapped_dialog_shown": False,
                    "_je_bytes": _buf.getvalue(), "_je_bytes_hash": id(_je),
                    "_je_original": _je.copy(), "_qbo_post_result": None,
                })
                log_action_async(action="JE Regenerated",
                                 input_file=st.session_state.get("_last_pf_name", ""),
                                 output_file=f"JE for {_stem}.xlsx",
                                 journal_number=_regen_jn,
                                 details="JE regenerated after Mapping file update.")
                st.session_state["_scroll_top"] = True
                navigate_to_step(2)
            except Exception as err:
                st.error(f"Regeneration failed: {err}")
                with st.expander("Error details"):
                    st.exception(err)
        st.stop()

    render_main_anchor()
    render_progress_steps(1)
    render_page_header("upload_file", "Generate Journal Entry",
                       "Upload your Invoice Supporting Details file and generate a QuickBooks-ready Journal Entry.")

    # ── Mapping settings ──────────────────────────────────────────────────────
    with st.expander("Mapping Settings — Advanced (leave as default unless instructed)", expanded=False):
        _c1, _c2 = st.columns([3, 1])
        with _c1:
            use_default_mapping = st.checkbox("Use default Mapping.xlsx", value=True)
        with _c2:
            if st.button("Edit Mapping", width='stretch'):
                st.session_state["step_before_mapping"] = 1
                navigate_to_step(3)
        custom_map_file = None
        if not use_default_mapping:
            custom_map_file = st.file_uploader("Upload custom Mapping file", type=["xlsx"], key="mf")
        default_map_path = BASE_DIR / "Mapping" / "Mapping.xlsx"

    st.divider()

    # ── Section 1: Upload ─────────────────────────────────────────────────────
    st.markdown(
        '<div class="section-header"><span class="section-badge">1</span>'
        'Upload Payroll File<span class="req" aria-label="required">*</span></div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<p class="section-hint">Drag and drop or browse for the Invoice Supporting Details Excel file (.xlsx).</p>',
        unsafe_allow_html=True,
    )
    if st.session_state.get("_val_no_file"):
        st.markdown('<div class="upload-err">', unsafe_allow_html=True)

    payroll_file = st.file_uploader("Payroll file", type=["xlsx"], key="pf", label_visibility="collapsed")

    if st.session_state.get("_val_no_file"):
        st.markdown('</div>', unsafe_allow_html=True)
        st.markdown(
            '<div class="field-err"><span class="material-icons-round" aria-hidden="true">error_outline</span>'
            'A payroll file (.xlsx) is required before generating.</div>',
            unsafe_allow_html=True,
        )

    if payroll_file and st.session_state.get("_val_no_file"):
        st.session_state["_val_no_file"] = False

    # Auto-detect journal number + background prefetch
    _uploaded = st.session_state.get("pf")
    _pf_key   = f"{_uploaded.name}_{_uploaded.size}" if _uploaded else None
    if _uploaded and st.session_state.get("_last_pf_name") != _pf_key:
        st.session_state["_last_pf_name"] = _pf_key
        try:
            _fbytes = _uploaded.getvalue()
            st.session_state["_pf_bytes"] = _fbytes
            _inv_date = read_invoice_date(_fbytes)
            if _inv_date:
                st.session_state["journal_number_input"] = f"Salary for {_inv_date}"
            def _prefetch(_b=_fbytes):
                try: cached_read_payroll(_b)
                except Exception: pass
            threading.Thread(target=_prefetch, daemon=True).start()
        except Exception:
            pass

    st.divider()

    # ── Section 2: Journal Settings ───────────────────────────────────────────
    st.markdown(
        '<div class="section-header"><span class="section-badge">2</span>Journal Settings</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        "<p class=\"section-hint\">Journal Number is auto-filled from the payroll file's invoice date.</p>",
        unsafe_allow_html=True,
    )
    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown(
            '<label style="font-size:14px;font-weight:500;color:var(--text,#1a1a1a)">'
            'Journal Number<span class="req" aria-label="required">*</span></label>',
            unsafe_allow_html=True,
        )
        journal_number = st.text_input("Journal Number", key="journal_number_input",
                                       help="Auto-filled from Invoice Date. Edit if needed.",
                                       label_visibility="collapsed")
        if st.session_state.get("_val_no_journal"):
            st.markdown(
                '<div class="field-err"><span class="material-icons-round" aria-hidden="true">error_outline</span>'
                'Journal Number is required.</div>',
                unsafe_allow_html=True,
            )
        if journal_number and journal_number.strip() and st.session_state.get("_val_no_journal"):
            st.session_state["_val_no_journal"] = False
    with col_b:
        entry_date = st.date_input("Entry Date", value=date.today())

    provision_desc = st.text_input(
        "Provision Description (optional)",
        value=st.session_state["provision_desc"],
        placeholder=f"e.g. Provision for {date.today().strftime('%d %b %Y')}",
        help="Label for the balancing credit row. Leave blank for auto-label.",
    )
    st.session_state["provision_desc"] = provision_desc

    if st.session_state.get("_val_no_mapping"):
        st.markdown(
            '<div class="field-err"><span class="material-icons-round" aria-hidden="true">error_outline</span>'
            'Upload a custom mapping file or select "Use default Mapping.xlsx" above.</div>',
            unsafe_allow_html=True,
        )

    st.divider()

    # ── Section 3: Generate ───────────────────────────────────────────────────
    st.markdown(
        '<div class="section-header"><span class="section-badge">3</span>Generate Journal Entry</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<p class="section-hint">Complete the sections above, then click Generate. '
        'Fields marked <span class="req">*</span> are required.</p>',
        unsafe_allow_html=True,
    )

    # Validation summary card
    _errs_display = []
    if st.session_state.get("_val_no_file"):    _errs_display.append("Upload a payroll file (.xlsx)")
    if st.session_state.get("_val_no_journal"): _errs_display.append("Enter a Journal Number")
    if st.session_state.get("_val_no_mapping"): _errs_display.append("Upload a custom mapping file or use the default")
    if _errs_display:
        _items = "".join(f"<li>{e}</li>" for e in _errs_display)
        st.markdown(
            f'<div class="val-card" role="alert" aria-live="polite">'
            f'<span class="material-icons-round" aria-hidden="true">error</span>'
            f'<div class="val-card-body">'
            f'<p class="val-card-title">Please fix the following before generating:</p>'
            f'<ul class="val-card-list">{_items}</ul>'
            f'</div></div>',
            unsafe_allow_html=True,
        )

    if st.button("Generate Journal Entry", type="primary", width='stretch'):
        _errs: list[str] = []
        if not payroll_file:
            st.session_state["_val_no_file"] = True
            _errs.append("Upload a payroll file (.xlsx)")
        if not journal_number or not journal_number.strip():
            st.session_state["_val_no_journal"] = True
            _errs.append("Enter a Journal Number")
        if not use_default_mapping and not custom_map_file:
            st.session_state["_val_no_mapping"] = True
            _errs.append("Upload a custom mapping file or use the default")
        else:
            st.session_state["_val_no_mapping"] = False
        if _errs:
            st.rerun(); st.stop()

        map_source = str(default_map_path) if use_default_mapping else custom_map_file.read()
        if use_default_mapping and not default_map_path.exists():
            st.error(f"Default mapping file not found:\n`{default_map_path}`"); st.stop()

        with st.spinner("Generating Journal Entry — please wait…"):
            try:
                file_bytes = st.session_state.get("_pf_bytes") or payroll_file.read()
                inputs_dir = BASE_DIR / "inputs"
                inputs_dir.mkdir(exist_ok=True)
                (inputs_dir / payroll_file.name).write_bytes(file_bytes)

                df, full_df, invoice_df, payroll_grand_total = cached_read_payroll(file_bytes)
                pf_issues = validate_payroll_df(df, payroll_file.name)
                if pf_issues:
                    for iss in pf_issues: st.error(iss)
                    st.stop()

                cached_load_mapping.clear()
                pay_item_map, dept_allocation, known_items, pay_item_id_map = cached_load_mapping(map_source)
                for iss in validate_mapping(pay_item_map, dept_allocation): st.warning(iss)

                regular_lines = aggregate_by_department(df, pay_item_map, dept_allocation, pay_item_id_map)
                company_lines = aggregate_company_wide(df, pay_item_map, invoice_df, pay_item_id_map)
                special_lines = process_special_columns(df, pay_item_map, dept_allocation, pay_item_id_map)

                je_df = build_je(regular_lines=regular_lines + company_lines, special_lines=special_lines,
                                 journal_number=journal_number, entry_date=entry_date.strftime("%m/%d/%Y"),
                                 provision_description=provision_desc)
                validate_je(je_df)

                je_provision = round(float(
                    je_df["Credit (exc. Tax)"].where(je_df["Account"] == "Accrued Expenses:Accrued Payroll", 0).fillna(0).sum()
                ), 2)
                clean_stem = re.sub(r"^Invoice_Supporting_Details[\s_\-]*", "",
                                    Path(payroll_file.name).stem, flags=re.IGNORECASE).strip()

                known_norm  = {k.strip().lower() for k in known_items}
                mapped_norm = {k.strip().lower() for k in pay_item_map}
                skip_cols   = {"Company Code","Company Name","Employee ID","Employee Name",
                               "Department Long Descr","Location Long Descr","Pay Frequency Descr Long",
                               "Invoice Number","Pay End Date","Check Date"}
                skip_cols  |= {c for c in df.columns if str(c).lower().startswith("unnamed")}
                unmapped_cols  = [c for c in df.columns if c not in skip_cols and c.strip().lower() not in known_norm]
                na_mapped_cols = [c for c in df.columns if c not in skip_cols
                                  and c.strip().lower() in known_norm and c.strip().lower() not in mapped_norm]
                dept_summary = (df.groupby("Department Long Descr")
                                  .agg(Employees=("Employee ID","count"))
                                  .reset_index()
                                  .rename(columns={"Department Long Descr":"Department"}))

                _dl_buf = BytesIO(); je_df.to_excel(_dl_buf, index=False)
                st.session_state.update({
                    "je_df": je_df, "je_filename": f"JE for {clean_stem}.xlsx",
                    "je_summary": (len(je_df), len(regular_lines), len(special_lines)),
                    "payroll_gt": payroll_grand_total, "je_provision": je_provision,
                    "journal_number_saved": journal_number, "unmapped_cols": unmapped_cols,
                    "na_mapped_cols": na_mapped_cols, "unmapped_dialog_shown": False,
                    "dept_summary": dept_summary, "_je_bytes": _dl_buf.getvalue(),
                    "_je_bytes_hash": id(je_df),
                })
                st.session_state["_je_original"] = je_df.copy()
                log_action_async(action="JE Generated", input_file=payroll_file.name,
                                 output_file=f"JE for {clean_stem}.xlsx", journal_number=journal_number,
                                 details=f"{len(je_df)} lines ({len(regular_lines)} dept + {len(special_lines)} employee + 1 provision)")
                _raw = st.session_state.get("_pf_bytes")
                if _raw: append_input_to_consolidated(_raw, journal_number)
                st.session_state.update({"_qbo_post_result": None, "_val_no_file": False,
                                          "_val_no_journal": False, "_val_no_mapping": False,
                                          "_scroll_top": True})
                navigate_to_step(2)

            except KeyError as e:
                st.error(f"Missing expected column: {e} — check the file is an Invoice Supporting Detail export.")
                with st.expander("Full error"): st.exception(e)
            except Exception as e:
                st.error(f"Unexpected error: {e}")
                with st.expander("Full error"): st.exception(e)
