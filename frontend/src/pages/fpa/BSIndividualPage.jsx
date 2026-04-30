/**
 * BSIndividualPage
 *
 * Mirrors the "BS (Individual)" sheet in the Excel reference.
 *
 * • Month/date selector changes the "As of" view (no API call — all months
 *   are pre-computed in the preview payload).
 * • Columns: Particulars | {company_name} | Insurance Brokers (blank) | Eliminations (blank) | Consolidated
 */

import {
  Box, Container, Typography, Button,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";

import BSIndividualTable from "../../components/fpa/BSIndividualTable";
import FullScreenWrapper  from "../../components/fpa/FullScreenWrapper";
import { useFpaResult }      from "../../context/FpaResultContext";

export default function BSIndividualPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  if (!result) return null;
  const { bsiBlob, bsiPreview, companyName } = result;

  // Support both preview shapes
  const isNewShape   = !!bsiPreview?.rows_by_month;
  const months       = isNewShape ? (bsiPreview?.months ?? []) : [];
  const defaultMonth = isNewShape ? (bsiPreview?.as_of ?? "") : (bsiPreview?.as_of ?? "");

  const selectedMonth = pageFilters.bsIndividual?.selectedMonth ?? defaultMonth;
  const setSelectedMonth = (v) => setPageFilter("bsIndividual", { selectedMonth: v });

  // Rows for the selected month
  const rows = isNewShape
    ? (bsiPreview?.rows_by_month?.[selectedMonth] ?? [])
    : (bsiPreview?.rows ?? []);

  const checkRow    = rows.find((r) => r.type === "check");
  const assetRow    = rows.find((r) => r.label === "TOTAL ASSETS");

  const checkVal   = isNewShape ? (checkRow?.co_a ?? null) : (checkRow?.value ?? null);
  const isBalanced = checkVal != null && Math.abs(checkVal) < 0.01;

  const handleDownload = () => {
    if (!bsiBlob) return;
    const url = URL.createObjectURL(bsiBlob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `${companyName}_bs_individual.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayMonth = selectedMonth || defaultMonth;

  return (
    <Box className="page-enter">

      {/* ── Page header band ────────────────────────────────────────────────── */}
      <Box
        component="section"
        aria-label="Page controls"
        sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}
      >
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                Balance Sheet — Individual
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Account-level detail &mdash; <strong>{companyName}</strong>
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {/* Month selector */}
              {months.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="bsi-month-label">As of</InputLabel>
                  <Select
                    labelId="bsi-month-label"
                    value={selectedMonth}
                    label="As of"
                    onChange={(e) => setSelectedMonth(e.target.value)}
                  >
                    {months.map((m) => (
                      <MenuItem key={m} value={m}>{m}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {bsiBlob && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AccountBalanceWalletIcon aria-hidden="true" />}
                  onClick={handleDownload}
                  aria-label={`Download ${companyName}_bs_individual.xlsx`}
                  sx={{ background: "linear-gradient(135deg,#400f61,#2d0a45)", height: 40 }}
                >
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>

        {/* ── BS Individual Table ──────────────────────────────────────────── */}
        {bsiPreview && (
          <FullScreenWrapper
            title={`Balance Sheet — Individual — ${companyName} — ${displayMonth}`}
            fullContent={
              <BSIndividualTable
                data={bsiPreview}
                selectedMonth={selectedMonth}
                companyName={companyName}
              />
            }
          >
            <BSIndividualTable
              data={bsiPreview}
              selectedMonth={selectedMonth}
              companyName={companyName}
            />
          </FullScreenWrapper>
        )}
      </Container>
    </Box>
  );
}
