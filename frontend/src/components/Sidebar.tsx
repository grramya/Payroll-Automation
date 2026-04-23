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
  { path: '/fpa/dashboard',        icon: 'dashboard',        label: 'Dashboard' },
  { path: '/fpa/staging',          icon: 'table_chart',      label: 'Staging Output' },
  { path: '/fpa/base-bs',          icon: 'account_balance',  label: 'Base BS' },
  { path: '/fpa/bs-individual',    icon: 'account_tree',     label: 'BS Individual' },
  { path: '/fpa/pl-individual',    icon: 'trending_up',      label: 'Base P&L' },
  { path: '/fpa/comparative-pl',   icon: 'show_chart',       label: 'Comparative P&L' },
  { path: '/fpa/comparative-pl-bd',icon: 'bar_chart',        label: 'Comp P&L (BD)' },
]

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { sessionId } = useApp()
  const { user } = useAuth()
  const { result: fpaResult } = useFpaResult()

  const isAdmin = user?.role === 'admin'
  const canPayroll = isAdmin || user?.can_access_payroll
  const canFpa     = isAdmin || user?.can_access_fpa

  const [payrollOpen, setPayrollOpen] = useState(false)
  const [fpaOpen, setFpaOpen]         = useState(false)

  const c = collapsed

  const navItemStyle = (extra: CSSProperties = {}): CSSProperties => ({
    ...styles.navItem,
    justifyContent: c ? 'center' : 'flex-start',
    padding: c ? '10px 0' : '10px 12px',
    ...extra,
  })

  const SectionToggle = ({ label, open, onToggle: toggle }: { label: string; open: boolean; onToggle: () => void }) =>
    c ? null : (
      <button onClick={toggle} style={styles.sectionToggle}>
        <span style={styles.sectionLabel}>{label}</span>
        <span className="material-icons-round" style={{ fontSize: 14, color: '#9E9E9E' }}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
    )

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>

      {/* Toggle tab on right edge */}
      <button onClick={onToggle} style={styles.toggleTab} title={c ? 'Expand' : 'Collapse'}>
        <span className="material-icons-round" style={{ fontSize: 16 }}>
          {c ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>

      <aside style={{ ...styles.aside, width: c ? 64 : 228 }}>

        {/* Brand */}
        <div style={{ ...styles.brand, justifyContent: c ? 'center' : 'flex-start' }}>
          <span className="material-icons-round" style={styles.brandIcon}>apps</span>
          {!c && (
            <div>
              <div style={styles.brandName}>Finance Suite</div>
              <div style={styles.brandSub}>Vearc Automation</div>
            </div>
          )}
        </div>

        <nav style={styles.nav}>

          {/* ── Home ── */}
          <NavLink
            to="/"
            end
            title={c ? 'Home' : undefined}
            style={({ isActive }) => ({ ...navItemStyle(), ...(isActive ? styles.navItemActive : {}) })}
          >
            <span className="material-icons-round" style={styles.navIcon}>home</span>
            {!c && <span style={styles.navLabel}>Home</span>}
          </NavLink>
          <div style={styles.divider} />

          {/* ── Payroll JE Section ── */}
          {canPayroll && (
            <>
              <SectionToggle label="Payroll JE Automation" open={payrollOpen} onToggle={() => setPayrollOpen(v => !v)} />

              {(payrollOpen || c) && (
                <>
                  {PAYROLL_STEPS.map(({ n, icon, label }) => {
                    const locked = n === 2 && !sessionId
                    return (
                      <NavLink
                        key={n}
                        to={locked ? '#' : `/step/${n}`}
                        onClick={locked ? (e) => e.preventDefault() : undefined}
                        title={c ? label : undefined}
                        style={({ isActive }) => ({
                          ...navItemStyle(),
                          ...(isActive ? styles.navItemActive : {}),
                          ...(locked ? styles.navItemLocked : {}),
                        })}
                      >
                        <span className="material-icons-round" style={styles.navIcon}>{icon}</span>
                        {!c && <span style={styles.navLabel}>{label}</span>}
                        {!c && locked && <span className="material-icons-round" style={styles.lockIcon}>lock</span>}
                      </NavLink>
                    )
                  })}

                  <NavLink
                    to="/activity-log"
                    title={c ? 'Activity Log' : undefined}
                    style={({ isActive }) => ({ ...navItemStyle(), ...(isActive ? styles.navItemActive : {}) })}
                  >
                    <span className="material-icons-round" style={styles.navIcon}>history</span>
                    {!c && <span style={styles.navLabel}>Activity Log</span>}
                  </NavLink>

                  {!c && <div style={{ ...styles.subLabel }}>Downloads</div>}
                  <a href={downloadConsolidatedJEUrl()} download="Consolidated_Payroll.xlsx" title={c ? 'Consolidated JE' : undefined} style={navItemStyle()}>
                    <span className="material-icons-round" style={styles.navIcon}>table_chart</span>
                    {!c && <span style={styles.navLabel}>Consolidated JE</span>}
                    {!c && <span className="material-icons-round" style={styles.downloadIcon}>download</span>}
                  </a>
                  <a href={downloadConsolidatedInputsUrl()} download="Consolidated_Inputs.xlsx" title={c ? 'Consolidated Inputs' : undefined} style={navItemStyle()}>
                    <span className="material-icons-round" style={styles.navIcon}>folder_zip</span>
                    {!c && <span style={styles.navLabel}>Consolidated Inputs</span>}
                    {!c && <span className="material-icons-round" style={styles.downloadIcon}>download</span>}
                  </a>
                </>
              )}
            </>
          )}

          <div style={styles.divider} />

          {/* ── FP&A Section ── */}
          {canFpa && (
            <>
              <SectionToggle label="FP&A Automation" open={fpaOpen} onToggle={() => setFpaOpen(v => !v)} />

              {(fpaOpen || c) && (
                <>
                  <NavLink
                    to="/fpa/"
                    title={c ? 'FP&A Generate' : undefined}
                    style={({ isActive }) => ({ ...navItemStyle(), ...(isActive ? styles.navItemActiveFpa : {}) })}
                  >
                    <span className="material-icons-round" style={styles.navIcon}>tune</span>
                    {!c && <span style={styles.navLabel}>Generate</span>}
                  </NavLink>

                  {FPA_RESULT_ITEMS.map(({ path, icon, label }) => {
                    const locked = !fpaResult
                    return (
                      <NavLink
                        key={path}
                        to={locked ? '#' : path}
                        onClick={locked ? (e) => e.preventDefault() : undefined}
                        title={c ? label : undefined}
                        style={({ isActive }) => ({
                          ...navItemStyle(),
                          ...(isActive && !locked ? styles.navItemActiveFpa : {}),
                          ...(locked ? styles.navItemLocked : {}),
                        })}
                      >
                        <span className="material-icons-round" style={styles.navIcon}>{icon}</span>
                        {!c && <span style={styles.navLabel}>{label}</span>}
                        {!c && locked && <span className="material-icons-round" style={styles.lockIcon}>lock</span>}
                      </NavLink>
                    )
                  })}
                </>
              )}
            </>
          )}

          {/* ── Admin ── */}
          {isAdmin && (
            <>
              <div style={styles.divider} />
              {!c && <div style={styles.sectionLabel}>Admin</div>}
              <NavLink
                to="/users"
                title={c ? 'Manage Users' : undefined}
                style={({ isActive }) => ({ ...navItemStyle(), ...(isActive ? styles.navItemActive : {}) })}
              >
                <span className="material-icons-round" style={styles.navIcon}>manage_accounts</span>
                {!c && <span style={styles.navLabel}>Manage Users</span>}
              </NavLink>
            </>
          )}

        </nav>

        {/* Footer */}
        <div style={{ ...styles.footer, justifyContent: 'center' }}>
          <span className="material-icons-round" style={{ fontSize: 16, color: '#888' }}>info</span>
          {!c && <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>Finance Suite v2</span>}
        </div>

      </aside>
    </div>
  )
}

