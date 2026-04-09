import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { downloadConsolidatedJEUrl, downloadConsolidatedInputsUrl } from '../api/api'

const STEPS = [
  { n: 1, icon: 'upload_file', label: 'Generate JE' },
  { n: 2, icon: 'table_view',  label: 'JE Preview' },
  { n: 3, icon: 'edit_note',   label: 'Edit Mapping' },
  { n: 4, icon: 'cloud_sync',  label: 'QuickBooks' },
]

export default function Sidebar({ collapsed, onToggle }) {
  const { sessionId } = useApp()
  const c = collapsed

  const navItemStyle = (extra = {}) => ({
    ...styles.navItem,
    justifyContent: c ? 'center' : 'flex-start',
    padding: c ? '10px 0' : '10px 12px',
    ...extra,
  })

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>

      {/* Toggle tab on right edge */}
      <button onClick={onToggle} style={styles.toggleTab} title={c ? 'Expand' : 'Collapse'}>
        <span className="material-icons-round" style={{ fontSize: 16 }}>
          {c ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>

      <aside style={{ ...styles.aside, width: c ? 64 : 220 }}>

        {/* Brand */}
        <div style={{ ...styles.brand, justifyContent: c ? 'center' : 'flex-start' }}>
          <span className="material-icons-round" style={styles.brandIcon}>receipt_long</span>
          {!c && (
            <div>
              <div style={styles.brandName}>Payroll JE</div>
              <div style={styles.brandSub}>Automation</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={styles.nav}>

          {STEPS.map(({ n, icon, label }) => {
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
                {!c && <span style={styles.stepNum}>{n}</span>}
                <span className="material-icons-round" style={styles.navIcon}>{icon}</span>
                {!c && <span style={styles.navLabel}>{label}</span>}
                {!c && locked && <span className="material-icons-round" style={styles.lockIcon}>lock</span>}
              </NavLink>
            )
          })}

          <div style={styles.divider} />

          <NavLink
            to="/activity-log"
            title={c ? 'Activity Log' : undefined}
            style={({ isActive }) => ({
              ...navItemStyle(),
              ...(isActive ? styles.navItemActive : {}),
            })}
          >
            <span className="material-icons-round" style={styles.navIcon}>history</span>
            {!c && <span style={styles.navLabel}>Activity Log</span>}
          </NavLink>

          <div style={styles.divider} />

          {!c && <div style={styles.sectionLabel}>Downloads</div>}

          <a
            href={downloadConsolidatedJEUrl()}
            download="Consolidated_Payroll.xlsx"
            title={c ? 'Consolidated Payroll JE' : undefined}
            style={navItemStyle()}
          >
            <span className="material-icons-round" style={styles.navIcon}>table_chart</span>
            {!c && <span style={styles.navLabel}>Consolidated JE</span>}
            {!c && <span className="material-icons-round" style={styles.downloadIcon}>download</span>}
          </a>

          <a
            href={downloadConsolidatedInputsUrl()}
            download="Consolidated_Inputs.xlsx"
            title={c ? 'Consolidated Inputs' : undefined}
            style={navItemStyle()}
          >
            <span className="material-icons-round" style={styles.navIcon}>folder_zip</span>
            {!c && <span style={styles.navLabel}>Consolidated Inputs</span>}
            {!c && <span className="material-icons-round" style={styles.downloadIcon}>download</span>}
          </a>

        </nav>

        {/* Footer */}
        <div style={{ ...styles.footer, justifyContent: 'center' }}>
          <span className="material-icons-round" style={{ fontSize: 16, color: 'rgba(255,255,255,.5)' }}>info</span>
          {!c && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginLeft: 6 }}>Payroll JE Automation</span>}
        </div>

      </aside>
    </div>
  )
}

const styles = {
  aside: {
    height: '100%',
    background: 'linear-gradient(180deg, #400f61 0%, #2d0a45 100%)',
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
    background: '#400f61',
    border: '1px solid rgba(255,255,255,.25)',
    borderLeft: 'none',
    borderRadius: '0 8px 8px 0',
    color: '#fff',
    cursor: 'pointer',
    padding: 0,
    transition: 'background .15s',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '18px 14px 16px',
    borderBottom: '1px solid rgba(255,255,255,.12)',
    marginBottom: 12,
  },
  brandIcon: {
    fontSize: 26,
    color: '#fff',
    background: 'rgba(255,255,255,.15)',
    borderRadius: 10,
    padding: 6,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  brandSub: {
    color: 'rgba(255,255,255,.6)',
    fontSize: 11,
    fontWeight: 400,
    lineHeight: 1.3,
  },
  nav: {
    flex: 1,
    padding: '4px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    color: 'rgba(255,255,255,.7)',
    textDecoration: 'none',
    fontSize: 13.5,
    fontWeight: 500,
    transition: 'background .15s, color .15s',
    whiteSpace: 'nowrap',
  },
  navItemActive: {
    background: 'rgba(255,255,255,.18)',
    color: '#fff',
  },
  navItemLocked: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'rgba(255,255,255,.2)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navIcon: {
    fontSize: 18,
    flexShrink: 0,
  },
  navLabel: {
    flex: 1,
  },
  lockIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  downloadIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  divider: {
    borderTop: '1px solid rgba(255,255,255,.12)',
    margin: '8px 0',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,.4)',
    padding: '4px 4px 2px',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px 12px',
    borderTop: '1px solid rgba(255,255,255,.1)',
  },
}
