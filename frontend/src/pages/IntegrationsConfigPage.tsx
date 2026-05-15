import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import type { FpaQBOStatus, QBOCompanyStatus } from '../api/api'
import { getFpaQBOStatus, getFpaQBOAuthUrl, disconnectFpaQBO } from '../api/api'

export default function IntegrationsConfigPage() {
  const [status, setStatus] = useState<FpaQBOStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function reload() {
    setLoading(true)
    getFpaQBOStatus()
      .then(setStatus)
      .catch(() => setError('Failed to load connection status.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  return (
    <div style={styles.page}>
      <PageHeader
        title="Integrations & Connections"
        subtitle="External services connected to this application"
        icon="cable"
      />

      {loading && <div style={{ marginTop: 32 }}><Spinner /></div>}
      {error && <div style={styles.errorMsg}>{error}</div>}

      {status && (
        <div style={styles.grid}>
          <div style={styles.card}>
            {/* Card header */}
            <div style={styles.cardHeader}>
              <div style={styles.iconWrap}>
                <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--p, #4f46e5)' }}>
                  cloud_sync
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={styles.cardName}>QuickBooks Online</div>
                <div style={styles.cardDesc}>
                  Syncs journal entries to QuickBooks.
                  {status.sandbox && <span style={styles.sandboxBadge}>Sandbox</span>}
                </div>
              </div>
            </div>

            {/* Per-company rows */}
            <div style={styles.companies}>
              <CompanyRow
                company={status.main}
                companyKey="main"
                onRefresh={reload}
              />
              <CompanyRow
                company={status.broker}
                companyKey="broker"
                onRefresh={reload}
                last
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CompanyRow ────────────────────────────────────────────────────────────────

function CompanyRow({
  company,
  companyKey,
  onRefresh,
  last,
}: {
  company: QBOCompanyStatus
  companyKey: 'main' | 'broker'
  onRefresh: () => void
  last?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const popupRef = useRef<Window | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const connected = company.connected



  async function handleConnect() {
    setMsg('')
    setBusy(true)
    try {
      const { auth_url } = await getFpaQBOAuthUrl(companyKey)
      const popup = window.open(auth_url, 'qbo_oauth', 'width=640,height=720,left=200,top=100,resizable=yes,scrollbars=yes')

      if (!popup || popup.closed) {
        setShowPaste(true)
        setMsg('Popup blocked — complete sign-in in the new tab, then paste the redirect URL below.')
        window.open(auth_url, '_blank', 'noopener,noreferrer')
        setBusy(false)
        return
      }

      popupRef.current = popup
      setMsg('Sign in to QuickBooks in the popup. This will update automatically when done.')

      pollRef.current = setInterval(async () => {
        if (!popupRef.current || popupRef.current.closed) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current  = null
          popupRef.current = null
          setMsg('')
          setBusy(false)
          onRefresh()
        }
      }, 500)
    } catch {
      setMsg('Failed to start QuickBooks authorization.')
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(`Disconnect ${company.company_name} from QuickBooks?`)) return
    setBusy(true)
    setMsg('')
    try {
      await disconnectFpaQBO(companyKey)
      onRefresh()
    } catch {
      setMsg('Disconnect failed. Please try again.')
      setBusy(false)
    }
  }

  async function handlePasteSubmit() {
    if (!pasteUrl.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const { http } = await import('../api/api') as any
      await http.post('/fpa/qbo-exchange-url', { redirect_url: pasteUrl, company: companyKey })
      setShowPaste(false)
      setPasteUrl('')
      onRefresh()
    } catch {
      setMsg('Token exchange failed. Check the URL and try again.')
      setBusy(false)
    }
  }

  return (
    <div style={{ ...styles.companyRow, ...(last ? { borderBottom: 'none' } : {}) }}>
      <div style={styles.companyLeft}>
        <span
          className="material-icons-round"
          style={{ fontSize: 16, color: connected ? '#16a34a' : '#9ca3af', marginTop: 2 }}
        >
          {connected ? 'check_circle' : 'radio_button_unchecked'}
        </span>
        <div>
          <div style={styles.companyName}>{company.company_name}</div>
          {connected && company.realm_id && (
            <div style={styles.meta}>Realm ID: {company.realm_id}</div>
          )}
          {msg && <div style={styles.msgText}>{msg}</div>}

          {/* Paste-mode fallback */}
          {showPaste && (
            <div style={styles.pasteWrap}>
              <input
                style={styles.pasteInput}
                placeholder="Paste redirect URL here…"
                value={pasteUrl}
                onChange={e => setPasteUrl(e.target.value)}
              />
              <button style={styles.pasteBtn} onClick={handlePasteSubmit} disabled={busy}>
                Submit
              </button>
              <button style={styles.cancelBtn} onClick={() => { setShowPaste(false); setPasteUrl('') }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={styles.actions}>
        {busy && <Spinner />}
        {!busy && connected && (
          <button style={styles.disconnectBtn} onClick={handleDisconnect}>
            <span className="material-icons-round" style={{ fontSize: 15 }}>link_off</span>
            Disconnect
          </button>
        )}
        {!busy && !connected && !showPaste && (
          <button style={styles.connectBtn} onClick={handleConnect}>
            <span className="material-icons-round" style={{ fontSize: 15 }}>link</span>
            Connect
          </button>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '24px 24px 48px',
  },
  grid: {
    marginTop: 24,
  },
  card: {
    background: 'var(--card-bg, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 10,
    padding: '20px 22px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: 'var(--sb-active-bg, #ede9fe)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text, #111)',
  },
  cardDesc: {
    fontSize: 12.5,
    color: 'var(--muted, #6b7280)',
    marginTop: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sandboxBadge: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    background: '#fef3c7',
    color: '#92400e',
    padding: '2px 6px',
    borderRadius: 4,
  },
  companies: {
    borderTop: '1px solid var(--border, #f3f4f6)',
    paddingTop: 4,
  },
  companyRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '14px 4px',
    borderBottom: '1px solid var(--border, #f3f4f6)',
    gap: 12,
  },
  companyLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  companyName: {
    fontSize: 13.5,
    fontWeight: 500,
    color: 'var(--text, #111)',
  },
  meta: {
    fontSize: 11.5,
    color: 'var(--muted, #9ca3af)',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  msgText: {
    fontSize: 12,
    color: 'var(--muted, #6b7280)',
    marginTop: 4,
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  connectBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    background: 'var(--p, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  disconnectBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    background: '#fff',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    cursor: 'pointer',
  },
  pasteWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap' as const,
  },
  pasteInput: {
    fontSize: 12,
    padding: '5px 8px',
    border: '1px solid var(--border, #d1d5db)',
    borderRadius: 5,
    width: 300,
    outline: 'none',
  },
  pasteBtn: {
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    background: 'var(--p, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '5px 10px',
    fontSize: 12,
    background: 'none',
    color: 'var(--muted, #6b7280)',
    border: '1px solid var(--border, #d1d5db)',
    borderRadius: 5,
    cursor: 'pointer',
  },
  errorMsg: {
    marginTop: 24,
    fontSize: 13,
    color: '#dc2626',
  },
}
