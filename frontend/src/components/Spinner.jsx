export default function Spinner({ label = 'Processing…' }) {
  return (
    <div className="spinner-overlay">
      <div className="spinner" />
      <div className="spinner-label">{label}</div>
    </div>
  )
}
