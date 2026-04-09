# =============================================================================
# qbo/auth.py — OAuth 2.0 Authorization Code Flow for QuickBooks Online
# =============================================================================
"""
Handles the full OAuth 2.0 lifecycle:
  1. Build the authorization URL the user visits in their browser.
  2. Spin up a temporary local HTTP server to capture the callback redirect.
  3. Exchange the authorization code for access + refresh tokens.
  4. Persist tokens to qbo/tokens.json — survives between app restarts.
  5. Auto-refresh the access token whenever it is expired or near expiry.
  6. Optionally revoke tokens on logout.

Token lifetimes (QBO):
    Access token  — expires after 1 hour
    Refresh token — expires after 100 days (timer resets on every refresh)
"""

import json
import time
import secrets
import webbrowser
import threading
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional

import requests
from requests.auth import HTTPBasicAuth

from qbo import config


# =============================================================================
# TokenStore — wraps the raw token payload
# =============================================================================

class TokenStore:
    """
    Holds OAuth tokens in memory and knows how to read/write tokens.json.

    Fields in tokens.json:
        access_token   — bearer token sent on every API call
        refresh_token  — used to obtain a new access token
        realm_id       — QBO Company ID (part of every API URL)
        expires_at     — Unix timestamp when the access token expires
        token_type     — always "Bearer"
    """

    def __init__(self, data: dict):
        self.access_token  = data.get("access_token",  "")
        self.refresh_token = data.get("refresh_token", "")
        self.realm_id      = data.get("realm_id",      "")
        self.token_type    = data.get("token_type",    "Bearer")
        self.expires_at    = float(data.get("expires_at", 0))

    @property
    def is_expired(self) -> bool:
        """True when the access token has expired (60-second safety buffer)."""
        return time.time() >= (self.expires_at - 60)

    def to_dict(self) -> dict:
        return {
            "access_token":  self.access_token,
            "refresh_token": self.refresh_token,
            "realm_id":      self.realm_id,
            "token_type":    self.token_type,
            "expires_at":    self.expires_at,
        }

    def save(self) -> None:
        """Persist tokens to qbo/tokens.json on disk (best-effort — never raises)."""
        try:
            config.TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
            config.TOKEN_FILE.write_text(
                json.dumps(self.to_dict(), indent=2), encoding="utf-8"
            )
        except Exception:
            pass

    @classmethod
    def load(cls) -> Optional["TokenStore"]:
        """Load tokens from qbo/tokens.json. Returns None if not found."""
        if config.TOKEN_FILE.exists():
            try:
                data = json.loads(config.TOKEN_FILE.read_text(encoding="utf-8"))
                return cls(data)
            except Exception:
                pass
        return None

    @classmethod
    def delete(cls) -> None:
        """Delete tokens from disk (used on logout)."""
        config.TOKEN_FILE.unlink(missing_ok=True)


# =============================================================================
# Step 1 — Build the authorization URL
# =============================================================================

def get_authorization_url() -> str:
    """Construct and return the Intuit OAuth 2.0 authorization URL."""
    params = {
        "client_id":     config.CLIENT_ID,
        "response_type": "code",
        "scope":         config.SCOPES,
        "redirect_uri":  config.REDIRECT_URI,
        "state":         secrets.token_urlsafe(16),
    }
    return config.AUTHORIZATION_URL + "?" + urllib.parse.urlencode(params)


# =============================================================================
# Step 2 — Local callback server
# =============================================================================

# Shared between the HTTP handler thread and the main thread
_callback_result: dict = {}
_callback_event         = threading.Event()


class _CallbackHandler(BaseHTTPRequestHandler):
    """
    Minimal HTTP handler that parses the OAuth redirect from Intuit.

    Intuit will call:
        GET https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?code=...&realmId=...&state=...
    """

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self._html(404, "Not found")
            return

        qs = urllib.parse.parse_qs(parsed.query)

        if "error" in qs:
            _callback_result["error"] = qs["error"][0]
            self._html(
                400,
                "<h2 style='color:red'>Authorization failed</h2>"
                f"<p>{qs['error'][0]}</p><p>You can close this tab.</p>",
            )
        else:
            _callback_result["code"]     = qs.get("code",    [""])[0]
            _callback_result["realm_id"] = qs.get("realmId", [""])[0]
            _callback_result["state"]    = qs.get("state",   [""])[0]
            self._html(
                200,
                "<h2 style='color:green;font-family:sans-serif'>"
                "Authorization successful!</h2>"
                "<p style='font-family:sans-serif'>"
                "You can close this tab and return to the application.</p>",
            )

        _callback_event.set()

    def _html(self, status: int, body: str):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass   # suppress default server log lines


