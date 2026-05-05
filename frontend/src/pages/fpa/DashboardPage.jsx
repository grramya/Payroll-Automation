import { useState, useMemo } from "react";
import { Box, Container, Typography, Divider, Collapse } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon   from "@mui/icons-material/KeyboardArrowUp";
import dayjs from "dayjs";
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { useFpaResult } from "../../context/FpaResultContext";

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtM = (v) => {
  if (v == null || isNaN(v)) return "—";
  const abs  = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};
const fmtPct  = (v) => (v == null || isNaN(v) ? "—" : `${Number(v).toFixed(1)}%`);
const delta   = (cur, prev) => (prev && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null);
const MONTH_ABBR = { Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12" };
const toYM = (s) => { const [m, y] = s.split("-"); return `${y.length===2?`20${y}`:y}-${MONTH_ABBR[m]}`; };

// ─────────────────────────────────────────────────────────────────────────────
// Shared components
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#212529", fontFamily: "Inter, Roboto, sans-serif" }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: "0.75rem", color: "#6B7280", mt: 0.25, fontFamily: "Inter, Roboto, sans-serif" }}>{subtitle}</Typography>}
    </Box>
  );
}

function Card({ children, sx = {} }) {
  return (
    <Box
      sx={{
        bgcolor: "#fff", borderRadius: "4px", border: "1px solid #E5E7EB",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)", p: 2.5, ...sx,
      }}
    >
      {children}
    </Box>
  );
}

