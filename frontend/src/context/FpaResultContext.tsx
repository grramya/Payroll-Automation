import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

export interface FpaResult {
  summary: Record<string, unknown>
  previewRows: Record<string, unknown>[]
  companyName: string
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

interface FpaResultContextValue {
  result: FpaResult | null
  setResult: (r: FpaResult | null) => void
}

const FpaResultContext = createContext<FpaResultContextValue | null>(null)

export function FpaResultProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<FpaResult | null>(null)
  return (
    <FpaResultContext.Provider value={{ result, setResult }}>
      {children}
    </FpaResultContext.Provider>
  )
}

export function useFpaResult(): FpaResultContextValue {
  const ctx = useContext(FpaResultContext)
  if (!ctx) throw new Error('useFpaResult must be used within <FpaResultProvider>')
  return ctx
}
