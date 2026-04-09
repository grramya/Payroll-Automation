import { useState, useEffect, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { getActivityLog, downloadActivityLogUrl } from '../api/api'

export default function Step5ActivityLog() {
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchLog()
  }, [])

  async function fetchLog() {
    setLoading(true)
    try {
      const data = await getActivityLog()
      setRows(data.rows || [])
      setColumns(data.columns || [])
    } catch (err) {
      setError('Could not load Activity Log.')
    } finally {
      setLoading(false)
    }
  }

  const colDefs = useMemo(() => {
    if (!columns.length) return []
    return columns.map((col) => ({
      field: col,
      headerName: col,
      resizable: true,
      sortable: true,
      filter: true,
      flex: col.toLowerCase().includes('detail') ? 2 : 1,
      minWidth: 110,
    }))
  }, [columns])

  const defaultColDef = useMemo(() => ({
    cellStyle: { fontSize: '13px' },
  }), [])

  // Compute metrics
  const total = rows.length
  const actionCol = columns.find((c) => c.toLowerCase().includes('action'))
  const generated = actionCol
    ? rows.filter((r) => /Generated|Regenerated/i.test(r[actionCol] || '')).length
    : 0
  const posted = actionCol
    ? rows.filter((r) => /Posted/i.test(r[actionCol] || '')).length
    : 0

  return (
    <div>
      {loading && <Spinner label="Loading Activity Log…" />}

      <PageHeader
        icon="history"
        title="Activity Log"
        subtitle="Full audit trail of all Journal Entry generations, edits, downloads, and QuickBooks posts."
      />

      {error && <Alert type="error">{error}</Alert>}

      {rows.length === 0 && !loading && !error ? (
        <Alert type="info">
          No activity recorded yet. Generate your first Journal Entry to start the log.
        </Alert>
      ) : (
        <>
          {/* Metrics */}
          <div className="metric-row">
            <div className="metric-card">
              <div className="metric-value">{total}</div>
              <div className="metric-label">Total Actions</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{generated}</div>
              <div className="metric-label">JEs Generated</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{posted}</div>
              <div className="metric-label">Posted to QBO</div>
            </div>
          </div>

          <hr className="divider" />

          <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--muted)' }}>
            {total} entries — newest first · read-only
          </div>

          {/* Table */}
          <div className="ag-theme-alpine" style={{ height: 520, width: '100%', marginBottom: 20 }}>
            <AgGridReact
              rowData={rows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              pagination
              paginationPageSize={25}
              animateRows
            />
          </div>

          <hr className="divider" />

          <a
            href={downloadActivityLogUrl()}
            download="Activity_Log.xlsx"
            className="btn btn-primary"
            style={{ display: 'inline-flex' }}
          >
            <span className="material-icons-round">download</span>
            Download Activity Log (Excel)
          </a>
        </>
      )}
    </div>
  )
}
