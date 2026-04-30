import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Dayjs } from 'dayjs'
import { apiClient as http } from '../api/api'

export interface FpaResult {
  summary: Record<string, unknown>
  previewRows: Record<string, unknown>[]
  companyName: string
  cachedAt: string | null
  downloadBlob: Blob | null
  bsBlob: Blob | null
  bsPreview: Record<string, unknown> | null
  bsiBlob: Blob | null
  bsiPreview: Record<string, unknown> | null
  plBlob: Blob | null
  plPreview: Record<string, unknown> | null
  compPlBlob: Blob | null
  compPlPreview: Record<string, unknown> | null
  compPlBdBlob: Blob | null
  compPlBdPreview: Record<string, unknown> | null
}

export interface PageFilters {
  dashboard?: { fromDate: Dayjs | null; toDate: Dayjs | null }
  baseBS?: { fromDate: Dayjs | null; toDate: Dayjs | null }
  compPL?: { fromDate: Dayjs | null; toDate: Dayjs | null; selectedQuarter: string; selectedYear: number }
  compPLBD?: { fromDate: Dayjs | null; toDate: Dayjs | null; selectedQuarter: string; selectedYear: number }
  bsIndividual?: { selectedMonth: string }
  plIndividual?: { selectedMonth: string }
}

export type CacheStatus = 'loading' | 'loaded' | 'none'

interface FpaResultContextValue {
  result: FpaResult | null
  setResult: (r: FpaResult | null) => void
  pageFilters: PageFilters
  setPageFilter: <K extends keyof PageFilters>(key: K, value: PageFilters[K]) => void
  cacheStatus: CacheStatus
}

function b64ToBlob(b64: string): Blob {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const FpaResultContext = createContext<FpaResultContextValue | null>(null)

export function FpaResultProvider({ children }: { children: ReactNode }) {
  const [result, setResultState] = useState<FpaResult | null>(null)
  const [pageFilters, setPageFilters] = useState<PageFilters>({})
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>('loading')

  useEffect(() => {
    http.get('/fpa/qbo-cache')
      .then((res) => {
        const d = res.data
        setResultState({
          summary:         d.summary,
          previewRows:     d.preview,
          companyName:     d.company_name    ?? '',
          cachedAt:        d.cached_at       ?? null,
          downloadBlob:    d.excel_b64             ? b64ToBlob(d.excel_b64)             : null,
          bsBlob:          d.bs_excel_b64          ? b64ToBlob(d.bs_excel_b64)          : null,
          bsPreview:       d.bs_preview            ?? null,
          bsiBlob:         d.bsi_excel_b64         ? b64ToBlob(d.bsi_excel_b64)         : null,
          bsiPreview:      d.bsi_preview           ?? null,
          plBlob:          d.pl_excel_b64          ? b64ToBlob(d.pl_excel_b64)          : null,
          plPreview:       d.pl_preview            ?? null,
          compPlBlob:      d.comp_pl_excel_b64     ? b64ToBlob(d.comp_pl_excel_b64)     : null,
          compPlPreview:   d.comp_pl_preview       ?? null,
          compPlBdBlob:    d.comp_pl_bd_excel_b64  ? b64ToBlob(d.comp_pl_bd_excel_b64)  : null,
          compPlBdPreview: d.comp_pl_bd_preview    ?? null,
        })
        setCacheStatus('loaded')
      })
      .catch(() => setCacheStatus('none'))
  }, [])

  const setResult = (r: FpaResult | null) => {
    setResultState(r)
    setPageFilters({})
  }

  const setPageFilter = <K extends keyof PageFilters>(key: K, value: PageFilters[K]) => {
    setPageFilters((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <FpaResultContext.Provider value={{ result, setResult, pageFilters, setPageFilter, cacheStatus }}>
      {children}
    </FpaResultContext.Provider>
  )
}

export function useFpaResult(): FpaResultContextValue {
  const ctx = useContext(FpaResultContext)
  if (!ctx) throw new Error('useFpaResult must be used within <FpaResultProvider>')
  return ctx
}
