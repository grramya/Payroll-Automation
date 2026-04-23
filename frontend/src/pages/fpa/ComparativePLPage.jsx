import { useState, useMemo } from "react";
import {
  Box, Container, Typography, Button,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import DownloadIcon    from "@mui/icons-material/Download";

import { useFpaResult } from "../../context/FpaResultContext";

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtAmt = (v) => {
  if (v == null) return "—";
  const abs  = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmt    = (v, isMetric) => (isMetric ? fmtPct(v) : fmtAmt(v));

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_ABBR = {
  Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
  Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
};

function monthStrToYYYYMM(s) {
  const [mon, yr] = s.split("-");
  const fullYr = yr.length === 2 ? `20${yr}` : yr;
  return `${fullYr}-${MONTH_ABBR[mon]}`;
}

// Returns the 4 quarters ending at (and including) the selected quarter.
// e.g. "Q3-2026" → ["Q4-2025","Q1-2026","Q2-2026","Q3-2026"]
function fourQuartersEndingAt(q) {
  const [qPart, yr] = q.split("-");
  let qNum = parseInt(qPart.slice(1));
  let year = parseInt(yr);
  const result = [];
  for (let i = 3; i >= 0; i--) {
    let qi = qNum - i;
    let yi = year;
    while (qi <= 0) { qi += 4; yi--; }
    result.push(`Q${qi}-${yi}`);
  }
  return result;
}

// ── Row styling map ───────────────────────────────────────────────────────────

const ROW_STYLES = {
  section: {
    bg: "#0F172A", labelColor: "#fff", valColor: "#fff",
    fontWeight: 700, fontSize: "0.78rem", height: 28,
  },
  subsection: {
    bg: "#F8FAFC", labelColor: "#1E293B", valColor: "#1E293B",
    fontWeight: 700, fontSize: "0.76rem", height: 24,
  },
  line: {
    bg: "#fff", labelColor: "#334155", valColor: "#334155",
    fontWeight: 400, fontSize: "0.75rem", height: 22,
  },
  subtotal: {
    bg: "#EBF2FB", labelColor: "#1E40AF", valColor: "#1E40AF",
    fontWeight: 700, fontSize: "0.75rem", height: 22,
    borderTop: "1px solid #CBD5E1",
  },
  total: {
    bg: "#F1F5F9", labelColor: "#0F172A", valColor: "#0F172A",
    fontWeight: 700, fontSize: "0.76rem", height: 24,
    borderTop: "1px solid #CBD5E1",
  },
  grand_total: {
    bg: "#1E3A5F", labelColor: "#fff", valColor: "#fff",
    fontWeight: 700, fontSize: "0.78rem", height: 28,
    borderTop: "2px solid #64748B",
  },
  metric: {
    bg: "#F0F9FF", labelColor: "#0369A1", valColor: "#0369A1",
    fontWeight: 400, fontSize: "0.72rem", height: 20, italic: true,
  },
  blank: { bg: "#fff", height: 10 },
};

// ── Column group builder ──────────────────────────────────────────────────────

function buildColumnGroups(monthCols, fourQuarters, selectedYear) {
  return [
    { label: "Months",   cols: monthCols,                                          color: "#1E3A5F" },
    { label: "Quarters", cols: fourQuarters,                                       color: "#374151" },
    { label: "Year",     cols: [String(selectedYear - 1), String(selectedYear)],   color: "#1E3A5F" },
  ];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ComparativePLPage() {
  const { result } = useFpaResult();
  if (!result) return null;

  const { compPlBlob, compPlPreview, companyName } = result;
  if (!compPlPreview) return null;

  const {
    available_months:   months,
    available_quarters: quarters,
    available_years:    years,
    data,
    rows,
  } = compPlPreview;

  // ── Defaults ─────────────────────────────────────────────────────────────
  const defaultQuarter = quarters[quarters.length - 1] ?? "";
  const defaultYear    = years[years.length - 1] ?? new Date().getFullYear();
  const firstYear = quarters.length ? quarters[0].split("-")[1]                    : String(new Date().getFullYear());
  const lastYear  = quarters.length ? quarters[quarters.length - 1].split("-")[1]  : String(new Date().getFullYear());

  const [selectedQuarter, setSelectedQuarter] = useState(defaultQuarter);
  const [selectedYear,    setSelectedYear]    = useState(defaultYear);
  const [fromDate,        setFromDate]        = useState(`${firstYear}-01-01`);
  const [toDate,          setToDate]          = useState(`${lastYear}-12-31`);

  // ── Filter quarters by date range ────────────────────────────────────────
  const filteredQuarters = useMemo(() => {
    const fromYM = fromDate ? fromDate.slice(0, 7) : null;
    const toYM   = toDate   ? toDate.slice(0, 7)   : null;
    return quarters.filter((q) => {
      const [qPart, yr] = q.split("-");
      const qNum   = parseInt(qPart.slice(1));
      const qStart = `${yr}-${String((qNum - 1) * 3 + 1).padStart(2, "0")}`;
      const qEnd   = `${yr}-${String(qNum * 3).padStart(2, "0")}`;
      if (fromYM && qEnd   < fromYM) return false;
      if (toYM   && qStart > toYM)   return false;
      return true;
    });
  }, [quarters, fromDate, toDate]);

  const effectiveQuarter = filteredQuarters.includes(selectedQuarter)
    ? selectedQuarter
    : (filteredQuarters[filteredQuarters.length - 1] ?? "");

  // ── Filter months by date range ───────────────────────────────────────────
  const filteredMonths = useMemo(() => {
    const fromYM = fromDate ? fromDate.slice(0, 7) : null;
    const toYM   = toDate   ? toDate.slice(0, 7)   : null;
    return months.filter((m) => {
      const ym = monthStrToYYYYMM(m);
      if (fromYM && ym < fromYM) return false;
      if (toYM   && ym > toYM)   return false;
      return true;
    });
  }, [months, fromDate, toDate]);

  // ── 4 consecutive quarters ending at the selected quarter ────────────────
  const fourQuarters = useMemo(
    () => (effectiveQuarter ? fourQuartersEndingAt(effectiveQuarter) : []),
    [effectiveQuarter],
  );

  const columnGroups = useMemo(
    () => buildColumnGroups(filteredMonths, fourQuarters, selectedYear).filter((g) => g.cols.length > 0),
    [filteredMonths, fourQuarters, selectedYear],
  );

  const allPeriods = useMemo(
    () => columnGroups.flatMap((g) => g.cols),
    [columnGroups],
  );

  // ── Download handler ──────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!compPlBlob) return;
    const url = URL.createObjectURL(compPlBlob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `${companyName}_comparative_pl.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Table layout constants ────────────────────────────────────────────────
  const COL_W_LABEL = 220;
  const COL_W_DATA  = 110;
  const totalW      = COL_W_LABEL + allPeriods.length * COL_W_DATA;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box className="page-enter">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}>
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                  Comparative P&amp;L (Class)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {companyName}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, flexWrap: "wrap" }}>

              {/* ── Date range filter ── */}
              {["From", "To"].map((label) => {
                const value    = label === "From" ? fromDate : toDate;
                const onChange = label === "From" ? setFromDate : setToDate;
                return (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary"
                      sx={{ display: "block", mb: 0.5, fontSize: "0.72rem" }}
                    >
                      {label}
                    </Typography>
                    <Box
                      sx={{
                        border: "1px solid #CBD5E1", borderRadius: 1.5,
                        display: "flex", alignItems: "center",
                        px: 1.5, py: 0.6, bgcolor: "#fff", minWidth: 150,
                        "&:focus-within": { borderColor: "#D97706", boxShadow: "0 0 0 2px rgba(217,119,6,0.12)" },
                      }}
                    >
                      <input
                        type="date"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        style={{
                          border: "none", outline: "none",
                          fontSize: "0.82rem", color: "#334155",
                          background: "transparent", width: "100%", cursor: "pointer",
                        }}
                      />
                    </Box>
                  </Box>
                );
              })}

              {/* Quarter selector — shows all available quarters; selects the "ending" quarter */}
              {filteredQuarters.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel sx={{ fontSize: "0.8rem" }}>Quarter</InputLabel>
                  <Select
                    value={effectiveQuarter}
                    label="Quarter"
                    onChange={(e) => setSelectedQuarter(e.target.value)}
                    sx={{ fontSize: "0.82rem" }}
                  >
                    {filteredQuarters.map((q) => (
                      <MenuItem key={q} value={q} sx={{ fontSize: "0.82rem" }}>{q}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Year selector */}
              {years.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel sx={{ fontSize: "0.8rem" }}>Year</InputLabel>
                  <Select
                    value={selectedYear}
                    label="Year"
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    sx={{ fontSize: "0.82rem" }}
                  >
                    {years.map((y) => (
                      <MenuItem key={y} value={y} sx={{ fontSize: "0.82rem" }}>{y}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {compPlBlob && (
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownload}
                  sx={{ background: "linear-gradient(135deg,#D97706,#B45309)", whiteSpace: "nowrap" }}
                >
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <Container maxWidth="xl" sx={{ py: 3, px: { xs: 1, md: 3 } }}>
        <Box sx={{ overflowX: "auto", borderRadius: 2, border: "1px solid #E2E8F0", boxShadow: 1 }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: `${totalW}px`,
              minWidth: "100%",
              tableLayout: "fixed",
              fontFamily: "'Inter', -apple-system, sans-serif",
            }}
          >
            <colgroup>
              <col style={{ width: `${COL_W_LABEL}px` }} />
              {allPeriods.map((p) => (
                <col key={p} style={{ width: `${COL_W_DATA}px` }} />
              ))}
            </colgroup>

            <thead>
              {/* ── Group header row ─────────────────────────────────── */}
              <tr>
                <th
                  style={{
                    position: "sticky", left: 0, zIndex: 3,
                    background: "#0F172A", color: "#fff",
                    padding: "8px 12px", textAlign: "left",
                    fontSize: "0.72rem", fontWeight: 700,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    borderRight: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  Particulars
                </th>
                {columnGroups.map((grp) => (
                  <th
                    key={grp.label}
                    colSpan={grp.cols.length}
                    style={{
                      background: "#0F172A", color: "rgba(255,255,255,0.7)",
                      padding: "8px 6px", textAlign: "center",
                      fontSize: "0.68rem", fontWeight: 600,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      borderLeft: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    {grp.label}
                  </th>
                ))}
              </tr>

              {/* ── Period label row ─────────────────────────────────── */}
              <tr>
                <th
                  style={{
                    position: "sticky", left: 0, zIndex: 3,
                    background: "#0F172A",
                    borderRight: "1px solid rgba(255,255,255,0.12)",
                    borderBottom: "1px solid rgba(255,255,255,0.12)",
                  }}
                />
                {columnGroups.map((grp) =>
                  grp.cols.map((period, ci) => (
                    <th
                      key={period}
                      style={{
                        background: "#0F172A", color: "rgba(255,255,255,0.85)",
                        padding: "6px 8px", textAlign: "right",
                        fontSize: "0.7rem", fontWeight: 600,
                        letterSpacing: "0.03em",
                        borderLeft: ci === 0 ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,255,255,0.06)",
                        borderBottom: "1px solid rgba(255,255,255,0.12)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {period}
                    </th>
                  ))
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map((rdef, ri) => {
                const { label, type, key } = rdef;
                const style    = ROW_STYLES[type] ?? ROW_STYLES.line;
                const isMetric = type === "metric";

                if (type === "blank") {
                  return (
                    <tr key={ri}>
                      <td
                        colSpan={allPeriods.length + 1}
                        style={{ height: style.height, background: style.bg }}
                      />
                    </tr>
                  );
                }

                return (
                  <tr key={ri} style={{ background: style.bg, borderTop: style.borderTop }}>
                    {/* Label cell — sticky */}
                    <td
                      style={{
                        position: "sticky", left: 0, zIndex: 2,
                        background: style.bg,
                        padding: "4px 12px",
                        height: style.height,
                        fontSize: style.fontSize,
                        fontWeight: style.fontWeight,
                        color: style.labelColor,
                        fontStyle: style.italic ? "italic" : "normal",
                        whiteSpace: "nowrap",
                        borderRight: "2px solid #E2E8F0",
                        borderTop: style.borderTop,
                      }}
                    >
                      {label ?? ""}
                    </td>

                    {/* Value cells */}
                    {allPeriods.map((period, pi) => {
                      const rawVal     = key != null ? (data[period]?.[key] ?? null) : null;
                      const displayVal = (type === "section" || type === "subsection") ? null : fmt(rawVal, isMetric);
                      const isNeg      = rawVal != null && rawVal < 0;

                      let valColor = style.valColor;
                      if (isNeg && type === "line")        valColor = "#DC2626";
                      if (isNeg && type === "grand_total") valColor = "#FCA5A5";
                      if (isNeg && type === "metric")      valColor = "#DC2626";

                      // Group boundary: start of Months, Quarters, and Year groups
                      const groupStart = pi === 0
                        || pi === filteredMonths.length
                        || pi === filteredMonths.length + fourQuarters.length;

                      return (
                        <td
                          key={`${ri}-${period}`}
                          style={{
                            padding: "4px 10px 4px 4px",
                            textAlign: "right",
                            fontSize: style.fontSize,
                            fontWeight: style.fontWeight,
                            fontStyle: style.italic ? "italic" : "normal",
                            color: valColor,
                            whiteSpace: "nowrap",
                            borderTop: style.borderTop,
                            borderLeft: groupStart ? "2px solid #E2E8F0" : "1px solid #F1F5F9",
                          }}
                        >
                          {displayVal}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      </Container>
    </Box>
  );
}
