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
      // Clear credentials from both storages and force re-login
      localStorage.removeItem('pje_token')
      localStorage.removeItem('pje_user')
      sessionStorage.removeItem('pje_token')
      sessionStorage.removeItem('pje_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function logoutApi() {
  await http.post('/auth/logout')
}

export async function resetPassword(username, newPassword) {
  const { data } = await http.post('/auth/reset-password', {
    username,
    new_password: newPassword,
  })
  return data
}

export async function changeOwnPassword(username, oldPassword, newPassword) {
  const { data } = await http.post('/auth/change-own-password', {
    username,
    old_password: oldPassword,
    new_password: newPassword,
  })
  return data
}

// ── JE generation & management ─────────────────────────────────────────────────

export async function generateJE(file, journalNumber, entryDate, provisionDesc) {
  const form = new FormData()
  form.append('file', file)
  form.append('journal_number', journalNumber)
  form.append('entry_date', entryDate)
  form.append('provision_desc', provisionDesc || '')
  const { data } = await http.post('/generate', form)
  return data
}

export async function getJE(sessionId) {
  const { data } = await http.get(`/je/${sessionId}`)
  return data
}

export async function saveJE(sessionId, rows) {
  const { data } = await http.put(`/je/${sessionId}`, { rows })
  return data
}

export function downloadJEUrl(sessionId) {
  return `/api/je/${sessionId}/download`
}

export async function regenerateJE(sessionId, journalNumber, entryDate, provisionDesc) {
  const { data } = await http.post(`/regenerate/${sessionId}`, {
    journal_number: journalNumber,
    entry_date: entryDate,
    provision_desc: provisionDesc || '',
  })
  return data
}

// ── Mapping ────────────────────────────────────────────────────────────────────

export async function getMapping() {
  const { data } = await http.get('/mapping')
  return data
}

export async function saveMapping(rows) {
  const { data } = await http.put('/mapping', { rows })
  return data
}

// ── QuickBooks ─────────────────────────────────────────────────────────────────

export async function postToQBO(sessionId) {
  const { data } = await http.post(`/je/${sessionId}/post-qbo`)
  return data
}

export async function getQBOStatus() {
  const { data } = await http.get('/qbo/status')
  return data
}

export async function startQBOAuth() {
  const { data } = await http.post('/qbo/auth-start')
  return data
}

export async function completeQBOAuth(redirectUrl) {
  const { data } = await http.post('/qbo/auth-complete', { redirect_url: redirectUrl })
  return data
}

export async function disconnectQBO() {
  const { data } = await http.post('/qbo/disconnect')
  return data
}

// ── Activity log ───────────────────────────────────────────────────────────────

export async function getActivityLog() {
  const { data } = await http.get('/activity-log')
  return data
}

export function downloadActivityLogUrl() {
  return '/api/activity-log/download'
}

// ── Consolidated downloads ─────────────────────────────────────────────────────

export function downloadConsolidatedJEUrl() {
  return '/api/consolidated/je/download'
}

export function downloadConsolidatedInputsUrl() {
  return '/api/consolidated/inputs/download'
}

// ── User management (admin only) ───────────────────────────────────────────────

export async function listUsers() {
  const { data } = await http.get('/auth/users')
  return data
}

export async function createUser(username, password, role) {
  const { data } = await http.post('/auth/users', { username, password, role })
  return data
}

export async function deleteUser(username) {
  const { data } = await http.delete(`/auth/users/${username}`)
  return data
}

export async function resetUserPassword(username, password) {
  const { data } = await http.put(`/auth/users/${username}/reset-password`, { password })
  return data
}
