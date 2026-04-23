/**
 * BSIndividualTable
 *
 * Renders the BS (Individual) for ONE selected "as-of" month.
 *
 * Column layout (mirrors Excel rows 3-5):
 *   A  Particulars
 *   B  {company_name}                         (co_a — actual data)
 *   C  Concertiv Insurance Brokers, Inc.      (co_b — blank/—)
 *   D  Eliminations                            (elim — blank/—)
 *   E  Consolidated BS                         (cons = co_a + co_b + elim = co_a)
 *
 * Data shape:  rows_by_month[selectedMonth] = [{label, co_a, co_b, elim, cons, type}]
 */

import {
  Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Chip, alpha,
} from "@mui/material";

const STYLE = {
  section: {
    bg: "#0F172A", stickyBg: "#0F172A",
    label: { color: "#fff", fontWeight: 800, fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase" },
  },
  subsection: {
    bg: "#F8FAFC", stickyBg: "#F8FAFC",
    label: { color: "#1E293B", fontWeight: 700, fontSize: "0.78rem" },
  },
  group_header: {
    bg: alpha("#2563EB", 0.07), stickyBg: "#EDF2FF",
    label: { color: "#1E40AF", fontWeight: 700, fontSize: "0.78rem" },
    borderTop: "1.5px solid #BFDBFE",
  },
  account: {
    bg: "#ffffff", stickyBg: "#ffffff",
    label: { color: "#475569", fontWeight: 400, fontSize: "0.77rem" },
  },
  group_total: {
    bg: alpha("#2563EB", 0.07), stickyBg: "#EDF2FF",
    label: { color: "#1E40AF", fontWeight: 700, fontSize: "0.78rem" },
    borderTop: "1.5px solid #BFDBFE",
  },
  total: {
    bg: "#F1F5F9", stickyBg: "#F1F5F9",
    label: { color: "#0F172A", fontWeight: 700, fontSize: "0.78rem" },
    borderTop: "1px solid #CBD5E1",
  },
  grand_total: {
    bg: "#1E3A5F", stickyBg: "#1E3A5F",
    label: { color: "#fff", fontWeight: 800, fontSize: "0.82rem" },
    borderTop: "2px solid #94A3B8",
  },
  equity_item: {
    bg: "#ffffff", stickyBg: "#ffffff",
    label: { color: "#475569", fontWeight: 400, fontSize: "0.77rem" },
  },
  check: null,
};

const NUM = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtVal(v) {
  if (v === null || v === undefined) return null;
  const abs = NUM.format(Math.abs(v));
  return v < 0 ? `(${abs})` : abs;
}

export default function BSIndividualTable({ data, selectedMonth, companyName }) {
  if (!data) return null;

  // Support both old shape ({as_of, rows}) and new shape ({rows_by_month, months})
  const isNewShape = !!data.rows_by_month;
  const month      = selectedMonth || data.as_of || "";
  const rows       = isNewShape
    ? (data.rows_by_month?.[month] ?? [])
    : (data.rows ?? []);
  const coLabel    = companyName || "Company";

  const COLS = [coLabel, "Concertiv Insurance Brokers, Inc.", "Eliminations", "Consolidated BS"];

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      variant="outlined"
      sx={{ borderRadius: 3, overflowX: "auto", overflowY: "visible" }}
    >
      <Table size="small" stickyHeader aria-label="Balance Sheet Individual">

        {/* ── Column headers ───────────────────────────────────────────────── */}
        <TableHead>
          <TableRow>
            <TableCell
              scope="col"
              sx={{
                bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.08em",
                textTransform: "uppercase", minWidth: 300,
                position: "sticky", left: 0, zIndex: 3,
                borderRight: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Particulars
            </TableCell>
            {COLS.map((col) => (
              <TableCell
                key={col}
                scope="col"
                align="right"
                sx={{
                  bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                  fontWeight: 700, fontSize: "0.67rem", letterSpacing: "0.03em",
                  whiteSpace: "nowrap", minWidth: col.length > 20 ? 170 : 130, py: 1.5,
                }}
              >
                {col}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* ── Data rows ────────────────────────────────────────────────────── */}
        <TableBody>
          {rows.map((row, idx) => {
            if (row.type === "blank") {
              return (
                <TableRow key={idx}>
                  <TableCell colSpan={5} sx={{ py: 0.35, border: "none", bgcolor: "#F8FAFC" }} />
                </TableRow>
              );
            }

            /* Check row */
            if (row.type === "check") {
              // Use co_a for the check value (same as legacy .value)
              const checkVal = isNewShape ? row.co_a : row.value;
              const balanced = checkVal != null && Math.abs(checkVal) < 0.01;
              return (
                <TableRow key={idx} sx={{ bgcolor: balanced ? alpha("#059669", 0.06) : alpha("#DC2626", 0.06) }}>
                  <TableCell
                    sx={{
                      fontWeight: 700, fontSize: "0.78rem",
                      color: balanced ? "#166534" : "#991B1B",
                      borderTop: "1px solid #CBD5E1",
                    }}
                  >
                    {row.label}
                  </TableCell>
                  {[0, 1, 2, 3].map((ci) => (
                    <TableCell key={ci} align="right" sx={{ borderTop: "1px solid #CBD5E1" }}>
                      {ci === 0 ? (
                        <Chip
                          label={balanced ? "✓ 0.00 — Balanced" : fmtVal(checkVal)}
                          size="small"
                          color={balanced ? "success" : "error"}
                          sx={{ fontSize: "0.7rem", fontWeight: 700, height: 20, borderRadius: 1 }}
                        />
                      ) : <Box component="span" sx={{ color: "#CBD5E1" }}>—</Box>}
                    </TableCell>
                  ))}
                </TableRow>
              );
            }

            const s        = STYLE[row.type] ?? STYLE.account;
            const isHeader = ["section", "subsection"].includes(row.type);
            const isGrandT = row.type === "grand_total";
            const isLine   = ["account", "equity_item"].includes(row.type);

            // Extract values — new shape has co_a/co_b/elim/cons; old shape has .value
            const co_a = isNewShape ? row.co_a : row.value;
            const co_b = isNewShape ? row.co_b : null;
            const elim = isNewShape ? row.elim : null;
            const cons = isNewShape ? row.cons : row.value;
            const dataVals = [co_a, co_b, elim, cons];

            return (
              <TableRow
                key={idx}
                sx={{
                  bgcolor: s.bg ?? "#ffffff",
                  "&:hover td": isLine ? { bgcolor: alpha("#2563EB", 0.03) } : {},
                }}
              >
                {/* Label */}
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

                {/* Value cells */}
                {dataVals.map((raw, ci) => {
                  const colKey  = COLS[ci];
                  const isBlank = ci === 1 || ci === 2;  // co_b and elim always blank
                  const formatted = isBlank ? null : fmtVal(raw);
                  const isNeg = raw != null && raw < 0;

                  let valColor  = "#334155";
                  let valWeight = 400;

                  if (isGrandT) {
                    valColor  = isNeg ? "#FCA5A5" : "#FFFFFF";
                    valWeight = 800;
                  } else if (["group_header", "group_total"].includes(row.type)) {
                    valColor  = "#1E40AF";
                    valWeight = 700;
                  } else if (["total"].includes(row.type)) {
                    valColor  = "#0F172A";
                    valWeight = 700;
                  } else if (isLine) {
                    valColor  = isNeg ? "#DC2626" : "#166534";
                  }

                  return (
                    <TableCell
                      key={colKey}
                      align="right"
                      aria-label={`${row.label ?? ""} ${colKey}: ${formatted ?? "—"}`}
                      sx={{
                        fontFamily:   "monospace",
                        fontSize:     "0.78rem",
                        fontWeight:   valWeight,
                        color:        isBlank ? "#CBD5E1" : valColor,
                        py:           isHeader || isGrandT ? 1 : 0.65,
                        borderBottom: "1px solid #F1F5F9",
                        bgcolor:      s.bg,
                        ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                        whiteSpace:   "nowrap",
                      }}
                    >
                      {isHeader
                        ? null
                        : isBlank
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
