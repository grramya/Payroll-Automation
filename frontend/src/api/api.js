import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

// Attach JWT token to every request
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('pje_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, clear session and redirect to login
http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('pje_token')
      localStorage.removeItem('pje_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

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

export async function getMapping() {
  const { data } = await http.get('/mapping')
  return data
}

export async function saveMapping(rows) {
  const { data } = await http.put('/mapping', { rows })
  return data
}

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

export async function getActivityLog() {
  const { data } = await http.get('/activity-log')
  return data
}

export function downloadActivityLogUrl() {
  return '/api/activity-log/download'
}

export function downloadConsolidatedJEUrl() {
  return '/api/consolidated/je/download'
}

export function downloadConsolidatedInputsUrl() {
  return '/api/consolidated/inputs/download'
}
