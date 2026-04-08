"""views/step3_mapping.py — Mapping file editor page."""
import streamlit as st
import pandas as pd

from views.shared import (
    BASE_DIR, cached_load_mapping,
    render_progress_steps, render_page_header, render_main_anchor,
)


def render():
    render_main_anchor()
    render_progress_steps(3)

    _back_step = st.session_state.get("step_before_mapping", 1)
    render_page_header(
        "edit_note", "Edit Mapping File",
        "Add or update column mappings. Each row defines the GL account for a payroll column. Use NA to skip a column.",
        back_step=_back_step, back_label="← Back",
    )

    unmapped = st.session_state["unmapped_cols"]
    if unmapped:
        st.info(
            "**Columns that need mapping:**  "
            + "  ·  ".join(f"`{c}`" for c in unmapped)
            + "\n\nAdd a row for each one in the table below with the correct COGS and Indirect GL accounts."
        )

    default_map_path = BASE_DIR / "Mapping" / "Mapping.xlsx"

    try:
        map_df = pd.read_excel(default_map_path, sheet_name=0, header=None, dtype=str).fillna("")
        for _id_c in [3, 4]:
            map_df[_id_c] = map_df[_id_c].str.replace(r"\.0$", "", regex=True)
        map_df.columns = [
            "Pay Item", "COGS GL Account", "Indirect GL Account",
            "COGS ID", "Indirect ID", "_col5", "Department", "Allocation", "Notes",
        ]

        st.subheader("Mapping Table")
        st.caption(
            "Pay Item = column name from the payroll file (must match exactly).  "
            "COGS GL Account / Indirect GL Account = GL account name.  "
            "COGS ID / Indirect ID = QBO Account ID (editable)."
        )

        edited_map = st.data_editor(
            map_df, width='stretch', num_rows="dynamic", height=500, hide_index=True,
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
        col_save, col_regen = st.columns([2, 2])

        with col_save:
            if st.button("Save Mapping", type="primary", width='stretch'):
                try:
                    with pd.ExcelWriter(default_map_path, engine="openpyxl") as writer:
                        edited_map.to_excel(writer, index=False, header=False, sheet_name="Sheet1")
                    cached_load_mapping.clear()
                    st.session_state["unmapped_cols"] = []
                    st.success("Mapping saved. Click **Regenerate JE** to apply the updated mapping.")
                    from processing.logger import log_action_async
                    log_action_async(action="Mapping Updated", input_file="Mapping.xlsx",
                                     output_file="Mapping.xlsx",
                                     details="Mapping file edited and saved via UI.")
                except Exception as e:
                    st.error(f"Could not save mapping: {e}")

        with col_regen:
            if st.button("Regenerate JE with Updated Mapping", width='stretch'):
                cached_load_mapping.clear()
                st.session_state.update({
                    "step": 1, "_je_bytes": None, "_je_bytes_hash": None,
                    "_regenerate_triggered": True,
                })
                st.rerun()

    except FileNotFoundError:
        st.error(f"Mapping file not found at: `{default_map_path}`")
    except Exception as e:
        st.error(f"Could not load mapping file: {e}")