// ── Microsoft Teams-inspired color palette ─────────────────────────────────────
// BG: #F5F5F5  |  Text: #252525  |  Muted: #616161  |  Accent: #6264A7
// Active bg: #E8E8F4  |  Hover bg: rgba(98,100,167,0.08)  |  Divider: #E0E0E0

const styles: Record<string, CSSProperties> = {
  aside: {
    height: '100%',
    background: '#F5F5F5',
    borderRight: '1px solid #E0E0E0',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    transition: 'width 0.2s ease',
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
    background: '#F5F5F5',
    border: '1px solid #E0E0E0',
    borderLeft: 'none',
    borderRadius: '0 8px 8px 0',
    color: '#616161',
    cursor: 'pointer',
    padding: 0,
    transition: 'background .15s',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 14px 14px',
    borderBottom: '1px solid #E0E0E0',
    marginBottom: 8,
  },
  brandIcon: {
    fontSize: 22,
    color: '#fff',
    background: '#6264A7',
    borderRadius: 8,
    padding: 6,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: '#252525',
    fontSize: 13.5,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  brandSub: {
    color: '#616161',
    fontSize: 11,
    fontWeight: 400,
    lineHeight: 1.3,
  },
  nav: {
    flex: 1,
    padding: '4px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: 6,
    color: '#252525',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 400,
    transition: 'background .12s, color .12s',
    whiteSpace: 'nowrap',
  },
  navItemActive: {
    background: '#E8E8F4',
    color: '#6264A7',
    fontWeight: 600,
  },
  navItemActiveFpa: {
    background: '#E8E8F4',
    color: '#6264A7',
    fontWeight: 600,
  },
  navItemLocked: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  navIcon: { fontSize: 17, flexShrink: 0, color: '#616161' },
  navLabel: { flex: 1 },
  lockIcon: { fontSize: 12, opacity: 0.5 },
  downloadIcon: { fontSize: 12, opacity: 0.5 },
  divider: {
    borderTop: '1px solid #E0E0E0',
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
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: '#616161',
    whiteSpace: 'nowrap' as const,
  },
  subLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    color: '#9E9E9E',
    padding: '6px 4px 2px',
    whiteSpace: 'nowrap' as const,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 12px',
    borderTop: '1px solid #E0E0E0',
  },
}
