import { useState, useEffect, useMemo, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import type { JERow } from '../api/api'
import { getActivityLog, downloadActivityLogUrl } from '../api/api'

export default function Step5ActivityLog() {
  const [rows, setRows] = useState<JERow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const gridRef = useRef<AgGridReact<JERow>>(null)

  useEffect(() => {
    fetchLog()
  }, [])

  async function fetchLog() {
    setLoading(true)
    try {
      const data = await getActivityLog()
      setRows(data.rows || [])
      setColumns(data.columns || [])
    } catch {
      setError('Could not load Activity Log.')
    } finally {
      setLoading(false)
    }
  }

  const colMinWidths: Record<string, number> = {
    'timestamp': 170,
    'user': 110,
    'ip address': 130,
    'hostname': 180,
    'action': 130,
    'input file': 210,
    'output file': 210,
    'journal number': 190,
    'changes made': 260,
  }

  const colDefs = useMemo((): ColDef<JERow>[] => {
    if (!columns.length) return []
    return columns.map((col) => {
      const key = col.toLowerCase()
      const isDetails = key.includes('detail')
      const minWidth = colMinWidths[key] ?? (isDetails ? 320 : 130)
      return {
        field: col,
        headerName: col,
        resizable: true,
        sortable: true,
        filter: true,
        minWidth,
        width: isDetails ? 380 : undefined,
        wrapText: true,
        autoHeight: true,
        cellStyle: { fontSize: '13px', whiteSpace: 'normal', lineHeight: '1.5', padding: '6px 8px' },
      }
    })
  }, [columns])

  const defaultColDef = useMemo(() => ({
    cellStyle: { fontSize: '13px' },
  }), [])

  function onFirstDataRendered() {
    gridRef.current?.api?.autoSizeAllColumns()
  }

  const total = rows.length
  const actionCol = columns.find((c) => c.toLowerCase().includes('action'))
  const generated = actionCol
    ? rows.filter((r) => /Generated|Regenerated/i.test(String(r[actionCol] ?? ''))).length
    : 0
  const posted = actionCol
    ? rows.filter((r) => /Posted/i.test(String(r[actionCol] ?? ''))).length
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
            <AgGridReact<JERow>
              ref={gridRef}
              rowData={rows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              pagination
              paginationPageSize={25}
              animateRows
              onFirstDataRendered={onFirstDataRendered}
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
