import { useState, useRef, useEffect } from "react";
import type { MetricRow as MetricRowType } from "../types";
import { fmt } from "../engine/formatter";
import { getQTD, getYTD, getLTM, lastFilledMonth, getQuarterValue } from "../engine/periodCalc";
import VarianceCell from "./VarianceCell";
import Sparkline from "./Sparkline";

const COL_LABEL = 220;
const COL_UNIT  = 44;
const COL_MONTH = 72;
const COL_VAR   = 70;
const COL_SPARK = 68;

const BRAND    = "#512D6D";
const BG_COMP  = "#F5F5F5";
const BG_EDIT  = "#FFFFFF";
const BG_BGT   = "#F0F4FF";
const MISSING  = "#9E9E9E";

interface Props {
  row:           MetricRowType;
  months:        string[];
  selectedYear:  number;
  actualData:    Record<string, number | null>;
  budgetData:    Record<string, number | null>;
  allActualData: Record<string, number | null>;
  mode:          "actuals" | "budget";
  onCellEdit:    (month: string, value: number | null) => void;
  view?:         "input" | "report";
}

export default function MetricRow({
  row, months, selectedYear, actualData, budgetData,
  allActualData, mode, onCellEdit, view = "input",
}: Props) {
  const [editCell,  setEditCell]  = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus();
  }, [editCell]);

  const isReadOnly = view === "report";
  const displayData = isReadOnly ? actualData : (mode === "actuals" ? actualData : budgetData);

  const startEdit = (m: string) => {
    if (!row.isEditable || isReadOnly) return;
    setEditCell(m);
    setEditValue(displayData[m] != null ? String(displayData[m]) : "");
  };
  const commit = () => {
    if (!editCell) return;
    const v = editValue.trim() === "" ? null : Number(editValue.replace(/,/g, ""));
    onCellEdit(editCell, isNaN(v as number) ? null : v);
    setEditCell(null);
  };

  const sparkVals: (number | null)[] = (() => {
    const mos = Object.keys(allActualData).sort();
    return mos.slice(-12).map((m) => allActualData[m] ?? null);
  })();

  const lastM  = lastFilledMonth(actualData, selectedYear);
  const qtdAct = getQTD(actualData, selectedYear, lastM, row.aggMethod);
  const ytdAct = getYTD(actualData, selectedYear, lastM, row.aggMethod);
  const qtdBgt = getQTD(budgetData,  selectedYear, lastM, row.aggMethod);
  const ytdBgt = getYTD(budgetData,  selectedYear, lastM, row.aggMethod);

  // Report-mode quarterly values
  const q1Act = getQuarterValue(actualData, selectedYear, 1, row.aggMethod);
  const q2Act = getQuarterValue(actualData, selectedYear, 2, row.aggMethod);
  const q3Act = getQuarterValue(actualData, selectedYear, 3, row.aggMethod);
  const q4Act = getQuarterValue(actualData, selectedYear, 4, row.aggMethod);
  const q1Bgt = getQuarterValue(budgetData, selectedYear, 1, row.aggMethod);
  const q2Bgt = getQuarterValue(budgetData, selectedYear, 2, row.aggMethod);
  const q3Bgt = getQuarterValue(budgetData, selectedYear, 3, row.aggMethod);
  const q4Bgt = getQuarterValue(budgetData, selectedYear, 4, row.aggMethod);
  // YTD for report = full year actuals vs budget (Dec of selected year)
  const ytdActReport = getYTD(actualData, selectedYear, 12, row.aggMethod);
  const ytdBgtReport = getYTD(budgetData,  selectedYear, 12, row.aggMethod);
  const ltm = getLTM(actualData, `${selectedYear}-12`, row.aggMethod);

  const rowBg = isReadOnly
    ? (!row.isEditable ? BG_COMP : BG_EDIT)
    : (!row.isEditable ? BG_COMP : mode === "budget" ? BG_BGT : BG_EDIT);

  return (
    <tr style={{ background: rowBg }}>

      {/* Metric label */}
      <td
        style={{
          position: "sticky", left: 0, zIndex: 1,
          width: COL_LABEL, minWidth: COL_LABEL, maxWidth: COL_LABEL,
          background: rowBg, borderTop: "1px solid #F1F5F9",
          padding: "4px 10px", fontSize: "0.76rem", color: "#334155",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
        title={row.lineItem}
      >
        {!row.isEditable && (
          <span
            style={{
              display: "inline-block", fontSize: "0.55rem", fontWeight: 700,
              color: BRAND, border: `1px solid ${BRAND}`, borderRadius: 3,
              padding: "0 3px", marginRight: 4, verticalAlign: "middle",
              lineHeight: 1.6,
            }}
          >
            fx
          </span>
        )}
        {row.lineItem}
      </td>

      {/* Units */}
      <td
        style={{
          position: "sticky", left: COL_LABEL, zIndex: 1,
          width: COL_UNIT, background: rowBg, borderTop: "1px solid #F1F5F9",
          padding: "4px 4px", fontSize: "0.68rem", color: "#94A3B8",
          textAlign: "center",
        }}
      >
        {row.units}
      </td>

      {/* 12 monthly cells */}
      {months.map((m) => {
        const v       = displayData[m] ?? null;
        const editing = editCell === m;
        const outlineColor = mode === "budget" ? "#64748B" : BRAND;

        return (
          <td
            key={m}
            style={{
              width: COL_MONTH, minWidth: COL_MONTH,
              padding: "2px 4px", textAlign: "right",
              fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 500,
              borderTop: "1px solid #F1F5F9",
              cursor: (row.isEditable && !isReadOnly) ? "text" : "default",
              outline: editing ? `2px solid ${outlineColor}` : "none",
            }}
            onClick={() => startEdit(m)}
          >
            {editing ? (
              <input
                ref={inputRef}
                type="text" inputMode="numeric" value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(); }
                  if (e.key === "Escape") setEditCell(null);
                }}
                onBlur={commit}
                style={{
                  width: "100%", border: "none", outline: "none",
                  background: "transparent", textAlign: "right",
                  fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 500,
                }}
              />
            ) : (
              <span style={{ color: v == null ? MISSING : "#0F172A" }}>
                {v == null ? "—" : fmt(v, row.units)}
              </span>
            )}
          </td>
        );
      })}

      {view === "report" ? (
        <>
          {/* Q1 Act | Bgt | Diff */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: q1Act == null ? MISSING : "#0F172A" }}>
              {q1Act == null ? "—" : fmt(q1Act, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: q1Bgt == null ? MISSING : "#6B7280" }}>
              {q1Bgt == null ? "—" : fmt(q1Bgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={q1Act} budget={q1Bgt} metricId={row.id} units={row.units} />

          {/* Q2 Act | Bgt | Diff */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: q2Act == null ? MISSING : "#0F172A" }}>
              {q2Act == null ? "—" : fmt(q2Act, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: q2Bgt == null ? MISSING : "#6B7280" }}>
              {q2Bgt == null ? "—" : fmt(q2Bgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={q2Act} budget={q2Bgt} metricId={row.id} units={row.units} />

          {/* Q3 Act | Bgt | Diff */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: q3Act == null ? MISSING : "#0F172A" }}>
              {q3Act == null ? "—" : fmt(q3Act, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: q3Bgt == null ? MISSING : "#6B7280" }}>
              {q3Bgt == null ? "—" : fmt(q3Bgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={q3Act} budget={q3Bgt} metricId={row.id} units={row.units} />

          {/* Q4 Act | Bgt | Diff */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: q4Act == null ? MISSING : "#0F172A" }}>
              {q4Act == null ? "—" : fmt(q4Act, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: q4Bgt == null ? MISSING : "#6B7280" }}>
              {q4Bgt == null ? "—" : fmt(q4Bgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={q4Act} budget={q4Bgt} metricId={row.id} units={row.units} />

          {/* YTD Act | Bgt | Diff */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: ytdActReport == null ? MISSING : "#0F172A" }}>
              {ytdActReport == null ? "—" : fmt(ytdActReport, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: ytdBgtReport == null ? MISSING : "#6B7280" }}>
              {ytdBgtReport == null ? "—" : fmt(ytdBgtReport, row.units)}
            </span>
          </td>
          <VarianceCell actual={ytdActReport} budget={ytdBgtReport} metricId={row.id} units={row.units} />

          {/* LTM */}
          <td style={{ ...varGroup, color: ltm == null ? MISSING : "#334155" }}>
            {ltm == null ? "—" : fmt(ltm, row.units)}
          </td>
        </>
      ) : (
        <>
          {/* QTD: Act | Bgt | Δ$ | Δ% */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: qtdAct == null ? MISSING : "#0F172A" }}>
              {qtdAct == null ? "—" : fmt(qtdAct, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: qtdBgt == null ? MISSING : "#6B7280" }}>
              {qtdBgt == null ? "—" : fmt(qtdBgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={qtdAct} budget={qtdBgt} metricId={row.id} units={row.units} />
          <VarianceCell actual={qtdAct} budget={qtdBgt} metricId={row.id} units={row.units} showPct />

          {/* YTD: Act | Bgt | Δ$ | Δ% */}
          <td style={{ ...varGroup, borderLeft: "2px solid #E2E8F0" }}>
            <span style={{ color: ytdAct == null ? MISSING : "#0F172A" }}>
              {ytdAct == null ? "—" : fmt(ytdAct, row.units)}
            </span>
          </td>
          <td style={varGroup}>
            <span style={{ color: ytdBgt == null ? MISSING : "#6B7280" }}>
              {ytdBgt == null ? "—" : fmt(ytdBgt, row.units)}
            </span>
          </td>
          <VarianceCell actual={ytdAct} budget={ytdBgt} metricId={row.id} units={row.units} />
          <VarianceCell actual={ytdAct} budget={ytdBgt} metricId={row.id} units={row.units} showPct />

          {/* Sparkline */}
          <td style={{ width: COL_SPARK, textAlign: "center", borderTop: "1px solid #F1F5F9", padding: "2px 4px" }}>
            <Sparkline values={sparkVals} />
          </td>
        </>
      )}
    </tr>
  );
}

const varGroup: React.CSSProperties = {
  width: COL_VAR, minWidth: COL_VAR, padding: "4px 6px",
  textAlign: "right", fontFamily: "monospace", fontSize: "0.72rem",
  borderTop: "1px solid #F1F5F9", whiteSpace: "nowrap",
};
