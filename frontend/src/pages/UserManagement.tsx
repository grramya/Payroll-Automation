import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import type { UserRecord } from '../api/api'
import { listUsers, createUser, deleteUser, resetUserPassword, updateUserPermissions } from '../api/api'

export default function UserManagement() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Add user form
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [newCanPayroll, setNewCanPayroll] = useState(false)
  const [newCanFpa, setNewCanFpa]         = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // Permission editing state
  const [permSaving, setPermSaving] = useState<string | null>(null)

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [showResetPw, setShowResetPw] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    setError('')
    try {
      const data = await listUsers()
      setUsers(data.users || [])
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    if (!newUsername.trim()) { setAddError('Username is required.'); return }
    if (newPassword.length < 4) { setAddError('Password must be at least 4 characters.'); return }
    setAdding(true)
    try {
      await createUser(newUsername.trim(), newPassword, newRole, newCanPayroll, newCanFpa)
      setSuccess(`User "${newUsername.trim()}" created successfully.`)
      setNewUsername('')
      setNewPassword('')
      setNewRole('user')
      setNewCanPayroll(false)
      setNewCanFpa(false)
      fetchUsers()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setAddError(axiosErr.response?.data?.detail || 'Failed to create user.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setError('')
    try {
      await deleteUser(username)
      setSuccess(`User "${username}" deleted.`)
      fetchUsers()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setError(axiosErr.response?.data?.detail || 'Failed to delete user.')
    }
  }

  async function handleTogglePermission(username: string, field: 'payroll' | 'fpa', current: number) {
    const u = users.find(x => x.username === username)
    if (!u) return
    setPermSaving(username + field)
    try {
      const payroll = field === 'payroll' ? !current : Boolean(u.can_access_payroll)
      const fpa     = field === 'fpa'     ? !current : Boolean(u.can_access_fpa)
      await updateUserPermissions(username, payroll, fpa)
      setSuccess(`Permissions updated for "${username}".`)
      fetchUsers()
    } catch {
      setError('Failed to update permissions.')
    } finally {
      setPermSaving(null)
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    if (resetPw.length < 4) { setResetError('Password must be at least 4 characters.'); return }
    if (!resetTarget) return
    setResetting(true)
    try {
      await resetUserPassword(resetTarget, resetPw)
      setSuccess(`Password reset for "${resetTarget}".`)
      setResetTarget(null)
      setResetPw('')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setResetError(axiosErr.response?.data?.detail || 'Failed to reset password.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      {loading && <Spinner label="Loading users…" />}

      <PageHeader
        icon="manage_accounts"
        title="User Management"
        subtitle="Add, remove, and manage user accounts. Only admins can access this page."
      />

      {error   && <Alert type="error"   onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess('')}>{success}</Alert>}

      {/* ── Add User Form ── */}
      <div style={s.card}>
        <div style={s.cardTitle}>
          <span className="material-icons-round" style={s.cardTitleIcon}>person_add</span>
          Add New User
        </div>
        <form onSubmit={handleAdd} style={s.form}>
          <div style={s.formRow}>
            <div style={s.field}>
              <label style={s.label}>Username</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>person</span>
                <input
                  style={s.input}
                  type="text"
                  placeholder="Enter username"
                  value={newUsername}
                  onChange={e => { setNewUsername(e.target.value); setAddError('') }}
                  autoComplete="off"
                />
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Password</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>lock</span>
                <input
                  style={{ ...s.input, paddingRight: 40 }}
                  type={showNewPw ? 'text' : 'password'}
                  placeholder="Min. 4 characters"
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setAddError('') }}
                  autoComplete="new-password"
                />
                <button type="button" style={s.eyeBtn} onClick={() => setShowNewPw(v => !v)} tabIndex={-1}>
                  <span className="material-icons-round" style={{ fontSize: 16, color: '#888' }}>
                    {showNewPw ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Role</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>admin_panel_settings</span>
                <select
                  style={{ ...s.input, cursor: 'pointer' }}
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>App Access</label>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingTop: 10 }}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={newCanPayroll} onChange={e => setNewCanPayroll(e.target.checked)} style={s.checkbox} />
                  Payroll JE
                </label>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={newCanFpa} onChange={e => setNewCanFpa(e.target.checked)} style={s.checkbox} />
                  FP&amp;A
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" style={s.addBtn} disabled={adding}>
                {adding ? 'Adding…' : 'Add User'}
              </button>
            </div>
          </div>

          {addError && (
            <div style={s.inlineError}>
              <span className="material-icons-round" style={{ fontSize: 14 }}>error_outline</span>
              {addError}
            </div>
          )}
        </form>
      </div>

      {/* ── Users Table ── */}
      <div style={s.card}>
        <div style={s.cardTitle}>
          <span className="material-icons-round" style={s.cardTitleIcon}>group</span>
          Existing Users
          <span style={s.badge}>{users.length}</span>
        </div>

        {users.length === 0 && !loading ? (
          <Alert type="info">No users found.</Alert>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Username</th>
                <th style={s.th}>Role</th>
                <th style={{ ...s.th, textAlign: 'center' }}>Payroll JE</th>
                <th style={{ ...s.th, textAlign: 'center' }}>FP&amp;A</th>
                <th style={s.th}>Created</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isAdmin = u.role === 'admin'
                const savingP = permSaving === u.username + 'payroll'
                const savingF = permSaving === u.username + 'fpa'
                return (
                  <tr key={u.id} style={s.tr}>
                    <td style={s.td}>
                      <span className="material-icons-round" style={{ fontSize: 15, color: '#400f61', verticalAlign: 'middle', marginRight: 6 }}>account_circle</span>
                      {u.username}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.roleBadge, ...(isAdmin ? s.roleAdmin : s.roleUser) }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {isAdmin
                        ? <span style={s.adminBadge}>Always</span>
                        : (
                          <button
                            style={{ ...s.toggleBtn, ...(u.can_access_payroll ? s.toggleOn : s.toggleOff) }}
                            onClick={() => handleTogglePermission(u.username, 'payroll', u.can_access_payroll)}
                            disabled={!!savingP}
                            title={u.can_access_payroll ? 'Revoke Payroll access' : 'Grant Payroll access'}
                          >
                            {savingP ? '…' : u.can_access_payroll ? '✓ On' : 'Off'}
                          </button>
                        )
                      }
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {isAdmin
                        ? <span style={s.adminBadge}>Always</span>
                        : (
                          <button
                            style={{ ...s.toggleBtn, ...(u.can_access_fpa ? s.toggleOn : s.toggleOff) }}
                            onClick={() => handleTogglePermission(u.username, 'fpa', u.can_access_fpa)}
                            disabled={!!savingF}
                            title={u.can_access_fpa ? 'Revoke FP&A access' : 'Grant FP&A access'}
                          >
                            {savingF ? '…' : u.can_access_fpa ? '✓ On' : 'Off'}
                          </button>
                        )
                      }
                    </td>
                    <td style={{ ...s.td, color: '#777', fontSize: 12 }}>
                      {u.created ? new Date(u.created).toLocaleString() : '—'}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <button
                        style={s.actionBtn}
                        onClick={() => { setResetTarget(u.username); setResetPw(''); setResetError(''); setShowResetPw(false) }}
                      >
                        Reset Password
                      </button>
                      <button
                        style={{ ...s.actionBtn, ...s.deleteBtn }}
                        onClick={() => handleDelete(u.username)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Reset Password Modal ── */}
      {resetTarget && (
        <div style={s.overlay} onClick={() => setResetTarget(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>
              <span className="material-icons-round" style={{ fontSize: 20, color: '#400f61' }}>key</span>
              Reset Password — {resetTarget}
            </div>
            <form onSubmit={handleResetPassword}>
              <div style={s.field}>
                <label style={s.label}>New Password</label>
                <div style={s.inputWrap}>
                  <span className="material-icons-round" style={s.inputIcon}>lock</span>
                  <input
                    style={{ ...s.input, paddingRight: 40 }}
                    type={showResetPw ? 'text' : 'password'}
                    placeholder="Min. 4 characters"
                    value={resetPw}
                    onChange={e => { setResetPw(e.target.value); setResetError('') }}
                    autoFocus
                    autoComplete="new-password"
                  />
                  <button type="button" style={s.eyeBtn} onClick={() => setShowResetPw(v => !v)} tabIndex={-1}>
                    <span className="material-icons-round" style={{ fontSize: 16, color: '#888' }}>
                      {showResetPw ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
              {resetError && (
                <div style={s.inlineError}>
                  <span className="material-icons-round" style={{ fontSize: 14 }}>error_outline</span>
                  {resetError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" style={s.addBtn} disabled={resetting}>
                  {resetting ? 'Saving…' : 'Save Password'}
                </button>
                <button type="button" style={s.cancelBtn} onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  card: {
    background: '#fff',
    border: '1px solid #e8d5f7',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 20,
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
    fontWeight: 700,
    color: '#400f61',
    marginBottom: 18,
  },
  cardTitleIcon: { fontSize: 20, color: '#400f61' },
  badge: {
    background: '#f5eefa',
    color: '#400f61',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    padding: '1px 9px',
    marginLeft: 4,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formRow: { display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 160 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: {
    position: 'absolute', left: 10, fontSize: 16,
    color: '#400f61', opacity: 0.55, pointerEvents: 'none',
  },
  input: {
    width: '100%', padding: '9px 10px 9px 34px',
    border: '1.5px solid #d4d0da', borderRadius: 8, fontSize: 13,
    fontFamily: 'inherit', outline: 'none', color: '#1a1a1a',
    background: '#fafafa', boxSizing: 'border-box',
  },
  eyeBtn: {
    position: 'absolute', right: 8, background: 'none', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2,
  },
  addBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 18px', background: '#400f61', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  cancelBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 18px', background: '#f5f5f5', color: '#555',
    border: '1.5px solid #ddd', borderRadius: 8, fontSize: 13,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  inlineError: {
    display: 'flex', alignItems: 'center', gap: 6, color: '#b71c1c',
    fontSize: 12, background: '#ffebee', border: '1px solid #ef9a9a',
    borderRadius: 6, padding: '6px 10px', marginTop: 4,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em',
    color: '#888', borderBottom: '2px solid #f0e8f7',
  },
  tr: { borderBottom: '1px solid #f5f0fa' },
  td: { padding: '11px 12px', color: '#222', verticalAlign: 'middle' },
  roleBadge: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 20,
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  roleAdmin: { background: '#f5eefa', color: '#400f61' },
  roleUser:  { background: '#f0f4ff', color: '#3949ab' },
  actionBtn: {
    display: 'inline-flex', alignItems: 'center', padding: '5px 12px', marginLeft: 8,
    background: '#f5eefa', color: '#400f61', border: '1px solid #d4b8f0',
    borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  deleteBtn: { background: '#fff5f5', color: '#b71c1c', border: '1px solid #f5c6c6' },
  toggleBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit', minWidth: 52,
    transition: 'background .15s',
  },
  toggleOn:  { background: '#e8f5e9', color: '#2e7d32' },
  toggleOff: { background: '#f5f5f5', color: '#888' },
  adminBadge: {
    display: 'inline-block', fontSize: 11, fontWeight: 600,
    color: '#400f61', background: '#f5eefa', borderRadius: 20,
    padding: '2px 10px',
  },
  checkLabel: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 13, color: '#444', fontWeight: 500, cursor: 'pointer',
  },
  checkbox: { width: 15, height: 15, cursor: 'pointer', accentColor: '#400f61' },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: 14, padding: '28px 28px 24px',
    width: '100%', maxWidth: 400,
    boxShadow: '0 12px 48px rgba(64,15,97,.18)', border: '1px solid #e8d5f7',
  },
  modalTitle: {
    display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 15, fontWeight: 700, color: '#400f61', marginBottom: 20,
  },
}