// Custom tooltip for recharts
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: "#F5F5F5", borderRadius: 1.5, p: 1.5, minWidth: 160, border: "1px solid #E0E0E0", boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}>
      <Typography sx={{ color: "#616161", fontSize: "0.68rem", mb: 0.75, fontWeight: 600 }}>{label}</Typography>
      {payload.map((p) => (
        <Box key={p.dataKey} sx={{ display: "flex", justifyContent: "space-between", gap: 2, mb: 0.25 }}>
          <Typography sx={{ color: p.color, fontSize: "0.72rem", fontWeight: 500 }}>{p.name}</Typography>
          <Typography sx={{ color: "#252525", fontSize: "0.72rem", fontWeight: 700 }}>
            {typeof p.value === "number" ? fmtM(p.value) : p.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Tile
// ─────────────────────────────────────────────────────────────────────────────
function KpiTile({ label, value, deltaVal, format = "money", accent = "#94A3B8" }) {
  const positive = deltaVal == null ? null : deltaVal >= 0;
  const formattedVal = format === "pct" ? fmtPct(value) : fmtM(value);
  const isNeg = typeof value === "number" && value < 0;

  return (
    <Box
      sx={{
        flex: "1 1 160px", bgcolor: "#fff", borderRadius: "4px",
        border: "1px solid #E5E7EB", p: 2,
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        borderTop: `4px solid ${accent}`,
      }}
    >
      <Typography sx={{ fontSize: "0.68rem", fontWeight: 600, color: "#6B7280", letterSpacing: "0.05em", textTransform: "uppercase", mb: 0.75, fontFamily: "Inter, Roboto, sans-serif" }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: "1.45rem", fontWeight: 700, color: isNeg ? "#E8784A" : "#1A2E44", lineHeight: 1.1, fontFamily: "Inter, Roboto, sans-serif" }}>
        {formattedVal}
      </Typography>
      {deltaVal != null && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mt: 0.6 }}>
          <Typography component="span" sx={{ fontSize: "0.7rem", fontWeight: 600, color: positive ? "#29ABE2" : "#E8784A", fontFamily: "Inter, Roboto, sans-serif" }}>
            {positive ? "▲" : "▼"} {Math.abs(deltaVal).toFixed(1)}%
          </Typography>
          <Typography component="span" sx={{ fontSize: "0.7rem", fontWeight: 400, color: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }}>
            &nbsp;MoM
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Efficiency ratio bar
// ─────────────────────────────────────────────────────────────────────────────
function RatioBar({ label, value, benchmark }) {
  const pct    = Math.min(Math.max(value ?? 0, -100), 100);
  const absPct = Math.abs(pct);
  const isGood = benchmark != null ? (pct >= benchmark) : pct >= 0;
  const barColor = isGood ? "#29ABE2" : "#E8784A";

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#212529", fontWeight: 600, fontFamily: "Inter, Roboto, sans-serif" }}>{label}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {benchmark != null && (
            <Typography sx={{ fontSize: "0.68rem", color: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }}>Target {benchmark}%</Typography>
          )}
          <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: barColor, fontFamily: "Inter, Roboto, sans-serif" }}>
            {fmtPct(pct)}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ height: 6, bgcolor: "#D1D5DB", borderRadius: 99, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${absPct}%`, bgcolor: barColor, borderRadius: 99, transition: "width 0.6s ease" }} />
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Department Heatmap
// ─────────────────────────────────────────────────────────────────────────────
const DEPT_KEYS = [
  { label: "Cost of Revenue", key: "Total COGS" },
  { label: "G&A",             key: "Total G&A" },
  { label: "R&D",             key: "Total R&D" },
  { label: "Sales",           key: "Total Sales" },
  { label: "Marketing",       key: "Total Marketing" },
  { label: "Customer Success",key: "Total Customer Success" },
  { label: "Product",         key: "Total Product" },
];

function DeptHeatmap({ months, data }) {
  // Show last 6 months max for readability
  const displayMonths = months.slice(-6);

  // Find max absolute value for scale
  const allVals = displayMonths.flatMap((m) =>
    DEPT_KEYS.map((d) => Math.abs(data[m]?.[d.key] ?? 0))
  );
  const maxVal = Math.max(...allVals, 1);

  // FFF8F0 (Cream) → F5A623 (Amber) → C45C0A (Deep Orange)
  const cellBg = (val) => {
    if (val == null) return "#FFF8F0";
    const ratio = Math.abs(val) / maxVal;
    let r, g, b;
    if (ratio <= 0.5) {
      const t = ratio * 2;
      r = Math.round(255 + t * (245 - 255));
      g = Math.round(248 + t * (166 - 248));
      b = Math.round(240 + t * (35  - 240));
    } else {
      const t = (ratio - 0.5) * 2;
      r = Math.round(245 + t * (196 - 245));
      g = Math.round(166 + t * (92  - 166));
      b = Math.round(35  + t * (10  - 35));
    }
    return `rgb(${r},${g},${b})`;
  };
  const cellText = (val) => {
    const ratio = val != null ? Math.abs(val) / maxVal : 0;
    return ratio > 0.5 ? "#ffffff" : "#1A2E44";
  };

  return (
    <Box sx={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "#64748B", fontWeight: 600, whiteSpace: "nowrap", fontSize: "0.68rem" }}>
              Department
            </th>
            {displayMonths.map((m) => (
              <th key={m} style={{ textAlign: "right", padding: "6px 6px", color: "#64748B", fontWeight: 600, whiteSpace: "nowrap", fontSize: "0.68rem" }}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DEPT_KEYS.map(({ label, key }) => (
            <tr key={label}>
              <td style={{ padding: "5px 8px", color: "#334155", fontWeight: 500, whiteSpace: "nowrap", borderTop: "1px solid #F1F5F9" }}>
                {label}
              </td>
              {displayMonths.map((m) => {
                const v   = data[m]?.[key] ?? null;
                const abs = v != null ? Math.abs(v) : null;
                return (
                  <td
                    key={m}
                    title={v != null ? fmtM(v) : "—"}
                    style={{
                      padding: "5px 6px", textAlign: "right",
                      background: cellBg(v),
                      borderTop: "1px solid rgba(0,0,0,0.04)",
                      fontFamily: "monospace", color: cellText(v), fontWeight: 600,
                    }}
                  >
                    {abs != null ? fmtM(abs) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Typography sx={{ fontSize: "0.65rem", color: "#94A3B8", mt: 1 }}>
        Darker = higher spend · Showing last {displayMonths.length} months
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Period Comparison Table
// ─────────────────────────────────────────────────────────────────────────────
const COMPARE_ROWS = [
  { label: "Total Revenue",         key: "Total Revenue" },
  { label: "Total COGS",            key: "Total COGS" },
  { label: "Gross Profit",          key: "Gross Profit" },
  { label: "Gross Margin %",        key: "Gross Profit (%)", pct: true },
  { label: "Total Operating Exp.",  key: "Total Operating Expenses" },
  { label: "Operating Profit",      key: "Operating Profit" },
  { label: "Operating Margin %",    key: "Operating Profit (%)", pct: true },
  { label: "EBITDA",                key: "EBITDA" },
  { label: "EBITDA Margin %",       key: "EBITDA (%)", pct: true },
  { label: "Net Income",            key: "Net Income" },
  { label: "Net Income %",          key: "Net Income (%)", pct: true },
];

function PeriodTable({ data, months }) {
  if (!months.length) return null;
  const cur   = months[months.length - 1];
  const prev  = months[months.length - 2] ?? null;
  const yearAgo = useMemo(() => {
    if (!cur) return null;
    const ym   = toYM(cur);
    const date = new Date(`${ym}-01`);
    date.setFullYear(date.getFullYear() - 1);
    const tgt  = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
    return months.find((m) => toYM(m) === tgt) ?? null;
  }, [cur, months]);

  const cols = [
    { label: cur,              key: cur },
    ...(prev    ? [{ label: prev,    key: prev    }] : []),
    ...(yearAgo ? [{ label: yearAgo, key: yearAgo }] : []),
  ];

  return (
    <Box sx={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr style={{ background: "#D4781A" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "rgba(255,255,255,0.92)", fontWeight: 600, fontSize: "0.72rem" }}>
              Line Item
            </th>
            {cols.map((c) => (
              <th key={c.label} style={{ textAlign: "right", padding: "8px 10px", color: "rgba(255,255,255,0.92)", fontWeight: 600, fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
            {prev && (
              <th style={{ textAlign: "right", padding: "8px 10px", color: "rgba(255,255,255,0.92)", fontWeight: 600, fontSize: "0.72rem" }}>
                Δ MoM
              </th>
            )}
            {yearAgo && (
              <th style={{ textAlign: "right", padding: "8px 10px", color: "rgba(255,255,255,0.92)", fontWeight: 600, fontSize: "0.72rem" }}>
                Δ YoY
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map(({ label, key, pct }, i) => {
            const cur_v  = data[cur]?.[key]    ?? null;
            const prev_v = prev    ? (data[prev]?.[key]    ?? null) : null;
            const yoy_v  = yearAgo ? (data[yearAgo]?.[key] ?? null) : null;
            const mom_d  = pct
              ? (cur_v != null && prev_v != null ? cur_v - prev_v : null)
              : delta(cur_v, prev_v);
            const yoy_d  = pct
              ? (cur_v != null && yoy_v  != null ? cur_v - yoy_v  : null)
              : delta(cur_v, yoy_v);
            const fmt    = (v) => v == null ? "—" : pct ? fmtPct(v) : fmtM(v);
            const dColor = (d) => d == null ? "#94A3B8" : d >= 0 ? "#29ABE2" : "#E8784A";
            const fmtDelta = (d) => d == null ? "—" : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}${pct ? " pp" : "%"}`;

            return (
              <tr key={key} style={{ background: i % 2 === 0 ? "#fff" : "#F8FAFC" }}>
                <td style={{ padding: "7px 12px", color: "#334155", fontWeight: 500, borderTop: "1px solid #F1F5F9" }}>
                  {label}
                </td>
                {cols.map((c) => {
                  const v = data[c.key]?.[key] ?? null;
                  const isNeg = typeof v === "number" && v < 0;
                  return (
                    <td key={c.label} style={{ padding: "7px 10px", textAlign: "right", borderTop: "1px solid #F1F5F9", fontFamily: "monospace", color: isNeg ? "#E8784A" : "#0F172A", fontWeight: 600 }}>
                      {fmt(v)}
                    </td>
                  );
                })}
                {prev && (
                  <td style={{ padding: "7px 10px", textAlign: "right", borderTop: "1px solid #F1F5F9", color: dColor(mom_d), fontWeight: 700, fontSize: "0.75rem" }}>
                    {fmtDelta(mom_d)}
                  </td>
                )}
                {yearAgo && (
                  <td style={{ padding: "7px 10px", textAlign: "right", borderTop: "1px solid #F1F5F9", color: dColor(yoy_d), fontWeight: 700, fontSize: "0.75rem" }}>
                    {fmtDelta(yoy_d)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  const [compareOpen, setCompareOpen] = useState(false);

  const compPlPreview = result?.compPlPreview;
  const bsPreview     = result?.bsPreview;
  const companyName   = result?.companyName ?? "";

  // ── All months from data ──────────────────────────────────────────────────
  const plMonths  = compPlPreview?.available_months ?? [];
  const plData    = compPlPreview?.data ?? {};
  const bsMonths  = bsPreview?.months ?? [];
  const bsRows    = bsPreview?.rows   ?? [];

  // ── Date range — derived from data, persisted in context ─────────────────
  const defaultFrom = dayjs().startOf('year');
  const defaultTo   = dayjs().endOf('month');
  const fromDate = pageFilters.dashboard?.fromDate ?? defaultFrom;
  const toDate   = pageFilters.dashboard?.toDate   ?? defaultTo;
  const setFromDate = (v) => setPageFilter("dashboard", { fromDate: v, toDate });
  const setToDate   = (v) => setPageFilter("dashboard", { fromDate, toDate: v });

  // ── Filtered P&L months ───────────────────────────────────────────────────
  const filteredPlMonths = useMemo(() => {
    const fromYM = fromDate?.isValid() ? fromDate.format("YYYY-MM") : null;
    const toYM_  = toDate?.isValid()   ? toDate.format("YYYY-MM")   : null;
    return plMonths.filter((m) => {
      const ym = toYM(m);
      if (fromYM && ym < fromYM) return false;
      if (toYM_  && ym > toYM_)  return false;
      return true;
    });
  }, [plMonths, fromDate, toDate]);

  // ── Filtered BS months (with their original indices for value lookup) ─────
  const filteredBsEntries = useMemo(() => {
    const fromYM = fromDate?.isValid() ? fromDate.format("YYYY-MM") : null;
    const toYM_  = toDate?.isValid()   ? toDate.format("YYYY-MM")   : null;
    return bsMonths
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        const ym = toYM(m);
        if (fromYM && ym < fromYM) return false;
        if (toYM_  && ym > toYM_)  return false;
        return true;
      });
  }, [bsMonths, fromDate, toDate]);

  // ── Derived KPI source: last month with actual revenue ───────────────────
  // Skips the current partial month when revenue hasn't been invoiced yet.
  const kpiLatestIdx = (() => {
    for (let i = filteredPlMonths.length - 1; i >= 0; i--) {
      if ((plData[filteredPlMonths[i]]?.["Total Revenue"] ?? 0) > 0) return i;
    }
    return filteredPlMonths.length - 1;
  })();
  const latestM   = filteredPlMonths[kpiLatestIdx];
  const prevM     = kpiLatestIdx > 0 ? filteredPlMonths[kpiLatestIdx - 1] : undefined;
  const latestD   = plData[latestM] ?? {};
  const prevD     = plData[prevM]   ?? {};
  const kpiMonths = filteredPlMonths.slice(0, kpiLatestIdx + 1);

  // ── Revenue trend chart data (filtered) ──────────────────────────────────
  const revTrendData = useMemo(() =>
    filteredPlMonths.map((m) => ({
      month:          m,
      Revenue:        plData[m]?.["Total Revenue"]  ?? 0,
      "Gross Profit": plData[m]?.["Gross Profit"]   ?? 0,
      EBITDA:         plData[m]?.["EBITDA"]         ?? 0,
      "Net Income":   plData[m]?.["Net Income"]     ?? 0,
    })),
    [filteredPlMonths, plData]
  );

  // ── P&L bar data (filtered, last 8) ──────────────────────────────────────
  const plBarData = useMemo(() =>
    filteredPlMonths.slice(-8).map((m) => ({
      month:          m,
      Revenue:        plData[m]?.["Total Revenue"]  ?? 0,
      "Gross Profit": plData[m]?.["Gross Profit"]   ?? 0,
      EBITDA:         plData[m]?.["EBITDA"]         ?? 0,
    })),
    [filteredPlMonths, plData]
  );

  // ── Area chart stroke colors (based on last data point sign) ────────────
  const revTrendColors = useMemo(() => {
    const last = revTrendData[revTrendData.length - 1] ?? {};
    return { EBITDA: ((last.EBITDA ?? 0) >= 0 ? "#F5A623" : "#E8784A") };
  }, [revTrendData]);

  // ── Area chart zero-crossing gradient offset ─────────────────────────────
  const revTrendBounds = useMemo(() => {
    const vals = revTrendData.flatMap(d => [d.Revenue, d["Gross Profit"], d.EBITDA]);
    const rawMax = vals.length ? Math.max(...vals) : 1;
    const rawMin = vals.length ? Math.min(...vals) : 0;
    const pad    = (rawMax - rawMin) * 0.05 || 1;
    const max    = rawMax + pad;
    const min    = Math.min(rawMin - pad, 0);
    const offset = `${Math.max(0, Math.min(100, (max / (max - min)) * 100)).toFixed(1)}%`;
    return { min, max, offset };
  }, [revTrendData]);

  // ── Cash trend (filtered BS) ──────────────────────────────────────────────
  const findBsRow     = (label) => bsRows.find((r) => r.label === label);
  const cashRow           = findBsRow("Cash and Cash equivalents");
  const assetsRow         = findBsRow("Total Assets");
  const currentLiabRow    = findBsRow("Current Liabilities");
  const nonCurrentLiabRow = findBsRow("Non Current Liabilities");
  const equityRow         = findBsRow("Equity");

  const cashTrendData = useMemo(() =>
    filteredBsEntries.map(({ m, i }) => ({
      month: m,
      Cash:  cashRow?.values?.[i] ?? 0,
    })),
    [filteredBsEntries, cashRow]
  );

  const lastBsEntry   = filteredBsEntries[filteredBsEntries.length - 1];
  const prevBsEntry   = filteredBsEntries[filteredBsEntries.length - 2];
  const latestBsIdx   = lastBsEntry?.i ?? -1;
  const prevBsIdx     = prevBsEntry?.i ?? -1;

  const latestCash   = latestBsIdx >= 0 ? (cashRow?.values?.[latestBsIdx]   ?? null) : null;
  const prevCash     = prevBsIdx   >= 0 ? (cashRow?.values?.[prevBsIdx]     ?? null) : null;
  const latestAssets = latestBsIdx >= 0 ? (assetsRow?.values?.[latestBsIdx] ?? null) : null;
  const latestLiab   = latestBsIdx >= 0
    ? ((currentLiabRow?.values?.[latestBsIdx] ?? 0) + (nonCurrentLiabRow?.values?.[latestBsIdx] ?? 0))
    : null;
  const latestEquity = latestBsIdx >= 0 ? (equityRow?.values?.[latestBsIdx] ?? null) : null;
  const monthlyBurn   = latestCash != null && prevCash != null ? latestCash - prevCash : null;
  const runway        = monthlyBurn && monthlyBurn < 0 ? Math.abs(latestCash / monthlyBurn) : null;

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const kpis = [
    { label: "Revenue",      value: latestD["Total Revenue"],        deltaVal: delta(latestD["Total Revenue"],        prevD["Total Revenue"]),        accent: "#29ABE2" },
    { label: "Gross Margin", value: latestD["Gross Profit (%)"],     deltaVal: null, format: "pct",                   accent: "#1A5276" },
    { label: "EBITDA",       value: latestD["EBITDA"],               deltaVal: delta(latestD["EBITDA"],               prevD["EBITDA"]),               accent: "#F5A623" },
    { label: "Net Income",   value: latestD["Net Income"],           deltaVal: delta(latestD["Net Income"],           prevD["Net Income"]),           accent: "#1A5276" },
    { label: "Cash",         value: latestCash,                      deltaVal: delta(latestCash, prevCash),           accent: "#56CCF2" },
    { label: "Op. Margin",   value: latestD["Operating Profit (%)"], deltaVal: null, format: "pct",                   accent: "#E8784A" },
  ];

  const efficiencyRatios = [
    { label: "Gross Margin",      value: latestD["Gross Profit (%)"],     benchmark: 70 },
    { label: "EBITDA Margin",     value: latestD["EBITDA (%)"],           benchmark: 10 },
    { label: "Operating Margin",  value: latestD["Operating Profit (%)"], benchmark: 15 },
    { label: "Net Income Margin", value: latestD["Net Income (%)"],       benchmark: 10 },
  ];

  if (!result) return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <Typography color="text.secondary">Upload and generate a file to see the dashboard.</Typography>
    </Box>
  );

  return (
    <Box className="page-enter" sx={{ pb: 6 }}>

      {/* ── Page header with date filters ───────────────────────────────── */}
      <Box
        component="section"
        aria-label="Page controls"
        sx={{
          borderBottom: "1px solid #E2E8F0", bgcolor: "#fff",
          px: { xs: 2, md: 4 }, py: 2.5, mb: 3,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 2,
        }}
      >
        <Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            {companyName} &mdash; {filteredPlMonths[0] ?? "—"} to {filteredPlMonths[filteredPlMonths.length - 1] ?? "—"}
            {latestM && latestM !== filteredPlMonths[filteredPlMonths.length - 1] && (
              <> &nbsp;·&nbsp; KPIs as of {latestM}</>
            )}
          </Typography>
        </Box>

        {/* Date range pickers — same pattern as all other FP&A pages */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <DatePicker
            label="From"
            value={fromDate}
            onChange={(v) => setFromDate(v)}
            slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, inputProps: { "aria-label": "Filter from date" } } }}
          />
          <DatePicker
            label="To"
            value={toDate}
            onChange={(v) => setToDate(v)}
            slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, inputProps: { "aria-label": "Filter to date" } } }}
          />
        </Box>
      </Box>

      <Container maxWidth="xl">

        {/* ── KPI Strip ──────────────────────────────────────────────────── */}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 3 }}>
          {kpis.map((k) => (
            <KpiTile key={k.label} {...k} />
          ))}
        </Box>

        {/* ── Row 1: Revenue Trend + P&L Bar ─────────────────────────────── */}
        <Box sx={{ display: "flex", gap: 2, mb: 2.5, flexWrap: "wrap" }}>

          {/* Revenue trend */}
          <Card sx={{ flex: "2 1 500px" }}>
            <SectionHeader title="Revenue & Profitability Trend" subtitle="Monthly · Revenue, Gross Profit, EBITDA" />
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fontSize: 10, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8, fontFamily: "Inter, Roboto, sans-serif" }} />
                <ReferenceArea y1={0} y2={1e9}  fill="#EBF8FC" fillOpacity={1} ifOverflow="hidden" />
                <ReferenceArea y1={-1e9} y2={0} fill="#FFF4ED" fillOpacity={1} ifOverflow="hidden" />
                <ReferenceLine y={0} stroke="#B0D9E8" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="Revenue"      stroke="#29ABE2" strokeWidth={2.5} fill="none" dot={false} />
                <Area type="monotone" dataKey="Gross Profit" stroke="#1A5276" strokeWidth={2}   fill="none" dot={false} />
                <Area type="monotone" dataKey="EBITDA"       stroke={revTrendColors.EBITDA}      strokeWidth={1.5} fill="none" strokeDasharray="4 2" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* P&L bar breakdown */}
          <Card sx={{ flex: "1 1 300px" }}>
            <SectionHeader title="P&L Summary" subtitle="Last 8 months — grouped bars" />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={plBarData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fontSize: 9, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} width={55} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8, fontFamily: "Inter, Roboto, sans-serif" }} />
                <ReferenceLine y={0} stroke="#B0D9E8" strokeDasharray="4 4" />
                <Bar dataKey="Revenue"      fill="#29ABE2" radius={[2,2,0,0]} maxBarSize={18} />
                <Bar dataKey="Gross Profit" fill="#1A5276" radius={[2,2,0,0]} maxBarSize={18} />
                <Bar dataKey="EBITDA"       radius={[2,2,0,0]} maxBarSize={18}>
                  {plBarData.map((entry, i) => <Cell key={i} fill={entry.EBITDA >= 0 ? "#F5A623" : "#E8784A"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Box>

        {/* ── Row 2: Dept Heatmap + Efficiency (50 / 50) ─────────────────── */}
        <Box sx={{ display: "flex", gap: 2, mb: 2.5 }}>

          {/* Department spend heatmap */}
          <Card sx={{ flex: "1 1 0", minWidth: 0 }}>
            <SectionHeader title="Department Spend" subtitle="Monthly expenditure by category (last 6 months)" />
            <DeptHeatmap months={filteredPlMonths} data={plData} />
          </Card>

          {/* Efficiency ratios */}
          <Card sx={{ flex: "1 1 0", minWidth: 0 }}>
            <SectionHeader title="Margin Analysis" subtitle="vs SaaS benchmark" />
            {efficiencyRatios.map((r) => <RatioBar key={r.label} {...r} />)}
          </Card>

        </Box>

        {/* ── Row 3: Cash & Balance Sheet (full width) ────────────────────── */}
        <Box sx={{ mb: 2.5 }}>
          <Card>
            <SectionHeader title="Cash & Balance Sheet" subtitle={bsMonths[bsMonths.length - 1] ?? ""} />

            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {/* Cash trend mini chart */}
              <Box sx={{ flex: "1 1 300px", minWidth: 0 }}>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={cashTrendData.slice(-12)} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#56CCF2" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#56CCF2" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fontSize: 10, fill: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={0} stroke="#CBD5E1" strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="Cash" stroke="#26C6DA" strokeWidth={2.5} fill="url(#cashGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </Box>

              {/* BS summary */}
              <Box sx={{ flex: "0 0 260px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <Divider sx={{ mb: 1.5, display: { xs: "block", sm: "none" } }} />
                {[
                  { label: "Cash",         value: latestCash,   color: "#56CCF2" },
                  { label: "Total Assets", value: latestAssets, color: "#29ABE2" },
                  { label: "Total Liab.",  value: latestLiab,   color: "#E8784A" },
                  { label: "Equity",       value: latestEquity, color: "#F5A623" },
                  ...(runway ? [{ label: "Runway", value: `~${runway.toFixed(1)} mo`, raw: true, color: runway < 6 ? "#E8784A" : "#29ABE2" }] : []),
                ].map(({ label, value, color, raw }) => (
                  <Box key={label} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 0.6, borderBottom: "1px solid #E5E7EB" }}>
                    <Typography sx={{ fontSize: "0.75rem", color: "#6B7280", fontFamily: "Inter, Roboto, sans-serif" }}>{label}</Typography>
                    <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color, fontFamily: "Inter, Roboto, sans-serif" }}>
                      {raw ? value : fmtM(value)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Card>
        </Box>

        {/* ── Period Comparison (collapsible) ────────────────────────────── */}
        <Card sx={{ p: 0, overflow: "hidden" }}>
          <Box
            onClick={() => setCompareOpen((p) => !p)}
            sx={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              px: 2.5, py: 1.75, cursor: "pointer",
              bgcolor: compareOpen ? "#F8FAFC" : "#fff",
              "&:hover": { bgcolor: "#F8FAFC" },
              userSelect: "none",
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: "0.92rem", color: "#0F172A" }}>
                Period Comparison
              </Typography>
              <Typography sx={{ fontSize: "0.72rem", color: "#64748B" }}>
                Current month vs prior month vs prior year — click to {compareOpen ? "collapse" : "expand"}
              </Typography>
            </Box>
            {compareOpen ? <KeyboardArrowUpIcon sx={{ color: "#64748B" }} /> : <KeyboardArrowDownIcon sx={{ color: "#64748B" }} />}
          </Box>

          <Collapse in={compareOpen}>
            <Divider />
            <Box sx={{ p: 2.5 }}>
              <PeriodTable data={plData} months={kpiMonths} />
            </Box>
          </Collapse>
        </Card>

      </Container>
    </Box>
  );
}
