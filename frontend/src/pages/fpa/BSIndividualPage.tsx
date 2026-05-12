import {
  Box, Container, Typography, Button,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import BSIndividualTable from "../../components/fpa/BSIndividualTable";
import FullScreenWrapper  from "../../components/fpa/FullScreenWrapper";
import { useFpaResult }   from "../../context/FpaResultContext";

export default function BSIndividualPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  if (!result) return null;
  const { bsiUrl, bsiPreview, companyName } = result;

  const bsi = bsiPreview as Record<string, unknown> | null;
  const isNewShape   = !!bsi?.rows_by_month;
  const months       = isNewShape ? (bsi?.months as string[] ?? []) : [];
  const defaultMonth = (bsi?.as_of as string) ?? "";

  const selectedMonth    = (pageFilters.bsIndividual as Record<string, unknown> | undefined)?.selectedMonth as string ?? defaultMonth;
  const setSelectedMonth = (v: string) => setPageFilter("bsIndividual", { selectedMonth: v } as never);

  const rows       = isNewShape ? ((bsi?.rows_by_month as Record<string, unknown[]>)?.[selectedMonth] ?? []) : ((bsi?.rows as unknown[]) ?? []);
  const checkRow   = rows.find((r: unknown) => (r as Record<string, unknown>).type === "check") as Record<string, unknown> | undefined;
  const checkVal   = isNewShape ? (checkRow?.co_a as number ?? null) : (checkRow?.value as number ?? null);
  const isBalanced = checkVal != null && Math.abs(checkVal) < 0.01;

  const handleDownload = () => {
    if (!bsiUrl) return;
    const a = document.createElement("a");
    a.href = bsiUrl; a.download = `${companyName}_bs_individual.xlsx`; a.click();
  };

  const displayMonth = selectedMonth || defaultMonth;

  return (
    <Box className="page-enter">
      <Box component="section" aria-label="Page controls" sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}>
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Balance Sheet — Individual</Typography>
              <Typography variant="body2" color="text.secondary">Account-level detail &mdash; <strong>{companyName}</strong></Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {months.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="bsi-month-label">As of</InputLabel>
                  <Select labelId="bsi-month-label" value={selectedMonth} label="As of" onChange={(e: SelectChangeEvent) => setSelectedMonth(e.target.value)}>
                    {months.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
              {bsiUrl && (
                <Button size="small" variant="contained" startIcon={<AccountBalanceWalletIcon aria-hidden="true" />} onClick={handleDownload} aria-label={`Download ${companyName}_bs_individual.xlsx`} sx={{ background: "linear-gradient(135deg,#400f61,#2d0a45)", height: 40 }}>
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {bsiPreview && (
          <FullScreenWrapper title={`Balance Sheet — Individual — ${companyName} — ${displayMonth}`} fullContent={<BSIndividualTable data={bsiPreview as never} selectedMonth={selectedMonth} companyName={companyName} />}>
            <BSIndividualTable data={bsiPreview as never} selectedMonth={selectedMonth} companyName={companyName} />
          </FullScreenWrapper>
        )}
      </Container>
    </Box>
  );
}
