import { useState, useRef, useEffect, useCallback } from 'react'
import type { User } from '../context/AuthContext'

interface AppHeaderProps {
  user: User | null
  onLogout: () => void
}

export default function AppHeader({ user, onLogout }: AppHeaderProps) {
  const [open, setOpen] = useState(false)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const btnRef    = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [close])

  // Close on Escape, return focus to trigger
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
        btnRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, close])

  return (
    <header className="app-header" role="banner">
      {/* Skip-nav: rendered first so keyboard users reach it immediately */}
      <a href="#main-content" className="skip-nav">Skip to main content</a>

      <span className="material-icons-round app-header-logo" aria-hidden="true">apps</span>
      <span className="app-header-title">Finance Suite</span>

      {user && (
        <div className="user-menu-wrap" ref={wrapRef}>
          <button
            ref={btnRef}
            className="user-avatar-btn"
            onClick={() => setOpen(o => !o)}
            aria-label={`${user.username} — account menu`}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span aria-hidden="true">{user.username.charAt(0).toUpperCase()}</span>
          </button>

          {open && (
            <div
              role="menu"
              aria-label="Account menu"
              className="user-dropdown"
            >
              <div
                className="user-dropdown-name"
                role="presentation"
                aria-hidden="true"
              >
                {user.username}
              </div>

              <button
                role="menuitem"
                className="user-dropdown-item"
                onClick={() => { close(); onLogout() }}
              >
                <span className="material-icons-round" aria-hidden="true">logout</span>
                Sign Out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
