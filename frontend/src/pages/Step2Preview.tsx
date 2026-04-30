import type { CSSProperties } from 'react'
import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { useApp } from '../context/AppContext'
import type { JERow, QBOPostResult } from '../api/api'
import { saveJE, downloadJEUrl, postToQBO } from '../api/api'

export default function Step2Preview() {
  const navigate = useNavigate()
  const {
    sessionId, jeRows, jeColumns,
    summary, payrollGt, jeProvision,
    unmappedCols, naMappedCols, deptSummary,
    updateJERows, updateProvision, setLoading, loading, loadingMsg,
  } = useApp()

  const [apiError, setApiError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [qboResult, setQboResult] = useState<QBOPostResult | null>(null)
  const [showDeptSummary, setShowDeptSummary] = useState(false)
  const [showNaMapped, setShowNaMapped] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showQboConfirm, setShowQboConfirm] = useState(false)
  const gridRef = useRef<AgGridReact<JERow>>(null)

  if (!sessionId) {
    return (
      <div>
        <PageHeader icon="table_view" title="Journal Entry Preview" />
        <Alert type="info">No Journal Entry generated yet. <button className="back-link" onClick={() => navigate('/step/1')}>Go to Step 1</button></Alert>
      </div>
    )
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const colDefs = useMemo((): ColDef<JERow>[] => {
    if (!jeColumns.length) return []
    const NON_EDITABLE = new Set(['Post?', 'Journal Number', 'Entry Date'])
    return jeColumns.map((col) => ({
      field: col,
      headerName: col,
      editable: !NON_EDITABLE.has(col),
      resizable: true,
      sortable: true,
      filter: true,
      minWidth: col.length > 20 ? 180 : 130,
      flex: col === 'Journal Description' ? 2 : undefined,
    }))
  }, [jeColumns])

  const defaultColDef = useMemo(() => ({
    cellStyle: { fontSize: '13px' },
  }), [])

  // ── Save edits ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!gridRef.current) return
    const rows: JERow[] = []
    gridRef.current.api.forEachNode((node) => { if (node.data) rows.push(node.data) })
    setLoading(true, 'Saving edits…')
    try {
      const result = await saveJE(sessionId, rows)
      updateJERows(rows)
      if (result.je_provision != null) updateProvision(result.je_provision)
      setSaveMsg('Changes saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setApiError(axiosErr.response?.data?.detail || 'Save failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Download ──────────────────────────────────────────────────────────────
  function handleDownload() {
    window.location.href = downloadJEUrl(sessionId)
  }

  // ── Post to QBO ───────────────────────────────────────────────────────────
  async function confirmPostQBO() {
    setShowQboConfirm(false)
    setApiError('')
    setQboResult(null)
    setLoading(true, 'Posting to QuickBooks…')
    try {
      const result = await postToQBO(sessionId)
      setQboResult(result)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const detail = axiosErr.response?.data?.detail
      if (axiosErr.response?.status === 401) {
        setApiError('Not authenticated with QuickBooks. Go to Step 4 to connect.')
      } else {
        setApiError(typeof detail === 'string' ? detail : 'Failed to post to QuickBooks.')
      }
    } finally {
      setLoading(false)
    }
  }

  const diff = payrollGt != null ? Math.abs(payrollGt - (jeProvision ?? 0)) : null

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="table_view"
        title="Journal Entry Preview"
        subtitle="Review, edit inline, download your Journal Entry, and post it to QuickBooks."
        backStep={1}
        backLabel="Back to Upload"
      />

      {apiError && <Alert type="error" onClose={() => setApiError('')}>{apiError}</Alert>}
      {saveMsg  && <Alert type="success">{saveMsg}</Alert>}

      {/* Summary */}
      {summary && (
        <Alert type="success">
          Journal Entry generated — <strong>{summary.total} lines</strong>{' '}
          ({summary.regular} dept-level + {summary.special} employee-level + 1 provision)
        </Alert>
      )}

      {/* Grand total validation */}
      {payrollGt != null && (
        diff != null && diff < 0.02 ? (
          <Alert type="success">
            Grand total matched — Payroll: {payrollGt.toLocaleString('en-US', { minimumFractionDigits: 2 })}&nbsp;
            | JE Provision: {jeProvision?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Alert>
        ) : (
          <Alert type="error">
            Grand total mismatch — Payroll: {payrollGt.toLocaleString('en-US', { minimumFractionDigits: 2 })}&nbsp;
            | JE Provision: {jeProvision?.toLocaleString('en-US', { minimumFractionDigits: 2 })}&nbsp;
            | Difference: {diff?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Alert>
        )
      )}

      {/* Unmapped columns warning */}
      {unmappedCols.length > 0 && (
        <Alert type="warn">
          <strong>{unmappedCols.length} column(s)</strong> in the payroll file have no mapping and were skipped:{' '}
          {unmappedCols.map((c, i) => (
            <span key={c}>{i > 0 && ', '}<code style={{ background: '#fff3e0', padding: '0 4px', borderRadius: 3 }}>{c}</code></span>
          ))}
          <br />
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => navigate('/step/3')}
          >
            Edit Mapping File
          </button>
        </Alert>
      )}

      {/* NA-mapped collapsible */}
      {naMappedCols.length > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 16px' }}>
          <div className="collapsible-header" onClick={() => setShowNaMapped((v) => !v)}>
            <span style={{ fontSize: 13 }}>
              Columns intentionally skipped (mapped as NA): {naMappedCols.length}
            </span>
            <span className="material-icons-round" style={{ fontSize: 18 }}>
              {showNaMapped ? 'expand_less' : 'expand_more'}
            </span>
          </div>
          {showNaMapped && (
            <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 13, color: 'var(--muted)' }}>
              {naMappedCols.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Department summary collapsible */}
      {deptSummary.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px' }}>
          <div className="collapsible-header" onClick={() => setShowDeptSummary((v) => !v)}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Department Summary</span>
            <span className="material-icons-round" style={{ fontSize: 18 }}>
              {showDeptSummary ? 'expand_less' : 'expand_more'}
            </span>
          </div>
          {showDeptSummary && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--p-light)', color: 'var(--p)' }}>
                  {deptSummary[0] && Object.keys(deptSummary[0]).map((k) => (
                    <th key={k} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deptSummary.map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    {Object.values(row).map((v, j) => (
                      <td key={j} style={{ padding: '6px 10px' }}>{v != null ? String(v) : ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* QBO post result */}
      {qboResult && (
        <Alert type="success">
          Posted to QuickBooks — ID: <strong>{qboResult.id}</strong>, Doc#: <strong>{qboResult.doc_number}</strong>
        </Alert>
      )}

      {/* AG Grid editable table */}
      <div style={fullscreen ? fsStyles.overlay : {}}>
        {fullscreen && (
          <div style={fsStyles.topBar}>
            <span style={fsStyles.topBarTitle}>Journal Entry Preview</span>
            <button className="btn btn-sm btn-secondary" onClick={() => setFullscreen(false)}>
              <span className="material-icons-round">fullscreen_exit</span>
              Exit Fullscreen
            </button>
          </div>
        )}

        <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden', ...(fullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' } : {}) }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Click any cell to edit · Changes are saved when you click Save</span>
            {!fullscreen && (
              <button className="btn btn-sm btn-secondary" style={{ flexShrink: 0, padding: '4px 8px' }} onClick={() => setFullscreen(true)} title="Expand table">
                <span className="material-icons-round" style={{ fontSize: 16 }}>fullscreen</span>
              </button>
            )}
          </div>
          <div className="ag-theme-alpine" style={{ height: fullscreen ? '100%' : 520, width: '100%', flex: fullscreen ? 1 : undefined }}>
            <AgGridReact<JERow>
              ref={gridRef}
              rowData={jeRows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              rowSelection="multiple"
              stopEditingWhenCellsLoseFocus
              undoRedoCellEditing
              undoRedoCellEditingLimit={20}
              animateRows
            />
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            <span className="material-icons-round">save</span>
            Save Edits
          </button>
          <button className="btn btn-secondary" onClick={handleDownload}>
            <span className="material-icons-round">download</span>
            Download Excel
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/step/3')}>
            <span className="material-icons-round">edit_note</span>
            Edit Mapping
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowQboConfirm(true)}
            disabled={loading}
            style={{ marginLeft: 'auto' }}
          >
            <span className="material-icons-round">cloud_upload</span>
            Post to QuickBooks
          </button>
        </div>
      </div>

      {/* Confirmation modal — Post to QuickBooks */}
      {showQboConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 12,
            padding: '28px 32px', maxWidth: 440, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span className="material-icons-round" style={{ color: 'var(--warn)', fontSize: 28 }}>warning</span>
              <h3 style={{ margin: 0, fontSize: 17 }}>Post to QuickBooks?</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 8 }}>
              This will create a <strong>permanent Journal Entry</strong> in your QuickBooks Online company:
            </p>
            <ul style={{ fontSize: 13.5, color: 'var(--text)', paddingLeft: 20, marginBottom: 20, lineHeight: 1.8 }}>
              <li>Journal: <strong>{jeRows[0]?.['Journal Number'] ?? '—'}</strong></li>
              <li>Lines: <strong>{jeRows.length}</strong></li>
            </ul>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              Once posted, the entry can only be deleted directly in QuickBooks. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowQboConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmPostQBO}>
                <span className="material-icons-round">cloud_upload</span>
                Yes, Post to QuickBooks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const fsStyles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 20px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: '#400f61',
  },
}
