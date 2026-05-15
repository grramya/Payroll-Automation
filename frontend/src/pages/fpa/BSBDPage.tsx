import { useMemo, useState } from "react";
import {
  Box, Container, Typography, Button,
  Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Chip, alpha,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import AccountBalanceIcon      from "@mui/icons-material/AccountBalance";
import KeyboardArrowDownIcon   from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon  from "@mui/icons-material/KeyboardArrowRight";
import FullScreenWrapper       from "../../components/fpa/FullScreenWrapper";
import { useFpaResult }        from "../../context/FpaResultContext";
import { fpaDownloadFilteredReport } from "../../api/api";

// ── Number formatting ────────────────────────────────────────────────────────

const NUM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtVal(v: number | null | undefined): string | null {
  if (v == null) return null;
  const abs = NUM.format(Math.abs(v));
  return v < 0 ? `(${abs})` : abs;
}

// ── 4 quarters ending at q ────────────────────────────────────────────────────

function fourQuartersEndingAt(q: string): string[] {
  const [qPart, yr] = q.split("-");
  let qNum = parseInt(qPart.slice(1));
  let year = parseInt(yr);
  const result: string[] = [];
  for (let i = 3; i >= 0; i--) {
    let qi = qNum - i;
    let yi = year;
    while (qi <= 0) { qi += 4; yi--; }
    result.push(`Q${qi}-${yi}`);
  }
  return result;
}

// ── Row style map ─────────────────────────────────────────────────────────────

interface RowStyle {
  bg: string;
  stickyBg: string;
  labelColor: string;
  valColor: string;
  fontWeight: number;
  fontSize: string;
  indent: boolean;
  borderTop?: string;
  uppercase?: boolean;
  letterSpacing?: string;
}

const ROW_STYLES: Record<string, RowStyle> = {
  section:    { bg: "#0F172A",              stickyBg: "#0F172A",  labelColor: "#fff",    valColor: "#fff",    fontWeight: 800, fontSize: "0.72rem", indent: false, uppercase: true, letterSpacing: "0.1em" },
  subsection: { bg: "#F8FAFC",              stickyBg: "#F8FAFC",  labelColor: "#1E293B", valColor: "#1E293B", fontWeight: 700, fontSize: "0.78rem", indent: false },
  data:       { bg: "#ffffff",              stickyBg: "#ffffff",  labelColor: "#475569", valColor: "#334155", fontWeight: 400, fontSize: "0.77rem", indent: true },
  retained:   { bg: "#ffffff",              stickyBg: "#ffffff",  labelColor: "#475569", valColor: "#334155", fontWeight: 400, fontSize: "0.77rem", indent: true },
  subtotal:   { bg: alpha("#2563EB", 0.07), stickyBg: "#EDF2FF",  labelColor: "#1E40AF", valColor: "#1E40AF", fontWeight: 700, fontSize: "0.78rem", indent: false, borderTop: "1.5px solid #BFDBFE" },
  total:      { bg: "#F1F5F9",              stickyBg: "#F1F5F9",  labelColor: "#0F172A", valColor: "#0F172A", fontWeight: 700, fontSize: "0.78rem", indent: false, borderTop: "1px solid #CBD5E1" },
  check:      { bg: alpha("#059669", 0.06), stickyBg: "#F0FDF4",  labelColor: "#166534", valColor: "#166534", fontWeight: 700, fontSize: "0.77rem", indent: false },
  blank:      { bg: "#F8FAFC",              stickyBg: "#F8FAFC",  labelColor: "#fff",    valColor: "#fff",    fontWeight: 400, fontSize: "0.5rem",  indent: false },
};

// ── Data shapes ───────────────────────────────────────────────────────────────

interface RowDef {
  label?: string | null;
  type: string;
  key?: string | null;
}

interface BsBdPreview {
  available_quarters: string[];
  available_years:    number[];
  data:               Record<string, Record<string, number | null>>;
  rows:               RowDef[];
  company_name?:      string;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function BSBDTable({
  preview,
  fourQuarters,
  yearCols,
  collapsedSections,
  collapsedSubsections,
  toggleSection,
  toggleSubsection,
}: {
  preview: BsBdPreview;
  fourQuarters: string[];
  yearCols: string[];
  collapsedSections: Set<number>;
  collapsedSubsections: Set<number>;
  toggleSection: (i: number) => void;
  toggleSubsection: (i: number) => void;
}) {
  const { data, rows } = preview;
  const allCols = [...fourQuarters, ...yearCols];

  const rowMeta = useMemo(() => {
    let curSection = -1;
    let curSubsection = -1;
    return rows.map((row, i) => {
      if (row.type === "section")    { curSection = i; curSubsection = -1; return { sectionParent: -1, subsectionParent: -1 }; }
      if (row.type === "subsection") { curSubsection = i; return { sectionParent: curSection, subsectionParent: -1 }; }
      return { sectionParent: curSection, subsectionParent: curSubsection };
    });
  }, [rows]);

  const isVisible = (ri: number, type: string): boolean => {
    if (type === "section" || type === "total") return true;
    const { sectionParent, subsectionParent } = rowMeta[ri];
    if (sectionParent !== -1 && collapsedSections.has(sectionParent)) return false;
    if (["data", "retained", "subtotal", "check", "blank"].includes(type) && subsectionParent !== -1 && collapsedSubsections.has(subsectionParent)) return false;
    return true;
  };

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      variant="outlined"
      sx={{ borderRadius: 3, overflow: "auto", maxHeight: "calc(100vh - 220px)" }}
    >
      <Table size="small" stickyHeader aria-label="Balance Sheet BD">
        <TableHead>
          <TableRow>
            <TableCell
              scope="col"
              sx={{
                bgcolor: "#400f61",
                color: "rgba(255,255,255,0.9)",
                fontWeight: 700,
                fontSize: "0.68rem",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                minWidth: 300,
                position: "sticky",
                left: 0,
                zIndex: 3,
                borderRight: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Particulars
            </TableCell>
            {allCols.map((col) => (
              <TableCell
                key={col}
                scope="col"
                align="right"
                sx={{
                  bgcolor: "#400f61",
                  color: "rgba(255,255,255,0.9)",
                  fontWeight: 700,
                  fontSize: "0.67rem",
                  letterSpacing: "0.03em",
                  whiteSpace: "nowrap",
                  minWidth: 140,
                  py: 1.5,
                }}
              >
                {col}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((row, idx) => {
            if (!isVisible(idx, row.type)) return null;

            if (row.type === "blank") {
              return (
                <TableRow key={idx} aria-hidden="true">
                  <TableCell colSpan={allCols.length + 1} sx={{ py: 0.35, border: "none", bgcolor: "#F8FAFC" }} />
                </TableRow>
              );
            }

            if (row.type === "check") {
              const checkVal = row.key ? (data[allCols[0]]?.[row.key] ?? null) : null;
              const balanced = checkVal != null && Math.abs(checkVal) < 0.01;
              return (
                <TableRow key={idx} sx={{ bgcolor: balanced ? alpha("#059669", 0.06) : alpha("#DC2626", 0.06) }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: "0.77rem", color: balanced ? "#166534" : "#991B1B", borderTop: "1px solid #CBD5E1", position: "sticky", left: 0, bgcolor: balanced ? alpha("#059669", 0.06) : alpha("#DC2626", 0.06) }}>
                    {row.label ?? "Check"}
                  </TableCell>
                  {allCols.map((col, ci) => {
                    const v = row.key ? (data[col]?.[row.key] ?? null) : null;
                    const isBalanced = v != null && Math.abs(v) < 0.01;
                    return (
                      <TableCell key={ci} align="right" sx={{ borderTop: "1px solid #CBD5E1" }}>
                        {ci === 0 ? (
                          <Chip
                            label={isBalanced ? "✓ 0.00 — Balanced" : (fmtVal(v) ?? "—")}
                            size="small"
                            color={isBalanced ? "success" : "error"}
                            sx={{ fontSize: "0.7rem", fontWeight: 700, height: 20, borderRadius: 1 }}
                          />
                        ) : (
                          <Box component="span" sx={{ color: "#CBD5E1" }}>—</Box>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            }

            const s           = ROW_STYLES[row.type] ?? ROW_STYLES.data;
            const isSection   = row.type === "section";
            const isSub       = row.type === "subsection";
            const canToggle   = isSection || isSub;
            const isCollapsed = isSection ? collapsedSections.has(idx) : isSub ? collapsedSubsections.has(idx) : false;
            const isHeader    = isSection || isSub;
            const isLine      = row.type === "data" || row.type === "retained";

            const vals = allCols.map((c) => (row.key ? (data[c]?.[row.key] ?? null) : null));

            return (
              <TableRow
                key={idx}
                sx={{
                  bgcolor: s.bg,
                  ...(isLine ? { "&:hover td, &:hover th": { bgcolor: alpha("#2563EB", 0.03) } } : {}),
                }}
              >
                <TableCell
                  component={isSection ? "th" : "td"}
                  scope={isSection ? "rowgroup" : undefined}
                  onClick={canToggle ? () => (isSection ? toggleSection(idx) : toggleSubsection(idx)) : undefined}
                  sx={{
                    color: s.labelColor,
                    fontWeight: s.fontWeight,
                    fontSize: s.fontSize,
                    textTransform: s.uppercase ? "uppercase" : "none",
                    letterSpacing: s.letterSpacing,
                    pl: s.indent ? 4 : 1.5,
                    pr: 1,
                    py: isHeader ? 1 : 0.65,
                    borderBottom: "1px solid #F1F5F9",
                    borderRight: "1px solid #E2E8F0",
                    ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                    bgcolor: s.stickyBg,
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    cursor: canToggle ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {canToggle && (
                    <Box component="span" sx={{ display: "inline-flex", verticalAlign: "middle", mr: 0.5 }}>
                      {isCollapsed
                        ? <KeyboardArrowRightIcon sx={{ fontSize: "1rem" }} />
                        : <KeyboardArrowDownIcon  sx={{ fontSize: "1rem" }} />
                      }
                    </Box>
                  )}
                  {row.label ?? ""}
                </TableCell>

                {vals.map((v, ci) => {
                  const formatted = isHeader ? null : fmtVal(v);
                  const isNeg = v != null && v < 0;

                  let valColor  = s.valColor;
                  let valWeight = s.fontWeight;
                  if (isLine && isNeg)   valColor = "#DC2626";
                  if (isLine && !isNeg && v != null) valColor = "#166534";

                  return (
                    <TableCell
                      key={ci}
                      align="right"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: s.fontSize,
                        fontWeight: valWeight,
                        color: valColor,
                        py: isHeader ? 1 : 0.65,
                        borderBottom: "1px solid #F1F5F9",
                        bgcolor: s.bg,
                        ...(s.borderTop ? { borderTop: s.borderTop } : {}),
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isHeader
                        ? null
                        : formatted ?? <Box component="span" sx={{ color: "#CBD5E1" }}>—</Box>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BSBDPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  const [collapsedSections,    setCollapsedSections]    = useState<Set<number>>(new Set());
  const [collapsedSubsections, setCollapsedSubsections] = useState<Set<number>>(new Set());

  const toggleSection    = (i: number) => setCollapsedSections(p    => { const s = new Set(p); s.has(i) ? s.delete(i) : s.add(i); return s; });
  const toggleSubsection = (i: number) => setCollapsedSubsections(p => { const s = new Set(p); s.has(i) ? s.delete(i) : s.add(i); return s; });

  if (!result) return null;

  const { bsBdPreview, companyName } = result;
  if (!bsBdPreview) return (
    <Box sx={{ p: 4 }}>
      <Typography color="text.secondary">No Balance Sheet (BD) data available.</Typography>
    </Box>
  );

  const preview  = bsBdPreview as unknown as BsBdPreview;
  const years    = preview.available_years ?? [];
  const quarters = preview.available_quarters ?? [];

  const defaultYear    = years[years.length - 1] ?? new Date().getFullYear();
  const defaultQuarter = quarters[quarters.length - 1] ?? "";

  const selectedYear    = pageFilters.bsBD?.selectedYear    ?? defaultYear;
  const selectedQuarter = pageFilters.bsBD?.selectedQuarter ?? defaultQuarter;

  const setSelectedYear    = (y: number) =>
    setPageFilter("bsBD", { selectedYear: y, selectedQuarter: pageFilters.bsBD?.selectedQuarter ?? defaultQuarter });
  const setSelectedQuarter = (q: string) =>
    setPageFilter("bsBD", { selectedYear: pageFilters.bsBD?.selectedYear ?? defaultYear, selectedQuarter: q });

  const effectiveQuarter = selectedQuarter || defaultQuarter;

  const fourQuarters = useMemo(
    () => (effectiveQuarter ? fourQuartersEndingAt(effectiveQuarter) : []),
    [effectiveQuarter],
  );

  const yearCols = useMemo(
    () => [selectedYear - 1, selectedYear].map(String).filter((y) => y in preview.data),
    [selectedYear, preview.data],
  );

  const handleDownload = async () => {
    const blob = await fpaDownloadFilteredReport("bs_bd", { selected_quarter: effectiveQuarter });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${companyName}_bs_bd_${effectiveQuarter}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableProps = { preview, fourQuarters, yearCols, collapsedSections, collapsedSubsections, toggleSection, toggleSubsection };

  return (
    <Box className="page-enter">
      <Box
        component="section"
        aria-label="Page controls"
        sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}
      >
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                Balance Sheet (BD)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                4 quarters ending {effectiveQuarter} &mdash; <strong>{companyName}</strong>
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {years.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <InputLabel id="bsbd-year-label">Year</InputLabel>
                  <Select
                    labelId="bsbd-year-label"
                    value={selectedYear}
                    label="Year"
                    onChange={(e: SelectChangeEvent<number>) => setSelectedYear(Number(e.target.value))}
                  >
                    {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
                  </Select>
                </FormControl>
              )}

              {quarters.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel id="bsbd-q-label">As of Quarter</InputLabel>
                  <Select
                    labelId="bsbd-q-label"
                    value={effectiveQuarter}
                    label="As of Quarter"
                    onChange={(e: SelectChangeEvent) => setSelectedQuarter(e.target.value)}
                  >
                    {quarters.map((q) => <MenuItem key={q} value={q}>{q}</MenuItem>)}
                  </Select>
                </FormControl>
              )}

              <Button
                size="small"
                variant="contained"
                startIcon={<AccountBalanceIcon aria-hidden="true" />}
                onClick={handleDownload}
                aria-label={`Download ${companyName} BS BD ${effectiveQuarter}`}
                sx={{ background: "linear-gradient(135deg,#400f61,#2d0a45)", height: 40 }}
              >
                Download .xlsx
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <FullScreenWrapper
          title={`Balance Sheet (BD) — ${companyName} — As of ${effectiveQuarter}`}
          fullContent={<BSBDTable {...tableProps} />}
        >
          <BSBDTable {...tableProps} />
        </FullScreenWrapper>
      </Container>
    </Box>
  );
}
