import type { CSSProperties } from 'react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useFpaResult } from '../context/FpaResultContext'
import { downloadConsolidatedJEUrl, downloadConsolidatedInputsUrl } from '../api/api'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

const PAYROLL_STEPS = [
  { n: 1, icon: 'upload_file', label: 'Step 1: Generate JE' },
  { n: 2, icon: 'table_view',  label: 'Step 2: JE Preview' },
  { n: 3, icon: 'edit_note',   label: 'Step 3: Edit Mapping' },
  { n: 4, icon: 'cloud_sync',  label: 'Step 4: QuickBooks' },
]

const FPA_RESULT_ITEMS = [
  { path: '/fpa/dashboard',         icon: 'dashboard',       label: 'Dashboard' },
  { path: '/fpa/staging',           icon: 'table_chart',     label: 'Staging Output' },
  { path: '/fpa/base-bs',           icon: 'account_balance', label: 'Base BS' },
  { path: '/fpa/bs-individual',     icon: 'account_tree',    label: 'BS Individual' },
  { path: '/fpa/pl-individual',     icon: 'trending_up',     label: 'Base P&L' },
  { path: '/fpa/comparative-pl',    icon: 'show_chart',      label: 'Comparative P&L' },
  { path: '/fpa/comparative-pl-bd', icon: 'bar_chart',       label: 'Comp P&L (BD)' },
]

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { sessionId } = useApp()
  const { user } = useAuth()
  const { result: fpaResult } = useFpaResult()

  const isAdmin    = user?.role === 'admin'
  const canPayroll = isAdmin || user?.can_access_payroll
  const canFpa     = isAdmin || user?.can_access_fpa

  const [payrollOpen, setPayrollOpen] = useState(false)
  const [fpaOpen, setFpaOpen]         = useState(false)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>

      {/* Toggle tab */}
      <button
        onClick={onToggle}
        style={styles.toggleTab}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
      >
        <span className="material-icons-round" style={{ fontSize: 16 }} aria-hidden="true">
          {collapsed ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>

      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        style={{ ...styles.aside, width: collapsed ? 64 : 228 }}
      >
        {/* Brand */}
        <div style={{ ...styles.brand, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <span className="material-icons-round" style={styles.brandIcon} aria-hidden="true">apps</span>
          {!collapsed && (
            <div>
              <div style={styles.brandName}>Finance Suite</div>
              <div style={styles.brandSub}>Vearc Automation</div>
            </div>
          )}
        </div>

        {collapsed ? (
          // ── COLLAPSED: icon-only rail ────────────────────────────────────
          <nav aria-label="Main navigation (collapsed)" style={{ ...styles.nav, alignItems: 'center' }}>

            <NavLink to="/" end aria-label="Home"
              style={({ isActive }) => ({ ...styles.iconBtn, ...(isActive ? styles.iconBtnActive : {}) })}
            >
              <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">home</span>
            </NavLink>

            {canPayroll && (
              <>
                <div style={styles.divider} role="separator" />
                <NavLink to="/step/1" aria-label="Payroll JE Automation"
                  style={({ isActive }) => ({ ...styles.iconBtn, ...(isActive ? styles.iconBtnActive : {}) })}
                >
                  <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">receipt_long</span>
                </NavLink>
              </>
            )}

            {canFpa && (
              <>
                <div style={{ ...styles.divider, width: '100%' }} role="separator" />
                <NavLink to="/fpa/" aria-label="FP&A Automation"
                  style={({ isActive }) => ({ ...styles.iconBtn, ...(isActive ? styles.iconBtnActive : {}) })}
                >
                  <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">analytics</span>
                </NavLink>
              </>
            )}

            {isAdmin && (
              <>
                <div style={{ ...styles.divider, width: '100%' }} role="separator" />
                <NavLink to="/users" aria-label="Manage Users"
                  style={({ isActive }) => ({ ...styles.iconBtn, ...(isActive ? styles.iconBtnActive : {}) })}
                >
                  <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">manage_accounts</span>
                </NavLink>
              </>
            )}

          </nav>
        ) : (
          // ── EXPANDED: full sidebar ───────────────────────────────────────
          <nav aria-label="Main navigation" style={styles.nav}>

            {/* Home */}
            <NavLink to="/" end
              style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
            >
              <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">home</span>
              <span style={styles.navLabel}>Home</span>
            </NavLink>

            <div style={styles.divider} role="separator" />

            {/* ── Payroll JE Automation ── */}
            {canPayroll && (
              <>
                <button
                  onClick={() => setPayrollOpen(v => !v)}
                  style={styles.sectionToggle}
                  aria-expanded={payrollOpen}
                  aria-controls="payroll-section"
                >
                  <span style={styles.sectionLabel}>Payroll JE Automation</span>
                  <span className="material-icons-round" style={{ fontSize: 14, color: 'var(--sb-muted)' }} aria-hidden="true">
                    {payrollOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                <div id="payroll-section" hidden={!payrollOpen}>
                  {PAYROLL_STEPS.map(({ n, icon, label }) => {
                    const locked = n === 2 && !sessionId
                    if (locked) {
                      return (
                        <span
                          key={n}
                          style={{ ...styles.navItem, ...styles.nestedItem, ...styles.navItemLocked }}
                          aria-disabled="true"
                          title="Complete Step 1 first to unlock this step"
                        >
                          <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">{icon}</span>
                          <span style={styles.navLabel}>{label}</span>
                          <span className="material-icons-round" style={styles.lockIcon} aria-hidden="true">lock</span>
                        </span>
                      )
                    }
                    return (
                      <NavLink
                        key={n}
                        to={`/step/${n}`}
                        style={({ isActive }) => ({
                          ...styles.navItem,
                          ...styles.nestedItem,
                          ...(isActive ? styles.navItemActive : {}),
                        })}
                      >
                        <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">{icon}</span>
                        <span style={styles.navLabel}>{label}</span>
                      </NavLink>
                    )
                  })}

                  <NavLink
                    to="/activity-log"
                    style={({ isActive }) => ({ ...styles.navItem, ...styles.nestedItem, ...(isActive ? styles.navItemActive : {}) })}
                  >
                    <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">history</span>
                    <span style={styles.navLabel}>Activity Log</span>
                  </NavLink>

                  <div style={styles.subLabel} aria-hidden="true">Downloads</div>
                  <a
                    href={downloadConsolidatedJEUrl()}
                    download="Consolidated_Payroll.xlsx"
                    aria-label="Download Consolidated JE as Excel file"
                    style={{ ...styles.navItem, ...styles.nestedItem }}
                  >
                    <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">table_chart</span>
                    <span style={styles.navLabel}>Consolidated JE</span>
                    <span className="material-icons-round" style={styles.downloadIcon} aria-hidden="true">download</span>
                  </a>
                  <a
                    href={downloadConsolidatedInputsUrl()}
                    download="Consolidated_Inputs.xlsx"
                    aria-label="Download Consolidated Inputs as Excel file"
                    style={{ ...styles.navItem, ...styles.nestedItem }}
                  >
                    <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">folder_zip</span>
                    <span style={styles.navLabel}>Consolidated Inputs</span>
                    <span className="material-icons-round" style={styles.downloadIcon} aria-hidden="true">download</span>
                  </a>
                </div>
              </>
            )}

            <div style={styles.divider} role="separator" />

            {/* ── FP&A Automation ── */}
            {canFpa && (
              <>
                <button
                  onClick={() => setFpaOpen(v => !v)}
                  style={styles.sectionToggle}
                  aria-expanded={fpaOpen}
                  aria-controls="fpa-section"
                >
                  <span style={styles.sectionLabel}>FP&amp;A Automation</span>
                  <span className="material-icons-round" style={{ fontSize: 14, color: 'var(--sb-muted)' }} aria-hidden="true">
                    {fpaOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                <div id="fpa-section" hidden={!fpaOpen}>
                  <NavLink
                    to="/fpa/"
                    style={({ isActive }) => ({ ...styles.navItem, ...styles.nestedItem, ...(isActive ? styles.navItemActive : {}) })}
                  >
                    <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">tune</span>
                    <span style={styles.navLabel}>Generate</span>
                  </NavLink>

                  {FPA_RESULT_ITEMS.map(({ path, icon, label }) => {
                    const locked = !fpaResult
                    if (locked) {
                      return (
                        <span
                          key={path}
                          style={{ ...styles.navItem, ...styles.nestedItem, ...styles.navItemLocked }}
                          aria-disabled="true"
                          title="Generate FP&A data first to unlock this view"
                        >
                          <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">{icon}</span>
                          <span style={styles.navLabel}>{label}</span>
                          <span className="material-icons-round" style={styles.lockIcon} aria-hidden="true">lock</span>
                        </span>
                      )
                    }
                    return (
                      <NavLink
                        key={path}
                        to={path}
                        style={({ isActive }) => ({
                          ...styles.navItem,
                          ...styles.nestedItem,
                          ...(isActive ? styles.navItemActive : {}),
                        })}
                      >
                        <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">{icon}</span>
                        <span style={styles.navLabel}>{label}</span>
                      </NavLink>
                    )
                  })}
                </div>
              </>
            )}

            {/* ── Admin ── */}
            {isAdmin && (
              <>
                <div style={styles.divider} role="separator" />
                <div style={styles.sectionLabel} aria-hidden="true">Admin</div>
                <NavLink
                  to="/users"
                  style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
                >
                  <span className="material-icons-round" style={styles.navIcon} aria-hidden="true">manage_accounts</span>
                  <span style={styles.navLabel}>Manage Users</span>
                </NavLink>
              </>
            )}

          </nav>
        )}

        {/* Footer */}
        <div style={{ ...styles.footer, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <span className="material-icons-round" style={{ fontSize: 16, color: 'var(--sb-muted)' }} aria-hidden="true">info</span>
          {!collapsed && <span style={{ fontSize: 11, color: 'var(--sb-muted)', marginLeft: 6 }}>Finance Suite v2</span>}
        </div>

      </aside>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  aside: {
    height: '100%',
    background: 'var(--sb-bg)',
    borderRight: '1px solid var(--sb-border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    transition: 'width 0.22s ease',
  },
  toggleTab: {
    position: 'absolute',
    top: 20,
    right: -16,
    zIndex: 20,
    width: 18,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--sb-bg)',
    border: '1px solid var(--sb-border)',
    borderLeft: 'none',
    borderRadius: '0 8px 8px 0',
    color: 'var(--sb-muted)',
    cursor: 'pointer',
    padding: 0,
    transition: 'background .15s',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 14px 14px',
    borderBottom: '1px solid var(--sb-border)',
    marginBottom: 8,
  },
  brandIcon: {
    fontSize: 22,
    color: '#fff',
    background: 'var(--p)',
    borderRadius: 8,
    padding: 6,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: 'var(--sb-text)',
    fontSize: 13.5,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  brandSub: {
    color: 'var(--sb-muted)',
    fontSize: 11,
    lineHeight: 1.3,
  },
  nav: {
    flex: 1,
    padding: '4px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  // Collapsed icon-only button
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 8,
    color: 'var(--sb-text)',
    textDecoration: 'none',
    transition: 'background .12s',
    flexShrink: 0,
  },
  iconBtnActive: {
    background: 'var(--sb-active-bg)',
    color: 'var(--sb-active-text)',
  },
  // Expanded full nav items
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 6,
    color: 'var(--sb-text)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 400,
    transition: 'background .12s, color .12s',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
  },
  nestedItem: {
    paddingLeft: 20,
    fontSize: 12.5,
  },
  navItemActive: {
    background: 'var(--sb-active-bg)',
    color: 'var(--sb-active-text)',
    fontWeight: 600,
  },
  navItemLocked: {
    opacity: 0.45,
    cursor: 'not-allowed',
    userSelect: 'none' as const,
  },
  navIcon: { fontSize: 17, flexShrink: 0, color: 'var(--sb-muted)' },
  navLabel: { flex: 1 },
  lockIcon: { fontSize: 12, opacity: 0.55 },
  downloadIcon: { fontSize: 12, opacity: 0.55 },
  divider: {
    borderTop: '1px solid var(--sb-border)',
    margin: '6px 0',
  },
  sectionToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px 4px 4px',
    marginTop: 10,
    borderRadius: 4,
    fontFamily: 'inherit',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: 'var(--sb-muted)',
    whiteSpace: 'nowrap' as const,
  },
  subLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    color: '#9E9E9E',
    padding: '8px 4px 2px 20px',
    whiteSpace: 'nowrap' as const,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 12px',
    borderTop: '1px solid var(--sb-border)',
  },
}
