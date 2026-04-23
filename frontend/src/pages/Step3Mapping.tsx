import type { CSSProperties } from 'react'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, CellContextMenuEvent, IRowNode } from 'ag-grid-community'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { useApp } from '../context/AppContext'
import type { JERow } from '../api/api'
import { getMapping, saveMapping, regenerateJE } from '../api/api'

const MAP_COLUMNS = [
  'Pay Item', 'COGS GL Account', 'Indirect GL Account',
  'COGS ID', 'Indirect ID', '_col5', 'Department', 'Allocation', 'Notes',
]

interface CtxMenu {
  x: number
  y: number
  node: IRowNode<JERow>
}

export default function Step3Mapping() {
  const navigate = useNavigate()
  const {
    sessionId, unmappedCols, setJEData, setLoading, loading, loadingMsg,
  } = useApp()

  const [rows, setRows] = useState<JERow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [apiError, setApiError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const gridRef = useRef<AgGridReact<JERow>>(null)

  // Close context menu on any outside click
  useEffect(() => {
    function close() { setCtxMenu(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    loadMappingData()
  }, [])

  async function loadMappingData() {
    setLoading(true, 'Loading mapping…')
    try {
      const data = await getMapping()
      setRows(data.rows || [])
      setColumns(data.columns || MAP_COLUMNS)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setLoadErr(axiosErr.response?.data?.detail || 'Failed to load mapping file.')
    } finally {
      setLoading(false)
    }
  }

  const colDefs = useMemo((): ColDef<JERow>[] => {
    if (!columns.length) return []
    return columns.map((col) => ({
      field: col,
      headerName: col === '_col5' ? '' : col,
      editable: true,
      resizable: true,
      minWidth: col === '_col5' ? 60 : col.length > 20 ? 180 : 140,
      flex: col === 'Pay Item' || col.includes('GL Account') ? 1 : undefined,
    }))
  }, [columns])

  const defaultColDef = useMemo(() => ({
    cellStyle: { fontSize: '13px' },
  }), [])

  async function handleSave() {
    if (!gridRef.current) return
    const currentRows: JERow[] = []
    gridRef.current.api.forEachNode((node) => { if (node.data) currentRows.push(node.data) })
    setLoading(true, 'Saving mapping…')
    setApiError('')
    try {
      await saveMapping(currentRows)
      setRows(currentRows)
      setSaveMsg('Mapping saved. Click "Regenerate JE" to apply the updated mapping.')
      setTimeout(() => setSaveMsg(''), 5000)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setApiError(axiosErr.response?.data?.detail || 'Failed to save mapping.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerate() {
    if (!sessionId) {
      setApiError('No active session. Please generate a JE first (Step 1).')
      return
    }
    setApiError('')
    setLoading(true, 'Regenerating Journal Entry with updated mapping…')
    try {
      const result = await regenerateJE(sessionId)
      setJEData({
        jeRows: result.je_rows,
        jeColumns: result.columns,
        summary: result.summary,
        jeProvision: result.je_provision,
        unmappedCols: result.unmapped_cols || [],
        naMappedCols: result.na_mapped_cols || [],
      })
      navigate('/step/2')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setApiError(axiosErr.response?.data?.detail || 'Regeneration failed.')
    } finally {
      setLoading(false)
    }
  }

  function handleAddRow() {
    const newRow = Object.fromEntries(columns.map((c) => [c, '']))
    if (gridRef.current) {
      gridRef.current.api.applyTransaction({ add: [newRow] })
    }
  }

  const handleCellContextMenu = useCallback((params: CellContextMenuEvent<JERow>) => {
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

  const backStep = sessionId ? 2 : 1

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="edit_note"
        title="Edit Mapping File"
        subtitle="Add or update column mappings. Each row defines the GL account for a payroll column. Use NA to skip a column."
        backStep={backStep}
        backLabel="Back"
      />

      {loadErr && <Alert type="error">{loadErr}</Alert>}
      {apiError && <Alert type="error" onClose={() => setApiError('')}>{apiError}</Alert>}
      {saveMsg  && <Alert type="success">{saveMsg}</Alert>}

      {unmappedCols.length > 0 && (
        <Alert type="info">
          <strong>Columns that need mapping:</strong>{' '}
          {unmappedCols.join('  ·  ')}
          <br />
          Add a row for each one with the correct COGS and Indirect GL accounts.
        </Alert>
      )}

      <div style={fullscreen ? fsStyles.overlay : {}}>
        {fullscreen && (
          <div style={fsStyles.topBar}>
            <span style={fsStyles.topBarTitle}>Edit Mapping File</span>
            <button className="btn btn-sm btn-secondary" onClick={() => setFullscreen(false)}>
              <span className="material-icons-round">fullscreen_exit</span>
              Exit Fullscreen
            </button>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12, ...(fullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' } : {}) }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              Pay Item = column name from the payroll file (must match exactly) ·
              COGS/Indirect GL Account = GL account name ·
              COGS/Indirect ID = QBO Account ID
            </span>
            {!fullscreen && (
              <button className="btn btn-sm btn-secondary" style={{ flexShrink: 0, padding: '4px 8px' }} onClick={() => setFullscreen(true)} title="Expand table">
                <span className="material-icons-round" style={{ fontSize: 16 }}>fullscreen</span>
              </button>
            )}
          </div>
          <div className="ag-theme-alpine" style={{ height: fullscreen ? '100%' : 500, width: '100%', flex: fullscreen ? 1 : undefined }}>
            <AgGridReact<JERow>
              ref={gridRef}
              rowData={rows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              rowSelection="multiple"
              stopEditingWhenCellsLoseFocus
              animateRows
              preventDefaultOnContextMenu
              onCellContextMenu={handleCellContextMenu}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            <span className="material-icons-round">save</span>
            Save Mapping
          </button>
          {sessionId && (
            <button className="btn btn-secondary" onClick={handleRegenerate} disabled={loading}>
              <span className="material-icons-round">refresh</span>
              Regenerate JE with Updated Mapping
            </button>
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 9999,
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.12)',
            minWidth: 160,
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: '#b71c1c', fontFamily: 'inherit' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ffebee')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={handleDeleteRow}
          >
            Delete Row
          </button>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--text)', fontFamily: 'inherit' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-light)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { handleAddRow(); setCtxMenu(null) }}
          >
            <span className="material-icons-round" style={{ fontSize: 16 }}>add</span>
            Insert Row Below
          </button>
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
