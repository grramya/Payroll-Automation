import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { apiClient as axios } from "../../api/api";
import {
  Box, Container, Typography, TextField, Button,
  LinearProgress, Alert, InputAdornment, alpha,
  Tabs, Tab, Chip, Switch, FormControlLabel, Collapse,
  CircularProgress,
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
import LinkIcon from "@mui/icons-material/Link";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import FileDropZone from "../../components/fpa/FileDropZone";
import { useFpaResult } from "../../context/FpaResultContext";

function b64ToBlob(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function formatAge(isoStr) {
  const mins = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepRow({ steps, active }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 4 }} role="list" aria-label="Steps">
      {steps.map((label, i) => {
        const done = i < active;
        const cur  = i === active;
        return (
          <Box key={label} sx={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }} role="listitem">
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: "0.78rem",
                transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
                bgcolor: done ? "success.main" : cur ? "primary.main" : "#E2E8F0",
                color: done || cur ? "white" : "#94A3B8",
                boxShadow: cur ? "0 0 0 4px rgba(37,99,235,0.15)" : "none",
              }}>
                {done ? <CheckIcon sx={{ fontSize: 15 }} /> : i + 1}
              </Box>
              <Typography variant="caption" sx={{ fontWeight: cur ? 600 : 500, color: done ? "success.main" : cur ? "primary.main" : "text.disabled", fontSize: "0.68rem", whiteSpace: "nowrap" }}>
                {label}
              </Typography>
            </Box>
            {i < steps.length - 1 && (
              <Box sx={{ flex: 1, height: 2, mx: 1.5, mb: 2.5, bgcolor: i < active ? "success.main" : "#E2E8F0", borderRadius: 99, transition: "background-color 0.5s ease" }} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ── Report navigation items ────────────────────────────────────────────────────
const REPORT_ITEMS = [
  { path: "/fpa/staging",           icon: "table_chart",     title: "Staging Output",             sub: (r) => "Transaction detail by account" },
  { path: "/fpa/base-bs",           icon: "account_balance", title: "Base Balance Sheet",         sub: (r) => `${r.bsPreview?.months?.length ?? 0} months computed` },
  { path: "/fpa/bs-individual",     icon: "account_tree",    title: "BS Individual",              sub: (r) => `As of ${r.bsiPreview?.as_of ?? "—"} · account-level detail` },
  { path: "/fpa/pl-individual",     icon: "trending_up",     title: "Base P&L",                   sub: (r) => `${r.plPreview?.months?.length ?? 0} months · class-level detail` },
  { path: "/fpa/comparative-pl",    icon: "show_chart",      title: "Comparative P&L (Class)",    sub: (r) => `${r.compPlPreview?.available_months?.length ?? 0} months` },
  { path: "/fpa/comparative-pl-bd", icon: "bar_chart",       title: "Comparative P&L (BD)",       sub: (r) => `${r.compPlBdPreview?.available_months?.length ?? 0} months` },
];

function ReportCard({ icon, title, subtitle, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "13px 16px",
        background: hovered ? "var(--p-light)" : "var(--surface)",
        border: `1.5px solid ${hovered ? "var(--p)" : "var(--border)"}`,
        borderRadius: "var(--r8)",
        cursor: "pointer", textAlign: "left", width: "100%",
        transition: "border-color .15s, background .15s",
        fontFamily: "inherit",
        boxShadow: hovered ? "0 2px 8px rgba(64,15,97,0.10)" : "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
        background: hovered ? "var(--p)" : "var(--p-light)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .15s",
      }}>
        <span className="material-icons-round" style={{ fontSize: 19, color: hovered ? "#fff" : "var(--p)" }}>{icon}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.3 }}>{subtitle}</div>
      </div>
      <span className="material-icons-round" style={{ fontSize: 16, color: "var(--muted)", flexShrink: 0 }}>chevron_right</span>
    </button>
  );
}

// ── Reports-ready view ─────────────────────────────────────────────────────────
const STALE_HOURS = 24;

function isStale(isoStr) {
  if (!isoStr) return false;
  const ageHours = (Date.now() - new Date(isoStr).getTime()) / 3600000;
  return ageHours > STALE_HOURS;
}

function SuccessOutput({ result, navigate, onRefresh }) {
  const ageLabel = result?.cachedAt ? formatAge(result.cachedAt) : null;
  const stale    = isStale(result?.cachedAt);
  const { summary } = result;
  const pct = summary?.total_rows
    ? `${((summary.matched_rows / summary.total_rows) * 100).toFixed(1)}%`
    : "—";

  const metrics = [
    { label: "Transactions",    value: summary?.total_rows?.toLocaleString() ?? "—" },
    { label: "Date Range",      value: summary?.date_range ?? "—" },
    { label: "Mapped",          value: pct },
    ...(ageLabel ? [{ label: "Last Refreshed", value: ageLabel }] : []),
  ];

  return (
    <div>
      {/* Stale data warning */}
      {stale && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", marginBottom: 14,
          background: "#FFFBEB", border: "1px solid #FCD34D",
          borderRadius: 8, fontSize: 13,
        }}>
          <span className="material-icons-round" style={{ color: "#D97706", fontSize: 18, flexShrink: 0 }}>warning</span>
          <span style={{ color: "#92400E", flex: 1 }}>
            These reports are based on data fetched <strong>{ageLabel}</strong> and may be outdated.
          </span>
          <button
            onClick={onRefresh}
            style={{
              background: "#D97706", color: "#fff", border: "none",
              borderRadius: 6, padding: "4px 12px", fontSize: 12.5,
              cursor: "pointer", fontWeight: 600, flexShrink: 0,
            }}
          >
            Re-fetch
          </button>
        </div>
      )}

      {/* Metric strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {metrics.map(({ label, value }) => (
          <div key={label} style={{ flex: "1 1 130px", minWidth: 110, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r8)", padding: "11px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--p)", lineHeight: 1.2, marginBottom: 3 }}>{value}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Report grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 10 }}>
        {REPORT_ITEMS.map(({ path, icon, title, sub }) => (
          <ReportCard key={path} icon={icon} title={title} subtitle={sub(result)} onClick={() => navigate(path)} />
        ))}
      </div>
    </div>
  );
}

// ── QBO connect panel (one per company) ───────────────────────────────────────
function QboConnectPanel({ company, label, connected, onConnected, onError }) {
  const [step,        setStep]        = useState("idle");   // idle | waiting | pasting | done
  const [authUrl,     setAuthUrl]     = useState("");
  const [pasteMode,   setPasteMode]   = useState(false);
  const [pastedUrl,   setPastedUrl]   = useState("");
  const [localError,  setLocalError]  = useState("");
  const [connecting,  setConnecting]  = useState(false);

  const handleOpen = async () => {
    setLocalError(""); setStep("waiting"); setPastedUrl("");
    try {
      const res = await axios.get(`/fpa/qbo-auth-url?company=${company}`);
      setAuthUrl(res.data.auth_url);
      setPasteMode(res.data.paste_mode);
      window.open(res.data.auth_url, "_blank", "noopener,noreferrer");

      if (!res.data.paste_mode) {
        // Callback mode — poll until connected
        setStep("waiting");
        const interval = setInterval(async () => {
          try {
            const s = await axios.get("/fpa/qbo-status");
            if (s.data[company]?.connected) {
              clearInterval(interval);
              setStep("done");
              onConnected(s.data);
            }
          } catch (_) {}
        }, 2000);
        setTimeout(() => clearInterval(interval), 120000);
      } else {
        // Paste mode — show input
        setStep("pasting");
      }
    } catch (err) {
      setLocalError(err.response?.data?.detail ?? err.message);
      setStep("idle");
      onError(err.response?.data?.detail ?? err.message);
    }
  };

  const handlePasteSubmit = async () => {
    if (!pastedUrl.trim()) return;
    setConnecting(true); setLocalError("");
    try {
      await axios.post("/fpa/qbo-exchange-url", { redirect_url: pastedUrl.trim(), company });
      const s = await axios.get("/fpa/qbo-status");
      setStep("done");
      onConnected(s.data);
    } catch (err) {
      setLocalError(err.response?.data?.detail ?? err.message);
    } finally {
      setConnecting(false);
    }
  };

  if (connected) {
    return (
      <Chip size="small" label={`${label}: Connected`} color="success" variant="filled"
        icon={<CheckIcon style={{ fontSize: 14 }} />} sx={{ fontSize: "0.75rem" }} />
    );
  }

  return (
    <Box sx={{ flex: "1 1 280px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={`${label}: Not connected`} color="default" variant="outlined" sx={{ fontSize: "0.75rem" }} />
        {step === "idle" && (
          <Button size="small" variant="outlined" onClick={handleOpen}
            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
            sx={{ textTransform: "none", fontSize: "0.78rem" }}>
            Connect {label}
          </Button>
        )}
        {step === "waiting" && !pasteMode && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
            Waiting for authorization…
          </Typography>
        )}
      </Box>

      {/* Paste-mode instructions */}
      <Collapse in={step === "pasting"}>
        <Box sx={{ mt: 1.5, p: 2, bgcolor: "#F8FAFC", borderRadius: 2, border: "1px solid #E2E8F0" }}>
          <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 600, color: "text.primary" }}>
            After approving in the browser:
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            1. Intuit will redirect to the OAuth Playground page.<br />
            2. Copy the <strong>full URL</strong> from your browser's address bar.<br />
            3. Paste it below and click <strong>Submit</strong>.
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
            <TextField
              size="small" fullWidth placeholder="https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?code=..."
              value={pastedUrl} onChange={(e) => setPastedUrl(e.target.value)}
              sx={{ flex: "1 1 300px", "& .MuiInputBase-input": { fontSize: "0.78rem" } }}
              onKeyDown={(e) => { if (e.key === "Enter") handlePasteSubmit(); }}
            />
            <Button size="small" variant="contained" onClick={handlePasteSubmit}
              disabled={!pastedUrl.trim() || connecting}
              sx={{ height: 40, flexShrink: 0, textTransform: "none" }}>
              {connecting ? "Connecting…" : "Submit"}
            </Button>
          </Box>
          <Button size="small" onClick={() => window.open(authUrl, "_blank", "noopener,noreferrer")}
            startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
            sx={{ mt: 1, textTransform: "none", fontSize: "0.75rem", color: "text.secondary" }}>
            Re-open authorization page
          </Button>
        </Box>
      </Collapse>

      {localError && <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: "0.78rem" }}>{localError}</Alert>}
    </Box>
  );
}

