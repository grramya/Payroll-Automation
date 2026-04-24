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
  Box, Container, Typography, Button,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";

import PLIndividualTable from "../../components/fpa/PLIndividualTable";
import FullScreenWrapper from "../../components/fpa/FullScreenWrapper";
import { useFpaResult }     from "../../context/FpaResultContext";

export default function PLIndividualPage() {
  const { result } = useFpaResult();
  if (!result) return null;
  const { plBlob, plPreview, companyName } = result;

  const months       = plPreview?.months ?? [];
  const defaultMonth = months[months.length - 1] ?? "";

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

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
                  <InputLabel id="pl-month-label">As of</InputLabel>
                  <Select
                    labelId="pl-month-label"
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

              {plBlob && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<DownloadIcon aria-hidden="true" />}
                  onClick={handleDownload}
                  aria-label={`Download ${companyName}_pl_individual.xlsx`}
                  sx={{ background: "linear-gradient(135deg,#059669,#047857)", height: 40 }}
                >
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>

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


