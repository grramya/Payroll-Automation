import { useState } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { apiClient as axios } from "../../api/api";
import {
  Box, Container, Typography, TextField, Button,
  LinearProgress, Alert, InputAdornment, alpha,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import BoltIcon from "@mui/icons-material/Bolt";
import BusinessIcon from "@mui/icons-material/Business";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TableChartIcon from "@mui/icons-material/TableChart";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";

import FileDropZone from "../../components/fpa/FileDropZone";
import { useFpaResult } from "../../context/FpaResultContext";

const API = "";

function b64ToBlob(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ── Custom horizontal step indicator ─────────────────────────────────────────
function StepRow({ steps, active }) {
  return (
    <Box
      sx={{ display: "flex", alignItems: "center", mb: 4 }}
      role="list"
      aria-label="Steps"
    >
      {steps.map((label, i) => {
        const done   = i < active;
        const cur    = i === active;
        const future = i > active;
        return (
          <Box key={label} sx={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }} role="listitem">
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
              <Box
                aria-label={`Step ${i + 1}: ${label}${done ? " (completed)" : cur ? " (current)" : ""}`}
                sx={{
                  width: 32, height: 32, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "0.78rem",
                  transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
                  bgcolor: done ? "success.main" : cur ? "primary.main" : "#E2E8F0",
                  color: done || cur ? "white" : "#94A3B8",
                  boxShadow: cur ? "0 0 0 4px rgba(37,99,235,0.15)" : "none",
                }}
              >
                {done ? <CheckIcon sx={{ fontSize: 15 }} /> : i + 1}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: cur ? 600 : 500,
                  color: done ? "success.main" : cur ? "primary.main" : "text.disabled",
                  fontSize: "0.68rem",
                  whiteSpace: "nowrap",
                  transition: "color 0.25s",
                }}
              >
                {label}
              </Typography>
            </Box>
            {i < steps.length - 1 && (
              <Box
                aria-hidden="true"
                sx={{
                  flex: 1, height: 2, mx: 1.5, mb: 2.5,
                  bgcolor: i < active ? "success.main" : "#E2E8F0",
                  borderRadius: 99,
                  transition: "background-color 0.5s ease",
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ── Output card (shown after success) ────────────────────────────────────────
const COLOR_HEX = {
  primary:   "#236CFF",
  success:   "#059669",
  secondary: "#7C3AED",
  warning:   "#D97706",
  error:     "#DC2626",
};

function OutputCard({ icon: Icon, title, subtitle, color, onClick, ariaLabel }) {
  const hex = COLOR_HEX[color] ?? COLOR_HEX.primary;
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-label={ariaLabel}
      sx={{
        flex: "1 1 200px", display: "flex", alignItems: "center", gap: 2,
        p: 2.5, borderRadius: 3, border: "1.5px solid",
        borderColor: hex,
        bgcolor: alpha(hex, 0.04),
        cursor: "pointer", textAlign: "left",
        transition: "all 0.18s ease",
        outline: "none",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: `0 6px 16px ${alpha(hex, 0.18)}`,
        },
        "&:focus-visible": { outline: "2px solid", outlineColor: hex, outlineOffset: 2 },
      }}
    >
      <Box
        sx={{
          width: 40, height: 40, borderRadius: 2.5,
          bgcolor: hex,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <Icon sx={{ color: "white", fontSize: 20 }} />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "0.88rem", color: "text.primary", display: "block", mb: 0.25 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      </Box>
      <ArrowRightIcon sx={{ color: "text.disabled", fontSize: 20, flexShrink: 0 }} aria-hidden="true" />
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GeneratePage() {
  const navigate = useNavigate();
  const { result, setResult } = useFpaResult();

  const [inputFile,   setInputFile]   = useState(null);
  const [companyName, setCompanyName] = useState(result?.companyName ?? "");
  const [status,      setStatus]      = useState(result ? "done" : "idle");
  const [errorMsg,    setErrorMsg]    = useState("");

  const handleFile = (file) => {
    setInputFile(file);
    if (!file || companyName.trim()) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", sheetRows: 5 });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        for (const row of raw) {
          for (const cell of row) {
            const s = String(cell).trim();
            if (s && s.toLowerCase() !== "nan") {
              setCompanyName(s);
              return;
            }
          }
        }
      } catch (_) {}
    };
    reader.readAsArrayBuffer(file);
  };

  const fileReady    = !!inputFile;
  const companyReady = companyName.trim().length > 0;
  const canTransform = fileReady && companyReady && status !== "loading";
  const isLoading    = status === "loading";
  const isDone       = status === "done";

  const activeStep = isDone ? 3 : !fileReady ? 0 : companyReady ? 1 : 1;

  const handleTransform = async () => {
    setStatus("loading");
    setErrorMsg("");
    const form = new FormData();
    form.append("input_file",   inputFile);
    form.append("company_name", companyName.trim());
    try {
      const res = await axios.post("/fpa/transform", form);
      const {
        summary, preview,
        excel_b64, bs_excel_b64, bs_preview, bsi_excel_b64, bsi_preview,
        pl_excel_b64, pl_preview,
        comp_pl_excel_b64, comp_pl_preview,
        comp_pl_bd_excel_b64, comp_pl_bd_preview,
      } = res.data;
      setResult({
        summary, previewRows: preview, companyName: companyName.trim(),
        downloadBlob:      b64ToBlob(excel_b64),
        bsBlob:            bs_excel_b64         ? b64ToBlob(bs_excel_b64)         : null,
        bsPreview:         bs_preview          ?? null,
        bsiBlob:           bsi_excel_b64        ? b64ToBlob(bsi_excel_b64)        : null,
        bsiPreview:        bsi_preview         ?? null,
        plBlob:            pl_excel_b64         ? b64ToBlob(pl_excel_b64)         : null,
        plPreview:         pl_preview          ?? null,
        compPlBlob:        comp_pl_excel_b64    ? b64ToBlob(comp_pl_excel_b64)    : null,
        compPlPreview:     comp_pl_preview     ?? null,
        compPlBdBlob:      comp_pl_bd_excel_b64 ? b64ToBlob(comp_pl_bd_excel_b64) : null,
        compPlBdPreview:   comp_pl_bd_preview  ?? null,
      });
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.response?.data?.detail ?? err.message);
      setStatus("error");
    }
  };

  const handleReset = () => {
    setInputFile(null);
    setCompanyName("");
    setStatus("idle");
    setErrorMsg("");
    setResult(null);
  };

  return (
    <Container maxWidth="md" sx={{ py: 5, px: { xs: 3, md: 5 } }} className="page-enter">

      {/* ── Page heading ───────────────────────────────────────────────── */}
      <Box sx={{ mb: 5 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: "text.primary", mb: 0.75 }}>
          Transform your data
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: "0.9375rem" }}>
          Upload a QuickBooks export and generate your staging file&nbsp;&amp;&nbsp;Base BS in seconds.
        </Typography>
      </Box>

      {/* ── Step indicator ─────────────────────────────────────────────── */}
      <StepRow
        steps={["Upload file", "Company name", "Generate"]}
        active={isDone ? 3 : !fileReady ? 0 : 1}
      />

      {/* ── Step 1 card ────────────────────────────────────────────────── */}
      <Box
        component="section"
        aria-labelledby="step1-label"
        sx={{
          mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3,
          border: "1px solid",
          borderColor: fileReady ? "success.main" : "#E2E8F0",
          borderLeftWidth: 4,
          borderLeftColor: fileReady ? "success.main" : "primary.main",
          boxShadow: 1,
          transition: "border-color 0.3s",
        }}
      >
        <Typography id="step1-label" variant="subtitle1" sx={{ mb: 0.5, color: "text.primary" }}>
          Upload input file
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          QuickBooks export (.xlsx). Mapping rules are built-in — no mapping file needed.
        </Typography>
        <FileDropZone accept=".xlsx" file={inputFile} onFile={handleFile} label="Input File (.xlsx)" />
      </Box>

      {/* ── Step 2 card ────────────────────────────────────────────────── */}
      <Box
        component="section"
        aria-labelledby="step2-label"
        sx={{
          mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3,
          border: "1px solid",
          borderColor: isDone ? "success.main" : fileReady ? "#E2E8F0" : "#E2E8F0",
          borderLeftWidth: 4,
          borderLeftColor: isDone ? "success.main" : fileReady ? "primary.main" : "#E2E8F0",
          boxShadow: 1,
          opacity: fileReady ? 1 : 0.5,
          pointerEvents: fileReady ? "auto" : "none",
          transition: "opacity 0.25s, border-color 0.3s",
        }}
      >
        <Typography id="step2-label" variant="subtitle1" sx={{ mb: 0.5, color: "text.primary" }}>
          Company name
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          Placed in cell A1 and the Company column of the output.
        </Typography>

        <Box
          component="form"
          onSubmit={(e) => { e.preventDefault(); if (canTransform) handleTransform(); }}
          sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "flex-start" }}
          noValidate
        >
          <TextField
            id="company-name-input"
            label="Company name"
            required
            fullWidth
            size="small"
            placeholder="e.g. Acme Corp, Inc."
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <BusinessIcon sx={{ fontSize: 16, color: "text.disabled" }} aria-hidden="true" />
                </InputAdornment>
              ),
            }}
            helperText={companyName.trim() ? `Output A1 → "${companyName.trim()}"` : " "}
            inputProps={{ "aria-label": "Company name", autoComplete: "organization" }}
            sx={{ flex: "1 1 220px" }}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={!canTransform}
            aria-label={isLoading ? "Generating…" : "Generate outputs"}
            aria-busy={isLoading}
            startIcon={!isLoading && <BoltIcon aria-hidden="true" />}
            sx={{
              height: 40, mt: 0.25, flexShrink: 0,
              background: canTransform
                ? "#236CFF"
                : undefined,
              "&:hover": { background: "#1650CC" },
            }}
          >
            {isLoading ? "Generating…" : "Generate"}
          </Button>
          {status !== "idle" && (
            <Button
              variant="ghost"
              size="small"
              onClick={handleReset}
              startIcon={<RestartAltIcon aria-hidden="true" />}
              aria-label="Reset all"
              sx={{ height: 40, mt: 0.25, color: "text.secondary", "&:hover": { bgcolor: "#F1F5F9" } }}
            >
              Reset
            </Button>
          )}
        </Box>

        {/* Loading bar */}
        {isLoading && (
          <Box sx={{ mt: 2.5 }} role="status" aria-label="Processing…">
            <LinearProgress sx={{ mb: 0.75 }} />
            <Typography variant="caption" color="text.secondary">
              Transforming data and building the balance sheet…
            </Typography>
          </Box>
        )}

        {/* Error */}
        {status === "error" && (
          <Alert severity="error" sx={{ mt: 2 }} role="alert" aria-live="assertive">
            {errorMsg}
          </Alert>
        )}
      </Box>

      {/* ── Step 3: success output cards ───────────────────────────────── */}
      {isDone && result && (
        <Box
          className="page-enter"
          sx={{
            p: 3, bgcolor: alpha("#059669", 0.04),
            border: "1.5px solid", borderColor: alpha("#059669", 0.25),
            borderRadius: 3, boxShadow: 1,
          }}
          role="status"
          aria-live="polite"
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <CheckIcon sx={{ color: "success.main", fontSize: 18 }} aria-hidden="true" />
            <Typography variant="subtitle1" color="success.dark" sx={{ fontWeight: 700 }}>
              All the files generated successfully
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
            {result.summary?.total_rows?.toLocaleString()} rows · {result.summary?.date_range} ·{" "}
            {((result.summary?.matched_rows / result.summary?.total_rows) * 100).toFixed(1)}% mapped
          </Typography>

          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
            <OutputCard
              icon={TableChartIcon}
              title="Staging Output"
              subtitle="Transaction detail by account"
              color="primary"
              onClick={() => navigate("/fpa/staging")}
              ariaLabel="Open Staging Output page"
            />
            <OutputCard
              icon={AccountBalanceIcon}
              title="Base Balance Sheet"
              subtitle={`${result.bsPreview?.months?.length ?? 0} months computed`}
              color="success"
              onClick={() => navigate("/fpa/base-bs")}
              ariaLabel="Open Base BS page"
            />
            <OutputCard
              icon={AccountBalanceWalletIcon}
              title="BS Individual"
              subtitle={`As of ${result.bsiPreview?.as_of ?? "—"} · account-level detail`}
              color="secondary"
              onClick={() => navigate("/fpa/bs-individual")}
              ariaLabel="Open BS Individual page"
            />
            <OutputCard
              icon={TrendingUpIcon}
              title="Base P&L"
              subtitle={`${result.plPreview?.months?.length ?? 0} months · class-level detail`}
              color="success"
              onClick={() => navigate("/fpa/pl-individual")}
              ariaLabel="Open Base P&L page"
            />
            <OutputCard
              icon={TrendingUpIcon}
              title="Comparative P&L (Class)"
              subtitle={`${result.compPlPreview?.available_months?.length ?? 0} months · monthly, quarterly & yearly`}
              color="warning"
              onClick={() => navigate("/fpa/comparative-pl")}
              ariaLabel="Open Comparative P&L (Class) page"
            />
            <OutputCard
              icon={TrendingUpIcon}
              title="Comparative P&L (BD)"
              subtitle={`${result.compPlBdPreview?.available_months?.length ?? 0} months · BD-consolidated view`}
              color="error"
              onClick={() => navigate("/fpa/comparative-pl-bd")}
              ariaLabel="Open Comparative P&L (BD) page"
            />
          </Box>
        </Box>
      )}

    </Container>
  );
}