// =============================================================================
// Main page
// =============================================================================
export default function GeneratePage() {
  const navigate = useNavigate();
  const { result, setResult, cacheStatus } = useFpaResult();

  const [tab, setTab] = useState(0);

  // ── Upload tab ─────────────────────────────────────────────────────────────
  const [inputFile,    setInputFile]    = useState(null);
  const [companyName,  setCompanyName]  = useState(result?.companyName ?? "");
  const [uploadStatus, setUploadStatus] = useState(result ? "done" : "idle");
  const [uploadError,  setUploadError]  = useState("");

  // ── QBO tab ────────────────────────────────────────────────────────────────
  const [qboStatus,      setQboStatus]      = useState(null);
  const [qboCompanyName, setQboCompanyName] = useState(result?.companyName ?? "Concertiv");
  const [includeBroker,  setIncludeBroker]  = useState(false);
  const [qboFetchStatus, setQboFetchStatus] = useState("idle");
  const [qboError,       setQboError]       = useState("");
  const [fetchRows,      setFetchRows]      = useState([]);
  const [fetchTotal,     setFetchTotal]     = useState(null);
  const abortRef = useRef(null);

  const fetchQboStatus = useCallback(async () => {
    try {
      const res = await axios.get("/fpa/qbo-status");
      setQboStatus(res.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (tab === 1) fetchQboStatus();
  }, [tab, fetchQboStatus]);

  const applyResult = (data) => {
    const { cached_at, summary, preview, excel_b64, bs_excel_b64, bs_preview, bsi_excel_b64, bsi_preview,
            pl_excel_b64, pl_preview, comp_pl_excel_b64, comp_pl_preview,
            comp_pl_bd_excel_b64, comp_pl_bd_preview } = data;
    setResult({
      summary, previewRows: preview,
      cachedAt:        cached_at ?? null,
      companyName: tab === 0 ? companyName.trim() : qboCompanyName.trim(),
      downloadBlob:    b64ToBlob(excel_b64),
      bsBlob:          bs_excel_b64         ? b64ToBlob(bs_excel_b64)         : null,
      bsPreview:       bs_preview          ?? null,
      bsiBlob:         bsi_excel_b64        ? b64ToBlob(bsi_excel_b64)        : null,
      bsiPreview:      bsi_preview         ?? null,
      plBlob:          pl_excel_b64         ? b64ToBlob(pl_excel_b64)         : null,
      plPreview:       pl_preview          ?? null,
      compPlBlob:      comp_pl_excel_b64    ? b64ToBlob(comp_pl_excel_b64)    : null,
      compPlPreview:   comp_pl_preview     ?? null,
      compPlBdBlob:    comp_pl_bd_excel_b64 ? b64ToBlob(comp_pl_bd_excel_b64) : null,
      compPlBdPreview: comp_pl_bd_preview  ?? null,
    });
  };

  // ── Upload handlers ────────────────────────────────────────────────────────
  const handleFile = (file) => {
    setInputFile(file);
    if (!file || companyName.trim()) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type: "array", sheetRows: 5 });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        for (const row of raw)
          for (const cell of row) {
            const s = String(cell).trim();
            if (s && s.toLowerCase() !== "nan") { setCompanyName(s); return; }
          }
      } catch (_) {}
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTransform = async () => {
    setUploadStatus("loading"); setUploadError("");
    const form = new FormData();
    form.append("input_file", inputFile);
    form.append("company_name", companyName.trim());
    try {
      const res = await axios.post("/fpa/transform", form);
      applyResult(res.data);
      setUploadStatus("done");
    } catch (err) {
      setUploadError(err.response?.data?.detail ?? err.message);
      setUploadStatus("error");
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setInputFile(null); setCompanyName(""); setUploadStatus("idle"); setUploadError("");
    setQboCompanyName("Concertiv");
    setQboFetchStatus("idle"); setQboError(""); setFetchRows([]); setFetchTotal(null);
    setResult(null);
  };

  const handleQboFetch = async () => {
    setQboFetchStatus("loading"); setQboError(""); setFetchRows([]); setFetchTotal(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const rawToken = localStorage.getItem("pje_token") || sessionStorage.getItem("pje_token") || "";
      const token = rawToken ? `Bearer ${rawToken}` : "";
      const resp = await fetch("/api/fpa/qbo-fetch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({
            company_name:   qboCompanyName.trim(),
            include_broker: includeBroker,
          }),
          signal: ctrl.signal,
        }
      );

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.step === "error") {
            setQboError(evt.msg);
            setQboFetchStatus("error");
            return;
          }
          if (evt.step === "rows") {
            setFetchRows(evt.rows ?? []);
            setFetchTotal(evt.total ?? 0);
          }
          if (evt.step === "done") {
            applyResult(evt.data);
            setQboFetchStatus("done");
            return;
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      setQboError(err.message);
      setQboFetchStatus("error");
    }
  };

  const mainConnected   = qboStatus?.main?.connected   ?? false;
  const brokerConnected = qboStatus?.broker?.connected ?? false;
  const canQboFetch     = mainConnected && qboCompanyName.trim() && qboFetchStatus !== "loading";
  const fileReady       = !!inputFile;
  const companyReady    = companyName.trim().length > 0;
  const canTransform    = fileReady && companyReady && uploadStatus !== "loading";
  const isDone          = !!result;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }} className="page-enter">

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--p-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span className="material-icons-round" style={{ fontSize: 24, color: "var(--p)" }}>analytics</span>
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            {isDone ? "Financial Reports" : "Transform your data"}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {isDone
              ? "Reports are ready — select a view to explore your data."
              : "Upload a QuickBooks export or connect directly to QBO to generate reports."}
          </p>
        </div>
      </div>

      {/* Startup cache loading indicator */}
      {cacheStatus === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--p-light)", borderRadius: "var(--r8)", marginBottom: 20, border: "1px solid var(--border)" }}>
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--p)", fontWeight: 500 }}>Loading cached reports…</span>
        </div>
      )}

      {/* Reports ready */}
      {isDone && result && (
        <div style={{ marginBottom: 8 }}>
          <SuccessOutput result={result} navigate={navigate} onRefresh={handleReset} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleReset}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="material-icons-round" style={{ fontSize: 15 }}>refresh</span>
              Refresh / re-generate
            </button>
          </div>
        </div>
      )}

      {/* Generate form — only shown once cache check is complete and no data exists */}
      {!isDone && cacheStatus !== "loading" && (
        <>
          <Tabs value={tab} onChange={(_, v) => { setTab(v); handleReset(); }}
            sx={{ mb: 3, borderBottom: "1px solid #E2E8F0" }}>
            <Tab label="Upload File" sx={{ textTransform: "none", fontWeight: 600 }} />
            <Tab label="Fetch from QBO" icon={<LinkIcon sx={{ fontSize: 16 }} />} iconPosition="start"
              sx={{ textTransform: "none", fontWeight: 600 }} />
          </Tabs>

          {/* ── Tab 0: Upload File ─────────────────────────────────────────── */}
          {tab === 0 && (
            <>
              <StepRow steps={["Upload file", "Company name", "Generate"]} active={!fileReady ? 0 : 1} />

              <Box component="section" sx={{ mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3, border: "1px solid", borderColor: fileReady ? "success.main" : "#E2E8F0", borderLeftWidth: 4, borderLeftColor: fileReady ? "success.main" : "primary.main", boxShadow: 1 }}>
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Upload input file</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                  QuickBooks export (.xlsx). Mapping rules are built-in.
                </Typography>
                <FileDropZone accept=".xlsx" file={inputFile} onFile={handleFile} label="Input File (.xlsx)" />
              </Box>

              <Box component="section" sx={{ mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3, border: "1px solid", borderColor: "#E2E8F0", borderLeftWidth: 4, borderLeftColor: fileReady ? "primary.main" : "#E2E8F0", boxShadow: 1, opacity: fileReady ? 1 : 0.5, pointerEvents: fileReady ? "auto" : "none" }}>
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Company name</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>Placed in cell A1 and the Company column of the output.</Typography>
                <Box component="form" onSubmit={(e) => { e.preventDefault(); if (canTransform) handleTransform(); }}
                  sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "flex-start" }} noValidate>
                  <TextField
                    label="Company name" required fullWidth size="small" placeholder="e.g. Acme Corp, Inc."
                    value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><BusinessIcon sx={{ fontSize: 16, color: "text.disabled" }} /></InputAdornment> }}
                    helperText={companyName.trim() ? `Output A1 → "${companyName.trim()}"` : " "}
                    sx={{ flex: "1 1 220px" }}
                  />
                  <Button type="submit" variant="contained" size="large" disabled={!canTransform}
                    startIcon={uploadStatus !== "loading" && <BoltIcon />}
                    sx={{ height: 40, mt: 0.25, flexShrink: 0, background: canTransform ? "#236CFF" : undefined, "&:hover": { background: "#1650CC" } }}>
                    {uploadStatus === "loading" ? "Generating…" : "Generate"}
                  </Button>
                  {uploadStatus !== "idle" && (
                    <Button variant="ghost" size="small" onClick={handleReset} startIcon={<RestartAltIcon />}
                      sx={{ height: 40, mt: 0.25, color: "text.secondary", "&:hover": { bgcolor: "#F1F5F9" } }}>
                      Reset
                    </Button>
                  )}
                </Box>
                {uploadStatus === "loading" && (
                  <Box sx={{ mt: 2.5 }} role="status">
                    <LinearProgress sx={{ mb: 0.75 }} />
                    <Typography variant="caption" color="text.secondary">Transforming data and building the balance sheet…</Typography>
                  </Box>
                )}
                {uploadStatus === "error" && <Alert severity="error" sx={{ mt: 2 }}>{uploadError}</Alert>}
              </Box>
            </>
          )}

          {/* ── Tab 1: Fetch from QBO ──────────────────────────────────────── */}
          {tab === 1 && (
            <>
              <Box sx={{ mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3, border: "1px solid #E2E8F0", borderLeftWidth: 4, borderLeftColor: "primary.main", boxShadow: 1 }}>
                <Typography variant="subtitle1" sx={{ mb: 2 }}>QBO Connections</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2.5 }}>
                  <QboConnectPanel company="main" label="Main Company" connected={mainConnected}
                    onConnected={(s) => setQboStatus(s)} onError={(e) => setQboError(e)} />
                  <QboConnectPanel company="broker" label="Broker Company" connected={brokerConnected}
                    onConnected={(s) => setQboStatus(s)} onError={(e) => setQboError(e)} />
                </Box>
              </Box>

              <Box sx={{ mb: 2.5, p: { xs: 3, md: 4 }, bgcolor: "background.paper", borderRadius: 3, border: "1px solid #E2E8F0", borderLeftWidth: 4, borderLeftColor: mainConnected ? "primary.main" : "#E2E8F0", boxShadow: 1, opacity: mainConnected ? 1 : 0.5, pointerEvents: mainConnected ? "auto" : "none" }}>
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Fetch parameters</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                  Fetches all transactions from the company's first entry through today.
                </Typography>
                <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
                  <TextField label="Company name" size="small" required
                    value={qboCompanyName} onChange={(e) => setQboCompanyName(e.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><BusinessIcon sx={{ fontSize: 16, color: "text.disabled" }} /></InputAdornment> }}
                    sx={{ flex: "1 1 200px" }} />
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                  <FormControlLabel
                    control={<Switch checked={includeBroker} onChange={(e) => setIncludeBroker(e.target.checked)} disabled={!brokerConnected} size="small" />}
                    label={<Typography variant="body2" color={brokerConnected ? "text.primary" : "text.disabled"}>Include Broker Company data</Typography>}
                  />
                  <Button variant="contained" size="large" disabled={!canQboFetch} onClick={handleQboFetch}
                    startIcon={qboFetchStatus !== "loading" && <CloudDownloadIcon />}
                    sx={{ height: 40, flexShrink: 0, background: canQboFetch ? "#236CFF" : undefined, "&:hover": { background: "#1650CC" } }}>
                    {qboFetchStatus === "loading" ? "Fetching…" : "Fetch from QBO"}
                  </Button>
                  {qboFetchStatus !== "idle" && (
                    <Button variant="ghost" size="small" onClick={handleReset} startIcon={<RestartAltIcon />}
                      sx={{ height: 40, color: "text.secondary", "&:hover": { bgcolor: "#F1F5F9" } }}>
                      Reset
                    </Button>
                  )}
                </Box>
                {qboFetchStatus === "loading" && fetchRows.length === 0 && (
                  <Box sx={{ mt: 2.5, display: "flex", alignItems: "center", gap: 1.5 }} role="status">
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">Fetching from QuickBooks Online…</Typography>
                  </Box>
                )}
                {fetchRows.length > 0 && (
                  <Box sx={{ mt: 2.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {fetchTotal?.toLocaleString()} transactions fetched
                        {qboFetchStatus === "loading" && " — processing…"}
                      </Typography>
                      {qboFetchStatus === "loading" && <CircularProgress size={14} />}
                    </Box>
                    <Box sx={{ overflowX: "auto", borderRadius: 2, border: "1px solid #E2E8F0" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                        <thead>
                          <tr style={{ background: "#F8FAFC" }}>
                            {Object.keys(fetchRows[0] ?? {}).map((col) => (
                              <th key={col} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#475569", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {fetchRows.slice(0, 100).map((row, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFAFA" }}>
                              {Object.values(row).map((val, j) => (
                                <td key={j} style={{ padding: "5px 10px", color: "#334155", whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {val == null ? <span style={{ color: "#CBD5E1" }}>—</span> : String(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {fetchRows.length > 100 && (
                        <Box sx={{ p: 1, textAlign: "center", borderTop: "1px solid #E2E8F0" }}>
                          <Typography variant="caption" color="text.secondary">
                            Showing 100 of {fetchRows.length.toLocaleString()} rows
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )}
                {qboFetchStatus === "error" && (
                  <Alert severity="error" sx={{ mt: 2 }}>{qboError}</Alert>
                )}
              </Box>
            </>
          )}
        </>
      )}

    </div>
  );
}
