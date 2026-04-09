import { createContext, useContext, useReducer, useCallback } from 'react'

const AppContext = createContext(null)

const INITIAL = {
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

function reducer(state, action) {
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

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const setLoading = useCallback((on, msg = '') => {
    dispatch({ type: 'SET_LOADING', payload: on, msg })
  }, [])

  const setJEData = useCallback((payload) => {
    dispatch({ type: 'SET_JE_DATA', ...payload })
  }, [])

  const updateJERows = useCallback((rows) => {
    dispatch({ type: 'UPDATE_JE_ROWS', rows })
  }, [])

  const updateProvision = useCallback((value) => {
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

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
