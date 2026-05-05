import { useMemo } from "react";
import {
  Box, Container, Typography, Button, Chip,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs from "dayjs";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";

import BaseBSTable     from "../../components/fpa/BaseBSTable";
import FullScreenWrapper from "../../components/fpa/FullScreenWrapper";
import { useFpaResult } from "../../context/FpaResultContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_ABBR = {
  Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
  Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
};

function monthStrToYYYYMM(s) {
  const [mon, yr] = s.split("-");
  const fullYear = yr.length === 2 ? `20${yr}` : yr;
  return `${fullYear}-${MONTH_ABBR[mon]}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BaseBSPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  if (!result) return null;
  const { bsBlob, bsPreview, companyName } = result;

  const months = bsPreview?.months ?? [];
  const rows   = bsPreview?.rows   ?? [];

  const defaultFrom = dayjs().startOf('year');
  const defaultTo   = dayjs().endOf('month');
  const fromDate = pageFilters.baseBS?.fromDate ?? defaultFrom;
  const toDate   = pageFilters.baseBS?.toDate   ?? defaultTo;
  const setFromDate = (v) => setPageFilter("baseBS", { fromDate: v, toDate });
  const setToDate   = (v) => setPageFilter("baseBS", { fromDate, toDate: v });

  // ── Filtered months ────────────────────────────────────────────────────────
  const filteredIndices = useMemo(() => {
    const fromYM = fromDate?.isValid() ? fromDate.format("YYYY-MM") : null;
    const toYM   = toDate?.isValid()   ? toDate.format("YYYY-MM")   : null;
    return months.reduce((acc, m, i) => {
      const ym = monthStrToYYYYMM(m);
      if (fromYM && ym < fromYM) return acc;
      if (toYM   && ym > toYM)   return acc;
      acc.push(i);
      return acc;
    }, []);
  }, [months, fromDate, toDate]);

  const filteredMonths = useMemo(
    () => filteredIndices.map((i) => months[i]),
    [filteredIndices, months],
  );

  const filteredBsPreview = useMemo(() => {
    if (!bsPreview) return null;
    return {
      ...bsPreview,
      months: filteredMonths,
      rows: bsPreview.rows.map((row) => ({
        ...row,
        values: row.values ? filteredIndices.map((i) => row.values[i]) : row.values,
      })),
    };
  }, [bsPreview, filteredMonths, filteredIndices]);

  const checkRow   = rows.find((r) => r.type === "check");
  const isBalanced = checkRow?.values?.every((v) => Math.abs(v ?? 0) < 0.01) ?? false;

  const handleDownload = () => {
    if (!bsBlob) return;
    const url = URL.createObjectURL(bsBlob);
    const a = document.createElement("a");
    a.href = url; a.download = `${companyName}_base_bs.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box className="page-enter">
      {/* ── Page header band ─────────────────────────────────────────── */}
      <Box
        component="section"
        aria-label="Page controls"
        sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}
      >
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                Base Balance Sheet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Month-end balances from staging data &mdash; <strong>{companyName}</strong>
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {/* ── Date range filter ── */}
              <DatePicker
                label="From"
                value={fromDate}
                onChange={(v) => setFromDate(v)}
                slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, inputProps: { "aria-label": "Filter from date" } } }}
              />
              <DatePicker
                label="To"
                value={toDate}
                onChange={(v) => setToDate(v)}
                slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, inputProps: { "aria-label": "Filter to date" } } }}
              />

              <Chip
                icon={isBalanced
                  ? <CheckCircleIcon sx={{ fontSize: "14px !important" }} aria-hidden="true" />
                  : <ErrorIcon sx={{ fontSize: "14px !important" }} aria-hidden="true" />}
                label={isBalanced ? "Sheet balances ✓" : "Check mismatch"}
                color={isBalanced ? "success" : "error"}
                variant="outlined"
                size="small"
                aria-label={isBalanced ? "Balance sheet is balanced" : "Balance sheet has a mismatch"}
              />
              {bsBlob && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AccountBalanceIcon aria-hidden="true" />}
                  onClick={handleDownload}
                  aria-label={`Download ${companyName}_base_bs.xlsx`}
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

        {/* ── BS Table ───────────────────────────────────────────────── */}
        {filteredBsPreview && (
          <FullScreenWrapper
            title="Base Balance Sheet"
            fullContent={<BaseBSTable data={filteredBsPreview} dense />}
          >
            <BaseBSTable data={filteredBsPreview} />
          </FullScreenWrapper>
        )}
      </Container>
    </Box>
  );
}
