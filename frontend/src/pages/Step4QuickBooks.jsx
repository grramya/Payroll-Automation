import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { useApp } from '../context/AppContext'
import { getQBOStatus, startQBOAuth, completeQBOAuth, disconnectQBO } from '../api/api'

export default function Step4QuickBooks() {
  const navigate = useNavigate()
  const { sessionId, setLoading, loading, loadingMsg } = useApp()

  const [status, setStatus] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [apiError, setApiError] = useState('')
  const [msg, setMsg] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [showExchange, setShowExchange] = useState(false)

  useEffect(() => {
    fetchStatus()
  }, [])

  async function fetchStatus() {
    setLoading(true, 'Checking QuickBooks status…')
    try {
      const data = await getQBOStatus()
      setStatus(data)
    } catch (err) {
      setLoadErr('Could not check QuickBooks status.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    setApiError('')
    setLoading(true, 'Starting QuickBooks authorization…')
    try {
      const data = await startQBOAuth()
      // Open auth URL in new tab; user must copy the redirect URL back
      window.open(data.auth_url, '_blank', 'noopener,noreferrer')
      setShowExchange(true)
      setMsg('Authorization page opened. Complete sign-in, then paste the redirect URL below.')
    } catch (err) {
      setApiError(err.response?.data?.detail || 'Failed to start authorization.')
    } finally {
      setLoading(false)
    }
  }

  async function handleExchange() {
    if (!redirectUrl.trim()) {
      setApiError('Paste the redirect URL from QuickBooks.')
      return
    }
    setApiError('')
    setLoading(true, 'Exchanging tokens…')
    try {
      await completeQBOAuth(redirectUrl.trim())
      setMsg('Connected to QuickBooks successfully!')
      setShowExchange(false)
      setRedirectUrl('')
      await fetchStatus()
    } catch (err) {
      setApiError(err.response?.data?.detail || 'Token exchange failed. Check the URL and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect from QuickBooks? You will need to re-authorize to post JEs.')) return
    setApiError('')
    setLoading(true, 'Disconnecting…')
    try {
      await disconnectQBO()
      setMsg('Disconnected from QuickBooks.')
      await fetchStatus()
    } catch (err) {
      setApiError(err.response?.data?.detail || 'Disconnect failed.')
    } finally {
      setLoading(false)
    }
  }

  const backStep = sessionId ? 2 : 1

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="cloud_sync"
        title="QuickBooks Online Settings"
        subtitle="Connect your QBO company, manage OAuth tokens, and configure your Chart of Accounts and Vendor List."
        backStep={backStep}
        backLabel="Back to JE Preview"
      />

      {loadErr  && <Alert type="error">{loadErr}</Alert>}
      {apiError && <Alert type="error" onClose={() => setApiError('')}>{apiError}</Alert>}
      {msg      && <Alert type="success" onClose={() => setMsg('')}>{msg}</Alert>}

      {/* Credentials not configured */}
      {status && !status.creds_configured && (
        <Alert type="error">
          <strong>QBO credentials not configured.</strong> Copy <code>.env.example</code> → <code>.env</code> in
          the project root, fill in <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code>, then restart the
          backend server.
        </Alert>
      )}

      {/* Auth status card */}
      {status?.creds_configured && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 16 }}>Authentication</h2>

          <div className="qbo-status-row">
            <div className={`dot ${status.authenticated ? 'dot-green' : 'dot-gray'}`} />
            <div style={{ flex: 1 }}>
              {status.authenticated ? (
                <>
                  <strong>Connected</strong>
                  {status.realm_id && <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--muted)' }}>Realm ID: {status.realm_id}</span>}
                  {status.expires && (
                    <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--muted)' }}>
                      Expires: {new Date(status.expires).toLocaleString()}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--warn)' }}>Not connected to QuickBooks Online</span>
              )}
            </div>
            {status.authenticated ? (
              <button className="btn btn-danger btn-sm" onClick={handleDisconnect} disabled={loading}>
                <span className="material-icons-round">link_off</span>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={loading}>
                <span className="material-icons-round">link</span>
                Connect to QuickBooks
              </button>
            )}
          </div>

          {/* OAuth redirect URL exchange */}
          {showExchange && (
            <div style={{ marginTop: 16 }}>
              <Alert type="info">
                After signing in to QuickBooks, you will be redirected to a page — copy the full URL from
                your browser address bar and paste it below.
              </Alert>
              <label className="form-label" style={{ marginTop: 12 }}>Redirect URL</label>
              <input
                className="form-input"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?..."
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={handleExchange} disabled={loading}>
                  <span className="material-icons-round">check</span>
                  Complete Authorization
                </button>
                <button className="btn btn-secondary" onClick={() => setShowExchange(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>About QuickBooks Integration</h3>
        <ul style={{ paddingLeft: 20, fontSize: 13.5, lineHeight: 2, color: 'var(--muted)' }}>
          <li>Journal Entries are posted directly to your QBO company via the QBO REST API.</li>
          <li>OAuth access tokens expire after 1 hour and are automatically refreshed.</li>
          <li>OAuth refresh tokens expire after 100 days — reconnect if disconnected for long.</li>
          <li>To post a JE, go to <strong>Step 2 → Post to QuickBooks</strong>.</li>
          <li>
            Credentials are stored in <code>.env</code> — never commit this file to version control.
          </li>
        </ul>
      </div>
    </div>
  )
}
