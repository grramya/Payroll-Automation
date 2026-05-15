import type { FpaResult } from './FpaResultContext'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function b64ToObjectUrl(b64: string): string {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  const blob = new Blob([buf], { type: XLSX_MIME })
  return URL.createObjectURL(blob)
}

export function parseResult(d: Record<string, unknown>): FpaResult {
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
    bsBdUrl:         toUrl('bs_bd_excel_b64'),
    bsBdPreview:     (d.bs_bd_preview as Record<string, unknown>) ?? null,
    plUrl:           toUrl('pl_excel_b64'),
    plPreview:       (d.pl_preview as Record<string, unknown>) ?? null,
    compPlUrl:       toUrl('comp_pl_excel_b64'),
    compPlPreview:   (d.comp_pl_preview as Record<string, unknown>) ?? null,
    compPlBdUrl:     toUrl('comp_pl_bd_excel_b64'),
    compPlBdPreview: (d.comp_pl_bd_preview as Record<string, unknown>) ?? null,
  }
}

export function fpaResultFromEventData(data: Record<string, unknown>, companyName: string): FpaResult {
  return parseResult({ ...data, company_name: companyName })
}
