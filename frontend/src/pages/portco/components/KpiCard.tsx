// BRD §5.4: Executive Summary card — department header + KPI chips
import { fmt } from "../engine/formatter";
import { isFavorable } from "../constants/favorableDir";
import type { Units } from "../types";

const BRAND = "#512D6D";

interface KpiChip {
  label:    string;
  value:    number | null;
  budget:   number | null;
  units:    Units;
  metricId: string;
}

interface KpiCardProps {
  department: string;
  kpis:       KpiChip[];
  onClick:    () => void;
}

export default function KpiCard({ department, kpis, onClick }: KpiCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden",
        cursor: "pointer", background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow .15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(81,45,109,0.15)")}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)")}
    >
      {/* Purple header strip */}
      <div style={{
        background: BRAND, color: "#fff",
        padding: "8px 14px", fontWeight: 700, fontSize: "0.88rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        {department}
        <span className="material-icons-round" style={{ fontSize: 16, opacity: 0.7 }}>
          chevron_right
        </span>
      </div>

      {/* 2-column KPI chip grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#F1F5F9", padding: 1 }}>
        {kpis.map((kpi) => {
          const delta = (kpi.value != null && kpi.budget != null) ? kpi.value - kpi.budget : null;
          const favorable = delta != null ? isFavorable(kpi.metricId, delta) : null;
          const varColor = favorable == null ? "#94A3B8" : favorable ? "#27AE60" : "#E74C3C";

          return (
            <div key={kpi.label} style={{ background: "#fff", padding: "10px 12px" }}>
              <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {kpi.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1A2E44", fontFamily: "monospace" }}>
                  {kpi.value == null ? <span style={{ color: "#9E9E9E" }}>—</span> : fmt(kpi.value, kpi.units)}
                </span>
                {delta != null && (
                  <span style={{ fontSize: "0.68rem", fontWeight: 600, color: varColor }}>
                    {favorable ? "▲" : "▼"} {fmt(Math.abs(delta), kpi.units)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
