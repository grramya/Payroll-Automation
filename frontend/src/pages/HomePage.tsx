import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const isAdmin    = user?.role === 'admin'
  const canPayroll = isAdmin || user?.can_access_payroll
  const canFpa     = isAdmin || user?.can_access_fpa

  const firstName = user?.name?.split(' ')[0] ?? user?.username ?? 'there'

  return (
    <div style={styles.page}>
      {/* Greeting */}
      <div style={styles.greeting}>
        <div>
          <h1 style={styles.greetTitle}>Welcome back, {firstName}</h1>
          <p style={styles.greetSub}>Select a module below to get started.</p>
        </div>
      </div>

      {/* Module cards */}
      <div style={styles.cardGrid}>
        {canPayroll && (
          <ModuleCard
            icon="receipt_long"
            iconBg="#400f61"
            title="Payroll JE Automation"
            description="Upload payroll data, review journal entries, edit account mappings, and push directly to QuickBooks Online."
            features={['Generate JE from payroll files', 'Preview & validate entries', 'Edit account mappings', 'Post to QuickBooks']}
            onClick={() => navigate('/step/1')}
          />
        )}

        {canFpa && (
          <ModuleCard
            icon="analytics"
            iconBg="#1565C0"
            title="FP&A Analytics"
            description="Process financial statements and generate balance sheets, P&L comparisons, and consolidated reports."
            features={['Upload financial data', 'Balance sheet analysis', 'P&L comparisons', 'Comparative breakdowns']}
            onClick={() => navigate('/fpa/')}
          />
        )}

        {!canPayroll && !canFpa && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 32px', color: 'var(--muted)' }}>
            <span className="material-icons-round" style={{ fontSize: 40, marginBottom: 12, display: 'block' }}>lock</span>
            <p>You do not have access to any modules. Contact your administrator.</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface ModuleCardProps {
  icon: string
  iconBg: string
  title: string
  description: string
  features: string[]
  onClick: () => void
}

function ModuleCard({ icon, iconBg, title, description, features, onClick }: ModuleCardProps) {
  return (
    <div
      className="card"
      style={styles.moduleCard}
      onClick={onClick}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--p)'
        el.style.boxShadow = '0 4px 20px rgba(64,15,97,0.14)'
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--border)'
        el.style.boxShadow = 'var(--shadow)'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div style={styles.cardHeader}>
        <div style={{ ...styles.cardIcon, background: iconBg }}>
          <span className="material-icons-round" style={{ fontSize: 28, color: '#fff' }}>{icon}</span>
        </div>
        <h2 style={styles.cardTitle}>{title}</h2>
      </div>

      <p style={styles.cardDesc}>{description}</p>

      <ul style={styles.featureList}>
        {features.map(f => (
          <li key={f} style={styles.featureItem}>
            <span className="material-icons-round" style={styles.checkIcon}>check_circle</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button className="btn btn-primary" style={styles.openBtn}>
        Open {title}
        <span className="material-icons-round" style={{ fontSize: 16 }}>arrow_forward</span>
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 960,
    margin: '0 auto',
  },
  greeting: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 40,
    paddingBottom: 28,
    borderBottom: '1px solid var(--border)',
  },
  greetTitle: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 4,
  },
  greetSub: {
    fontSize: 14,
    color: 'var(--muted)',
    margin: 0,
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: 24,
  },
  moduleCard: {
    cursor: 'pointer',
    transition: 'border-color .18s, box-shadow .18s, transform .18s',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 700,
    margin: 0,
  },
  cardDesc: {
    fontSize: 13.5,
    color: 'var(--muted)',
    lineHeight: 1.6,
    margin: 0,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--text)',
  },
  checkIcon: {
    fontSize: 16,
    color: '#2e7d32',
    flexShrink: 0,
  },
  openBtn: {
    marginTop: 'auto',
    alignSelf: 'flex-start',
  },
}
