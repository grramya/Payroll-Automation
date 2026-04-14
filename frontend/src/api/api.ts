import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

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
  role: string
): Promise<void> {
  await http.post('/auth/users', { username, password, role })
}

export async function deleteUser(username: string): Promise<void> {
  await http.delete(`/auth/users/${username}`)
}

export async function resetUserPassword(username: string, password: string): Promise<void> {
  await http.put(`/auth/users/${username}/reset-password`, { password })
}