def _run_callback_server(timeout: int = 180) -> dict:
    """
    Start the local HTTP server and block until Intuit redirects back.
    Returns the parsed query-string dict or raises on timeout/error.
    """
    server = HTTPServer((config.CALLBACK_HOST, config.CALLBACK_PORT), _CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    received = _callback_event.wait(timeout=timeout)
    server.shutdown()

    if not received:
        raise TimeoutError(
            f"No callback received within {timeout}s. "
            "Did you complete authorization in the browser?"
        )
    if "error" in _callback_result:
        raise PermissionError(f"Intuit returned an error: {_callback_result['error']}")

    return _callback_result.copy()


def exchange_redirect_url(redirect_url: str) -> TokenStore:
    """
    Parse the redirect URL from the browser after Intuit authorization and
    exchange the authorization code for tokens.
    """
    parsed = urllib.parse.urlparse(redirect_url.strip())
    qs     = urllib.parse.parse_qs(parsed.query)

    if "error" in qs:
        raise PermissionError(f"Intuit returned an error: {qs['error'][0]}")

    code     = qs.get("code",    [""])[0]
    realm_id = qs.get("realmId", [""])[0]

    if not code:
        raise ValueError(
            "No authorization code found in the URL. "
            "Make sure you copied the full redirect URL from the browser."
        )

    return exchange_code_for_tokens(code, realm_id)


# =============================================================================
# Step 3 — Exchange code for tokens
# =============================================================================

def exchange_code_for_tokens(code: str, realm_id: str) -> TokenStore:
    """
    POST to Intuit's token endpoint and exchange the authorization code
    for access_token + refresh_token.

    Intuit requires HTTP Basic Auth (client_id:client_secret) on this call.
    """
    resp = requests.post(
        config.TOKEN_URL,
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": config.REDIRECT_URI,
        },
        auth=HTTPBasicAuth(config.CLIENT_ID, config.CLIENT_SECRET),
        headers={"Accept": "application/json"},
        timeout=30,
    )

    if not resp.ok:
        raise RuntimeError(
            f"Token exchange failed [{resp.status_code}]: {resp.text}"
        )

    data = resp.json()
    data["expires_at"] = time.time() + int(data.get("expires_in", 3600))
    data["realm_id"]   = realm_id

    store = TokenStore(data)
    store.save()
    return store


# =============================================================================
# Step 4 — Refresh access token
# =============================================================================

def refresh_access_token(store: TokenStore) -> TokenStore:
    """
    Use the refresh_token to obtain a new access_token.
    Called automatically by get_valid_token() when the access token is expired.
    """
    resp = requests.post(
        config.TOKEN_URL,
        data={
            "grant_type":    "refresh_token",
            "refresh_token": store.refresh_token,
        },
        auth=HTTPBasicAuth(config.CLIENT_ID, config.CLIENT_SECRET),
        headers={"Accept": "application/json"},
        timeout=30,
    )

    if not resp.ok:
        raise RuntimeError(
            f"Token refresh failed [{resp.status_code}]: {resp.text}\n"
            "Your refresh token may have expired — re-authenticate."
        )

    data = resp.json()
    updated = {
        **store.to_dict(),
        **data,
        "expires_at": time.time() + int(data.get("expires_in", 3600)),
    }
    new_store = TokenStore(updated)
    new_store.save()
    return new_store


# =============================================================================
# Primary public interface — call before every API request
# =============================================================================

def get_valid_token() -> TokenStore:
    """
    Load tokens from disk and auto-refresh if expired.

    Raises
    ------
    FileNotFoundError — if no tokens exist yet (need to authenticate first)
    RuntimeError      — if the refresh token is also expired
    """
    store = TokenStore.load()
    if store is None:
        raise FileNotFoundError(
            "No QBO tokens found. Authenticate first via the QBO Settings panel."
        )
    if store.is_expired:
        store = refresh_access_token(store)
    return store


def is_authenticated() -> bool:
    """Return True if a non-expired token exists on disk."""
    try:
        get_valid_token()
        return True
    except Exception:
        return False


# =============================================================================
# Full first-time authentication flow
# =============================================================================

def authenticate() -> TokenStore:
    """
    Run the complete OAuth 2.0 Authorization Code flow (manual redirect).

      1. Build the authorization URL and open it in the browser.
      2. User logs in and authorizes — Intuit redirects to the OAuth Playground.
      3. User copies the full redirect URL from the browser and pastes it here.
      4. Exchange the code for tokens and save them.
    """
    config.validate_credentials()

    auth_url = get_authorization_url()

    print("\n  Opening browser for Intuit authorization...")
    print(f"\n  If the browser does not open, visit this URL manually:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    print("  After you click 'Connect' in the browser, Intuit will redirect")
    print("  to a page that may show an error — that is normal.")
    print("  Copy the FULL URL from your browser address bar and paste it below.\n")

    redirect_url = input("  Paste the full redirect URL here: ").strip()
    return exchange_redirect_url(redirect_url)


# =============================================================================
# Revoke tokens (logout)
# =============================================================================

def revoke_tokens() -> dict[str, str]:
    """
    Revoke both tokens at Intuit and delete tokens.json.
    Returns a dict with revocation status per token type.
    """
    store = TokenStore.load()
    if store is None:
        return {"status": "no_tokens"}

    results = {}
    for label, token_value in [
        ("access_token", store.access_token),
        ("refresh_token", store.refresh_token),
    ]:
        resp = requests.post(
            config.REVOKE_URL,
            data={"token": token_value},
            auth=HTTPBasicAuth(config.CLIENT_ID, config.CLIENT_SECRET),
            headers={"Accept": "application/json"},
            timeout=30,
        )
        results[label] = "revoked" if resp.ok else f"error ({resp.status_code})"

    TokenStore.delete()
    results["status"] = "logged_out"
    return results
