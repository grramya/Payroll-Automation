# =============================================================================
# qbo/main.py — Standalone CLI for QBO integration (outside Streamlit)
# =============================================================================
"""
Command-line interface for testing and running QBO operations independently.

Usage:
    python -m qbo.main auth           — First-time OAuth authentication
    python -m qbo.main accounts       — Print Chart of Accounts
    python -m qbo.main test-je        — Post a sample Journal Entry
    python -m qbo.main status         — Show token status
    python -m qbo.main logout         — Revoke tokens

Run from the project root directory:
    cd "C:/Users/GRRamya/Downloads/Payroll Automation"
    python -m qbo.main auth
"""

import sys
import json
from datetime import datetime

# ---------------------------------------------------------------------------
# Make sure the project root is on the path (for `from qbo import ...`)
# ---------------------------------------------------------------------------
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from qbo import config
from qbo import auth
from qbo import api


# =============================================================================
# CLI commands
# =============================================================================

def cmd_auth():
    """Run first-time OAuth authentication and save tokens."""
    print("\n=== QuickBooks Online — First-time Authentication ===\n")
    try:
        store = auth.authenticate()
        print(f"  Realm ID     : {store.realm_id}")
        print(f"  Token saved  : {config.TOKEN_FILE}")
        print(f"  Expires at   : {datetime.fromtimestamp(store.expires_at):%Y-%m-%d %H:%M:%S}")
        print("\n  You are now authenticated. Run other commands to interact with QBO.\n")
    except Exception as e:
        print(f"\n  ERROR: {e}\n")
        sys.exit(1)


def cmd_status():
    """Show current token status without making any API calls."""
    print("\n=== Token Status ===\n")
    store = auth.TokenStore.load()
    if store is None:
        print("  No tokens found. Run: python -m qbo.main auth\n")
        return
    exp = datetime.fromtimestamp(store.expires_at)
    expired = "  EXPIRED" if store.is_expired else "  Valid"
    print(f"  Realm ID       : {store.realm_id}")
    print(f"  Token file     : {config.TOKEN_FILE}")
    print(f"  Access token   : {'*' * 20}{store.access_token[-6:]}")
    print(f"  Expires at     : {exp:%Y-%m-%d %H:%M:%S}{expired}")
    print(f"  Sandbox mode   : {config.USE_SANDBOX}\n")


def cmd_accounts():
    """Fetch and print the Chart of Accounts."""
    print("\n=== Chart of Accounts ===\n")
    try:
        client   = api.QBOClient()
        accounts = client.get_accounts(active_only=True)
        if not accounts:
            print("  No accounts returned.\n")
            return
        # Print a formatted table
        print(f"  {'ID':<8} {'Type':<20} {'Name'}")
        print(f"  {'-'*8} {'-'*20} {'-'*40}")
        for acct in sorted(accounts, key=lambda a: a.get("AccountType", "") + a.get("Name", "")):
            print(
                f"  {acct.get('Id', ''):<8} "
                f"{acct.get('AccountType', ''):<20} "
                f"{acct.get('Name', '')}"
            )
        print(f"\n  Total: {len(accounts)} accounts\n")
    except api.QBOError as e:
        print(f"\n  QBO API Error [{e.status_code}]: {e}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n  Error: {e}\n")
        sys.exit(1)


def cmd_test_je():
    """
    Post a sample Journal Entry to the QBO Sandbox.

    Before running this command, call cmd_accounts() and note the IDs for
    two accounts you want to test with (e.g. an Expense account and a
    Bank or Payable account), then update DEBIT_ACCOUNT_ID / CREDIT_ACCOUNT_ID.
    """

    # ──────────────────────────────────────────────────────────────────────
    # UPDATE THESE with real account IDs from your sandbox Chart of Accounts
    # (run: python -m qbo.main accounts)
    # ──────────────────────────────────────────────────────────────────────
    DEBIT_ACCOUNT_ID  = "57"    # e.g. "Payroll Expenses" account ID
    CREDIT_ACCOUNT_ID = "33"    # e.g. "Accounts Payable" account ID
    AMOUNT            = 1500.00
    # ──────────────────────────────────────────────────────────────────────

    print("\n=== Post Sample Journal Entry to QBO Sandbox ===\n")

    payload = api.build_sample_je_payload(
        debit_account_id  = DEBIT_ACCOUNT_ID,
        credit_account_id = CREDIT_ACCOUNT_ID,
        amount            = AMOUNT,
        description       = "Payroll Automation — Test Entry",
    )

    print("  Payload to be posted:")
    print(json.dumps(payload, indent=4))

    confirm = input("\n  Post this entry to QBO Sandbox? (yes/no): ").strip().lower()
    if confirm not in ("yes", "y"):
        print("  Aborted.\n")
        return

    try:
        client = api.QBOClient()
        result = client.create_journal_entry(payload)
        print(f"\n  ✅ Journal Entry created successfully!")
        print(f"  QBO JE ID   : {result.get('Id')}")
        print(f"  Doc Number  : {result.get('DocNumber', 'N/A')}")
        print(f"  Txn Date    : {result.get('TxnDate')}")
        print(f"\n  Verify in QBO:")
        print(f"  https://app.quickbooks.com → Accounting → Journal Entries\n")

    except api.ValidationError as e:
        print(f"\n  Validation Error: {e}\n")
        sys.exit(1)
    except api.QBOError as e:
        print(f"\n  QBO API Error [{e.status_code}]: {e}")
        if e.fault:
            print(f"  Fault detail: {json.dumps(e.fault, indent=4)}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n  Unexpected error: {e}\n")
        sys.exit(1)


def cmd_logout():
    """Revoke tokens and delete tokens.json."""
    print("\n=== Logout — Revoking QBO Tokens ===\n")
    results = auth.revoke_tokens()
    for key, val in results.items():
        print(f"  {key}: {val}")
    print()


# =============================================================================
# Entry point
# =============================================================================

COMMANDS = {
    "auth":     cmd_auth,
    "status":   cmd_status,
    "accounts": cmd_accounts,
    "test-je":  cmd_test_je,
    "logout":   cmd_logout,
}

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("\nUsage: python -m qbo.main <command>")
        print("\nAvailable commands:")
        for name, fn in COMMANDS.items():
            doc = (fn.__doc__ or "").strip().split("\n")[0]
            print(f"  {name:<12} {doc}")
        print()
        sys.exit(0)

    config.validate_credentials()
    COMMANDS[sys.argv[1]]()


if __name__ == "__main__":
    main()
