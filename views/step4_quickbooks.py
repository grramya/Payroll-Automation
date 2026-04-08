"""views/step4_quickbooks.py — QuickBooks Online Settings page."""
import os
import streamlit as st
import pandas as pd

from views.shared import (
    BASE_DIR, render_progress_steps, render_page_header, render_main_anchor,
)


def render():
    render_main_anchor()
    render_progress_steps(4)
    render_page_header(
        "cloud_sync", "QuickBooks Online Settings",
        "Connect your QBO company, manage OAuth tokens, and configure your Chart of Accounts and Vendor List.",
        back_step=2, back_label="← Back to JE Preview",
    )

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
            "# .env\nQBO_CLIENT_ID=your_client_id_here\nQBO_CLIENT_SECRET=your_client_secret_here",
            language="bash",
        )
        st.stop()

    from qbo.auth import (
        is_authenticated, revoke_tokens, TokenStore,
        get_authorization_url, exchange_redirect_url,
    )
    _qbo_auth  = is_authenticated()
    _qbo_store = TokenStore.load()

    st.markdown("### Authentication")
    if _qbo_auth and _qbo_store:
        from datetime import datetime as _dt
        _exp = _dt.fromtimestamp(_qbo_store.expires_at).strftime("%Y-%m-%d %H:%M")
        _cs, _cr = st.columns([3, 1])
        with _cs:
            st.success(f"Connected  |  Realm ID: `{_qbo_store.realm_id}`  |  Expires: `{_exp}`")
        with _cr:
            if st.button("Disconnect", type="secondary", width='stretch'):
                with st.spinner("Revoking tokens…"):
                    try:
                        revoke_tokens(); st.success("Disconnected."); st.rerun()
                    except Exception as e:
                        st.error(f"Revoke failed: {e}")
    else:
        st.warning("Not connected to QuickBooks Online.")
        from qbo.config import are_credentials_set as _creds_ok_auth
        if not _creds_ok_auth():
            st.error("QBO credentials are not set.")
        else:
            _auth_url, _auth_state = get_authorization_url()
            st.session_state.setdefault("_qbo_auth_state", _auth_state)
            st.markdown("**Step 1 —** Open the Intuit authorization page and log in:")
            st.markdown(f"[Open Intuit Authorization Page]({_auth_url})")
            st.divider()
            st.markdown("**Step 2 —** After approving, paste the full redirect URL below:")
            _redirect = st.text_input("Redirect URL",
                                      placeholder="https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?code=…",
                                      key="qbo_redirect_paste", label_visibility="collapsed")
            if st.button("Connect to QuickBooks Online", type="primary", width='stretch'):
                if not _redirect.strip():
                    st.error("Please paste the redirect URL first.")
                else:
                    with st.spinner("Exchanging authorization code for tokens…"):
                        try:
                            _store = exchange_redirect_url(_redirect.strip(),
                                                           st.session_state.get("_qbo_auth_state",""))
                            st.success(f"Connected!  Realm ID: `{_store.realm_id}`")
                            st.rerun()
                        except Exception as e:
                            st.error(f"Authentication failed: {e}")
                            with st.expander("Error details"): st.exception(e)

    # Chart of Accounts
    if _qbo_auth:
        st.divider()
        st.markdown("### Chart of Accounts")
        st.caption("Fetch, edit, and save your QBO chart of accounts locally.")
        _cf, _ = st.columns([2, 3])
        with _cf:
            if st.button("Fetch Chart of Accounts", width='stretch'):
                with st.spinner("Fetching from QBO…"):
                    try:
                        from qbo.api import QBOClient
                        _df_accts = QBOClient().get_accounts_dataframe()
                        st.session_state["_qbo_accounts_df"] = _df_accts
                    except Exception as e:
                        st.error(f"Failed to fetch accounts: {e}")

        from qbo.config import ACCOUNTS_OVERRIDE_PATH as _accts_path
        if st.session_state.get("_qbo_accounts_df") is None and _accts_path.exists():
            st.session_state["_qbo_accounts_df"] = pd.read_csv(_accts_path, dtype=str).fillna("")

        _df_accts_disp = st.session_state.get("_qbo_accounts_df")
        if _df_accts_disp is not None and not _df_accts_disp.empty:
            _id_col = next((c for c in _df_accts_disp.columns if "id" in c.lower()), None)
            if _id_col:
                _df_accts_disp = _df_accts_disp.copy()
                _df_accts_disp["_sort"] = pd.to_numeric(_df_accts_disp[_id_col], errors="coerce")
                _df_accts_disp = _df_accts_disp.sort_values("_sort").drop(columns=["_sort"]).reset_index(drop=True)
            st.caption("Edit any row directly. Click **Save Changes** to persist.")
            _edited = st.data_editor(_df_accts_disp, width='stretch', hide_index=True, height=380, num_rows="dynamic")
            _b1, _b2 = st.columns(2)
            with _b1:
                if st.button("Save Changes", width='stretch'):
                    _accts_path.parent.mkdir(parents=True, exist_ok=True)
                    _edited.to_csv(_accts_path, index=False)
                    st.session_state["_qbo_accounts_df"] = _edited
                    st.success("Changes saved.")
            with _b2:
                st.download_button("Download Account List (CSV)",
                                   data=_edited.to_csv(index=False).encode(),
                                   file_name="QBO_Chart_of_Accounts.csv",
                                   mime="text/csv", width='stretch')
        elif _df_accts_disp is not None:
            st.info("No accounts returned from QBO.")

    # Vendor List
    if _qbo_auth:
        st.divider()
        st.markdown("### Vendor List")
        st.caption("Fetch, edit, and save your QBO vendor list locally.")
        _vf, _ = st.columns([2, 3])
        with _vf:
            if st.button("Fetch Vendor List", width='stretch'):
                with st.spinner("Fetching from QBO…"):
                    try:
                        from qbo.api import QBOClient as _QBOV
                        st.session_state["_qbo_vendors_df"] = _QBOV().get_vendors_dataframe()
                    except Exception as e:
                        st.error(f"Failed to fetch vendors: {e}")

        from qbo.config import VENDORS_OVERRIDE_PATH as _vend_path
        if st.session_state.get("_qbo_vendors_df") is None and _vend_path.exists():
            st.session_state["_qbo_vendors_df"] = pd.read_csv(_vend_path, dtype=str).fillna("")

        _df_vend = st.session_state.get("_qbo_vendors_df")
        if _df_vend is not None and not _df_vend.empty:
            _cur_je = st.session_state.get("je_df")
            if _cur_je is not None and "Vendor" in _cur_je.columns:
                _je_vend = {str(v).strip().lower() for v in _cur_je["Vendor"].dropna()
                            if str(v).strip() and str(v).strip().lower() not in ("nan","none","")}
                if _je_vend and "Display Name" in _df_vend.columns:
                    _df_vend = _df_vend.copy()
                    _df_vend["_in_je"] = _df_vend["Display Name"].str.strip().str.lower().isin(_je_vend)
                    _df_vend = (_df_vend.sort_values(["_in_je","Display Name"], ascending=[False,True])
                                        .drop(columns=["_in_je"]).reset_index(drop=True))
            st.caption("Edit any row directly. Click **Save Changes** to persist.")
            _edited_v = st.data_editor(_df_vend, width='stretch', hide_index=True, height=380, num_rows="dynamic")
            _vb1, _vb2 = st.columns(2)
            with _vb1:
                if st.button("Save Changes", width='stretch', key="save_vendors_btn"):
                    _vend_path.parent.mkdir(parents=True, exist_ok=True)
                    _edited_v.to_csv(_vend_path, index=False)
                    st.session_state["_qbo_vendors_df"] = _edited_v
                    st.success("Vendor list saved.")
            with _vb2:
                st.download_button("Download Vendor List (CSV)",
                                   data=_edited_v.to_csv(index=False).encode(),
                                   file_name="QBO_Vendor_List.csv",
                                   mime="text/csv", width='stretch', key="dl_vendors_btn")
        elif _df_vend is not None:
            st.info("No vendors returned from QBO.")

    with st.expander("How account mapping works", expanded=False):
        st.markdown("""
When you click **Post Journal Entry to QuickBooks**, the app:
1. Fetches your **Chart of Accounts** from QBO to build a name → ID lookup.
2. Matches each JE row by **Account name** to find the QBO Account ID.
3. Posts via `POST /v3/company/{realmId}/journalentry`.

**Tip:** Account names in your JE must exactly match QBO account names.
Use the Chart of Accounts table above to confirm exact names.
        """)
