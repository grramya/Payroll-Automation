"""views/step2_preview.py — JE Preview, download, and QBO post page."""
from pathlib import Path
from io import BytesIO

import streamlit as st
import pandas as pd

from views.shared import (
    BASE_DIR, render_progress_steps, render_page_header,
    render_main_anchor, scroll_to_top, navigate_to_step,
    unmapped_dialog, missing_vendors_dialog,
)


def render():
    # Dialogs must fire before any other widgets
    if st.session_state["unmapped_cols"] and not st.session_state["unmapped_dialog_shown"]:
        unmapped_dialog(st.session_state["unmapped_cols"])
    if st.session_state.get("_missing_vendors_list"):
        missing_vendors_dialog(
            st.session_state["_missing_vendors_list"],
            source=st.session_state.get("_missing_vendors_source", "local"),
        )

    render_main_anchor()
    render_progress_steps(2)
    render_page_header(
        "table_view", "Journal Entry Preview",
        "Review, edit inline, download your Journal Entry, and post it to QuickBooks.",
        back_step=1, back_label="← Back to Upload",
    )

    # ── Summary ───────────────────────────────────────────────────────────────
    total_lines, reg_lines, spec_lines = st.session_state["je_summary"]
    st.success(
        f"Journal Entry generated — **{total_lines} lines** "
        f"({reg_lines} dept-level + {spec_lines} employee-level + 1 provision)"
    )

    # Grand total validation
    payroll_gt   = st.session_state["payroll_gt"]
    je_provision = st.session_state["je_provision"]
    if payroll_gt is not None:
        diff = round(abs(payroll_gt - je_provision), 2)
        if diff < 0.02:
            st.write(f"Grand total matched — Payroll: {payroll_gt:,.2f}  |  JE Provision: {je_provision:,.2f}")
        else:
            st.error(
                f"Grand total mismatch — "
                f"Payroll: {payroll_gt:,.2f}  |  JE Provision: {je_provision:,.2f}  |  Difference: {diff:,.2f}"
            )

    # Unmapped alert
    unmapped = st.session_state["unmapped_cols"]
    if unmapped:
        st.warning(
            f"**{len(unmapped)} column(s)** in the payroll file have no mapping and were skipped: "
            + ", ".join(f"`{c}`" for c in unmapped)
        )
        if st.button("Edit Mapping File", type="secondary"):
            st.session_state["step_before_mapping"] = 2
            navigate_to_step(3)

    na_mapped = st.session_state["na_mapped_cols"]
    if na_mapped:
        with st.expander("Columns intentionally skipped (mapped as NA)"):
            for c in na_mapped:
                st.write(f"• {c}")

    with st.expander("Department Summary", expanded=False):
        st.dataframe(st.session_state["dept_summary"], use_container_width=True)

    # ── Editable table ────────────────────────────────────────────────────────
    st.caption("Click any cell to edit · Empty row at bottom to add · Select row + Delete to remove")
    _screen_h = st.session_state.get("_screen_height", 900)
    _table_h  = max(340, min(int(_screen_h) - 420, 960))

    edited_df = st.data_editor(
        st.session_state["je_df"],
        key="je_editor",
        use_container_width=True,
        height=_table_h,
        num_rows="dynamic",
        hide_index=True,
        column_config={
            "Debit (exc. Tax)":  st.column_config.NumberColumn(format="%.2f"),
            "Credit (exc. Tax)": st.column_config.NumberColumn(format="%.2f"),
        },
    )
    st.session_state["je_df"] = edited_df

    # Dynamic table height via JS
    st.components.v1.html("""
<script>
(function () {
    function resize() {
        var doc = window.parent.document;
        var vh  = window.parent.innerHeight;
        var target = Math.max(340, Math.min(vh - 420, 960));
        doc.querySelectorAll('[data-testid="stDataEditor"] iframe').forEach(function(f) {
            f.style.height = target + 'px'; f.style.minHeight = '340px';
        });
        doc.querySelectorAll('[data-testid="stDataEditorGridContainer"]').forEach(function(c) {
            c.style.height = target + 'px';
        });
    }
    resize();
    window.parent.addEventListener('resize', resize, { passive: true });
    [80, 200, 500, 1000].forEach(function(d) { setTimeout(resize, d); });
})();
</script>
""", height=0)

    # Rebuild bytes only when actually edited
    _editor_state = st.session_state.get("je_editor", {})
    _has_edits = bool(
        _editor_state.get("edited_rows") or
        _editor_state.get("added_rows") or
        _editor_state.get("deleted_rows")
    )
    if _has_edits or st.session_state["_je_bytes"] is None:
        _buf = BytesIO(); edited_df.to_excel(_buf, index=False)
        st.session_state["_je_bytes"] = _buf.getvalue()

    excel_bytes = st.session_state["_je_bytes"]

    def _on_download():
        _snap_df  = st.session_state["je_df"].copy()
        _snap_orig = st.session_state.get("_je_original")
        _snap_jn  = st.session_state["journal_number_saved"]
        _snap_fn  = st.session_state["je_filename"]
        _snap_inp = st.session_state.get("_last_pf_name", "")
        try:
            from processing.je_builder   import export_je_to_bytes
            from processing.consolidator import append_to_consolidated
            from processing.logger       import log_action_async, compute_je_diff
            _formatted = export_je_to_bytes(_snap_df)
            je_dir = BASE_DIR / "JE"; je_dir.mkdir(exist_ok=True)
            (je_dir / _snap_fn).write_bytes(_formatted)
            append_to_consolidated(je_df=_snap_df, journal_number=_snap_jn)
            _diff = compute_je_diff(_snap_orig, _snap_df)
            log_action_async(action="JE Downloaded", input_file=_snap_inp,
                             output_file=_snap_fn, journal_number=_snap_jn,
                             details="File saved to JE folder and appended to consolidated.",
                             changes=_diff)
        except Exception:
            pass

    st.download_button(
        label="Download Journal Entry (Excel)",
        data=excel_bytes,
        file_name=st.session_state["je_filename"],
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        width='stretch', type="primary", on_click=_on_download,
    )

    # ── QBO Post section ──────────────────────────────────────────────────────
    st.divider()
    st.markdown(
        '<div class="section-header"><span class="section-badge">4</span>Post to QuickBooks Online</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<p class="section-hint">Review and post the generated Journal Entry directly to your QBO company.</p>',
        unsafe_allow_html=True,
    )

    try:
        from qbo.config import are_credentials_set
        from qbo.auth   import is_authenticated, TokenStore as _TS4
        _creds_ok4  = are_credentials_set()
        _qbo_auth4  = is_authenticated() if _creds_ok4 else False
        _qbo_store4 = _TS4.load() if _qbo_auth4 else None
    except Exception:
        _creds_ok4 = False; _qbo_auth4 = False; _qbo_store4 = None

    if not _creds_ok4:
        st.warning("QBO credentials not set up. Copy `.env.example` → `.env` and restart.")
    elif not _qbo_auth4:
        st.warning("Not connected to QuickBooks Online.")
        _c, _ = st.columns([2, 3])
        with _c:
            if st.button("Connect to QBO", width='stretch', type="primary", key="s2_connect_qbo"):
                navigate_to_step(4)
    else:
        st.success(f"Connected  |  Realm: `{_qbo_store4.realm_id}`")
        _c2, _ = st.columns([2, 3])
        with _c2:
            if st.button("QBO Settings / Accounts / Vendors", width='stretch', key="s2_qbo_settings"):
                navigate_to_step(4)

        _post_note = st.text_input("Private Note (optional)", value="",
                                   placeholder="Internal memo visible only in QBO",
                                   key="s2_qbo_private_note")
        if st.button("Post Journal Entry to QuickBooks", type="primary", width='stretch', key="s2_post_btn"):
            _je_df_post = st.session_state.get("je_df")

            # Vendor pre-flight
            if not st.session_state.get("_skip_vendor_check", False):
                _vend_df = st.session_state.get("_qbo_vendors_df")
                if _vend_df is None:
                    from qbo.config import VENDORS_OVERRIDE_PATH as _vop
                    if _vop.exists():
                        _vend_df = pd.read_csv(_vop, dtype=str).fillna("")
                if _vend_df is not None and not _vend_df.empty and _je_df_post is not None:
                    _known = {str(n).strip().lower() for n in _vend_df.get("Display Name", pd.Series(dtype=str)) if str(n).strip()}
                    _needed = [str(v).strip() for v in _je_df_post.get("Vendor", pd.Series(dtype=str)).dropna()
                               if str(v).strip() and str(v).strip().lower() not in ("nan","none","")]
                    _missing = sorted({v for v in _needed if v.lower() not in _known})
                    if _missing:
                        st.session_state["_missing_vendors_list"] = _missing
                        st.session_state["_missing_vendors_source"] = "local"
                        st.rerun()
            st.session_state["_skip_vendor_check"] = False

            with st.spinner("Posting to QuickBooks Online…"):
                try:
                    from qbo.api import QBOClient
                    from datetime import date as _date4
                    _client = QBOClient()
                    _payload = _client.build_je_payload(
                        je_df=_je_df_post,
                        journal_number=st.session_state["journal_number_saved"],
                        txn_date=_date4.today().strftime("%m/%d/%Y"),
                        private_note=_post_note,
                        account_map=_client.fetch_account_map(),
                        class_map=_client.fetch_class_map(),
                        vendor_map=_client.fetch_vendor_map(),
                    )
                    _result = _client.create_journal_entry(_payload)
                    st.session_state["_qbo_post_result"] = _result

                    _je_id = _result.get("Id", "")
                    _pf_b  = st.session_state.get("_pf_bytes")
                    _pf_fn = st.session_state.get("je_filename", "payroll.xlsx").replace("JE for ", "")
                    if _je_id and _pf_b:
                        try:
                            with st.spinner("Attaching payroll file to JE in QBO…"):
                                _client.attach_file_to_je(_je_id, _pf_fn, _pf_b)
                            st.success("Payroll file attached to JE in QBO ✓")
                        except Exception as _att_err:
                            st.warning(f"JE posted, but attachment failed: {_att_err}")

                    from processing.logger import log_action_async
                    log_action_async(action="JE Posted to QBO",
                                     input_file=st.session_state.get("_last_pf_name",""),
                                     output_file=st.session_state["je_filename"],
                                     journal_number=st.session_state["journal_number_saved"],
                                     details=f"QBO JE ID: {_result.get('Id')} | Realm: {_qbo_store4.realm_id}")
                    st.success(f"Journal Entry posted!  QBO JE ID: **{_result.get('Id')}**  |  "
                               f"Doc Number: **{_result.get('DocNumber','N/A')}**")
                    st.info("Verify: https://app.quickbooks.com → Accounting → Journal Entries")
                except Exception as _err:
                    import re as _re
                    _msg = str(_err)
                    if "vendors were not found in QBO" in _msg:
                        _pv = _re.findall(r"vendor '([^']+)'", _msg)
                        if _pv:
                            st.session_state["_missing_vendors_list"] = _pv
                            st.session_state["_missing_vendors_source"] = "qbo"
                            st.rerun()
                    st.error(f"Failed to post to QBO: {_err}")
                    with st.expander("Error details"): st.exception(_err)

        _prev = st.session_state.get("_qbo_post_result")
        if _prev:
            with st.expander("Last QBO Post Result", expanded=False):
                import json
                st.code(json.dumps(_prev, indent=2, default=str), language="json")

    scroll_to_top()
