import type { MetricRow } from "../types";
import type { MetricMap } from "../types";
import MetricRowComp from "./MetricRow";
import { monthsForYear } from "../engine/periodCalc";

const BRAND = "#512D6D";
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Props {
  rows:           MetricRow[];
  selectedYear:   number;
  derivedActuals: MetricMap;
  derivedBudget:  MetricMap;
  mode:           "actuals" | "budget";
  onCellEdit:     (id: string, month: string, value: number | null) => void;
  view?:          "input" | "report";
  deptLabel?:     string;
}

export default function MetricTable({
  rows, selectedYear, derivedActuals, derivedBudget, mode, onCellEdit, view = "input", deptLabel,
}: Props) {
  const months = monthsForYear(selectedYear);

  const groups: { category: string; rows: MetricRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) {
      last.rows.push(row);
    } else {
      groups.push({ category: row.category, rows: [row] });
    }
  }

  // report mode: 12 months + 4 quarters (Act/Bgt/Diff each) + YTD (Act/Bgt/Diff) + LTM
  // input mode:  12 months + QTD (Act/Bgt/Δ$/Δ%) + YTD (Act/Bgt/Δ$/Δ%) + Trend
  const reportExtraCols = 4 * 3 + 3 + 1; // 16 extra cols in report
  const inputExtraCols  = 4 + 4 + 1;     // 9 extra cols in input (QTD+YTD+spark)

  return (
    <div>
      <table
        style={{
          borderCollapse: "collapse", tableLayout: "fixed",
          width: "100%", minWidth: 1760,
          fontSize: "0.76rem", fontFamily: "Inter, Roboto, sans-serif",
        }}
      >
        {/* colgroup pins column widths so the colSpan dept-label row doesn't collapse them */}
        {view === "report" ? (
          <colgroup>
            <col style={{ width: 220 }} /><col style={{ width: 44 }} />
            {Array.from({ length: 12 }, (_, i) => <col key={i} style={{ width: 72 }} />)}
            {Array.from({ length: 15 }, (_, i) => <col key={i} style={{ width: 70 }} />)}
            <col style={{ width: 72 }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: 220 }} /><col style={{ width: 44 }} />
            {Array.from({ length: 12 }, (_, i) => <col key={i} style={{ width: 72 }} />)}
            {Array.from({ length: 8 },  (_, i) => <col key={i} style={{ width: 70 }} />)}
            <col style={{ width: 68 }} />
          </colgroup>
        )}
        <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
          {deptLabel && (
            <tr>
              <th
                colSpan={100}
                style={{
                  padding: "7px 16px",
                  background: "#EDE9F7",
                  textAlign: "left",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: BRAND,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  borderTop: "2px solid #C4B3E0",
                  borderBottom: "1px solid #D4BBE8",
                  whiteSpace: "nowrap",
                }}
              >
                {deptLabel}
              </th>
            </tr>
          )}
          {view === "report" ? (
            <>
              {/* Report: Q1 Q2 Q3 Q4 YTD LTM header */}
              <tr style={{ background: BRAND }}>
                <th style={{ ...thSticky, color: "#fff", width: 220 }}>Metric</th>
                <th style={{ ...thSticky, left: 220, color: "#fff", width: 44 }}>Units</th>
                {MONTH_ABBR.map((mo, i) => (
                  <th key={i} style={{ ...thH1, color: "#fff", width: 72 }}>{mo}</th>
                ))}
                {(["Q1","Q2","Q3","Q4"] as const).map((q) => (
                  <th key={q} colSpan={3} style={{ ...thH1, color: "#fff", borderLeft: "2px solid rgba(255,255,255,0.25)", width: 70 * 3 }}>
                    {q}
                  </th>
                ))}
                <th colSpan={3} style={{ ...thH1, color: "#fff", borderLeft: "2px solid rgba(255,255,255,0.25)", width: 70 * 3 }}>
                  YTD
                </th>
                <th style={{ ...thH1, color: "#fff", width: 72 }}>LTM</th>
              </tr>
              {/* Sub-header */}
              <tr style={{ background: "#3D1F52" }}>
                <th style={{ ...thSticky, color: "rgba(255,255,255,0.7)", fontSize: "0.65rem", width: 220 }} />
                <th style={{ ...thSticky, left: 220, color: "rgba(255,255,255,0.7)", fontSize: "0.65rem", width: 44 }} />
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} style={{ ...thH2, color: "rgba(255,255,255,0.5)", fontSize: "0.65rem", width: 72 }}>
                    {selectedYear}
                  </th>
                ))}
                {["Act","Bgt","Diff","Act","Bgt","Diff","Act","Bgt","Diff","Act","Bgt","Diff","Act","Bgt","Diff"].map((lbl, i) => (
                  <th
                    key={i}
                    style={{
                      ...thH2, width: 70,
                      color: "rgba(255,255,255,0.7)", fontSize: "0.65rem",
                      borderLeft: (i % 3 === 0) ? "2px solid rgba(255,255,255,0.25)" : undefined,
                    }}
                  >
                    {lbl}
                  </th>
                ))}
                <th style={{ ...thH2, color: "rgba(255,255,255,0.5)", fontSize: "0.65rem", width: 72 }}>12mo</th>
              </tr>
            </>
          ) : (
            <>
              {/* Input: QTD YTD Trend header */}
              <tr style={{ background: BRAND }}>
                <th style={{ ...thSticky, color: "#fff", width: 220 }}>Metric</th>
                <th style={{ ...thSticky, left: 220, color: "#fff", width: 44 }}>Units</th>
                {MONTH_ABBR.map((mo, i) => (
                  <th key={i} style={{ ...thH1, color: "#fff", width: 72 }}>{mo}</th>
                ))}
                <th colSpan={4} style={{ ...thH1, color: "#fff", borderLeft: "2px solid rgba(255,255,255,0.25)", width: 70*4 }}>
                  QTD
                </th>
                <th colSpan={4} style={{ ...thH1, color: "#fff", borderLeft: "2px solid rgba(255,255,255,0.25)", width: 70*4 }}>
                  YTD
                </th>
                <th style={{ ...thH1, color: "#fff", width: 68 }}>Trend</th>
              </tr>
              <tr style={{ background: "#3D1F52" }}>
                <th style={{ ...thSticky, color: "rgba(255,255,255,0.7)", fontSize: "0.65rem", width: 220 }} />
                <th style={{ ...thSticky, left: 220, color: "rgba(255,255,255,0.7)", fontSize: "0.65rem", width: 44 }} />
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} style={{ ...thH2, color: "rgba(255,255,255,0.5)", fontSize: "0.65rem", width: 72 }}>
                    {selectedYear}
                  </th>
                ))}
                {["Act","Bgt","Δ$","Δ%","Act","Bgt","Δ$","Δ%"].map((lbl, i) => (
                  <th
                    key={i}
                    style={{
                      ...thH2, width: 70,
                      color: "rgba(255,255,255,0.7)", fontSize: "0.65rem",
                      borderLeft: (i === 0 || i === 4) ? "2px solid rgba(255,255,255,0.25)" : undefined,
                    }}
                  >
                    {lbl}
                  </th>
                ))}
                <th style={{ ...thH2, color: "rgba(255,255,255,0.5)", fontSize: "0.65rem", width: 68 }}>12mo</th>
              </tr>
            </>
          )}
        </thead>

        <tbody>
          {groups.map(({ category, rows: groupRows }) => (
            <>
              {view === "report" && (
                <tr key={`cat-${category}`} style={{ background: "#F0EBF6" }}>
                  <td
                    colSpan={2}
                    style={{
                      position: "sticky", left: 0, zIndex: 1,
                      padding: "5px 10px",
                      fontWeight: 700, fontSize: "0.7rem",
                      color: BRAND, textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      background: "#F0EBF6",
                      borderTop: "2px solid #D4BBE8",
                      borderBottom: "1px solid #E2D9EF",
                    }}
                  >
                    {category}
                  </td>
                  {Array.from({ length: 12 + reportExtraCols }).map((_, i) => (
                    <td key={i} style={{ background: "#F0EBF6", borderTop: "2px solid #D4BBE8" }} />
                  ))}
                </tr>
              )}

              {groupRows.map((row) => (
                <MetricRowComp
                  key={row.id}
                  row={row}
                  months={months}
                  selectedYear={selectedYear}
                  actualData={derivedActuals[row.id] ?? {}}
                  budgetData={derivedBudget[row.id] ?? {}}
                  allActualData={derivedActuals[row.id] ?? {}}
                  mode={mode}
                  onCellEdit={(month, value) => onCellEdit(row.id, month, value)}
                  view={view}
                />
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "7px 6px", textAlign: "center",
  fontWeight: 600, fontSize: "0.72rem", whiteSpace: "nowrap",
};
const thH1: React.CSSProperties = { ...th, background: BRAND };
const thH2: React.CSSProperties = { ...th, background: "#3D1F52" };

const thSticky: React.CSSProperties = {
  ...th, position: "sticky", left: 0, zIndex: 6,
  background: BRAND, textAlign: "left",
};
