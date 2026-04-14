import { createContext, useContext, useReducer, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { JERow, JESummary } from '../api/api'

interface AppState {
  sessionId: string | null
  jeRows: JERow[]
  jeColumns: string[]
  jeFilename: string
  summary: JESummary | null
  payrollGt: number | null
  jeProvision: number | null
  unmappedCols: string[]
  naMappedCols: string[]
  deptSummary: Record<string, unknown>[]
  warnings: string[]
  loading: boolean
  loadingMsg: string
}

export interface JEDataPayload {
  sessionId?: string
  jeRows: JERow[]
  jeColumns: string[]
  jeFilename?: string
  summary?: JESummary
  payrollGt?: number
  jeProvision?: number
  unmappedCols?: string[]
  naMappedCols?: string[]
  deptSummary?: Record<string, unknown>[]
  warnings?: string[]
}

type AppAction =
  | { type: 'SET_LOADING'; payload: boolean; msg?: string }
  | ({ type: 'SET_JE_DATA' } & JEDataPayload)
  | { type: 'UPDATE_JE_ROWS'; rows: JERow[] }
  | { type: 'UPDATE_PROVISION'; value: number }
  | { type: 'RESET' }

interface AppContextValue extends AppState {
  setLoading: (on: boolean, msg?: string) => void
  setJEData: (payload: JEDataPayload) => void
  updateJERows: (rows: JERow[]) => void
  updateProvision: (value: number) => void
  reset: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

const INITIAL: AppState = {
  sessionId: null,
  jeRows: [],
  jeColumns: [],
  jeFilename: '',
  summary: null,
  payrollGt: null,
  jeProvision: null,
  unmappedCols: [],
  naMappedCols: [],
  deptSummary: [],
  warnings: [],
  loading: false,
  loadingMsg: '',
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload, loadingMsg: action.msg || '' }
    case 'SET_JE_DATA':
      return {
        ...state,
        sessionId: action.sessionId ?? state.sessionId,
        jeRows: action.jeRows,
        jeColumns: action.jeColumns,
        jeFilename: action.jeFilename ?? state.jeFilename,
        summary: action.summary ?? state.summary,
        payrollGt: action.payrollGt ?? state.payrollGt,
        jeProvision: action.jeProvision ?? state.jeProvision,
        unmappedCols: action.unmappedCols ?? state.unmappedCols,
        naMappedCols: action.naMappedCols ?? state.naMappedCols,
        deptSummary: action.deptSummary ?? state.deptSummary,
        warnings: action.warnings ?? state.warnings,
        loading: false,
        loadingMsg: '',
      }
    case 'UPDATE_JE_ROWS':
      return { ...state, jeRows: action.rows }
    case 'UPDATE_PROVISION':
      return { ...state, jeProvision: action.value }
    case 'RESET':
      return INITIAL
    default:
      return state
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const setLoading = useCallback((on: boolean, msg = '') => {
    dispatch({ type: 'SET_LOADING', payload: on, msg })
  }, [])

  const setJEData = useCallback((payload: JEDataPayload) => {
    dispatch({ type: 'SET_JE_DATA', ...payload })
  }, [])

  const updateJERows = useCallback((rows: JERow[]) => {
    dispatch({ type: 'UPDATE_JE_ROWS', rows })
  }, [])

  const updateProvision = useCallback((value: number) => {
    dispatch({ type: 'UPDATE_PROVISION', value })
  }, [])

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  return (
    <AppContext.Provider
      value={{ ...state, setLoading, setJEData, updateJERows, updateProvision, reset }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
