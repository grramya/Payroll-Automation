import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { MetricCardsSkeleton, TableSkeleton } from '../components/SkeletonLoader'
import type { JERow, ActivityLogFilters } from '../api/api'
import { getActivityLog, downloadActivityLogUrl } from '../api/api'

const ACTION_OPTIONS = [
  '', 'JE Generated', 'JE Edited', 'JE Downloaded',
  'JE Posted to QBO', 'JE Regenerated', 'Mapping Updated',
]

export default function Step5ActivityLog() {
  const [rows,    setRows]    = useState<JERow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const gridRef = useRef<AgGridReact<JERow>>(null)

  // Filter state
  const [actionFilter,  setActionFilter]  = useState('')
  const [journalFilter, setJournalFilter] = useState('')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')

  const fetchLog = useCallback(async (filters?: ActivityLogFilters) => {
    setLoading(true)
    setError('')
    try {
      const data = await getActivityLog(filters)
      setRows(data.rows || [])
      setColumns(data.columns || [])
    } catch {
      setError('Could not load Activity Log.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLog() }, [fetchLog])

  function handleFilter() {
    fetchLog({
      action:         actionFilter  || undefined,
      journal_number: journalFilter || undefined,
      date_from:      dateFrom      || undefined,
      date_to:        dateTo        || undefined,
    })
  }

  function handleClear() {
    setActionFilter('')
    setJournalFilter('')
    setDateFrom('')
    setDateTo('')
    fetchLog()
  }

  const colMinWidths: Record<string, number> = {
    'timestamp': 170, 'user': 110, 'ip address': 130, 'hostname': 180,
    'action': 130, 'input file': 210, 'output file': 210,
    'journal number': 190, 'changes made': 260,
  }

  const colDefs = useMemo((): ColDef<JERow>[] => {
    if (!columns.length) return []
    return columns.map((col) => {
      const key       = col.toLowerCase()
      const isDetails = key.includes('detail')
      const minWidth  = colMinWidths[key] ?? (isDetails ? 320 : 130)
      return {
        field: col, headerName: col,
        resizable: true, sortable: true, filter: true,
        minWidth, width: isDetails ? 380 : undefined,
        wrapText: true, autoHeight: true,
        cellStyle: { fontSize: '13px', whiteSpace: 'normal', lineHeight: '1.5', padding: '6px 8px' },
      }
    })
  }, [columns])

  const defaultColDef = useMemo(() => ({ cellStyle: { fontSize: '13px' } }), [])

  const getRowId = useCallback((params: { data: JERow; rowIndex?: number }) =>
    String(params.rowIndex ?? 0), [])

  function onFirstDataRendered() {
    gridRef.current?.api?.autoSizeAllColumns()
  }

  const total     = rows.length
  const actionCol = columns.find((c) => c.toLowerCase().includes('action'))
  const generated = actionCol ? rows.filter((r) => /Generated|Regenerated/i.test(String(r[actionCol] ?? ''))).length : 0
  const posted    = actionCol ? rows.filter((r) => /Posted/i.test(String(r[actionCol] ?? ''))).length : 0

  // Initial load: show skeleton layout. Subsequent filter-reloads show spinner overlay.
  if (loading && rows.length === 0 && !error) {
    return (
      <div>
        <PageHeader
          icon="history"
          title="Activity Log"
          subtitle="Full audit trail of all Journal Entry generations, edits, downloads, and QuickBooks posts."
        />
        <MetricCardsSkeleton />
        <div style={{ marginTop: 20 }}>
          <TableSkeleton rows={8} cols={6} />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Spinner only for subsequent re-fetches (filter changes), not initial load */}
      {loading && rows.length > 0 && <Spinner label="Filtering…" />}

      <PageHeader
        icon="history"
        title="Activity Log"
        subtitle="Full audit trail of all Journal Entry generations, edits, downloads, and QuickBooks posts."
      />

      {error && <Alert type="error">{error}</Alert>}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Action</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt || 'All actions'}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Journal #</label>
          <input
            type="text"
            placeholder="e.g. 2024-03"
            value={journalFilter}
            onChange={(e) => setJournalFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, width: 140 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
          />
        </div>

        <button className="btn btn-primary" onClick={handleFilter} style={{ height: 36 }}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>search</span>
          Filter
        </button>
        <button className="btn btn-secondary" onClick={handleClear} style={{ height: 36 }}>
          Clear
        </button>
      </div>

      {rows.length === 0 && !loading && !error ? (
        <Alert type="info">
          No activity recorded yet. Generate your first Journal Entry to start the log.
        </Alert>
      ) : (
        <>
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
            {total} {total === 1 ? 'entry' : 'entries'} — newest first · read-only
          </div>

          <div className="ag-theme-alpine" style={{ height: 520, width: '100%', marginBottom: 20 }}>
            <AgGridReact<JERow>
              ref={gridRef}
              rowData={rows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              getRowId={getRowId}
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
