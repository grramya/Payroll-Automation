import { useToast } from '../context/ToastContext'

const VARIANTS = {
  success: { bg: '#e8f5e9', border: '#a5d6a7', color: '#1b5e20', icon: 'check_circle' },
  error:   { bg: '#ffebee', border: '#ef9a9a', color: '#b71c1c', icon: 'error'        },
  info:    { bg: '#e3f2fd', border: '#90caf9', color: '#0d47a1', icon: 'info'         },
  warning: { bg: '#fff8e1', border: '#ffe082', color: '#e65100', icon: 'warning'      },
}

/**
 * Renders all active toasts in a fixed top-right stack.
 * Place this once, at the root of the app, inside <ToastProvider>.
 */
export default function Toaster() {
  const { toasts, dismiss } = useToast()

  if (!toasts.length) return null

  return (
    <div style={s.stack} aria-live="polite" aria-atomic="false">
      {toasts.map(t => {
        const v = VARIANTS[t.type] ?? VARIANTS.info
        return (
          <div
            key={t.id}
            role="alert"
            style={{
              ...s.toast,
              background:  v.bg,
              borderColor: v.border,
              color:        v.color,
              borderLeft:  `4px solid ${v.border}`,
            }}
          >
            <span className="material-icons-round" style={s.icon} aria-hidden="true">
              {v.icon}
            </span>
            <span style={s.msg}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{ ...s.closeBtn, color: v.color }}
              aria-label="Dismiss notification"
            >
              <span className="material-icons-round" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

const s = {
  stack: {
    position: 'fixed',
    top: 20,
    right: 20,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxWidth: 380,
    width: '100%',
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid',
    boxShadow: '0 4px 20px rgba(0,0,0,.12)',
    animation: 'toastSlideIn .25s ease',
    pointerEvents: 'all',
  },
  icon: {
    fontSize: 18,
    flexShrink: 0,
    marginTop: 1,
  },
  msg: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.5,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    opacity: 0.6,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    transition: 'opacity .15s',
  },
}
