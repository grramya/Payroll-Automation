import type { ReactNode } from 'react'

type AlertType = 'success' | 'warn' | 'error' | 'info'

interface AlertProps {
  type?: AlertType
  children: ReactNode
  onClose?: () => void
}

const ICONS: Record<AlertType, string> = {
  success: 'check_circle',
  warn: 'warning',
  error: 'error',
  info: 'info',
}

export default function Alert({ type = 'info', children, onClose }: AlertProps) {
  return (
    <div className={`alert alert-${type}`}>
      <span className="material-icons-round">{ICONS[type]}</span>
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }}
        >
          <span className="material-icons-round" style={{ fontSize: 16 }}>close</span>
        </button>
      )}
    </div>
  )
}
