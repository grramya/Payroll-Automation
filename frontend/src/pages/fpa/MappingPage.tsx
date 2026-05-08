import type { CSSProperties } from 'react'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, CellContextMenuEvent, IRowNode } from 'ag-grid-community'
import PageHeader from '../../components/PageHeader'
import Spinner from '../../components/Spinner'
import Alert from '../../components/Alert'
import {
  getFpaAccountMap, saveFpaAccountMap,
  getFpaDeptMap, saveFpaDeptMap,
} from '../../api/api'
import type { FpaAccountRow, FpaDeptRow } from '../../api/api'

type Tab = 'accounts' | 'dept'

interface CtxMenu<T> {
  x: number
  y: number
  node: IRowNode<T>
}

const ACCT_COLUMNS: ColDef<FpaAccountRow>[] = [
  { field: 'account_name',        headerName: 'Account Name',        editable: true, flex: 2, minWidth: 280 },
  { field: 'financial_statement', headerName: 'Financial Statement', editable: true, flex: 1, minWidth: 140 },
  { field: 'main_grouping',       headerName: 'Main Grouping',       editable: true, flex: 1, minWidth: 140 },
  { field: 'secondary_grouping',  headerName: 'Secondary Grouping',  editable: true, flex: 1, minWidth: 160 },
  { field: 'classification',      headerName: 'Classification',      editable: true, flex: 1, minWidth: 180 },
]

const DEPT_COLUMNS: ColDef<FpaDeptRow>[] = [
  { field: 'account_name',     headerName: 'Account Name',      editable: true, flex: 2, minWidth: 280 },
  { field: 'dept_class',       headerName: 'Dept Class',        editable: true, flex: 1, minWidth: 160 },
  { field: 'classification_2', headerName: 'Classification 2',  editable: true, flex: 1, minWidth: 160 },
  { field: 'classification_3', headerName: 'Classification 3',  editable: true, flex: 1, minWidth: 180 },
  { field: 'department',       headerName: 'Department',        editable: true, flex: 1, minWidth: 140 },
  { field: 'dept_group_bd',    headerName: 'Dept Group (BD)',   editable: true, flex: 1, minWidth: 150 },
]

const EMPTY_ACCT: FpaAccountRow = {
  account_name: '', financial_statement: null,
  main_grouping: null, secondary_grouping: null, classification: null,
}
const EMPTY_DEPT: FpaDeptRow = {
  account_name: '', dept_class: null,
  classification_2: null, classification_3: null,
  department: null, dept_group_bd: null,
}

