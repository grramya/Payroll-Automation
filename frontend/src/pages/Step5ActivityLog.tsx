import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import {
  FormControl, InputLabel, Select, MenuItem,
  TextField, Button, Box,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import type { Dayjs } from 'dayjs'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
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

const FIELD_SX = { minWidth: 180 }
const DATE_SX  = { minWidth: 170 }

export default function Step5ActivityLog() {
  const [rows,    setRows]    = useState<JERow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const gridRef = useRef<AgGridReact<JERow>>(null)

  // Filter state
  const [actionFilter,  setActionFilter]  = useState('')
  const [journalFilter, setJournalFilter] = useState('')
  const [dateFrom,      setDateFrom]      = useState<Dayjs | null>(null)
  const [dateTo,        setDateTo]        = useState<Dayjs | null>(null)

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
      date_from:      dateFrom?.isValid() ? dateFrom.format('YYYY-MM-DD') : undefined,
      date_to:        dateTo?.isValid()   ? dateTo.format('YYYY-MM-DD')   : undefined,
    })
  }

  function handleClear() {
    setActionFilter('')
    setJournalFilter('')
    setDateFrom(null)
    setDateTo(null)
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
      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={FIELD_SX}>
            <InputLabel id="action-filter-label" shrink>Action</InputLabel>
            <Select
              labelId="action-filter-label"
              value={actionFilter}
              label="Action"
              displayEmpty
              notched
              renderValue={(val) => val || 'All actions'}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              {ACTION_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>{opt || 'All actions'}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size="small"
            label="Journal #"
            placeholder="e.g. 2024-03"
            value={journalFilter}
            onChange={(e) => setJournalFilter(e.target.value)}
            sx={FIELD_SX}
          />

          <DatePicker
            label="From"
            value={dateFrom}
            onChange={setDateFrom}
            slotProps={{ textField: { size: 'small', sx: DATE_SX } }}
          />

          <DatePicker
            label="To"
            value={dateTo}
            onChange={setDateTo}
            slotProps={{ textField: { size: 'small', sx: DATE_SX } }}
          />

          <Button
            variant="contained"
            size="small"
            startIcon={<SearchIcon />}
            onClick={handleFilter}
            sx={{ height: 40, px: 2.5, background: 'linear-gradient(135deg,#400f61,#2d0a45)', '&:hover': { background: 'linear-gradient(135deg,#5a1a85,#400f61)' } }}
          >
            Filter
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<ClearIcon />}
            onClick={handleClear}
            sx={{ height: 40, px: 2.5 }}
          >
            Clear
          </Button>
        </Box>
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
