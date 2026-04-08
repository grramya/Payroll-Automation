"""views/step5_activity_log.py — Activity Log full-page view."""
import streamlit as st
import pandas as pd

from views.shared import BASE_DIR, render_page_header, render_main_anchor


def render():
    render_main_anchor()
    render_page_header(
        "history", "Activity Log",
        "Full audit trail of all Journal Entry generations, edits, downloads, and QuickBooks posts.",
        back_step=1, back_label="← Back",
    )

    _log_path = BASE_DIR / "logs" / "Activity_Log.xlsx"

    if not _log_path.exists():
        st.info("No activity recorded yet. Generate your first Journal Entry to start the log.")
        return

    try:
        _log = pd.read_excel(_log_path, dtype=str).fillna("")
        _log = _log.iloc[::-1].reset_index(drop=True)   # newest first
        _total = len(_log)

        # Metrics
        _act_col = next((c for c in _log.columns if "action" in c.lower()), None)
        _m1, _m2, _m3 = st.columns(3)
        _m1.metric("Total Actions", _total)
        if _act_col:
            _gen  = int(_log[_act_col].str.contains("Generated|Regenerated", case=False, na=False).sum())
            _post = int(_log[_act_col].str.contains("Posted", case=False, na=False).sum())
            _m2.metric("JEs Generated", _gen)
            _m3.metric("Posted to QBO", _post)

        st.divider()

        st.markdown(
            '<div class="section-header"><span class="section-badge">1</span>Full Audit Trail</div>',
            unsafe_allow_html=True,
        )
        st.caption(f"{_total} entries — newest first · read-only")

        st.dataframe(
            _log,
            use_container_width=True,
            hide_index=True,
            height=max(400, min(_total * 36 + 60, 620)),
        )

        st.divider()

        st.download_button(
            label="Download Activity Log (Excel)",
            data=_log_path.read_bytes(),
            file_name="Activity_Log.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type="primary", width='stretch', key="log_dl_btn",
        )

    except Exception as err:
        st.error(f"Could not load Activity Log: {err}")
