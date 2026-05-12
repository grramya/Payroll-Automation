import type { CSSProperties } from 'react'

interface SkeletonBlockProps {
  height?: number | string
  width?: number | string
  borderRadius?: number
  style?: CSSProperties
}

/** Single animated skeleton placeholder bar. */
export function SkeletonBlock({ height = 18, width = '100%', borderRadius = 6, style }: SkeletonBlockProps) {
  return (
    <div
      style={{
        height,
        width,
        borderRadius,
        background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s infinite linear',
        ...style,
      }}
      aria-hidden="true"
    />
  )
}

/** Skeleton for a metric-card row (3 cards side by side). */
export function MetricCardsSkeleton() {
  return (
    <div className="metric-row" aria-label="Loading metrics…" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <div key={i} className="metric-card">
          <SkeletonBlock height={36} width="60%" style={{ marginBottom: 8 }} />
          <SkeletonBlock height={14} width="80%" />
        </div>
      ))}
      <style>{`
        @keyframes skeleton-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  )
}

/** Skeleton for a data table (header + N rows). */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-label="Loading table…" aria-busy="true" style={{ width: '100%' }}>
      <style>{`
        @keyframes skeleton-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={i} height={20} width={`${100 / cols}%`} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock key={c} height={16} width={`${100 / cols}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Skeleton for a card with a title + body lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-label="Loading…" aria-busy="true">
      <style>{`
        @keyframes skeleton-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
      <SkeletonBlock height={22} width="40%" style={{ marginBottom: 16 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} height={14} width={i === lines - 1 ? '60%' : '100%'} style={{ marginBottom: 10 }} />
      ))}
    </div>
  )
}
