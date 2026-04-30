# =============================================================================
# qbo/api.py — QuickBooks Online API calls
# =============================================================================
"""
Provides a QBOClient class that wraps every QBO REST API call needed by
the Payroll JE Automation app:

    QBOClient.get_accounts()          — fetch Chart of Accounts
    QBOClient.find_account()          — search by name or type
    QBOClient.create_journal_entry()  — post a Journal Entry
    QBOClient.get_journal_entry()     — fetch an existing JE by ID
    QBOClient.build_je_payload()      — convert our JE DataFrame → QBO JSON

QBO API reference:
    https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry
"""

from __future__ import annotations

import json
import math
from datetime import date
from typing import Optional

import pandas as pd
import requests

from qbo import config
from qbo.auth import get_valid_token, TokenStore


# =============================================================================
# Custom exceptions
# =============================================================================

class QBOError(Exception):
    """Raised when the QBO API returns an error response."""
    def __init__(self, status_code: int, message: str, fault: dict = None):
        self.status_code = status_code
        self.fault       = fault or {}
        super().__init__(f"QBO API Error [{status_code}]: {message}")


class ValidationError(Exception):
    """Raised when a Journal Entry fails local pre-flight validation."""


# =============================================================================
# QBOClient
# =============================================================================

class QBOClient:
    """
    Thin wrapper around the QBO REST API.

    Usage:
        client = QBOClient()
        accounts = client.get_accounts()
        result   = client.create_journal_entry(payload)
    """

    def __init__(self):
        self._store: TokenStore = get_valid_token()
        # Warn loudly if the token is for a different company than configured
        expected = config.MAIN_REALM_ID
        actual   = self._store.realm_id
        if expected and actual and expected != actual:
            raise RuntimeError(
                f"QBO realm ID mismatch: the stored token is for company '{actual}' "
                f"but QBO_MAIN_REALM_ID is set to '{expected}'. "
                "Please disconnect and re-authenticate in the QBO Settings panel "
                "while logged into the correct QBO company."
            )

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _headers(self) -> dict:
        """Build standard QBO request headers."""
        # Always ensure the token is fresh before each call
        if self._store.is_expired:
            from qbo.auth import refresh_access_token
            self._store = refresh_access_token(self._store)
        return {
            "Authorization": f"Bearer {self._store.access_token}",
            "Accept":        "application/json",
            "Content-Type":  "application/json",
        }

    def _base_url(self) -> str:
        """QBO base URL for this company's API."""
        return (
            f"{config.BASE_URL}/{config.API_VERSION}"
            f"/company/{self._store.realm_id}"
        )

    def _get(self, path: str, params: dict = None) -> dict:
        """Execute a GET request and return the JSON response."""
        url  = self._base_url() + path
        resp = requests.get(
            url,
            headers=self._headers(),
            params=params or {},
            timeout=30,
        )
        return self._handle_response(resp)

    def _post(self, path: str, payload: dict) -> dict:
        """Execute a POST request and return the JSON response."""
        url  = self._base_url() + path
        resp = requests.post(
            url,
            headers=self._headers(),
            data=json.dumps(payload),
            timeout=30,
        )
        return self._handle_response(resp)

    @staticmethod
    def _handle_response(resp: requests.Response) -> dict:
        """Parse the response; raise QBOError on non-2xx."""
        try:
            body = resp.json()
        except Exception:
            body = {}

        if resp.ok:
            return body

        # Extract the Intuit fault detail if present
        fault   = body.get("Fault", {})
        errors  = fault.get("Error", [])
        if errors:
            msg_parts = []
            for err in errors:
                part   = err.get("Message", "")
                detail = err.get("Detail", "")
                code   = err.get("code", "")
                if detail:
                    part += f" | Detail: {detail}"
                if code:
                    part += f" | Code: {code}"
                if part:
                    msg_parts.append(part)
            message = " | ".join(msg_parts) if msg_parts else resp.text
        else:
            message = resp.text

        # Special-case 403: add a hint about the most common cause
        if resp.status_code == 403 and not message.strip():
            message = (
                "Access denied (403). Most likely cause: the stored tokens were obtained "
                "via the OAuth Playground (sandbox) but the app is pointed at the production "
                "QBO API. Set QBO_USE_SANDBOX=true in .env, or re-authenticate against "
                "the production environment."
            )

        raise QBOError(resp.status_code, message, fault)

    # -------------------------------------------------------------------------
    # Chart of Accounts
    # -------------------------------------------------------------------------

    def get_accounts(
        self,
        account_type: Optional[str]    = None,
        account_subtype: Optional[str] = None,
        active_only: bool              = True,
    ) -> list[dict]:
        """
        Fetch the Chart of Accounts from QBO.

        Parameters
        ----------
        account_type    : filter by AccountType   (e.g. "Expense", "Bank")
        account_subtype : filter by AccountSubType (e.g. "SavingsAccount")
        active_only     : if True, only return Active accounts (default True)

        Returns
        -------
        List of account dicts, each with keys:
            Id, Name, AccountType, AccountSubType, Active, CurrentBalance
        """
        conditions = []
        if active_only:
            conditions.append("Active = true")
        if account_type:
            conditions.append(f"AccountType = '{account_type}'")
        if account_subtype:
            conditions.append(f"AccountSubType = '{account_subtype}'")

        where_clause = " AND ".join(conditions)
        base_query = f"SELECT * FROM Account WHERE {where_clause}" if conditions else "SELECT * FROM Account"

        # QBO caps results at 1000 per request — paginate until all accounts are fetched
        all_accounts: list[dict] = []
        page_size    = 1000
        start        = 1

        while True:
            paginated_query = f"{base_query} STARTPOSITION {start} MAXRESULTS {page_size}"
            data    = self._get("/query", params={"query": paginated_query, "minorversion": 65})
            page    = data.get("QueryResponse", {}).get("Account", [])
            all_accounts.extend(page)
            if len(page) < page_size:
                break   # last page — no more records
            start += page_size

        return all_accounts

    def find_account(self, name: str) -> Optional[dict]:
        """
        Find a single account by exact name match (case-insensitive).
        Returns the account dict or None if not found.
        """
        all_accounts = self.get_accounts(active_only=True)
        name_lower   = name.strip().lower()
        for acct in all_accounts:
            if acct.get("Name", "").strip().lower() == name_lower:
                return acct
        return None

    def get_accounts_dataframe(self) -> pd.DataFrame:
        """
        Return the Chart of Accounts as a pandas DataFrame.
        Useful for display in the Streamlit UI.
        """
        accounts = self.get_accounts(active_only=False)
        if not accounts:
            return pd.DataFrame()
        raw = pd.DataFrame(accounts)
        if "FullyQualifiedName" not in raw.columns:
            raw["FullyQualifiedName"] = raw["Name"]
        else:
            raw["FullyQualifiedName"] = raw["FullyQualifiedName"].fillna(raw["Name"])
        if "AcctNum" not in raw.columns:
            raw["AcctNum"] = ""
        else:
            raw["AcctNum"] = raw["AcctNum"].fillna("")
        df = raw[["AcctNum", "Id", "Name", "FullyQualifiedName", "AccountType", "AccountSubType", "Active", "CurrentBalance"]]
        df = df.rename(columns={
            "AcctNum":             "Account Number",
            "Id":                  "Account ID",
            "Name":                "Account Name",
            "FullyQualifiedName":  "Full Name",
            "AccountType":         "Type",
            "AccountSubType":      "Sub-Type",
            "Active":              "Active",
            "CurrentBalance":      "Balance",
        })
        return df.reset_index(drop=True)

    def get_vendors_dataframe(self) -> pd.DataFrame:
        """
        Return the Vendor list as a pandas DataFrame.
        Useful for display in the Streamlit UI.
        """
        all_vendors: list[dict] = []
        page_size = 1000
        start     = 1

        while True:
            query = f"SELECT * FROM Vendor STARTPOSITION {start} MAXRESULTS {page_size}"
            data  = self._get("/query", params={"query": query, "minorversion": 65})
            page  = data.get("QueryResponse", {}).get("Vendor", [])
            all_vendors.extend(page)
            if len(page) < page_size:
                break
            start += page_size

        if not all_vendors:
            return pd.DataFrame()

        rows = []
        for v in all_vendors:
            rows.append({
                "Vendor ID":           str(v.get("Id", "")),
                "Display Name":        v.get("DisplayName", ""),
                "Print on Check Name": v.get("PrintOnCheckName", ""),
                "Company Name":        v.get("CompanyName", ""),
                "Active":              v.get("Active", ""),
                "Balance":             v.get("Balance", ""),
            })
        return pd.DataFrame(rows).reset_index(drop=True)

    # -------------------------------------------------------------------------
    # Journal Entry creation
    # -------------------------------------------------------------------------

    @staticmethod
    def validate_je_lines(lines: list[dict]) -> None:
        """
        Pre-flight validation before posting to QBO.

        Checks:
        - At least 2 lines
        - Every line has AccountRef.value and Amount
        - PostingType is "Debit" or "Credit"
        - Total debits == total credits (within $0.01 rounding tolerance)

        Raises ValidationError with a descriptive message on failure.
        """
        if len(lines) < 2:
            raise ValidationError("A Journal Entry must have at least 2 lines.")

        total_debit  = 0.0
        total_credit = 0.0

        missing_ids = []
        for i, line in enumerate(lines, start=1):
            detail = line.get("JournalEntryLineDetail", {})

            if not detail.get("AccountRef", {}).get("value"):
                acct_name = detail.get("AccountRef", {}).get("name", "Unknown")
                missing_ids.append(f"  Line {i}: '{acct_name}'")

        if missing_ids:
            raise ValidationError(
                "The following accounts have no Account ID — "
                "add their IDs in the Mapping.xlsx (cols D & E) or fetch the Chart of Accounts and update:\n"
                + "\n".join(missing_ids)
            )

        for i, line in enumerate(lines, start=1):
            detail = line.get("JournalEntryLineDetail", {})
            amount = line.get("Amount")
            if amount is None or float(amount) <= 0:
                raise ValidationError(
                    f"Line {i}: Amount must be a positive number (got {amount!r})."
                )
            posting = detail.get("PostingType", "")
            if posting not in ("Debit", "Credit"):
                raise ValidationError(
                    f"Line {i}: PostingType must be 'Debit' or 'Credit' (got {posting!r})."
                )

            if posting == "Debit":
                total_debit  += float(amount)
            else:
                total_credit += float(amount)

        if abs(round(total_debit, 2) - round(total_credit, 2)) > 0.01:
            raise ValidationError(
                f"Journal Entry does not balance: "
                f"Debits = {total_debit:,.2f}  |  Credits = {total_credit:,.2f}  |  "
                f"Difference = {abs(total_debit - total_credit):,.2f}"
            )

    def create_journal_entry(self, payload: dict) -> dict:
        """
        Post a Journal Entry to QBO.

        Parameters
        ----------
        payload : dict
            A valid QBO JournalEntry JSON payload.
            Use build_je_payload() to construct it from your JE DataFrame.

        Returns
        -------
        dict — the created JournalEntry object as returned by QBO, including:
            Id        — QBO-assigned Journal Entry ID
            DocNumber — document number (if provided)
            TxnDate   — transaction date
        """
        # Validate lines before hitting the network
        lines = payload.get("Line", [])
        self.validate_je_lines(lines)

        response = self._post("/journalentry", payload)
        return response.get("JournalEntry", response)

    def attach_file_to_je(self, je_id: str, filename: str, file_bytes: bytes) -> dict:
        """
        Attach a file (e.g. the payroll input .xlsx) to an existing Journal Entry in QBO.

        Uses the QBO Attachable API to upload the file and link it to the JE,
        so auditors can open the JE in QBO and see the source payroll file attached.

        Parameters
        ----------
        je_id      : str   — QBO Journal Entry ID (returned by create_journal_entry)
        filename   : str   — original filename e.g. "Invoice_Supporting_Details-4.15.xlsx"
        file_bytes : bytes — raw file content

        Returns
        -------
        dict — the created Attachable object from QBO
        """
        import base64

        # Step 1 — Upload the file bytes as a QBO Attachable
        upload_url = self._base_url() + "/upload"

        boundary = "PayrollAutomationBoundary"
        # Build multipart/form-data body manually
        body_parts = []
        # Part 1: metadata JSON
        metadata = {
            "AttachableRef": [
                {
                    "EntityRef": {
                        "type":  "JournalEntry",
                        "value": str(je_id),
                    },
                    "IncludeOnSend": False,
                }
            ],
            "FileName":    filename,
            "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
        meta_json = json.dumps(metadata)
        body_parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file_metadata_01"\r\n'
            f"Content-Type: application/json\r\n\r\n"
            f"{meta_json}\r\n"
        )
        # Part 2: file bytes
        body_parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file_content_01"; filename="{filename}"\r\n'
            f"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        )
        body_str   = "".join(body_parts).encode("utf-8")
        body_end   = f"\r\n--{boundary}--\r\n".encode("utf-8")
        body_bytes = body_str + file_bytes + body_end

        headers = {
            "Authorization":  f"Bearer {self._store.access_token}",
            "Content-Type":   f"multipart/form-data; boundary={boundary}",
            "Accept":         "application/json",
        }

        resp = requests.post(upload_url, headers=headers, data=body_bytes, timeout=60)
        result = self._handle_response(resp)
        return result.get("AttachableResponse", [{}])[0].get("Attachable", result)

    def get_journal_entry(self, je_id: str) -> dict:
        """
        Fetch an existing Journal Entry by its QBO ID.

        Parameters
        ----------
        je_id : str — the Id returned by create_journal_entry()

        Returns
        -------
        dict — the full JournalEntry object
        """
        data = self._get(f"/journalentry/{je_id}")
        return data.get("JournalEntry", data)

    # -------------------------------------------------------------------------
    # Build QBO payload from our internal JE DataFrame
    # -------------------------------------------------------------------------

    @staticmethod
    def build_je_payload(
        je_df:         pd.DataFrame,
        journal_number: str  = "",
        txn_date:       str  = "",
        private_note:   str  = "",
        account_map:    dict = None,
        class_map:      dict = None,
        vendor_map:     dict = None,
    ) -> dict:
        """
        Convert the Payroll Automation JE DataFrame into a QBO-ready
        JournalEntry JSON payload.

        Parameters
        ----------
        je_df          : pd.DataFrame — output of build_je() from je_builder.py
        journal_number : str          — maps to DocNumber in QBO
        txn_date       : str          — "MM/DD/YYYY" or "YYYY-MM-DD"
        private_note   : str          — internal memo (PrivateNote field)
        account_map    : dict         — {account_name_lower: account_id}
                                        if provided, used to resolve AccountRef.value
        class_map      : dict         — {class_name_lower: class_id}
                                        if provided, used to resolve ClassRef.value
                                        (QBO requires ClassRef.value when ClassRef is sent)
        vendor_map     : dict         — {vendor_name_lower: vendor_id}
                                        if provided, used to resolve EntityRef.value for
                                        AP lines (QBO Error 6000 if vendor ID is missing)

        Returns
        -------
        dict — ready to pass to create_journal_entry()
        """
        account_map = account_map or {}
        class_map   = class_map   or {}
        vendor_map  = vendor_map  or {}

        # Normalise date to YYYY-MM-DD (QBO requirement)
        if txn_date:
            for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
                try:
                    from datetime import datetime
                    parsed = datetime.strptime(txn_date, fmt)
                    txn_date = parsed.strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
        else:
            txn_date = date.today().isoformat()

        # ── Pre-flight: collect ALL unresolved classes and vendors before building ──
        missing_classes = []
        missing_vendors = []
        for i, (_, row) in enumerate(je_df.iterrows(), start=1):
            if str(row.get("Post?", "Yes")).strip().lower() == "no":
                continue
            class_val  = row.get("Class")
            vendor_val = row.get("Vendor")
            desc       = str(row.get("Journal Description", "")).strip()

            if class_val and not _is_empty(class_val):
                class_name = str(class_val).strip()
                if not class_map.get(class_name.lower(), ""):
                    missing_classes.append(f"  Line {i} ('{desc}'): class '{class_name}'")

            if vendor_val and not _is_empty(vendor_val):
                vendor_name = str(vendor_val).strip()
                if not vendor_map.get(vendor_name.lower(), ""):
                    missing_vendors.append(f"  Line {i} ('{desc}'): vendor '{vendor_name}'")

        errors: list[str] = []
        if missing_classes:
            errors.append(
                "The following classes were not found in QBO — "
                "add them under Settings → All Lists → Classes:\n"
                + "\n".join(missing_classes)
            )
        if missing_vendors:
            errors.append(
                "The following vendors were not found in QBO — "
                "add them under Expenses → Vendors:\n"
                + "\n".join(missing_vendors)
            )
        if errors:
            raise ValidationError("\n\n".join(errors))

        lines = []
        for _, row in je_df.iterrows():
            # Skip rows explicitly marked Post? = "No" (manually excluded by user)
            if str(row.get("Post?", "Yes")).strip().lower() == "no":
                continue

            debit  = _safe_float(row.get("Debit (exc. Tax)"))
            credit = _safe_float(row.get("Credit (exc. Tax)"))

            if debit > 0:
                amount       = debit
                posting_type = "Debit"
            elif credit > 0:
                amount       = credit
                posting_type = "Credit"
            else:
                continue   # zero-amount lines are ignored

            _raw_acct = row.get("Account", "")
            account_name = "" if _is_empty(_raw_acct) else str(_raw_acct).strip()
            # Name lookup is primary — uses FullyQualifiedName from fetch_account_map()
            # so hierarchical names like "Cost of Goods Sold:COS - Staff:COS - Salary/Fixed"
            # always resolve to the correct QBO ID regardless of what is in Mapping.xlsx.
            # Fall back to the Account ID stored in the JE row only when no name match found.
            account_id_from_map = account_map.get(account_name.lower(), "")
            # Fallback: if the full qualified name isn't in the map (old CSV without
            # "Full Name" column), try just the last segment after the last ":"
            if not account_id_from_map and ":" in account_name:
                last_segment = account_name.rsplit(":", 1)[-1].strip()
                account_id_from_map = account_map.get(last_segment.lower(), "")
            _raw_id = row.get("Account ID", "")
            account_id_from_row = "" if _is_empty(_raw_id) else str(_raw_id).strip()
            account_id = account_id_from_map if account_id_from_map else account_id_from_row

            _raw_desc = row.get("Journal Description", "")
            description  = "" if _is_empty(_raw_desc) else str(_raw_desc).strip()
            class_val    = row.get("Class")
            vendor_val   = row.get("Vendor")

            line: dict = {
                "Description": description,
                "Amount":      round(amount, 2),
                "DetailType":  "JournalEntryLineDetail",
                "JournalEntryLineDetail": {
                    "PostingType": posting_type,
                    "AccountRef": {
                        "value": account_id,
                        "name":  account_name,
                    },
                },
            }

            # Attach vendor EntityRef for Accounts Payable lines.
            # QBO Error 6000: "When you use Accounts Payable, you must choose a vendor"
            # — requires EntityRef.value (vendor ID), not just name.
            if vendor_val and not _is_empty(vendor_val):
                vendor_name = str(vendor_val).strip()
                vendor_id   = vendor_map.get(vendor_name.lower(), "")
                line["JournalEntryLineDetail"]["Entity"] = {
                    "EntityRef": {
                        "value": vendor_id,
                        "name":  vendor_name,
                    },
                    "Type": "Vendor",
                }

            # Attach ClassRef — class_map is guaranteed to have this key
            # (missing classes were caught in the pre-flight check above).
            if class_val and not _is_empty(class_val):
                class_name = str(class_val).strip()
                class_id   = class_map.get(class_name.lower(), "")
                line["JournalEntryLineDetail"]["ClassRef"] = {
                    "value": class_id,
                    "name":  class_name,
                }

            lines.append(line)

        payload: dict = {
            "Line":    lines,
            "TxnDate": txn_date,
        }
        if journal_number:
            payload["DocNumber"] = str(journal_number).strip()
        if private_note:
            payload["PrivateNote"] = str(private_note).strip()

        return payload

    def fetch_account_map(self) -> dict[str, str]:
        """
        Return a dict mapping lower-cased account names → QBO account IDs.

        Uses the locally saved accounts_override.csv when available (faster —
        no QBO API call needed). Falls back to a live QBO fetch otherwise.
        """
        override = config.ACCOUNTS_OVERRIDE_PATH
        if override.exists():
            import csv
            result: dict[str, str] = {}
            with open(override, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    acct_id        = str(row.get("Account ID", "")).strip()
                    acct_name      = str(row.get("Account Name", "")).strip()
                    full_name      = str(row.get("Full Name", "")).strip()
                    if not acct_id:
                        continue
                    if acct_name:
                        result[acct_name.lower()] = acct_id
                    # Full Name (FullyQualifiedName) takes priority — overwrite short name
                    # so hierarchical names like "Accrued Expenses:Accrued Payroll" resolve
                    if full_name and full_name != acct_name:
                        result[full_name.lower()] = acct_id
            return result

        # No local file — fetch live from QBO
        accounts = self.get_accounts(active_only=False)
        result: dict[str, str] = {}
        for acct in accounts:
            if "Id" not in acct:
                continue
            acct_id = str(acct["Id"])
            if "Name" in acct:
                result[acct["Name"].strip().lower()] = acct_id
            if "FullyQualifiedName" in acct:
                result[acct["FullyQualifiedName"].strip().lower()] = acct_id
        return result

    def fetch_vendor_map(self) -> dict[str, str]:
        """
        Return a dict mapping lower-cased vendor display names → QBO vendor IDs.

        Uses the locally saved vendors_override.csv when available (faster —
        no QBO API call needed). Falls back to a live QBO fetch otherwise.
        """
        override = config.VENDORS_OVERRIDE_PATH
        if override.exists():
            import csv
            result: dict[str, str] = {}
            with open(override, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    vendor_id   = str(row.get("Vendor ID", "")).strip()
                    vendor_name = str(row.get("Display Name", "")).strip()
                    if vendor_id and vendor_name:
                        result[vendor_name.lower()] = vendor_id
            return result

        # No local file — fetch live from QBO
        all_vendors: list[dict] = []
        page_size = 1000
        start     = 1

        while True:
            query = f"SELECT * FROM Vendor STARTPOSITION {start} MAXRESULTS {page_size}"
            data  = self._get("/query", params={"query": query, "minorversion": 65})
            page  = data.get("QueryResponse", {}).get("Vendor", [])
            all_vendors.extend(page)
            if len(page) < page_size:
                break
            start += page_size

        result: dict[str, str] = {}
        for v in all_vendors:
            if "Id" not in v:
                continue
            vid = str(v["Id"])
            # Index by DisplayName (what we store in Vendor column of JE)
            if "DisplayName" in v:
                result[v["DisplayName"].strip().lower()] = vid
            # Also index by PrintOnCheckName as a fallback
            if "PrintOnCheckName" in v:
                result[v["PrintOnCheckName"].strip().lower()] = vid
        return result

    def fetch_class_map(self) -> dict[str, str]:
        """
        Return a dict mapping lower-cased class names → QBO class IDs.
        Indexes both short Name and FullyQualifiedName so hierarchical class
        names like "COGS:Procurement" resolve to the correct ID.

        Uses the locally saved classes_override.csv when available (faster —
        no QBO API call needed). Falls back to a live QBO fetch otherwise.

        Required so that ClassRef.value can be included when posting JEs
        (QBO API rejects ClassRef if it only has 'name' without 'value').
        """
        override = config.CLASSES_OVERRIDE_PATH
        if override.exists():
            import csv
            result: dict[str, str] = {}
            with open(override, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    cls_id        = str(row.get("Class ID", "")).strip()
                    cls_name      = str(row.get("Class Name", "")).strip()
                    full_name     = str(row.get("Full Name", "")).strip()
                    if not cls_id:
                        continue
                    if cls_name:
                        result[cls_name.lower()] = cls_id
                    if full_name and full_name != cls_name:
                        result[full_name.lower()] = cls_id
            return result

        # No local file — fetch live from QBO
        all_classes: list[dict] = []
        page_size = 1000
        start     = 1

        while True:
            query = f"SELECT * FROM Class STARTPOSITION {start} MAXRESULTS {page_size}"
            data  = self._get("/query", params={"query": query, "minorversion": 65})
            page  = data.get("QueryResponse", {}).get("Class", [])
            all_classes.extend(page)
            if len(page) < page_size:
                break
            start += page_size

        result: dict[str, str] = {}
        for cls in all_classes:
            if "Id" not in cls:
                continue
            cls_id = str(cls["Id"])
            if "Name" in cls:
                result[cls["Name"].strip().lower()] = cls_id
            if "FullyQualifiedName" in cls:
                result[cls["FullyQualifiedName"].strip().lower()] = cls_id
        return result

    def get_classes_dataframe(self) -> pd.DataFrame:
        """
        Return the Class list as a pandas DataFrame for display and local caching.
        """
        all_classes: list[dict] = []
        page_size = 1000
        start     = 1

        while True:
            query = f"SELECT * FROM Class STARTPOSITION {start} MAXRESULTS {page_size}"
            data  = self._get("/query", params={"query": query, "minorversion": 65})
            page  = data.get("QueryResponse", {}).get("Class", [])
            all_classes.extend(page)
            if len(page) < page_size:
                break
            start += page_size

        if not all_classes:
            return pd.DataFrame()

        raw = pd.DataFrame(all_classes)
        if "FullyQualifiedName" not in raw.columns:
            raw["FullyQualifiedName"] = raw["Name"]
        else:
            raw["FullyQualifiedName"] = raw["FullyQualifiedName"].fillna(raw["Name"])

        df = raw[["Id", "Name", "FullyQualifiedName", "Active"]].copy()
        df = df.rename(columns={
            "Id":                 "Class ID",
            "Name":               "Class Name",
            "FullyQualifiedName": "Full Name",
            "Active":             "Active",
        })
        return df.reset_index(drop=True)


# =============================================================================
# Standalone helper functions (usable without an authenticated client)
# =============================================================================

def build_sample_je_payload(
    debit_account_id:  str   = "57",
    credit_account_id: str   = "33",
    amount:            float = 1000.00,
    txn_date:          str   = "",
    description:       str   = "Payroll Journal Entry",
) -> dict:
    """
    Return a minimal but complete QBO JournalEntry payload with one
    Debit line and one Credit line.

    Use this to test the API connection before wiring up the full DataFrame flow.

    Parameters
    ----------
    debit_account_id  : QBO Account ID to debit  (find via get_accounts())
    credit_account_id : QBO Account ID to credit (find via get_accounts())
    amount            : dollar amount (same for both lines — entry must balance)
    txn_date          : "YYYY-MM-DD" or "" for today
    description       : line description

    Returns
    -------
    dict — pass directly to QBOClient.create_journal_entry()
    """
    txn_date = txn_date or date.today().isoformat()
    return {
        "Line": [
            {
                "Description": f"{description} — Debit",
                "Amount":      round(amount, 2),
                "DetailType":  "JournalEntryLineDetail",
                "JournalEntryLineDetail": {
                    "PostingType": "Debit",
                    "AccountRef": {
                        "value": debit_account_id,
                        "name":  "Payroll Expenses",   # name is informational only
                    },
                },
            },
            {
                "Description": f"{description} — Credit",
                "Amount":      round(amount, 2),
                "DetailType":  "JournalEntryLineDetail",
                "JournalEntryLineDetail": {
                    "PostingType": "Credit",
                    "AccountRef": {
                        "value": credit_account_id,
                        "name":  "Accounts Payable",   # name is informational only
                    },
                },
            },
        ],
        "TxnDate":    txn_date,
        "DocNumber":  "TEST-JE-001",
        "PrivateNote": f"Test entry created by Payroll JE Automation — {description}",
    }


# =============================================================================
# Private utilities
# =============================================================================

def _safe_float(val) -> float:
    """Convert a cell value to float; return 0.0 on failure or NaN."""
    if val is None:
        return 0.0
    try:
        f = float(val)
        return 0.0 if math.isnan(f) else f
    except (TypeError, ValueError):
        return 0.0


def _is_empty(val) -> bool:
    """Return True if val is None, NaN, empty string, or the literal 'nan'."""
    if val is None:
        return True
    if isinstance(val, float) and math.isnan(val):
        return True
    if str(val).strip().lower() in ("", "nan", "none"):
        return True
    return False
