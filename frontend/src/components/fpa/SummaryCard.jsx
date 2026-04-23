import {
  Box, Typography, LinearProgress, Chip, Alert,
  Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TableFooter, alpha,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

export default function SummaryCard({ summary }) {
  const {
    total_rows, unmatched_rows,
    financials_distribution, unmatched_accounts,
  } = summary;

  const finEntries = Object.entries(financials_distribution || {})
    .filter(([k]) => k !== "None" && k !== "nan")
    .sort((a, b) => b[1] - a[1]);

  const PALETTE = [
    { bg: alpha("#2563EB", 0.08), bar: "#2563EB", text: "#1E40AF" },
    { bg: alpha("#7C3AED", 0.08), bar: "#7C3AED", text: "#6D28D9" },
    { bg: alpha("#059669", 0.08), bar: "#059669", text: "#047857" },
  ];

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        borderRadius: 3,
        border: "1px solid #E2E8F0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
      aria-label="Transform summary"
    >
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: "1px solid #F1F5F9", bgcolor: "#FAFAFA" }}>
        <Typography variant="subtitle1" fontWeight={700}>Transform Summary</Typography>
      </Box>

      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>

        {/* Financials distribution */}
        {finEntries.length > 0 && (
          <Box aria-label="Financials distribution">
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              Financials Distribution
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {finEntries.map(([name, count], idx) => {
                const pct = ((count / total_rows) * 100).toFixed(1);
                const p = PALETTE[idx % PALETTE.length];
                return (
                  <Box key={name}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: p.bar, flexShrink: 0 }} aria-hidden="true" />
                        <Typography variant="body2" fontWeight={500} color="text.primary" sx={{ fontSize: "0.82rem" }}>
                          {name}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {count.toLocaleString()}
                        </Typography>
                        <Chip
                          label={`${pct}%`}
                          size="small"
                          sx={{ bgcolor: p.bg, color: p.text, fontWeight: 700, fontSize: "0.68rem", height: 18, borderRadius: 1 }}
                        />
                      </Box>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={parseFloat(pct)}
                      aria-label={`${name}: ${pct}%`}
                      sx={{
                        height: 5, borderRadius: 99,
                        bgcolor: "#F1F5F9",
                        "& .MuiLinearProgress-bar": { bgcolor: p.bar, borderRadius: 99 },
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Unmapped accounts */}
        <Box aria-label="Unmapped accounts">
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Unmapped Accounts
          </Typography>

          {!unmatched_accounts || unmatched_accounts.length === 0 ? (
            <Alert
              severity="success"
              icon={<CheckCircleIcon fontSize="small" />}
              sx={{ borderRadius: 2.5, border: "1px solid", borderColor: alpha("#059669", 0.2) }}
              role="status"
            >
              All accounts matched — no unmapped rows.
            </Alert>
          ) : (
            <>
              <TableContainer
                sx={{ border: "1px solid", borderColor: alpha("#DC2626", 0.25), borderRadius: 2.5, overflow: "hidden" }}
              >
                <Table size="small" aria-label="Unmapped accounts">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha("#DC2626", 0.05) }}>
                      <TableCell scope="col" sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        <Typography variant="overline" sx={{ color: "#B91C1C", fontSize: "0.65rem" }}>Account Name</Typography>
                      </TableCell>
                      <TableCell scope="col" align="right" sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        <Typography variant="overline" sx={{ color: "#B91C1C", fontSize: "0.65rem" }}>Rows</Typography>
                      </TableCell>
                      <TableCell scope="col" align="right" sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        <Typography variant="overline" sx={{ color: "#B91C1C", fontSize: "0.65rem" }}>Amount</Typography>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {unmatched_accounts.map((item, i) => (
                      <TableRow key={i} sx={{ bgcolor: i % 2 === 0 ? "background.paper" : alpha("#DC2626", 0.02) }}>
                        <TableCell sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.1)}`, py: 1 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <WarningAmberIcon sx={{ fontSize: 13, color: "warning.main" }} aria-hidden="true" />
                            <Typography variant="body2" color="error.dark" sx={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                              {item.account}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.1)}`, py: 1 }}>
                          <Chip
                            label={item.rows}
                            size="small"
                            color="error"
                            variant="outlined"
                            aria-label={`${item.rows} rows`}
                            sx={{ fontWeight: 700, minWidth: 42, fontSize: "0.72rem" }}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ borderBottom: `1px solid ${alpha("#DC2626", 0.1)}`, py: 1 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              color: item.amount === 0 ? "text.disabled" : "error.dark",
                            }}
                          >
                            {item.amount === 0
                              ? "—"
                              : item.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow sx={{ bgcolor: alpha("#DC2626", 0.05) }}>
                      <TableCell component="th" scope="row" sx={{ borderTop: `2px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        <Typography variant="body2" fontWeight={700} color="error.dark">Total unmapped</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ borderTop: `2px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        <Chip label={unmatched_rows} size="small" color="error" sx={{ fontWeight: 700, minWidth: 42, fontSize: "0.72rem" }} />
                      </TableCell>
                      <TableCell align="right" sx={{ borderTop: `2px solid ${alpha("#DC2626", 0.2)}`, py: 1 }}>
                        {(() => {
                          const total = unmatched_accounts.reduce((s, a) => s + (a.amount ?? 0), 0);
                          return (
                            <Typography variant="body2" fontWeight={700} sx={{ fontSize: "0.78rem", color: total === 0 ? "success.dark" : "error.dark" }}>
                              {total === 0
                                ? "$0.00"
                                : total.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                            </Typography>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>

              {/* Zero-amount callout */}
              {unmatched_accounts.reduce((s, a) => s + (a.amount ?? 0), 0) === 0 && (
                <Alert
                  severity="info"
                  sx={{ mt: 1.5, borderRadius: 2, fontSize: "0.8rem" }}
                >
                  These accounts have no monetary value — <strong>$0.00</strong>.
                </Alert>
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
