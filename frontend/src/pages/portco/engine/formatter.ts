import type { Units } from "../types";

// BRD §4.6: Number Formatting
export function fmt(value: number | null | undefined, units: Units): string {
  if (value == null || !isFinite(value)) return "—";
  const v = value;
  switch (units) {
    case "$": {
      const abs = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
      if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
      return v < 0
        ? `($${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })})`
        : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
    case "%":
      return v < 0
        ? `(${Math.abs(v * 100).toFixed(1)}%)`
        : `${(v * 100).toFixed(1)}%`;
    case "#":
      return v < 0
        ? `(${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })})`
        : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
    default:
      return v.toFixed(2);
  }
}

export function fmtDelta(delta: number | null, units: Units): string {
  if (delta == null || !isFinite(delta)) return "—";
  const sign = delta >= 0 ? "+" : "";
  if (units === "%") return `${sign}${(delta * 100).toFixed(1)}pp`;
  if (units === "$") {
    const abs = Math.abs(delta);
    const s   = delta < 0 ? "-" : "+";
    if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(1)}K`;
    return `${s}$${abs.toFixed(0)}`;
  }
  return `${sign}${delta.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

export function fmtPct(ratio: number | null): string {
  if (ratio == null || !isFinite(ratio)) return "—";
  const sign = ratio >= 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(1)}%`;
}
