import { useNavigate } from 'react-router-dom'

export default function PageHeader({ icon, title, subtitle, backStep, backLabel }) {
  const navigate = useNavigate()
  return (
    <div>
      {backStep && (
        <button className="back-link" onClick={() => navigate(`/step/${backStep}`)}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>arrow_back</span>
          {backLabel || 'Back'}
        </button>
      )}
      <div className="page-header">
        <div className="page-header-icon">
          <span className="material-icons-round">{icon}</span>
        </div>
        <div>
          <div className="page-header-title">{title}</div>
          {subtitle && <div className="page-header-sub">{subtitle}</div>}
        </div>
      </div>
    </div>
  )
}
