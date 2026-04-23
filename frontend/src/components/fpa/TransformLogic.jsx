import {
  Box, Paper, Typography,
  Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Chip, alpha,
} from "@mui/material";

const LOGIC = [
  { target: "Company",            source: "Hardcoded",              logic: "Set to the company name entered in the form" },
  { target: "Date",               source: "Input.Date",             logic: "Direct copy (MM/DD/YYYY)" },
  { target: "Transaction Type",   source: "Input.Transaction Type", logic: "Direct copy" },
  { target: "Num",                source: "Input.Num",              logic: "Direct copy" },
  { target: "Name",               source: "Input.Name → Vendor → Customer", logic: "Fallback chain: Name, then Vendor, then Customer" },
  { target: "Class (1st)",        source: "Input.Class",            logic: "Direct copy — QuickBooks Class/department field" },
  { target: "Memo/Description",   source: "Input.Memo/Description", logic: "Direct copy" },
  { target: "Split",              source: "Input.Split",            logic: "Direct copy" },
  { target: "Amount",             source: "Input.Amount",           logic: "Direct copy" },
  { target: "Balance",            source: "Input.Balance",          logic: "Direct copy" },
  { target: "Vendor",             source: "Input.Vendor",           logic: "Direct copy" },
  { target: "Customer",           source: "Input.Customer",         logic: "Direct copy" },
  { target: "Account",            source: "Input.Account",          logic: "Direct copy — used as join key to mapping table" },
  { target: "Account ID",         source: "Input.Account #",        logic: "Renamed; float converted to integer" },
  { target: "Financials",         source: "Mapping.Financial Statement",         logic: "JOIN on Input.Account = Mapping.Account Name" },
  { target: "Main Grouping",      source: "Mapping.Main Grouping",              logic: "Lookup via account join" },
  { target: "Secondary Grouping", source: "Mapping.Secondary Grouping",         logic: "Lookup via account join" },
  { target: "Classification",     source: "Mapping.Classification (Line Item)",  logic: "Lookup via account join" },
  { target: "Month",              source: "Derived from Date",      logic: "strftime('%b-%y') → e.g. Mar-26" },
  { target: "Classification 2",   source: "Mapping.Classification 2 (Cost Type)",         logic: "Lookup via (account, dept_class) join" },
  { target: "Classification 3",   source: "Mapping.Classification 3 (Expense Category)",  logic: "Lookup via (account, dept_class) join" },
  { target: "Class (2nd/Dept)",   source: "Mapping.Department (Class)",         logic: "Lookup via (account, dept_class) join" },
  { target: "Class Group (BD)",   source: "Mapping.Department Group (BD)",      logic: "Lookup via (account, dept_class) join" },
  { target: "One time Expenses",  source: "—",                      logic: "Left blank — requires manual tagging" },
  { target: "Quarter",            source: "Derived from Date",      logic: "Q{1-4}-YYYY → e.g. Q1-2026" },
];

const SOURCE_COLORS = {
  "Hardcoded":     { bg: alpha("#059669", 0.08), color: "#047857" },
  "Derived":       { bg: alpha("#D97706", 0.08), color: "#B45309" },
  "Input":         { bg: alpha("#2563EB", 0.08), color: "#1E40AF" },
  "Mapping":       { bg: alpha("#7C3AED", 0.08), color: "#6D28D9" },
  "—":             { bg: "#F1F5F9",              color: "#94A3B8" },
};

function sourceStyle(src) {
  for (const [key, style] of Object.entries(SOURCE_COLORS)) {
    if (src.startsWith(key)) return style;
  }
  return SOURCE_COLORS["Input"];
}

export default function TransformLogic() {
  return (
    <Paper elevation={0} variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, py: 2, borderBottom: "1px solid #E2E8F0", bgcolor: "#FAFAFA" }}>
        <Typography variant="subtitle1" fontWeight={700} id="logic-caption">
          Transformation Logic
        </Typography>
        <Typography variant="caption" color="text.secondary">
          How each output column is derived from the input and mapping table
        </Typography>
      </Box>

      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" aria-labelledby="logic-caption" aria-label="Transformation rules">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F8FAFC" }}>
              {["Output Column", "Source", "Logic Applied"].map((h) => (
                <TableCell
                  key={h}
                  scope="col"
                  sx={{
                    color: "text.secondary", fontWeight: 600,
                    fontSize: "0.68rem", letterSpacing: "0.08em",
                    textTransform: "uppercase", py: 1.25,
                    borderBottom: "1px solid #E2E8F0",
                  }}
                >
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {LOGIC.map((row, i) => {
              const sc = sourceStyle(row.source);
              return (
                <TableRow
                  key={i}
                  hover
                  sx={{
                    bgcolor: i % 2 === 0 ? "background.paper" : "#FAFAFA",
                    "&:hover": { bgcolor: alpha("#2563EB", 0.03) },
                    transition: "background-color 0.1s",
                  }}
                >
                  <TableCell
                    sx={{
                      fontWeight: 600, color: "text.primary",
                      whiteSpace: "nowrap", fontSize: "0.8rem", py: 1,
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  >
                    {row.target}
                  </TableCell>
                  <TableCell sx={{ py: 1, borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    <Chip
                      label={row.source}
                      size="small"
                      sx={{
                        bgcolor: sc.bg, color: sc.color,
                        fontFamily: "monospace", fontSize: "0.7rem",
                        fontWeight: 600, height: 20, borderRadius: 1,
                        "& .MuiChip-label": { px: 1 },
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary", fontSize: "0.8rem", py: 1, borderBottom: "1px solid #F1F5F9" }}>
                    {row.logic}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
