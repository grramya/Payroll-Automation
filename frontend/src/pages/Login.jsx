import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Please enter your User ID and password.'); return }
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate('/step/1', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid User ID or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* Logo */}
        <div style={styles.logoRow}>
          <div style={styles.logoIcon}>
            <span className="material-icons-round" style={{ fontSize: 36, color: '#400f61' }}>receipt_long</span>
          </div>
          <div>
            <div style={styles.appName}>Payroll JE Automation</div>
            <div style={styles.appSub}>Sign in to your account</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>

          {/* User ID */}
          <div style={styles.field}>
            <label style={styles.label}>User ID</label>
            <div style={styles.inputWrap}>
              <span className="material-icons-round" style={styles.inputIcon}>person</span>
              <input
                style={styles.input}
                type="text"
                placeholder="Enter your user ID"
                value={username}
                autoFocus
                autoComplete="username"
                onChange={e => { setUsername(e.target.value); setError('') }}
              />
            </div>
          </div>

          {/* Password */}
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <div style={styles.inputWrap}>
              <span className="material-icons-round" style={styles.inputIcon}>lock</span>
              <input
                style={{ ...styles.input, paddingRight: 44 }}
                type={showPw ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); setError('') }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={styles.eyeBtn}
                tabIndex={-1}
              >
                <span className="material-icons-round" style={{ fontSize: 18, color: '#888' }}>
                  {showPw ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={styles.error}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>error_outline</span>
              {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.spinner} /> Signing in…
                </span>
              : <>
                  <span className="material-icons-round" style={{ fontSize: 18 }}>login</span>
                  Sign In
                </>
            }
          </button>

        </form>

      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f5eefa 0%, #ede7f6 100%)',
    padding: 24,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 40px 28px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 8px 40px rgba(64,15,97,.12)',
    border: '1px solid #e8d5f7',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    background: '#f5eefa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  appName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#400f61',
    lineHeight: 1.3,
  },
  appSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  field: {
    marginBottom: 18,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#333',
    marginBottom: 6,
  },
  inputWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 12,
    fontSize: 18,
    color: '#400f61',
    opacity: 0.6,
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '11px 12px 11px 40px',
    border: '1.5px solid #d4d0da',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    color: '#1a1a1a',
    background: '#fafafa',
    transition: 'border-color .15s, box-shadow .15s',
    boxSizing: 'border-box',
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: 4,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#b71c1c',
    fontSize: 13,
    background: '#ffebee',
    border: '1px solid #ef9a9a',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 16,
  },
  btn: {
    width: '100%',
    padding: '12px',
    background: '#400f61',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'inherit',
    transition: 'background .15s',
    marginTop: 4,
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid rgba(255,255,255,.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin .7s linear infinite',
  },
  hint: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 12,
    color: '#aaa',
  },
}
