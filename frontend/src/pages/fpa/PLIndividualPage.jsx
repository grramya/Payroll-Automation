/**
 * PLIndividualPage
 *
 * Mirrors the "Base P&L (Class) (Individual)" sheet in the Excel reference.
 *
 * • Month selector changes which month is rendered in the table (no API call).
 * • Columns: Particulars | Mapping | {company_name} | Concertiv Insurance Brokers | Consolidated
 * • Insurance Brokers column is blank (—) — no data from current upload.
 * • Consolidated = company_name column (since Insurance Brokers = 0).
 */

import { useState } from "react";
import {
  Box, Container, Typography, Button, Chip, Paper, alpha,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import TrendingUpIcon    from "@mui/icons-material/TrendingUp";
import TrendingDownIcon  from "@mui/icons-material/TrendingDown";
import DownloadIcon      from "@mui/icons-material/Download";

import PLIndividualTable from "../../components/fpa/PLIndividualTable";
import FullScreenWrapper from "../../components/fpa/FullScreenWrapper";
import { useFpaResult }     from "../../context/FpaResultContext";

export default function PLIndividualPage() {
  const { result } = useFpaResult();
  if (!result) return null;
  const { plBlob, plPreview, companyName } = result;

  const months      = plPreview?.months ?? [];
  const rows        = plPreview?.rows   ?? [];
  const defaultMonth = months[months.length - 1] ?? "";

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  // ── KPI helpers ────────────────────────────────────────────────────────────
  const findRow = (label) => rows.find((r) => r.label === label);
  const getVal  = (row)  =>
    row?.values?.[selectedMonth]?.co_a ?? null;

  const totalRevRow  = findRow("Total Revenue");
  const grossProfRow = findRow("Gross Profit");
  const opProfRow    = findRow("Operating Profit");
  const netIncRow    = findRow("Net Income");

  const totalRev  = getVal(totalRevRow);
  const grossProf = getVal(grossProfRow);
  const opProf    = getVal(opProfRow);
  const netInc    = getVal(netIncRow);

  const fmtAmt = (v) => {
    if (v == null) return "—";
    const abs  = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  };

  const fmtPct = (num, den) => {
    if (num == null || !den || Math.abs(den) < 0.001) return null;
    return `${((num / den) * 100).toFixed(1)}%`;
  };

  const handleDownload = () => {
    if (!plBlob) return;
    const url = URL.createObjectURL(plBlob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `${companyName}_pl_individual.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box className="page-enter">

      {/* ── Page header band ────────────────────────────────────────────────── */}
      <Box
        sx={{
          borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper",
          px: { xs: 2, md: 4 }, py: 2.5,
        }}
      >
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                Base P&amp;L — Class (Individual)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Monthly P&amp;L by department &amp; classification &mdash; <strong>{companyName}</strong>
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {/* Month selector */}
              {months.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="pl-month-label" sx={{ fontSize: "0.8rem" }}>
                    As of
                  </InputLabel>
                  <Select
                    labelId="pl-month-label"
                    value={selectedMonth}
                    label="As of"
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    sx={{ fontSize: "0.82rem" }}
                  >
                    {months.map((m) => (
                      <MenuItem key={m} value={m} sx={{ fontSize: "0.82rem" }}>
                        {m}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}


              {plBlob && (
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon aria-hidden="true" />}
                  onClick={handleDownload}
                  aria-label={`Download ${companyName}_pl_individual.xlsx`}
                  sx={{ background: "linear-gradient(135deg,#059669,#047857)" }}
                >
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>

        {/* ── KPI tiles for selected month ──────────────────────────────────── */}
        {selectedMonth && (
          <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>

            <KpiTile label="Total Revenue"     value={fmtAmt(totalRev)}  positive={totalRev  >= 0} period={selectedMonth} />
            <KpiTile
              label="Gross Profit"
              value={fmtAmt(grossProf)}
              sub={fmtPct(grossProf, totalRev)}
              positive={grossProf != null && grossProf >= 0}
              period={selectedMonth}
            />
            <KpiTile
              label="Operating Profit"
              value={fmtAmt(opProf)}
              sub={fmtPct(opProf, totalRev)}
              positive={opProf != null && opProf >= 0}
              period={selectedMonth}
            />
            <KpiTile
              label="Net Income"
              value={fmtAmt(netInc)}
              sub={fmtPct(netInc, totalRev)}
              positive={netInc != null && netInc >= 0}
              period={selectedMonth}
            />

          </Box>
        )}

        {/* ── P&L Table ────────────────────────────────────────────────────── */}
        {plPreview && months.length > 0 ? (
          <FullScreenWrapper
            title={`Base P&L — Class (Individual) — ${companyName} — ${selectedMonth}`}
            fullContent={
              <PLIndividualTable
                data={plPreview}
                selectedMonth={selectedMonth}
                companyName={companyName}
              />
            }
          >
            <PLIndividualTable
              data={plPreview}
              selectedMonth={selectedMonth}
              companyName={companyName}
            />
          </FullScreenWrapper>
        ) : (
          <Box
            sx={{
              p: 4, textAlign: "center", borderRadius: 3,
              border: "1px dashed #CBD5E1", color: "text.secondary",
            }}
          >
            <Typography variant="body2">
              No P&amp;L data found. Ensure the uploaded file contains Profit &amp; Loss
              accounts with Classification 2 mappings.
            </Typography>
          </Box>
        )}
      </Container>
    </Box>
  );
}


// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, positive, period }) {
  const color = positive ? "success.main" : "error.main";
  const Icon  = positive ? TrendingUpIcon : TrendingDownIcon;

  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        flex: "0 0 160px", p: 2.5, borderRadius: 3, textAlign: "center",
        borderColor: positive ? alpha("#059669", 0.3) : alpha("#DC2626", 0.3),
        bgcolor:     positive ? alpha("#059669", 0.03) : alpha("#DC2626", 0.03),
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "center", mb: 0.75 }}>
        <Icon sx={{ fontSize: 18, color }} />
      </Box>
      <Typography sx={{ fontWeight: 800, fontSize: "1.25rem", color, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {sub} of revenue
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "block", mt: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontSize: "0.65rem" }}>
        {period}
      </Typography>
    </Paper>
  );
}
