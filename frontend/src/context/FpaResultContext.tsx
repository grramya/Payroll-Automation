import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Dayjs } from 'dayjs'
import { apiClient as http } from '../api/api'

export interface FpaResult {
  summary: Record<string, unknown>
  previewRows: Record<string, unknown>[]
  companyName: string
  cachedAt: string | null
  // Object URLs revoked on unmount/replacement — never large Blobs in state
  downloadUrl: string | null
  bsUrl: string | null
  bsPreview: Record<string, unknown> | null
  bsiUrl: string | null
  bsiPreview: Record<string, unknown> | null
  plUrl: string | null
  plPreview: Record<string, unknown> | null
  compPlUrl: string | null
  compPlPreview: Record<string, unknown> | null
  compPlBdUrl: string | null
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function b64ToObjectUrl(b64: string): string {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  const blob = new Blob([buf], { type: XLSX_MIME })
  return URL.createObjectURL(blob)
}

function revokeUrls(result: FpaResult | null) {
  if (!result) return
  const urlFields: (keyof FpaResult)[] = [
    'downloadUrl', 'bsUrl', 'bsiUrl', 'plUrl', 'compPlUrl', 'compPlBdUrl',
  ]
  for (const field of urlFields) {
    const url = result[field] as string | null
    if (url) URL.revokeObjectURL(url)
  }
}

function parseResult(d: Record<string, unknown>): FpaResult {
  const toUrl = (key: string): string | null => {
    const val = d[key]
    return typeof val === 'string' && val ? b64ToObjectUrl(val) : null
  }
  return {
    summary:         (d.summary as Record<string, unknown>) ?? {},
    previewRows:     (d.preview as Record<string, unknown>[]) ?? [],
    companyName:     (d.company_name as string) ?? '',
    cachedAt:        (d.cached_at as string) ?? null,
    downloadUrl:     toUrl('excel_b64'),
    bsUrl:           toUrl('bs_excel_b64'),
    bsPreview:       (d.bs_preview as Record<string, unknown>) ?? null,
    bsiUrl:          toUrl('bsi_excel_b64'),
    bsiPreview:      (d.bsi_preview as Record<string, unknown>) ?? null,
    plUrl:           toUrl('pl_excel_b64'),
    plPreview:       (d.pl_preview as Record<string, unknown>) ?? null,
    compPlUrl:       toUrl('comp_pl_excel_b64'),
    compPlPreview:   (d.comp_pl_preview as Record<string, unknown>) ?? null,
    compPlBdUrl:     toUrl('comp_pl_bd_excel_b64'),
    compPlBdPreview: (d.comp_pl_bd_preview as Record<string, unknown>) ?? null,
  }
}

const FpaResultContext = createContext<FpaResultContextValue | null>(null)

export function FpaResultProvider({ children }: { children: ReactNode }) {
  const [result,      setResultState] = useState<FpaResult | null>(null)
  const [pageFilters, setPageFilters] = useState<PageFilters>({})
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>('loading')

  // Track the currently active result so we can revoke its URLs on replacement
  const resultRef = useRef<FpaResult | null>(null)

  useEffect(() => {
    http.get<Record<string, unknown>>('/fpa/qbo-cache')
      .then((res) => {
        const parsed = parseResult(res.data)
        resultRef.current = parsed
        setResultState(parsed)
        setCacheStatus('loaded')
      })
      .catch(() => setCacheStatus('none'))

    // On unmount: revoke all object URLs to free browser memory
    return () => revokeUrls(resultRef.current)
  }, [])

  const setResult = useCallback((r: FpaResult | null) => {
    // Revoke URLs from the previous result before replacing
    revokeUrls(resultRef.current)
    resultRef.current = r
    setResultState(r)
    setPageFilters({})
  }, [])

  const setPageFilter = useCallback(<K extends keyof PageFilters>(key: K, value: PageFilters[K]) => {
    setPageFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

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

// ── Helper: build FpaResult from the SSE 'done' event data payload ────────────
export function fpaResultFromEventData(data: Record<string, unknown>, companyName: string): FpaResult {
  return parseResult({ ...data, company_name: companyName })
}
