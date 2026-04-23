import { useState, useRef, useEffect } from 'react'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import type { User } from '../context/AuthContext'

interface AppHeaderProps {
  user: User | null
  onLogout: () => void
  darkMode: boolean
  onToggleDark: () => void
}

export default function AppHeader({ user, onLogout, darkMode, onToggleDark }: AppHeaderProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="app-header">
      <span className="material-icons-round app-header-logo">apps</span>
      <span className="app-header-title">Finance Suite</span>

      {user && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Dark / Light mode toggle */}
          <button
            onClick={onToggleDark}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: '50%',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--p)', transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-light)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {darkMode
              ? <LightModeIcon style={{ fontSize: 22 }} />
              : <DarkModeIcon  style={{ fontSize: 22 }} />}
          </button>

          {/* Profile avatar + dropdown */}
          <div ref={ref} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpen(o => !o)}
              title={user.username}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                background: 'var(--p)', border: 'none', cursor: 'pointer',
                color: '#fff', fontWeight: 700, fontSize: 15,
                fontFamily: 'inherit',
              }}
            >
              {user.username.charAt(0).toUpperCase()}
            </button>

            {open && (
              <div style={{
                position: 'absolute', top: 44, right: 0,
                background: 'var(--surface)', borderRadius: 10,
                boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
                minWidth: 160, zIndex: 999,
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  padding: '10px 16px 8px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13, fontWeight: 600, color: 'var(--p)',
                }}>
                  {user.username}
                </div>
                <button
                  onClick={() => { setOpen(false); onLogout() }}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 16px', background: 'none', border: 'none',
                    fontSize: 13, color: 'var(--text)', cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span className="material-icons-round" style={{ fontSize: 16, color: 'var(--p)' }}>logout</span>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
