interface SpinnerProps {
  label?: string
}

export default function Spinner({ label = 'Processing…' }: SpinnerProps) {
  return (
    <div className="spinner-overlay">
      <div className="spinner" />
      <div className="spinner-label">{label}</div>
    </div>
  )
}
