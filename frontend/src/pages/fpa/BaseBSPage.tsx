import { useMemo, useState } from "react";
import { Box, Container, Typography, Button } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import BaseBSTable     from "../../components/fpa/BaseBSTable";
import FullScreenWrapper from "../../components/fpa/FullScreenWrapper";
import { useFpaResult } from "../../context/FpaResultContext";
import { fpaDownloadFilteredReport } from "../../api/api";

const MONTH_ABBR: Record<string, string> = {
  Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
  Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
};

function monthStrToYYYYMM(s: string): string {
  const [mon, yr] = s.split("-");
  const fullYear = yr.length === 2 ? `20${yr}` : yr;
  return `${fullYear}-${MONTH_ABBR[mon]}`;
}

export default function BaseBSPage() {
  const { result, pageFilters, setPageFilter } = useFpaResult();
  if (!result) return null;
  const { bsPreview, companyName } = result;

  const bs      = bsPreview as Record<string, unknown> | null;
  const months  = (bs?.months as string[]) ?? [];
  const rows    = (bs?.rows as Record<string, unknown>[]) ?? [];

  const defaultFrom = dayjs().startOf("year");
  const defaultTo   = dayjs().endOf("month");
  const filters     = pageFilters.baseBS as Record<string, Dayjs | null> | undefined;
  const fromDate    = filters?.fromDate ?? defaultFrom;
  const toDate      = filters?.toDate   ?? defaultTo;
  const setFromDate = (v: Dayjs | null) => setPageFilter("baseBS", { fromDate: v, toDate } as never);
  const setToDate   = (v: Dayjs | null) => setPageFilter("baseBS", { fromDate, toDate: v } as never);
  const [fromOpen,  setFromOpen]  = useState(false);
  const [toOpen,    setToOpen]    = useState(false);
  const [fromError, setFromError] = useState(false);
  const [toError,   setToError]   = useState(false);

  const filteredIndices = useMemo<number[]>(() => {
    const rangeOk = !(fromDate?.isValid() && toDate?.isValid() && fromDate.isAfter(toDate));
    const fromYM = rangeOk && fromDate?.isValid() ? fromDate.format("YYYY-MM") : null;
    const toYM   = rangeOk && toDate?.isValid()   ? toDate.format("YYYY-MM")   : null;
    return months.reduce<number[]>((acc, m, i) => {
      const ym = monthStrToYYYYMM(m);
      if (fromYM && ym < fromYM) return acc;
      if (toYM   && ym > toYM)   return acc;
      acc.push(i);
      return acc;
    }, []);
  }, [months, fromDate, toDate]);

  const filteredMonths = useMemo<string[]>(() => filteredIndices.map((i) => months[i]), [filteredIndices, months]);

  const filteredBsPreview = useMemo(() => {
    if (!bs) return null;
    return {
      ...bs,
      months: filteredMonths,
      rows: rows.map((row) => ({
        ...row,
        values: row.values ? filteredIndices.map((i) => (row.values as (number | null)[])[i]) : row.values,
      })),
    };
  }, [bs, filteredMonths, filteredIndices, rows]);

  const checkRow   = rows.find((r) => r.type === "check");
  const isBalanced = (checkRow?.values as (number | null)[] | undefined)?.every((v) => Math.abs(v ?? 0) < 0.01) ?? false;

  const handleDownload = async () => {
    const rangeOk = !(fromDate?.isValid() && toDate?.isValid() && fromDate.isAfter(toDate));
    const fromYM = rangeOk && fromDate?.isValid() ? fromDate.format("YYYY-MM") : undefined;
    const toYM   = rangeOk && toDate?.isValid()   ? toDate.format("YYYY-MM")   : undefined;
    const blob = await fpaDownloadFilteredReport("bs", { from_ym: fromYM, to_ym: toYM });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${companyName}_base_bs.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box className="page-enter">
      <Box component="section" aria-label="Page controls" sx={{ borderBottom: "1px solid #E2E8F0", bgcolor: "background.paper", px: { xs: 2, md: 4 }, py: 2.5 }}>
        <Container maxWidth="xl" disableGutters>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
            <Box>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Base Balance Sheet</Typography>
              <Typography variant="body2" color="text.secondary">Month-end balances from staging data &mdash; <strong>{companyName}</strong></Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <DatePicker
                label="From"
                value={fromDate}
                onChange={(v: Dayjs | null) => setFromDate(v)}
                maxDate={toDate?.isValid() ? toDate : undefined}
                onError={(e) => setFromError(!!e)}
                open={fromOpen} onOpen={() => setFromOpen(true)} onClose={() => setFromOpen(false)}
                slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, onClick: () => setFromOpen(true), error: fromError, helperText: fromError ? "Invalid date" : undefined } }}
              />
              <DatePicker
                label="To"
                value={toDate}
                onChange={(v: Dayjs | null) => setToDate(v)}
                minDate={fromDate?.isValid() ? fromDate : undefined}
                onError={(e) => setToError(!!e)}
                open={toOpen} onOpen={() => setToOpen(true)} onClose={() => setToOpen(false)}
                slotProps={{ textField: { size: "small", sx: { minWidth: 160 }, onClick: () => setToOpen(true), error: toError, helperText: toError ? "Invalid date" : undefined } }}
              />
              {bsPreview && (
                <Button size="small" variant="contained" startIcon={<AccountBalanceIcon aria-hidden="true" />} onClick={handleDownload} aria-label={`Download ${companyName}_base_bs.xlsx`} sx={{ background: "linear-gradient(135deg,#400f61,#2d0a45)", height: 40 }}>
                  Download .xlsx
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {filteredBsPreview && (
          <FullScreenWrapper title="Base Balance Sheet" fullContent={<BaseBSTable data={filteredBsPreview as never} dense />}>
            <BaseBSTable data={filteredBsPreview as never} />
          </FullScreenWrapper>
        )}
      </Container>
    </Box>
  );
}
