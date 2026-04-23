import {
  Box, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Paper, Typography, Chip, alpha,
} from "@mui/material";

const ROW_STYLES = {
  section:  {
    row: { bgcolor: "#0F172A" },
    stickyBg: "#0F172A",
    label: { color: "rgba(255,255,255,0.95)", fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.06em", textTransform: "uppercase" },
    val: null,
  },
  group: {
    row: { bgcolor: alpha("#2563EB", 0.06) },
    stickyBg: "#EDF2FF",
    label: { color: "#1E40AF", fontWeight: 700, fontSize: "0.8rem" },
    val: { color: "#1E40AF", fontWeight: 700 },
  },
  data: {
    row: {},
    stickyBg: "#FFFFFF",
    label: { color: "#475569", fontWeight: 400, fontSize: "0.78rem", pl: "22px" },
    val: { color: "#334155", fontWeight: 400 },
  },
  retained: {
    row: {},
    stickyBg: "#FFFFFF",
    label: { color: "#475569", fontWeight: 400, fontSize: "0.78rem", pl: "22px" },
    val: { color: "#334155", fontWeight: 400 },
  },
  total: {
    row: { bgcolor: "#F8FAFC", borderTop: "2px solid #CBD5E1" },
    stickyBg: "#F8FAFC",
    label: { color: "#0F172A", fontWeight: 700, fontSize: "0.8rem" },
    val: { color: "#0F172A", fontWeight: 700 },
  },
  check: {
    row: { bgcolor: alpha("#059669", 0.05) },
    stickyBg: "#F0FDF4",
    label: { color: "#047857", fontWeight: 700, fontSize: "0.78rem" },
    val: null,
  },
  nwc: {
    row: { bgcolor: "#F8FAFC" },
    stickyBg: "#F8FAFC",
    label: { color: "#334155", fontWeight: 700, fontSize: "0.78rem" },
    val: { color: "#334155", fontWeight: 700 },
  },
  nwc_chg: {
    row: { bgcolor: "#F8FAFC" },
    stickyBg: "#F8FAFC",
    label: { color: "#334155", fontWeight: 700, fontSize: "0.78rem" },
    val: { color: "#334155", fontWeight: 700 },
  },
};

const NUM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtVal(v) {
  if (v === null || v === undefined) return null;
  const abs = NUM.format(Math.abs(v));
  return v < 0 ? `(${abs})` : abs;
}

export default function BaseBSTable({ data }) {
  if (!data?.rows || !data?.months) return null;
  const { months, rows } = data;

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      variant="outlined"
      sx={{ borderRadius: 3, overflowX: "auto", overflowY: "visible" }}
    >
      <Table size="small" stickyHeader aria-label="Base Balance Sheet">
        {/* ── Column headers ─────────────────────────────────────────── */}
        <TableHead>
          <TableRow>
            <TableCell
              scope="col"
              sx={{
                bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.06em",
                textTransform: "uppercase", minWidth: 260,
                position: "sticky", left: 0, zIndex: 3,
                borderRight: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Particulars
            </TableCell>
            {months.map((m) => (
              <TableCell
                key={m}
                scope="col"
                align="right"
                sx={{
                  bgcolor: "#0F172A", color: "rgba(255,255,255,0.9)",
                  fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.04em",
                  whiteSpace: "nowrap", minWidth: 130, py: 1.5,
                }}
              >
                {m}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* ── Data rows ──────────────────────────────────────────────── */}
        <TableBody>
          {rows.map((row, idx) => {
            /* blank spacer */
            if (row.type === "blank") {
              return (
                <TableRow key={idx}>
                  <TableCell colSpan={months.length + 1} sx={{ py: 0.4, border: "none", bgcolor: "#F8FAFC" }} />
                </TableRow>
              );
            }

            const s = ROW_STYLES[row.type] ?? ROW_STYLES.data;
            const isSection = row.type === "section";

            return (
              <TableRow
                key={idx}
                sx={{
                  ...s.row,
                  "&:hover td:not(:first-child)": row.type === "data" || row.type === "retained"
                    ? { bgcolor: alpha("#236CFF", 0.04) }
                    : {},
                }}
              >
                {/* Label */}
                <TableCell
                  component={isSection ? "th" : "td"}
                  scope={isSection ? "rowgroup" : undefined}
                  sx={{
                    ...s.label,
                    position: "sticky", left: 0, zIndex: 1,
                    bgcolor: s.stickyBg ?? "#FFFFFF",
                    borderBottom: "1px solid #F1F5F9",
                    borderRight: "1px solid #E2E8F0",
                    py: isSection ? 1.1 : 0.8,
                    ...(s.row?.borderTop ? { borderTop: s.row.borderTop } : {}),
                  }}
                >
                  {row.label}
                </TableCell>

                {/* Section rows — fill remaining cols */}
                {isSection && (
                  <TableCell
                    colSpan={months.length}
                    sx={{ bgcolor: "#0F172A", border: "none" }}
                    aria-hidden="true"
                  />
                )}

                {/* Value cells for non-section rows */}
                {!isSection && months.map((m, ci) => {
                  const v = row.values?.[ci] ?? null;

                  if (row.type === "check") {
                    return (
                      <TableCell
                        key={m}
                        align="right"
                        sx={{ borderBottom: "1px solid #F1F5F9", py: 0.8, ...(s.row?.borderTop ? { borderTop: s.row.borderTop } : {}) }}
                      >
                        <Chip
                          label={Math.abs(v ?? 0) < 0.01 ? "✓ 0" : fmtVal(v)}
                          size="small"
                          color={Math.abs(v ?? 0) < 0.01 ? "success" : "error"}
                          sx={{ fontSize: "0.68rem", fontWeight: 700, height: 18, borderRadius: 1 }}
                          aria-label={`Check ${m}: ${Math.abs(v ?? 0) < 0.01 ? "balanced" : fmtVal(v)}`}
                        />
                      </TableCell>
                    );
                  }

                  const formatted = fmtVal(v);
                  const valColor = v < 0 ? "#DC2626" : s.val?.color ?? "#334155";

                  return (
                    <TableCell
                      key={m}
                      align="right"
                      aria-label={`${row.label} ${m}: ${formatted ?? "—"}`}
                      sx={{
                        borderBottom: "1px solid #F1F5F9",
                        py: 0.8,
                        ...(s.row?.borderTop ? { borderTop: s.row.borderTop } : {}),
                      }}
                    >
                      <Typography
                        component="span"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.78rem",
                          fontWeight: s.val?.fontWeight ?? 400,
                          color: valColor,
                        }}
                      >
                        {formatted ?? <Box component="span" sx={{ color: "#CBD5E1" }}>—</Box>}
                      </Typography>
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
