export default function AppHeader({ user, onLogout }) {
  return (
    <header className="app-header">
      <span className="material-icons-round app-header-logo">receipt_long</span>
      <span className="app-header-title">Payroll JE Automation</span>

      {user && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="material-icons-round" style={{ fontSize: 18, color: 'var(--p)', opacity: 0.7 }}>
            account_circle
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--p)' }}>
            {user.username}
          </span>
          <button
            onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: '1.5px solid var(--p)',
              borderRadius: 8, padding: '5px 12px',
              fontSize: 12, fontWeight: 600, color: 'var(--p)',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--p-light)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
            title="Sign out"
          >
            <span className="material-icons-round" style={{ fontSize: 15 }}>logout</span>
            Sign Out
          </button>
        </div>
      )}
    </header>
  )
}
