import type { CSSProperties } from 'react'
import { useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type ErrType = 'auth' | 'network' | 'lockout'

export default function Login() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [errors,   setErrors]   = useState<Record<string, string>>({})
  const [formErr,  setFormErr]  = useState('')
  const [errType,  setErrType]  = useState<ErrType>('auth')
  const [loading,  setLoading]  = useState(false)
  const [focused,  setFocused]  = useState<Record<string, boolean>>({})
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
    if (!username.trim()) errs.username = 'User ID is required.'
    if (!password)        errs.password = 'Password is required.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setErrors({}); setFormErr('')
    submitting.current = true
    setLoading(true)

    try {
      await login(username.trim(), password)
      navigate('/step/1', { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      if (!axiosErr.response) {
        setErrType('network')
        setFormErr('Could not reach the server. Check your connection and try again.')
      } else if (axiosErr.response.status === 429) {
        setErrType('lockout')
        setFormErr(axiosErr.response.data?.detail ?? 'Too many failed attempts. Please wait.')
      } else {
        setErrType('auth')
        setFormErr('Invalid username or password.')
      }
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const em = {
    auth:    { icon: 'error_outline', bg: '#ffebee', border: '#ef9a9a', color: '#b71c1c' },
    network: { icon: 'wifi_off',      bg: '#fff3e0', border: '#ffcc80', color: '#e65100' },
    lockout: { icon: 'lock_clock',    bg: '#fff3e0', border: '#ffcc80', color: '#e65100' },
  }[errType]

  return (
    <div style={s.page}>
      <div style={s.card}>

        {/* Logo */}
        <div style={s.logoRow}>
          <div style={s.logoIcon}>
            <span className="material-icons-round" style={{ fontSize: 36, color: '#400f61' }}>
              receipt_long
            </span>
          </div>
          <div>
            <div style={s.appName}>Payroll JE Automation</div>
            <div style={s.appSub}>Sign in to your account</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 28 }} noValidate>

          {/* User ID */}
          <div style={s.field}>
            <label htmlFor="username" style={s.label}>User ID</label>
            <div style={s.inputWrap}>
              <span className="material-icons-round" style={s.inputIcon}>person</span>
              <input
                id="username"
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

          {/* Password */}
          <div style={s.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label htmlFor="password" style={{ ...s.label, marginBottom: 0 }}>Password</label>
              <Link to="/forgot-password" style={s.forgotLink}>Forgot password?</Link>
            </div>
            <div style={s.inputWrap}>
              <span className="material-icons-round" style={s.inputIcon}>lock</span>
              <input
                id="password"
                style={{ ...inputStyle('password'), paddingRight: 44 }}
                type={showPw ? 'text' : 'password'} placeholder="Enter your password"
                value={password} autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: '' })); setFormErr('') }}
                onFocus={() => setFocused(p => ({ ...p, password: true }))}
                onBlur={() => setFocused(p => ({ ...p, password: false }))}
              />
              <button type="button" style={s.eyeBtn} tabIndex={-1}
                onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                <span className="material-icons-round" style={{ fontSize: 18, color: '#888' }}>
                  {showPw ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {errors.password && <div style={s.fieldErr}>{errors.password}</div>}
          </div>

          {/* Form error */}
          {formErr && (
            <div role="alert" style={{ ...s.formError, background: em.bg, borderColor: em.border, color: em.color }}>
              <span className="material-icons-round" style={{ fontSize: 16, flexShrink: 0 }}>{em.icon}</span>
              {formErr}
            </div>
          )}

          {/* Submit */}
          <button type="submit"
            style={{ ...s.btn, opacity: loading ? 0.8 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
            disabled={loading}>
            {loading
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={s.spinner} /> Signing in…
                </span>
              : <><span className="material-icons-round" style={{ fontSize: 18 }}>login</span> Sign In</>
            }
          </button>

        </form>
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
  forgotLink: {
    fontSize: 12, fontWeight: 600, color: '#400f61',
    textDecoration: 'none', borderBottom: '1px solid rgba(64,15,97,.35)',
  },
  formError: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
    border: '1px solid', borderRadius: 8, padding: '10px 12px',
    marginBottom: 16, lineHeight: 1.4,
  },
  btn: {
    width: '100%', padding: '12px', background: '#400f61', color: '#fff',
    border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontFamily: 'inherit', marginTop: 4,
  },
  spinner: {
    width: 16, height: 16, border: '2px solid rgba(255,255,255,.3)',
    borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block',
    animation: 'spin .7s linear infinite',
  },
}
