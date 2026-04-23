/**
 * PLIndividualTable — renders the Base P&L (Class) (Individual) for ONE selected month.
 *
 * Column layout (mirrors Excel):
 *   A  Particulars
 *   B  Mapping
 *   C  {company_name}  (co_a)
 *   D  Concertiv Insurance Brokers, Inc.  (co_b — blank/0)
 *   E  Consolidated  (cons = co_a + co_b)
 */

import {
  Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, alpha,
} from "@mui/material";

/** Visual config keyed by row type from backend. */
const STYLE = {
  section: {
    bg: "#0F172A", stickyBg: "#0F172A",
    label: { color: "#fff", fontWeight: 800, fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase" },
    val:   { color: "#fff", fontWeight: 700 },
  },
  subsection: {
    bg: "#F8FAFC", stickyBg: "#F8FAFC",
    label: { color: "#1E293B", fontWeight: 700, fontSize: "0.78rem" },
    val:   null,
  },
  line: {
    bg: "#ffffff", stickyBg: "#ffffff",
    label: { color: "#475569", fontWeight: 400, fontSize: "0.77rem" },
    val:   null,
  },
  subtotal: {
    bg: alpha("#2563EB", 0.07), stickyBg: "#EDF2FF",
    label: { color: "#1E40AF", fontWeight: 700, fontSize: "0.78rem" },
    val:   { color: "#1E40AF", fontWeight: 700 },
    borderTop: "1.5px solid #BFDBFE",
  },
  total: {
    bg: "#F1F5F9", stickyBg: "#F1F5F9",
    label: { color: "#0F172A", fontWeight: 700, fontSize: "0.78rem" },
    val:   { color: "#0F172A", fontWeight: 700 },
    borderTop: "1px solid #CBD5E1",
  },
  grand_total: {
    bg: "#1E3A5F", stickyBg: "#1E3A5F",
    label: { color: "#fff", fontWeight: 800, fontSize: "0.82rem" },
    val:   null,
    borderTop: "2px solid #94A3B8",
  },
  metric: {
    bg: "#F0F9FF", stickyBg: "#F0F9FF",
    label: { color: "#0369A1", fontWeight: 400, fontSize: "0.72rem", fontStyle: "italic" },
    val:   null,
  },
};

const NUM = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtVal(v, isMetric) {
  if (v === null || v === undefined) return null;
  if (isMetric) return `${v.toFixed(1)}%`;
  const abs = NUM.format(Math.abs(v));
  return v < 0 ? `(${abs})` : abs;
}

export default function PLIndividualTable({ data, selectedMonth, companyName }) {
  if (!data?.rows || !data?.months) return null;

  const month   = selectedMonth || data.months[data.months.length - 1];
  const coLabel = companyName || data.company_name || "Company";
  const COLS    = [coLabel, "Concertiv Insurance Brokers, Inc.", "Consolidated"];

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      variant="outlined"
      sx={{ borderRadius: 3, overflowX: "auto", overflowY: "visible" }}
    >
      <Table size="small" stickyHeader aria-label="Base P&L Class Individual">

        {/* ── Column headers ──────────────────────────────────────────────── */}
        <TableHead>
          <TableRow>
            {/* Particulars */}
            <TableCell
              scope="col"
              sx={{
                bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.08em",
                textTransform: "uppercase", minWidth: 280,
                position: "sticky", left: 0, zIndex: 3,
                borderRight: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Particulars
            </TableCell>
            {/* Mapping */}
            <TableCell
              scope="col"
              sx={{
                bgcolor: "#0F172A", color: "rgba(255,255,255,0.65)",
                fontWeight: 600, fontSize: "0.65rem", letterSpacing: "0.04em",
                minWidth: 170, py: 1.5, fontStyle: "italic",
              }}
            >
              Mapping
            </TableCell>
            {/* Data columns */}
            {COLS.map((col) => (
              <TableCell
                key={col}
                scope="col"
                align="right"
                sx={{
                  bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                  fontWeight: 700, fontSize: "0.67rem", letterSpacing: "0.03em",
                  whiteSpace: "nowrap", minWidth: col.length > 20 ? 170 : 120, py: 1.5,
                }}
              >
                {col}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* ── Data rows ────────────────────────────────────────────────────── */}
        <TableBody>
          {data.rows.map((row, idx) => {
            if (row.type === "blank") {
              return (
                <TableRow key={idx}>
                  <TableCell colSpan={5} sx={{ py: 0.3, border: "none", bgcolor: "#F8FAFC" }} />
                </TableRow>
              );
            }

            const s          = STYLE[row.type] ?? STYLE.line;
            const isMetric   = row.type === "metric";
            const isHeader   = ["section", "subsection"].includes(row.type);
            const isGrandT   = row.type === "grand_total";
            const isLine     = row.type === "line";

            // Get values for selected month
            const cv         = row.values?.[month] ?? null;
            const co_a       = cv?.co_a ?? null;
            const co_b       = cv?.co_b ?? null;
            const cons       = cv?.cons ?? null;
            const dataVals   = [co_a, co_b, cons];

            return (
              <TableRow
                key={idx}
                sx={{
                  bgcolor: s.bg ?? "#ffffff",
                  "&:hover td": isLine ? { bgcolor: alpha("#2563EB", 0.03) } : {},
                }}
              >
                {/* Label cell */}
                <TableCell
                  component={row.type === "section" ? "th" : "td"}
                  scope={row.type === "section" ? "rowgroup" : undefined}
                  sx={{
                    ...s.label,
                    py: isHeader || isGrandT ? 1 : 0.65,
                    borderBottom: "1px solid #F1F5F9",
                    borderRight: "1px solid #E2E8F0",
                    bgcolor: s.stickyBg ?? s.bg,
                    ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                    position: isGrandT ? "sticky" : undefined,
                    left:     isGrandT ? 0 : undefined,
                    zIndex:   isGrandT ? 1 : undefined,
                  }}
                >
                  {row.label}
                </TableCell>

                {/* Mapping cell */}
                <TableCell
                  sx={{
                    color: isHeader ? "transparent" : "#94A3B8",
                    fontSize: "0.7rem",
                    fontStyle: "italic",
                    py: isHeader || isGrandT ? 1 : 0.65,
                    borderBottom: "1px solid #F1F5F9",
                    bgcolor: s.bg,
                    ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                  }}
                >
                  {!isHeader ? (row.mapping ?? "") : null}
                </TableCell>

                {/* Data value cells — co_a, co_b, cons */}
                {dataVals.map((raw, ci) => {
                  const colKey   = COLS[ci];
                  const isZeroCol = ci === 1;  // co_b (Insurance Brokers) = always 0/blank
                  const formatted = isZeroCol ? null : fmtVal(raw, isMetric);
                  const isNeg     = raw != null && raw < 0;

                  // Text colour
                  let valColor  = s.val?.color ?? "#334155";
                  let valWeight = s.val?.fontWeight ?? 400;

                  if (isGrandT) {
                    valColor  = isNeg ? "#FCA5A5" : "#FFFFFF";
                    valWeight = 800;
                  } else if (isMetric) {
                    valColor  = isNeg ? "#DC2626" : "#0369A1";
                  } else if (isLine) {
                    valColor  = isNeg ? "#DC2626" : "#166534";
                  }

                  return (
                    <TableCell
                      key={colKey}
                      align="right"
                      aria-label={`${row.label ?? ""} ${colKey}: ${formatted ?? "—"}`}
                      sx={{
                        fontFamily: "monospace",
                        fontSize:   isMetric ? "0.73rem" : "0.78rem",
                        fontWeight: valWeight,
                        fontStyle:  isMetric ? "italic" : "normal",
                        color:      isZeroCol ? "#CBD5E1" : valColor,
                        py:         isHeader || isGrandT ? 1 : 0.65,
                        borderBottom: "1px solid #F1F5F9",
                        bgcolor:    s.bg,
                        ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isHeader
                        ? null
                        : isZeroCol
                          ? <Box component="span" sx={{ color: "#E2E8F0" }}>—</Box>
                          : (formatted ?? <Box component="span" sx={{ color: "#CBD5E1" }}>—</Box>)
                      }
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
