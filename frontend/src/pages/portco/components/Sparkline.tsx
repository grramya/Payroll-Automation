// BRD §5.2: 60px wide inline SVG sparkline (last 12 months)
interface SparklineProps {
  values: (number | null)[];
}

export default function Sparkline({ values }: SparklineProps) {
  const valid = values.filter((v): v is number => v !== null && isFinite(v));
  if (valid.length < 2) {
    return <svg width={60} height={24} aria-hidden="true" />;
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const W = 60, H = 22, PAD = 1;

  const pts = values
    .map((v, i) => {
      if (v === null || !isFinite(v)) return null;
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean);

  const polyline = pts.join(" ");
  const last = valid[valid.length - 1];
  const first = valid[0];
  const trending = last > first;
  const stroke = trending ? "#27AE60" : last < first ? "#E74C3C" : "#94A3B8";

  return (
    <svg width={W} height={H} aria-label="trend" role="img">
      <polyline
        points={polyline}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
