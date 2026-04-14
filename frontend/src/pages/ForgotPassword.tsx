import type { CSSProperties } from 'react'
import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { resetPassword } from '../api/api'

export default function ForgotPassword() {
  const navigate = useNavigate()

  const [username,  setUsername]  = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNew,   setShowNew]   = useState(false)
  const [showConf,  setShowConf]  = useState(false)
  const [errors,    setErrors]    = useState<Record<string, string>>({})
  const [formErr,   setFormErr]   = useState('')
  const [success,   setSuccess]   = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [focused,   setFocused]   = useState<Record<string, boolean>>({})
  const submitting = useRef(false)

  function inputStyle(field: string): CSSProperties {
    return {
      ...s.input,
      border: errors[field]
        ? '1.5px solid #ef5350'
        : focused[field]
        ? '1.5px solid #400f61'
        : '1.5px solid #d4d0da',
      boxShadow: focused[field] && !errors[field]
        ? '0 0 0 3px rgba(64,15,97,.12)'
        : 'none',
      transition: 'border-color .15s, box-shadow .15s',
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current) return

    const errs: Record<string, string> = {}
    if (!username.trim())     errs.username  = 'User ID is required.'
    if (newPw.length < 4)     errs.newPw     = 'Password must be at least 4 characters.'
    if (!confirmPw)           errs.confirmPw = 'Please confirm your new password.'
    else if (newPw !== confirmPw) errs.confirmPw = 'Passwords do not match.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setErrors({}); setFormErr('')
    submitting.current = true
    setLoading(true)

    try {
      await resetPassword(username.trim(), newPw)
      setSuccess(true)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setFormErr(axiosErr.response?.data?.detail || 'Could not reset password. Please try again.')
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>

        {/* Logo */}
        <div style={s.logoRow}>
          <div style={s.logoIcon}>
            <span className="material-icons-round" style={{ fontSize: 36, color: '#400f61' }}>
              lock_reset
            </span>
          </div>
          <div>
            <div style={s.appName}>Reset Password</div>
            <div style={s.appSub}>Set a new password for your account</div>
          </div>
        </div>

        {success ? (
          /* ── Success state ── */
          <div style={{ marginTop: 32, textAlign: 'center' }}>
            <div style={s.successIcon}>
              <span className="material-icons-round" style={{ fontSize: 40, color: '#2e7d32' }}>
                check_circle
              </span>
            </div>
            <div style={s.successTitle}>Password Reset Successfully</div>
            <div style={s.successSub}>
              Your password has been updated. You can now sign in with your new password.
            </div>
            <button style={s.btn} onClick={() => navigate('/login', { replace: true })}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>login</span>
              Go to Sign In
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit} style={{ marginTop: 28 }} noValidate>

            {/* User ID */}
            <div style={s.field}>
              <label htmlFor="fp-username" style={s.label}>User ID</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>person</span>
                <input
                  id="fp-username"
                  style={inputStyle('username')}
                  type="text" placeholder="Enter your user ID"
                  value={username} autoFocus autoComplete="username"
                  autoCapitalize="none" autoCorrect="off"
                  onChange={e => { setUsername(e.target.value); setErrors(p => ({ ...p, username: '' })); setFormErr('') }}
                  onFocus={() => setFocused(p => ({ ...p, username: true }))}
                  onBlur={() => setFocused(p => ({ ...p, username: false }))}
                />
              </div>
              {errors.username && <div style={s.fieldErr}>{errors.username}</div>}
            </div>

            {/* New Password */}
            <div style={s.field}>
              <label htmlFor="fp-new" style={s.label}>New Password</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>lock_open</span>
                <input
                  id="fp-new"
                  style={{ ...inputStyle('newPw'), paddingRight: 44 }}
                  type={showNew ? 'text' : 'password'} placeholder="Min. 4 characters"
                  value={newPw} autoComplete="new-password"
                  onChange={e => { setNewPw(e.target.value); setErrors(p => ({ ...p, newPw: '' })); setFormErr('') }}
                  onFocus={() => setFocused(p => ({ ...p, newPw: true }))}
                  onBlur={() => setFocused(p => ({ ...p, newPw: false }))}
                />
                <button type="button" style={s.eyeBtn} tabIndex={-1}
                  onClick={() => setShowNew(v => !v)} aria-label={showNew ? 'Hide' : 'Show'}>
                  <span className="material-icons-round" style={{ fontSize: 18, color: '#888' }}>
                    {showNew ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {errors.newPw && <div style={s.fieldErr}>{errors.newPw}</div>}
            </div>

            {/* Confirm Password */}
            <div style={s.field}>
              <label htmlFor="fp-confirm" style={s.label}>Confirm New Password</label>
              <div style={s.inputWrap}>
                <span className="material-icons-round" style={s.inputIcon}>lock_open</span>
                <input
                  id="fp-confirm"
                  style={{ ...inputStyle('confirmPw'), paddingRight: 44 }}
                  type={showConf ? 'text' : 'password'} placeholder="Re-enter new password"
                  value={confirmPw} autoComplete="new-password"
                  onChange={e => { setConfirmPw(e.target.value); setErrors(p => ({ ...p, confirmPw: '' })); setFormErr('') }}
                  onFocus={() => setFocused(p => ({ ...p, confirmPw: true }))}
                  onBlur={() => setFocused(p => ({ ...p, confirmPw: false }))}
                />
                <button type="button" style={s.eyeBtn} tabIndex={-1}
                  onClick={() => setShowConf(v => !v)} aria-label={showConf ? 'Hide' : 'Show'}>
                  <span className="material-icons-round" style={{ fontSize: 18, color: '#888' }}>
                    {showConf ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {errors.confirmPw && <div style={s.fieldErr}>{errors.confirmPw}</div>}
            </div>

            {/* Form error */}
            {formErr && (
              <div role="alert" style={s.formError}>
                <span className="material-icons-round" style={{ fontSize: 16, flexShrink: 0 }}>error_outline</span>
                {formErr}
              </div>
            )}

            {/* Submit */}
            <button type="submit"
              style={{ ...s.btn, opacity: loading ? 0.8 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
              disabled={loading}>
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>

            {/* Back to login */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <Link to="/login" style={s.backLink}>← Back to Sign In</Link>
            </div>

          </form>
        )}
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #f5eefa 0%, #ede7f6 100%)', padding: 24,
  },
  card: {
    background: '#fff', borderRadius: 16, padding: '40px 40px 36px',
    width: '100%', maxWidth: 420,
    boxShadow: '0 8px 40px rgba(64,15,97,.12)', border: '1px solid #e8d5f7',
  },
  logoRow:  { display: 'flex', alignItems: 'center', gap: 16 },
  logoIcon: {
    width: 64, height: 64, borderRadius: 16, background: '#f5eefa', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  appName: { fontSize: 18, fontWeight: 700, color: '#400f61', lineHeight: 1.3 },
  appSub:  { fontSize: 13, color: '#888', marginTop: 2 },
  field:   { marginBottom: 18 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: {
    position: 'absolute', left: 12, fontSize: 18,
    color: '#400f61', opacity: 0.6, pointerEvents: 'none',
  },
  input: {
    width: '100%', padding: '11px 12px 11px 40px', border: '1.5px solid #d4d0da',
    borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none',
    color: '#1a1a1a', background: '#fafafa', boxSizing: 'border-box',
  },
  eyeBtn: {
    position: 'absolute', right: 10, background: 'none', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4,
  },
  fieldErr: { color: '#d32f2f', fontSize: 12, marginTop: 5 },
  formError: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
    background: '#ffebee', border: '1px solid #ef9a9a', color: '#b71c1c',
    borderRadius: 8, padding: '10px 12px', marginBottom: 16, lineHeight: 1.4,
  },
  btn: {
    width: '100%', padding: '12px', background: '#400f61', color: '#fff',
    border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontFamily: 'inherit', cursor: 'pointer', marginTop: 4,
  },
  backLink: {
    fontSize: 12, fontWeight: 600, color: '#400f61',
    textDecoration: 'none', borderBottom: '1px solid rgba(64,15,97,.35)',
  },
  successIcon: {
    width: 80, height: 80, borderRadius: '50%', background: '#e8f5e9',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto 20px',
  },
  successTitle: { fontSize: 17, fontWeight: 700, color: '#1b5e20', marginBottom: 10 },
  successSub:   { fontSize: 13, color: '#555', marginBottom: 28, lineHeight: 1.6 },
}
