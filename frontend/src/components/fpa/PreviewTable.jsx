import { useState } from "react";
import {
  Box, Paper, Typography, TextField, InputAdornment,
  Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, TablePagination, alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

const VISIBLE_COLS = [
  "Company", "Date", "Transaction Type", "Name", "Account",
  "Amount", "Balance", "Financials", "Main Grouping",
  "Secondary Grouping", "Classification", "Month", "Quarter",
  "Classification 2", "Classification 3", "Class (Dept)", "Class Group (BD)",
];

const CURRENCY_COLS = new Set(["Amount", "Balance"]);

export default function PreviewTable({ rows }) {
  const [page,        setPage]        = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const [search,      setSearch]      = useState("");

  if (!rows || rows.length === 0) return null;

  const filtered = rows.filter((r) =>
    VISIBLE_COLS.some((col) => String(r[col] ?? "").toLowerCase().includes(search.toLowerCase()))
  );
  const pageRows = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const fmtCell = (col, val) => {
    if (val === null || val === undefined)
      return <Box component="span" sx={{ color: "#CBD5E1", fontFamily: "monospace" }}>—</Box>;

    if (CURRENCY_COLS.has(col) && typeof val === "number") {
      const abs = Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (
        <Box
          component="span"
          sx={{ fontFamily: "monospace", fontWeight: 500, color: val < 0 ? "error.main" : "success.dark" }}
          aria-label={`${val < 0 ? "negative " : ""}${abs}`}
        >
          {val < 0 ? `(${abs})` : abs}
        </Box>
      );
    }
    if (col === "Financials") {
      const isBS = val === "Balance Sheet";
      return (
        <Box
          component="span"
          sx={{
            display: "inline-flex", alignItems: "center",
            px: 1, py: 0.25, borderRadius: 1,
            bgcolor: isBS ? alpha("#2563EB", 0.08) : alpha("#7C3AED", 0.08),
            color: isBS ? "#1E40AF" : "#6D28D9",
            fontWeight: 600, fontSize: "0.7rem",
          }}
        >
          {String(val)}
        </Box>
      );
    }
    return <Box component="span" sx={{ fontSize: "0.78rem" }}>{String(val)}</Box>;
  };

  return (
    <Paper elevation={0} variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      {/* Header */}
      <Box
        sx={{
          px: 2.5, py: 1.75,
          borderBottom: "1px solid #E2E8F0",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap",
          bgcolor: "background.paper",
        }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={700} id="preview-caption">
            Data Preview
          </Typography>
          <Typography variant="caption" color="text.secondary">
            50 Balance Sheet + 50 P&amp;L rows sampled
          </Typography>
        </Box>
        <TextField
          size="small"
          placeholder="Search…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: "text.disabled" }} aria-hidden="true" />
              </InputAdornment>
            ),
          }}
          inputProps={{ "aria-label": "Search preview data", role: "searchbox" }}
          sx={{ width: 200 }}
        />
      </Box>

      {/* Table */}
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" stickyHeader aria-labelledby="preview-caption" aria-label="Transaction preview data">
          <TableHead>
            <TableRow>
              {VISIBLE_COLS.map((col) => (
                <TableCell
                  key={col}
                  scope="col"
                  sx={{
                    bgcolor: "#0F172A",
                    color: "rgba(255,255,255,0.9)",
                    fontWeight: 600,
                    fontSize: "0.68rem",
                    letterSpacing: "0.06em",
                    whiteSpace: "nowrap",
                    py: 1.25,
                    textTransform: "uppercase",
                  }}
                >
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((row, i) => (
              <TableRow
                key={i}
                hover
                sx={{
                  bgcolor: i % 2 === 0 ? "background.paper" : "#FAFAFA",
                  "&:hover": { bgcolor: alpha("#2563EB", 0.03) },
                  transition: "background-color 0.1s",
                }}
              >
                {VISIBLE_COLS.map((col) => (
                  <TableCell
                    key={col}
                    sx={{
                      maxWidth: 200, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: "text.secondary", py: 1,
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  >
                    {fmtCell(col, row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      <TablePagination
        component="div"
        count={filtered.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[10, 15, 25, 50]}
        aria-label="Preview pagination"
        sx={{ borderTop: "1px solid #E2E8F0", fontSize: "0.78rem" }}
      />
    </Paper>
  );
}
