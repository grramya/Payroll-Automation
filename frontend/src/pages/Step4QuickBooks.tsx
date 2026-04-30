import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, CellContextMenuEvent, IRowNode } from 'ag-grid-community'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { useApp } from '../context/AppContext'
import type { QBOStatus, QBOTableData, JERow } from '../api/api'
import {
  getQBOStatus, startQBOAuth, completeQBOAuth, disconnectQBO,
  getQBOAccounts, saveQBOAccounts, syncQBOAccounts,
  getQBOVendors,  saveQBOVendors,  syncQBOVendors,
  getQBOClasses,  saveQBOClasses,  syncQBOClasses,
} from '../api/api'

// ── Types ──────────────────────────────────────────────────────────────────────
interface TableState {
  rows: JERow[]
  columns: string[]
  source: 'local' | 'qbo' | 'none'
  lastSynced: string | null
  syncSource: string | null
  loading: boolean
  syncing: boolean
  saving: boolean
  error: string
  saveMsg: string
}
const emptyTable = (): TableState => ({
  rows: [], columns: [], source: 'none',
  lastSynced: null, syncSource: null,
  loading: false, syncing: false, saving: false, error: '', saveMsg: '',
})

interface CtxMenu { x: number; y: number; node: IRowNode<JERow> }

// ── Helpers ────────────────────────────────────────────────────────────────────
const STALE_HOURS = 24