export default function FpaMappingPage() {
  const [tab, setTab] = useState<Tab>('accounts')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [error, setError] = useState('')

  const [acctRows, setAcctRows] = useState<FpaAccountRow[]>([])
  const [deptRows, setDeptRows] = useState<FpaDeptRow[]>([])

  const [fullscreen, setFullscreen] = useState(false)
  const [ctxAcct, setCtxAcct] = useState<CtxMenu<FpaAccountRow> | null>(null)
  const [ctxDept, setCtxDept] = useState<CtxMenu<FpaDeptRow> | null>(null)

  const acctGridRef = useRef<AgGridReact<FpaAccountRow>>(null)
  const deptGridRef = useRef<AgGridReact<FpaDeptRow>>(null)

  const defaultColDef = useMemo(() => ({
    cellStyle: { fontSize: '13px' },
    resizable: true,
  }), [])

  useEffect(() => {
    function close() { setCtxAcct(null); setCtxDept(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setLoadingMsg('Loading mappings…')
    try {
      const [a, d] = await Promise.all([getFpaAccountMap(), getFpaDeptMap()])
      setAcctRows(a)
      setDeptRows(d)
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } }; message?: string }
      const detail = ax.response?.data?.detail || ax.message || String(err)
      setError(`Failed to load mapping data (${ax.response?.status ?? 'network'}): ${detail}`)
    } finally {
      setLoading(false)
    }
  }

  function flashSave(msg: string) {
    setSaveMsg(msg)
    setTimeout(() => setSaveMsg(''), 5000)
  }

  async function handleSaveAccounts() {
    if (!acctGridRef.current) return
    const current: FpaAccountRow[] = []
    acctGridRef.current.api.forEachNode((node) => { if (node.data) current.push(node.data) })
    setLoading(true); setLoadingMsg('Saving account map…'); setError('')
    try {
      await saveFpaAccountMap(current)
      setAcctRows(current)
      flashSave('Account mapping saved and reloaded into the transform engine.')
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      setError(ax.response?.data?.detail || 'Failed to save account map.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveDept() {
    if (!deptGridRef.current) return
    const current: FpaDeptRow[] = []
    deptGridRef.current.api.forEachNode((node) => { if (node.data) current.push(node.data) })
    setLoading(true); setLoadingMsg('Saving department map…'); setError('')
    try {
      await saveFpaDeptMap(current)
      setDeptRows(current)
      flashSave('Department mapping saved and reloaded into the transform engine.')
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      setError(ax.response?.data?.detail || 'Failed to save department map.')
    } finally {
      setLoading(false)
    }
  }

  const handleCtxAcct = useCallback((params: CellContextMenuEvent<FpaAccountRow>) => {
    const e = params.event as MouseEvent | null
    if (!e) return
    e.preventDefault()
    setCtxAcct({ x: e.clientX, y: e.clientY, node: params.node })
  }, [])

  const handleCtxDept = useCallback((params: CellContextMenuEvent<FpaDeptRow>) => {
    const e = params.event as MouseEvent | null
    if (!e) return
    e.preventDefault()
    setCtxDept({ x: e.clientX, y: e.clientY, node: params.node })
  }, [])

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="table_chart"
        title="FP&A Mapping Tables"
        subtitle="Edit account and department mapping rules used during the FP&A transform. Changes are applied immediately on save."
      />

      {error   && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {saveMsg && <Alert type="success">{saveMsg}</Alert>}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['accounts', 'dept'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '7px 18px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: tab === t ? 'var(--p)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text)',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            {t === 'accounts' ? 'Account Map' : 'Department Map'}
          </button>
        ))}
      </div>

      {/* Account Map tab */}
      {tab === 'accounts' && (
        <div style={fullscreen ? fsStyles.overlay : {}}>
          {fullscreen && (
            <div style={fsStyles.topBar}>
              <span style={fsStyles.topBarTitle}>Account Map</span>
              <button className="btn btn-sm btn-secondary" onClick={() => setFullscreen(false)}>
                <span className="material-icons-round">fullscreen_exit</span>
                Exit Fullscreen
              </button>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12, ...(fullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' } : {}) }}>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>
                Account Name = exact GL account name from QBO · Financial Statement = Balance Sheet or P&L · Main / Secondary Grouping = hierarchy grouping labels · Classification = line item label
              </span>
              {!fullscreen && (
                <button className="btn btn-sm btn-secondary" style={{ flexShrink: 0, padding: '4px 8px' }} onClick={() => setFullscreen(true)} title="Expand table">
                  <span className="material-icons-round" style={{ fontSize: 16 }}>fullscreen</span>
                </button>
              )}
            </div>
            <div className="ag-theme-alpine" style={{ height: fullscreen ? '100%' : 500, width: '100%', flex: fullscreen ? 1 : undefined }}>
              <AgGridReact<FpaAccountRow>
                ref={acctGridRef}
                rowData={acctRows}
                columnDefs={ACCT_COLUMNS}
                defaultColDef={defaultColDef}
                rowSelection="multiple"
                stopEditingWhenCellsLoseFocus
                animateRows
                preventDefaultOnContextMenu
                onCellContextMenu={handleCtxAcct}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleSaveAccounts} disabled={loading}>
              <span className="material-icons-round">save</span>
              Save Account Map
            </button>
            <button className="btn btn-secondary" onClick={() => {
              if (acctGridRef.current) {
                acctGridRef.current.api.applyTransaction({ add: [{ ...EMPTY_ACCT }] })
              }
            }} disabled={loading}>
              <span className="material-icons-round">add</span>
              Add Row
            </button>
          </div>
        </div>
      )}

      {/* Department Map tab */}
      {tab === 'dept' && (
        <div style={fullscreen ? fsStyles.overlay : {}}>
          {fullscreen && (
            <div style={fsStyles.topBar}>
              <span style={fsStyles.topBarTitle}>Department Map</span>
              <button className="btn btn-sm btn-secondary" onClick={() => setFullscreen(false)}>
                <span className="material-icons-round">fullscreen_exit</span>
                Exit Fullscreen
              </button>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12, ...(fullscreen ? { flex: 1, display: 'flex', flexDirection: 'column' } : {}) }}>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>
                Account Name + Dept Class = composite key · Classification 2 = cost type · Classification 3 = expense category · Department = internal dept label · Dept Group (BD) = business division grouping
              </span>
              {!fullscreen && (
                <button className="btn btn-sm btn-secondary" style={{ flexShrink: 0, padding: '4px 8px' }} onClick={() => setFullscreen(true)} title="Expand table">
                  <span className="material-icons-round" style={{ fontSize: 16 }}>fullscreen</span>
                </button>
              )}
            </div>
            <div className="ag-theme-alpine" style={{ height: fullscreen ? '100%' : 500, width: '100%', flex: fullscreen ? 1 : undefined }}>
              <AgGridReact<FpaDeptRow>
                ref={deptGridRef}
                rowData={deptRows}
                columnDefs={DEPT_COLUMNS}
                defaultColDef={defaultColDef}
                rowSelection="multiple"
                stopEditingWhenCellsLoseFocus
                animateRows
                preventDefaultOnContextMenu
                onCellContextMenu={handleCtxDept}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleSaveDept} disabled={loading}>
              <span className="material-icons-round">save</span>
              Save Department Map
            </button>
            <button className="btn btn-secondary" onClick={() => {
              if (deptGridRef.current) {
                deptGridRef.current.api.applyTransaction({ add: [{ ...EMPTY_DEPT }] })
              }
            }} disabled={loading}>
              <span className="material-icons-round">add</span>
              Add Row
            </button>
          </div>
        </div>
      )}

      {/* Right-click context menus */}
      {ctxAcct && (
        <CtxMenuPopup
          x={ctxAcct.x} y={ctxAcct.y}
          onDelete={() => {
            if (ctxAcct.node.data && acctGridRef.current) {
              acctGridRef.current.api.applyTransaction({ remove: [ctxAcct.node.data] })
            }
            setCtxAcct(null)
          }}
          onInsert={() => {
            if (acctGridRef.current) {
              acctGridRef.current.api.applyTransaction({ add: [{ ...EMPTY_ACCT }] })
            }
            setCtxAcct(null)
          }}
        />
      )}
      {ctxDept && (
        <CtxMenuPopup
          x={ctxDept.x} y={ctxDept.y}
          onDelete={() => {
            if (ctxDept.node.data && deptGridRef.current) {
              deptGridRef.current.api.applyTransaction({ remove: [ctxDept.node.data] })
            }
            setCtxDept(null)
          }}
          onInsert={() => {
            if (deptGridRef.current) {
              deptGridRef.current.api.applyTransaction({ add: [{ ...EMPTY_DEPT }] })
            }
            setCtxDept(null)
          }}
        />
      )}
    </div>
  )
}

function CtxMenuPopup({ x, y, onDelete, onInsert }: { x: number; y: number; onDelete: () => void; onInsert: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', top: y, left: x, zIndex: 9999,
        background: '#fff', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        minWidth: 160, overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: '#b71c1c', fontFamily: 'inherit' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#ffebee')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        onClick={onDelete}
      >
        Delete Row
      </button>
      <button
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--text)', fontFamily: 'inherit' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-light)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        onClick={onInsert}
      >
        <span className="material-icons-round" style={{ fontSize: 16 }}>add</span>
        Insert Row Below
      </button>
    </div>
  )
}

const fsStyles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: '#fff',
    display: 'flex', flexDirection: 'column', padding: '16px 20px',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  topBarTitle: { fontSize: 17, fontWeight: 700, color: '#400f61' },
}
