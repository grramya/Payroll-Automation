// BRD §4.5 FR-23: Green bg = favorable, red = unfavorable
import { fmtDelta, fmtPct, fmt } from "../engine/formatter";
import { isFavorable } from "../constants/favorableDir";
import type { Units } from "../types";

interface VarianceCellProps {
  actual: number | null;
  budget: number | null;
  metricId: string;
  units: Units;
  showPct?: boolean; // true → show delta%, false → show delta$
}

const BG_FAVORABLE   = "#E8F5E9";
const BG_UNFAVORABLE = "#FFEBEE";
const BG_NEUTRAL     = "transparent";

export default function VarianceCell({
  actual, budget, metricId, units, showPct = false,
}: VarianceCellProps) {
  if (actual == null || budget == null) {
    return (
      <td style={{ ...cellStyle, color: "#9E9E9E" }}>—</td>
    );
  }

  const delta = actual - budget;
  const favorable = isFavorable(metricId, delta);
  const bg = delta === 0 ? BG_NEUTRAL : favorable ? BG_FAVORABLE : BG_UNFAVORABLE;

  const display = showPct
    ? (budget !== 0 ? fmtPct(delta / Math.abs(budget)) : "—")
    : fmtDelta(delta, units);

  return (
    <td
      style={{
        ...cellStyle,
        background: bg,
        color: delta === 0 ? "#6B7280" : favorable ? "#1B5E20" : "#B71C1C",
        fontWeight: 600,
      }}
    >
      {display}
    </td>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "4px 6px",
  textAlign: "right",
  fontSize: "0.72rem",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  borderTop: "1px solid #F1F5F9",
};
