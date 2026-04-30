import axios from 'axios'

const http = axios.create({ baseURL: '/api' })
export { http as apiClient }

// ── Request interceptor — attach JWT from whichever storage holds it ──────────
http.interceptors.request.use((config) => {
  const token =
    localStorage.getItem('pje_token') ||
    sessionStorage.getItem('pje_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response interceptor — handle 401 (expired / revoked session) ─────────────
http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('pje_token')
      localStorage.removeItem('pje_user')
      sessionStorage.removeItem('pje_token')
      sessionStorage.removeItem('pje_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Shared types ───────────────────────────────────────────────────────────────

export interface JESummary {
  total: number
  regular: number
  special: number
}

export type JERow = Record<string, unknown>

export interface GenerateJEResponse {
  session_id: string
  je_rows: JERow[]
  columns: string[]
  je_filename: string
  summary: JESummary
  payroll_gt: number
  je_provision: number
  unmapped_cols: string[]
  na_mapped_cols: string[]
  dept_summary: Record<string, unknown>[]
  warnings: string[]
}

export interface QBOStatus {
  creds_configured: boolean
  authenticated: boolean
  realm_id?: string
  expires?: string
}

export interface QBOPostResult {
  id: string
  doc_number: string
}

export interface MappingData {
  rows: JERow[]
  columns: string[]
}

export interface ActivityLogData {
  rows: JERow[]
  columns: string[]
}

export interface UserRecord {
  id: number
  username: string
  role: string
  created?: string
  can_access_payroll: number
  can_access_fpa: number
}

export interface UsersData {
  users: UserRecord[]
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function logoutApi(): Promise<void> {
  await http.post('/auth/logout')
}

export async function resetPassword(username: string, newPassword: string): Promise<void> {
  await http.post('/auth/reset-password', {
    username,
    new_password: newPassword,
  })
}

export async function changeOwnPassword(
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await http.post('/auth/change-own-password', {
    username,
    old_password: oldPassword,
    new_password: newPassword,
  })
}

// ── JE generation & management ─────────────────────────────────────────────────

export async function parseFileMetadata(
  file: File
): Promise<{ journal_number: string; invoice_date: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<{ journal_number: string; invoice_date: string }>(
    '/parse-file',
    form
  )
  return data
}

export async function generateJE(
  file: File,
  journalNumber: string,
  entryDate: string,
  provisionDesc: string
): Promise<GenerateJEResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('journal_number', journalNumber)
  form.append('entry_date', entryDate)
  form.append('provision_desc', provisionDesc || '')
  const { data } = await http.post<GenerateJEResponse>('/generate', form)
  return data
}

export async function getJE(sessionId: string): Promise<GenerateJEResponse> {
  const { data } = await http.get<GenerateJEResponse>(`/je/${sessionId}`)
  return data
}

export async function saveJE(
  sessionId: string,
  rows: JERow[]
): Promise<{ je_provision?: number }> {
  const { data } = await http.put<{ je_provision?: number }>(`/je/${sessionId}`, { rows })
  return data
}

export function downloadJEUrl(sessionId: string): string {
  return `/api/je/${sessionId}/download`
}

export async function regenerateJE(
  sessionId: string,
  journalNumber?: string,
  entryDate?: string,
  provisionDesc?: string
): Promise<GenerateJEResponse> {
  const { data } = await http.post<GenerateJEResponse>(`/regenerate/${sessionId}`, {
    journal_number: journalNumber,
    entry_date: entryDate,
    provision_desc: provisionDesc || '',
  })
  return data
}

// ── Mapping ────────────────────────────────────────────────────────────────────

export async function getMapping(): Promise<MappingData> {
  const { data } = await http.get<MappingData>('/mapping')
  return data
}

export async function saveMapping(rows: JERow[]): Promise<void> {
  await http.put('/mapping', { rows })
}

// ── QuickBooks ─────────────────────────────────────────────────────────────────

export async function postToQBO(sessionId: string): Promise<QBOPostResult> {
  const { data } = await http.post<QBOPostResult>(`/je/${sessionId}/post-qbo`)
  return data
}

export async function getQBOStatus(): Promise<QBOStatus> {
  const { data } = await http.get<QBOStatus>('/qbo/status')
  return data
}

export async function startQBOAuth(): Promise<{ auth_url: string }> {
  const { data } = await http.post<{ auth_url: string }>('/qbo/auth-start')
  return data
}

export async function completeQBOAuth(redirectUrl: string): Promise<void> {
  await http.post('/qbo/auth-complete', { redirect_url: redirectUrl })
}

export async function disconnectQBO(): Promise<void> {
  await http.post('/qbo/disconnect')
}

export interface QBOTableData {
  rows: JERow[]
  columns: string[]
}

export async function getQBOAccounts(): Promise<QBOTableData> {
  const { data } = await http.get<QBOTableData>('/qbo/accounts')
  return data
}

export async function saveQBOAccounts(rows: JERow[]): Promise<void> {
  await http.put('/qbo/accounts', { rows })
}

export async function syncQBOAccounts(): Promise<QBOTableData> {
  const { data } = await http.post<QBOTableData>('/qbo/accounts/sync')
  return data
}

export async function getQBOVendors(): Promise<QBOTableData> {
  const { data } = await http.get<QBOTableData>('/qbo/vendors')
  return data
}

export async function saveQBOVendors(rows: JERow[]): Promise<void> {
  await http.put('/qbo/vendors', { rows })
}

export async function syncQBOVendors(): Promise<QBOTableData> {
  const { data } = await http.post<QBOTableData>('/qbo/vendors/sync')
  return data
}

export async function getQBOClasses(): Promise<QBOTableData> {
  const { data } = await http.get<QBOTableData>('/qbo/classes')
  return data
}

export async function saveQBOClasses(rows: JERow[]): Promise<void> {
  await http.put('/qbo/classes', { rows })
}

export async function syncQBOClasses(): Promise<QBOTableData> {
  const { data } = await http.post<QBOTableData>('/qbo/classes/sync')
  return data
}

// ── Activity log ───────────────────────────────────────────────────────────────

export async function getActivityLog(): Promise<ActivityLogData> {
  const { data } = await http.get<ActivityLogData>('/activity-log')
  return data
}

export function downloadActivityLogUrl(): string {
  return '/api/activity-log/download'
}

// ── Consolidated downloads ─────────────────────────────────────────────────────

export function downloadConsolidatedJEUrl(): string {
  return '/api/consolidated/je/download'
}

export function downloadConsolidatedInputsUrl(): string {
  return '/api/consolidated/inputs/download'
}

// ── User management (admin only) ───────────────────────────────────────────────

export async function listUsers(): Promise<UsersData> {
  const { data } = await http.get<UsersData>('/auth/users')
  return data
}

export async function createUser(
  username: string,
  password: string,
  role: string,
  can_access_payroll = false,
  can_access_fpa = false,
): Promise<void> {
  await http.post('/auth/users', { username, password, role, can_access_payroll, can_access_fpa })
}

export async function deleteUser(username: string): Promise<void> {
  await http.delete(`/auth/users/${username}`)
}

export async function resetUserPassword(username: string, password: string): Promise<void> {
  await http.put(`/auth/users/${username}/reset-password`, { password })
}

export async function updateUserPermissions(
  username: string,
  can_access_payroll: boolean,
  can_access_fpa: boolean,
): Promise<void> {
  await http.put(`/auth/users/${username}/permissions`, { can_access_payroll, can_access_fpa })
}

// ── FP&A ───────────────────────────────────────────────────────────────────────

export interface FpaTransformResponse {
  summary: Record<string, unknown>
  preview: Record<string, unknown>[]
  excel_b64: string
  bs_excel_b64: string
  bs_preview: Record<string, unknown>
  bsi_excel_b64: string
  bsi_preview: Record<string, unknown>
  pl_excel_b64: string
  pl_preview: Record<string, unknown>
  comp_pl_excel_b64: string
  comp_pl_preview: Record<string, unknown>
  comp_pl_bd_excel_b64: string
  comp_pl_bd_preview: Record<string, unknown>
}

export async function fpaGetMeta(file: File): Promise<{ company_name: string }> {
  const form = new FormData()
  form.append('input_file', file)
  const { data } = await http.post<{ company_name: string }>('/fpa/meta', form)
  return data
}

export async function fpaTransform(file: File, companyName: string): Promise<FpaTransformResponse> {
  const form = new FormData()
  form.append('input_file', file)
  form.append('company_name', companyName)
  const { data } = await http.post<FpaTransformResponse>('/fpa/transform', form)
  return data
}
