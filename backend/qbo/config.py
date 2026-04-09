# =============================================================================
# qbo/config.py — QuickBooks Online configuration and environment variables
# =============================================================================
"""
All QBO credentials and endpoint constants live here.
No credentials are ever hard-coded — everything is read from .env.

Setup:
    1. Copy .env.example → .env in the project root
    2. Fill in QBO_CLIENT_ID and QBO_CLIENT_SECRET from your Intuit Developer Portal app
    3. Make sure your app's redirect URI is set to: http://localhost:8000/callback
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# .env lives at the project root (one level up from this qbo/ folder)
_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def _get_secret(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ---------------------------------------------------------------------------
# Intuit credentials — set in .env (local) or Streamlit Secrets (cloud)
# ---------------------------------------------------------------------------
CLIENT_ID     = _get_secret("QBO_CLIENT_ID")
CLIENT_SECRET = _get_secret("QBO_CLIENT_SECRET")

# ---------------------------------------------------------------------------
# OAuth 2.0 endpoints
# ---------------------------------------------------------------------------
AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_URL         = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOKE_URL        = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"

# ---------------------------------------------------------------------------
# Redirect URI — must exactly match what you registered in the Dev Portal
# ---------------------------------------------------------------------------
REDIRECT_URI  = "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl"

# ---------------------------------------------------------------------------
# OAuth scopes
# ---------------------------------------------------------------------------
# com.intuit.quickbooks.accounting → read/write access to QBO company data
# openid profile email             → identity info (optional)
SCOPES = "com.intuit.quickbooks.accounting openid profile email"

# ---------------------------------------------------------------------------
# QBO API base URLs
# ---------------------------------------------------------------------------
SANDBOX_BASE_URL    = "https://sandbox-quickbooks.api.intuit.com"
PRODUCTION_BASE_URL = "https://quickbooks.api.intuit.com"

# Toggle via .env: set QBO_USE_SANDBOX=true to go back to sandbox
USE_SANDBOX = os.environ.get("QBO_USE_SANDBOX", "false").lower() == "true"
BASE_URL    = SANDBOX_BASE_URL if USE_SANDBOX else PRODUCTION_BASE_URL

API_VERSION = "v3"

# ---------------------------------------------------------------------------
# Local files
# ---------------------------------------------------------------------------
# Token storage — persists access + refresh tokens between runs
TOKEN_FILE = _PROJECT_ROOT / "qbo" / "tokens.json"

# ---------------------------------------------------------------------------
# Shared accounts override file
# If ACCOUNTS_OVERRIDE_PATH is set in .env, both users can point to the same
# shared network/OneDrive path so edits sync automatically.
# Leave blank to use the default local path: qbo/accounts_override.csv
# ---------------------------------------------------------------------------
_override_env = _get_secret("ACCOUNTS_OVERRIDE_PATH", "").strip()
_default_override = _PROJECT_ROOT / "qbo" / "accounts_override.csv"
if _override_env:
    _candidate = Path(_override_env)
    ACCOUNTS_OVERRIDE_PATH = _candidate if _candidate.exists() else _default_override
else:
    ACCOUNTS_OVERRIDE_PATH = _default_override

# ---------------------------------------------------------------------------
# Vendor list local override file
# ---------------------------------------------------------------------------
VENDORS_OVERRIDE_PATH = _PROJECT_ROOT / "qbo" / "vendors_override.csv"

# ---------------------------------------------------------------------------
# Local OAuth callback server settings
# ---------------------------------------------------------------------------
CALLBACK_HOST = "localhost"
CALLBACK_PORT = 8000

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_credentials() -> None:
    """Raise a clear error if credentials are missing from .env."""
    missing = [k for k, v in [("QBO_CLIENT_ID", CLIENT_ID), ("QBO_CLIENT_SECRET", CLIENT_SECRET)] if not v]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}\n"
            f"Copy .env.example → .env in the project root and fill in your credentials."
        )

def are_credentials_set() -> bool:
    """Return True if both credentials are non-empty."""
    return bool(CLIENT_ID and CLIENT_SECRET)