function formatSyncAge(isoStr: string | null): string {
  if (!isoStr) return ''
  const mins = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function isSyncStale(isoStr: string | null): boolean {
  if (!isoStr) return false
  return (Date.now() - new Date(isoStr).getTime()) / 3600000 > STALE_HOURS
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Step4QuickBooks() {
  const { sessionId, setLoading, loading, loadingMsg } = useApp()

  const [status,       setStatus]       = useState<QBOStatus | null>(null)
  const [loadErr,      setLoadErr]       = useState('')
  const [apiError,     setApiError]     = useState('')
  const [msg,          setMsg]          = useState('')
  const [redirectUrl,  setRedirectUrl]  = useState('')
  const [showExchange, setShowExchange] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showVendors,  setShowVendors]  = useState(false)
  const [showClasses,  setShowClasses]  = useState(false)
  const [accounts,     setAccounts]     = useState<TableState>(emptyTable())
  const [vendors,      setVendors]      = useState<TableState>(emptyTable())
  const [classes,      setClasses]      = useState<TableState>(emptyTable())

  // Map snake_case API fields to camelCase TableState
  function mapApiData(d: Record<string, unknown>): Partial<TableState> {
    return {
      rows: (d.rows as JERow[]) ?? [],
      columns: (d.columns as string[]) ?? [],
      source: (d.source as TableState['source']) ?? 'none',
      lastSynced: (d.last_synced as string | null) ?? null,
      syncSource: (d.sync_source as string | null) ?? null,
    }
  }

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    setLoading(true, 'Checking QuickBooks status…')
    try { setStatus(await getQBOStatus()) }
    catch { setLoadErr('Could not check QuickBooks status.') }
    finally { setLoading(false) }
  }

  // ── Auth actions ─────────────────────────────────────────────────────────────
  async function handleConnect() {
    setApiError('')
    setLoading(true, 'Starting QuickBooks authorization…')
    try {
      const d = await startQBOAuth()
      window.open(d.auth_url, '_blank', 'noopener,noreferrer')
      setShowExchange(true)
      setMsg('Authorization page opened. Complete sign-in, then paste the redirect URL below.')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setApiError(e.response?.data?.detail || 'Failed to start authorization.')
    } finally { setLoading(false) }
  }

  async function handleExchange() {
    if (!redirectUrl.trim()) { setApiError('Paste the redirect URL from QuickBooks.'); return }
    setApiError('')
    setLoading(true, 'Exchanging tokens…')
    try {
      await completeQBOAuth(redirectUrl.trim())
      setMsg('Connected to QuickBooks successfully!')
      setShowExchange(false); setRedirectUrl('')
      await fetchStatus()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setApiError(e.response?.data?.detail || 'Token exchange failed.')
    } finally { setLoading(false) }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect from QuickBooks? You will need to re-authorize to post JEs.')) return
    setApiError('')
    setLoading(true, 'Disconnecting…')
    try { await disconnectQBO(); setMsg('Disconnected.'); await fetchStatus() }
    catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setApiError(e.response?.data?.detail || 'Disconnect failed.')
    } finally { setLoading(false) }
  }

  // ── Accounts actions ─────────────────────────────────────────────────────────
  async function loadAccounts() {
    setAccounts(s => ({ ...s, loading: true, error: '' }))
    setShowAccounts(true)
    try {
      const d = await getQBOAccounts()
      setAccounts(s => ({ ...s, ...mapApiData(d), loading: false }))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setAccounts(s => ({ ...s, loading: false, error: e.response?.data?.detail || 'Failed to load.' }))
    }
  }

  async function syncAccounts() {
    setAccounts(s => ({ ...s, syncing: true, error: '' }))
    try {
      const d = await syncQBOAccounts()
      setAccounts(s => ({ ...s, ...mapApiData(d), syncing: false, saveMsg: 'Synced from QuickBooks.' }))
      setTimeout(() => setAccounts(s => ({ ...s, saveMsg: '' })), 3000)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setAccounts(s => ({ ...s, syncing: false, error: e.response?.data?.detail || 'Sync failed.' }))
    }
  }

  // ── Vendors actions ──────────────────────────────────────────────────────────
  async function loadVendors() {
    setVendors(s => ({ ...s, loading: true, error: '' }))
    setShowVendors(true)
    try {
      const d = await getQBOVendors()
      setVendors(s => ({ ...s, ...mapApiData(d), loading: false }))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setVendors(s => ({ ...s, loading: false, error: e.response?.data?.detail || 'Failed to load.' }))
    }
  }

  async function syncVendors() {
    setVendors(s => ({ ...s, syncing: true, error: '' }))
    try {
      const d = await syncQBOVendors()
      setVendors(s => ({ ...s, ...mapApiData(d), syncing: false, saveMsg: 'Synced from QuickBooks.' }))
      setTimeout(() => setVendors(s => ({ ...s, saveMsg: '' })), 3000)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setVendors(s => ({ ...s, syncing: false, error: e.response?.data?.detail || 'Sync failed.' }))
    }
  }

  // ── Classes actions ──────────────────────────────────────────────────────────
  async function loadClasses() {
    setClasses(s => ({ ...s, loading: true, error: '' }))
    setShowClasses(true)
    try {
      const d = await getQBOClasses()
      setClasses(s => ({ ...s, ...mapApiData(d), loading: false }))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setClasses(s => ({ ...s, loading: false, error: e.response?.data?.detail || 'Failed to load.' }))
    }
  }

  async function syncClasses() {
    setClasses(s => ({ ...s, syncing: true, error: '' }))
    try {
      const d = await syncQBOClasses()
      setClasses(s => ({ ...s, ...mapApiData(d), syncing: false, saveMsg: 'Synced from QuickBooks.' }))
      setTimeout(() => setClasses(s => ({ ...s, saveMsg: '' })), 3000)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setClasses(s => ({ ...s, syncing: false, error: e.response?.data?.detail || 'Sync failed.' }))
    }
  }

  const backStep = sessionId ? 2 : 1

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="cloud_sync"
        title="QuickBooks Online Settings"
        subtitle="Connect your QBO company, manage OAuth tokens, and edit your Chart of Accounts and Vendor List."
        backStep={backStep}
        backLabel="Back to JE Preview"
      />

      {loadErr  && <Alert type="error">{loadErr}</Alert>}
      {apiError && <Alert type="error" onClose={() => setApiError('')}>{apiError}</Alert>}
      {msg      && <Alert type="success" onClose={() => setMsg('')}>{msg}</Alert>}

      {status && !status.creds_configured && (
        <Alert type="error">
          <strong>QBO credentials not configured.</strong> Copy <code>.env.example</code> → <code>.env</code>,
          fill in <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code>, then restart the backend.
        </Alert>
      )}

      {/* ── Authentication ───────────────────────────────────────────────────── */}
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
                  {status.expires  && <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--muted)' }}>Expires: {new Date(status.expires).toLocaleString()}</span>}
                </>
              ) : (
                <span style={{ color: 'var(--warn)' }}>Not connected to QuickBooks Online</span>
              )}
            </div>
            {status.authenticated
              ? <button className="btn btn-danger btn-sm" onClick={handleDisconnect} disabled={loading}><span className="material-icons-round">link_off</span>Disconnect</button>
              : <button className="btn btn-primary btn-sm" onClick={handleConnect}   disabled={loading}><span className="material-icons-round">link</span>Connect to QuickBooks</button>
            }
          </div>

          {showExchange && (
            <div style={{ marginTop: 16 }}>
              <Alert type="info">After signing in to QuickBooks, copy the full redirect URL from your browser and paste it below.</Alert>
              <label className="form-label" style={{ marginTop: 12 }}>Redirect URL</label>
              <input className="form-input" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)}
                placeholder="https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?..." />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={handleExchange} disabled={loading}>
                  <span className="material-icons-round">check</span>Complete Authorization
                </button>
                <button className="btn btn-secondary" onClick={() => setShowExchange(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Chart of Accounts ────────────────────────────────────────────────── */}
      {status?.creds_configured && (
        <EditableQBOSection
          title="Chart of Accounts"
          icon="account_balance"
          hint="Account ID and Account Name are used when posting Journal Entries to QBO."
          show={showAccounts}
          state={accounts}
          onToggle={() => { if (!showAccounts) loadAccounts(); else setShowAccounts(false) }}
          onSync={syncAccounts}
          onSave={async (rows) => {
            setAccounts(s => ({ ...s, saving: true }))
            try {
              await saveQBOAccounts(rows)
              const now = new Date().toISOString()
              setAccounts(s => ({ ...s, rows, saving: false, saveMsg: 'Saved.', lastSynced: now, syncSource: 'manual' }))
              setTimeout(() => setAccounts(s => ({ ...s, saveMsg: '' })), 3000)
            } catch (err: unknown) {
              const e = err as { response?: { data?: { detail?: string } } }
              setAccounts(s => ({ ...s, saving: false, error: e.response?.data?.detail || 'Save failed.' }))
            }
          }}
          onAddRow={() => setAccounts(s => ({ ...s, rows: [...s.rows, Object.fromEntries(s.columns.map(c => [c, '']))] }))}
        />
      )}

      {/* ── Vendor List ──────────────────────────────────────────────────────── */}
      {status?.creds_configured && (
        <EditableQBOSection
          title="Vendor List"
          icon="store"
          hint="Vendor ID and Display Name are used to resolve AP lines when posting JEs."
          show={showVendors}
          state={vendors}
          onToggle={() => { if (!showVendors) loadVendors(); else setShowVendors(false) }}
          onSync={syncVendors}
          onSave={async (rows) => {
            setVendors(s => ({ ...s, saving: true }))
            try {
              await saveQBOVendors(rows)
              const now = new Date().toISOString()
              setVendors(s => ({ ...s, rows, saving: false, saveMsg: 'Saved.', lastSynced: now, syncSource: 'manual' }))
              setTimeout(() => setVendors(s => ({ ...s, saveMsg: '' })), 3000)
            } catch (err: unknown) {
              const e = err as { response?: { data?: { detail?: string } } }
              setVendors(s => ({ ...s, saving: false, error: e.response?.data?.detail || 'Save failed.' }))
            }
          }}
          onAddRow={() => setVendors(s => ({ ...s, rows: [...s.rows, Object.fromEntries(s.columns.map(c => [c, '']))] }))}
        />
      )}

      {/* ── Class List ──────────────────────────────────────────────────────── */}
      {status?.creds_configured && (
        <EditableQBOSection
          title="Class List"
          icon="category"
          hint="Classes are used to tag JE lines. Sync once to cache locally — avoids a live QBO call on every post."
          show={showClasses}
          state={classes}
          onToggle={() => { if (!showClasses) loadClasses(); else setShowClasses(false) }}
          onSync={syncClasses}
          onSave={async (rows) => {
            setClasses(s => ({ ...s, saving: true }))
            try {
              await saveQBOClasses(rows)
              const now = new Date().toISOString()
              setClasses(s => ({ ...s, rows, saving: false, saveMsg: 'Saved.', lastSynced: now, syncSource: 'manual' }))
              setTimeout(() => setClasses(s => ({ ...s, saveMsg: '' })), 3000)
            } catch (err: unknown) {
              const e = err as { response?: { data?: { detail?: string } } }
              setClasses(s => ({ ...s, saving: false, error: e.response?.data?.detail || 'Save failed.' }))
            }
          }}
          onAddRow={() => setClasses(s => ({ ...s, rows: [...s.rows, Object.fromEntries(s.columns.map(c => [c, '']))] }))}
        />
      )}

      {/* ── Info ─────────────────────────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>About QuickBooks Integration</h3>
        <ul style={{ paddingLeft: 20, fontSize: 13.5, lineHeight: 2, color: 'var(--muted)' }}>
          <li>Journal Entries are posted directly to your QBO company via the QBO REST API.</li>
          <li>OAuth access tokens expire after 1 hour and are automatically refreshed.</li>
          <li>OAuth refresh tokens expire after 100 days — reconnect if disconnected for long.</li>
          <li>To post a JE, go to <strong>Step 2 → Post to QuickBooks</strong>.</li>
          <li>Once synced, the local account/vendor/class lists are used during JE posting — no extra QBO calls needed.</li>
          <li>Credentials are stored in <code>.env</code> — never commit this file to version control.</li>
        </ul>
      </div>
    </div>
  )
}

// ── Editable section (AG Grid) ─────────────────────────────────────────────────

interface SectionProps {
  title: string
  icon: string
  hint: string
  show: boolean
  state: TableState
  onToggle: () => void
  onSync: () => void
  onSave: (rows: JERow[]) => Promise<void>
  onAddRow: () => void
}

function EditableQBOSection({ title, icon, hint, show, state, onToggle, onSync, onSave, onAddRow }: SectionProps) {
  const gridRef = useRef<AgGridReact<JERow>>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  useEffect(() => {
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const colDefs = useMemo((): ColDef<JERow>[] =>
    state.columns.map(col => ({
      field: col,
      headerName: col,
      editable: true,
      resizable: true,
      sortable: true,
      filter: true,
      minWidth: col.includes('Name') || col.includes('Account') ? 200 : 120,
      flex: col.includes('Name') || col.includes('Account') ? 1 : undefined,
    }))
  , [state.columns])

  const defaultColDef = useMemo(() => ({ cellStyle: { fontSize: '13px' } }), [])

  const handleContextMenu = useCallback((params: CellContextMenuEvent<JERow>) => {
    const e = params.event as MouseEvent | null
    if (!e) return
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, node: params.node })
  }, [])

  function handleDeleteRow() {
    if (ctxMenu?.node.data && gridRef.current) {
      gridRef.current.api.applyTransaction({ remove: [ctxMenu.node.data] })
    }
    setCtxMenu(null)
  }

  async function handleSave() {
    if (!gridRef.current) return
    const rows: JERow[] = []
    gridRef.current.api.forEachNode(node => { if (node.data) rows.push(node.data) })
    await onSave(rows)
  }

  const rowCount = state.rows.length

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {/* Header / toggle */}
      <div className="collapsible-header" onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="material-icons-round" style={{ color: 'var(--p)', fontSize: 22 }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {state.source === 'none' ? hint : (
                <>
                  <span>{rowCount} rows</span>
                  {state.lastSynced && (
                    <>
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span style={{
                        color: isSyncStale(state.lastSynced) ? '#D97706' : 'var(--muted)',
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        {isSyncStale(state.lastSynced) && (
                          <span className="material-icons-round" style={{ fontSize: 13 }}>warning</span>
                        )}
                        Last synced {formatSyncAge(state.lastSynced)}
                        {state.syncSource === 'qbo' ? ' from QBO' : ' (manual save)'}
                      </span>
                    </>
                  )}
                  {!state.lastSynced && (
                    <span style={{ color: 'var(--muted)' }}>
                      · {state.source === 'qbo' ? 'synced from QBO' : 'locally saved'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <span className="material-icons-round" style={{ fontSize: 20 }}>
          {show ? 'expand_less' : 'expand_more'}
        </span>
      </div>

      {/* Expanded content */}
      {show && (
        <div style={{ marginTop: 12 }}>
          {state.error   && <Alert type="error">{state.error}</Alert>}
          {state.saveMsg && <Alert type="success">{state.saveMsg}</Alert>}

          {state.loading ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <span className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>hourglass_empty</span>
              Loading…
            </div>
          ) : (
            <>
              {/* Action bar */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); onSync() }} disabled={state.syncing}>
                  <span className="material-icons-round">sync</span>
                  {state.syncing ? 'Syncing…' : 'Sync from QBO'}
                </button>
                {state.source === 'none' && (
                  <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>
                    No local data yet — click <strong>Sync from QBO</strong> to fetch.
                  </span>
                )}
              </div>

              {/* Grid */}
              {state.columns.length > 0 && (
                <div className="ag-theme-alpine" style={{ height: 400, width: '100%' }}>
                  <AgGridReact<JERow>
                    ref={gridRef}
                    rowData={state.rows}
                    columnDefs={colDefs}
                    defaultColDef={defaultColDef}
                    rowSelection="multiple"
                    stopEditingWhenCellsLoseFocus
                    animateRows
                    preventDefaultOnContextMenu
                    onCellContextMenu={handleContextMenu}
                  />
                </div>
              )}

              {/* Save button below grid */}
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button className="btn btn-primary" onClick={handleSave} disabled={state.saving}>
                  <span className="material-icons-round">save</span>
                  {state.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x,
            zIndex: 9999, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 160, overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--text)', fontFamily: 'inherit' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-light)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { onAddRow(); setCtxMenu(null) }}
          >
            <span className="material-icons-round" style={{ fontSize: 16 }}>add</span>
            Insert Row Below
          </button>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--err)', fontFamily: 'inherit' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--err-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={handleDeleteRow}
          >
            <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
            Delete Row
          </button>
        </div>
      )}
    </div>
  )
}
