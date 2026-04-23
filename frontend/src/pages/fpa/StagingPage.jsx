import { useState } from "react";
import {
  Box, Container, Typography, Button, Chip, Tabs, Tab, alpha,
} from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import TableChartIcon from "@mui/icons-material/TableChart";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import PreviewTable    from "../../components/fpa/PreviewTable";
import SummaryCard     from "../../components/fpa/SummaryCard";
import TransformLogic  from "../../components/fpa/TransformLogic";
import FullScreenWrapper from "../../components/fpa/FullScreenWrapper";
import { useFpaResult } from "../../context/FpaResultContext";

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, icon: Icon, color = "primary" }) {
  const colorMap = {
    primary: { bg: alpha("#2563EB", 0.07), icon: "#2563EB", text: "#1E40AF" },
    success: { bg: alpha("#059669", 0.07), icon: "#059669", text: "#047857" },
    warning: { bg: alpha("#D97706", 0.07), icon: "#D97706", text: "#92400E" },
    error:   { bg: alpha("#DC2626", 0.07), icon: "#DC2626", text: "#991B1B" },
  };
  const c = colorMap[color];
  return (
    <Box
      sx={{
        flex: "1 1 160px", p: 2.5, borderRadius: 3,
        bgcolor: "background.paper",
        border: "1px solid #E2E8F0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        display: "flex", flexDirection: "column", gap: 1,
        transition: "box-shadow 0.18s",
        "&:hover": { boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
      }}
      role="listitem"
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
          {label}
        </Typography>
        <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: c.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon sx={{ fontSize: 15, color: c.icon }} aria-hidden="true" />
        </Box>
      </Box>
      <Typography
        className="count-enter"
        sx={{ fontWeight: 800, fontSize: "1.4rem", color: c.text, lineHeight: 1.1 }}
        aria-label={`${label}: ${value}`}
      >
        {value}
      </Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StagingPage() {
  const { result } = useFpaResult();
  const [tab, setTab] = useState(0);
  if (!result) return null;
  const { summary, previewRows, downloadBlob, companyName } = result;

  const coverage = summary
    ? ((summary.matched_rows / summary.total_rows) * 100).toFixed(1)
    : "0";

  const handleDownload = () => {
    if (!downloadBlob) return;
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement("a");
    a.href = url; a.download = `${companyName}_staging_output.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box className="page-enter">
      {/* ── Page header band ─────────────────────────────────────────── */}
      <Box
        sx={{
          borderBottom: "1px solid #E2E8F0",
          bgcolor: "background.paper",
          px: { xs: 2, md: 4 }, py: 2.5,
        }}
      >
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                Staging Output
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Transaction Detail by Account &mdash; <strong>{companyName}</strong>
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon aria-hidden="true" />}
              onClick={handleDownload}
              aria-label={`Download ${companyName}_staging_output.xlsx`}
              sx={{ background: "linear-gradient(135deg,#2563EB,#1D4ED8)" }}
            >
              Download .xlsx
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>

        {/* ── Stats row ──────────────────────────────────────────────── */}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 3 }} role="list" aria-label="Summary statistics">
          <StatTile label="Total rows"   value={summary?.total_rows?.toLocaleString()}   icon={TrendingUpIcon}    color="primary" />
          <StatTile label="Mapped"       value={summary?.matched_rows?.toLocaleString()} icon={CheckCircleIcon}   color="success"
            sub={`${coverage}% coverage`} />
          <StatTile
            label="Unmapped"
            value={summary?.unmatched_rows?.toLocaleString()}
            icon={WarningAmberIcon}
            color={summary?.unmatched_rows > 0 ? "warning" : "success"}
          />
        </Box>

        {/* ── Summary card ───────────────────────────────────────────── */}
        <SummaryCard summary={summary} />

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <Box sx={{ mt: 3 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            aria-label="Staging output views"
            sx={{
              borderBottom: "1px solid #E2E8F0", mb: 0,
              "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0" },
            }}
          >
            <Tab id="stg-tab-0" aria-controls="stg-panel-0" icon={<TableChartIcon fontSize="small" />} iconPosition="start" label="Data Preview" />
            <Tab id="stg-tab-1" aria-controls="stg-panel-1" icon={<AccountTreeIcon fontSize="small" />} iconPosition="start" label="Transformation Logic" />
          </Tabs>

          <Box role="tabpanel" id="stg-panel-0" aria-labelledby="stg-tab-0" hidden={tab !== 0} sx={{ mt: 2 }}>
            {tab === 0 && (
              <FullScreenWrapper title="Data Preview — Staging Output" fullContent={<PreviewTable rows={previewRows} />}>
                <PreviewTable rows={previewRows} />
              </FullScreenWrapper>
            )}
          </Box>

          <Box role="tabpanel" id="stg-panel-1" aria-labelledby="stg-tab-1" hidden={tab !== 1} sx={{ mt: 2 }}>
            {tab === 1 && (
              <FullScreenWrapper title="Transformation Logic" fullContent={<TransformLogic />}>
                <TransformLogic />
              </FullScreenWrapper>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
