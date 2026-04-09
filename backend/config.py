# =============================================================================
# config.py — Central configuration for Payroll JE Automation
# =============================================================================

# ---------------------------------------------------------------------------
# Columns processed at EMPLOYEE level (not aggregated by department)
# ---------------------------------------------------------------------------
SPECIAL_COLUMNS = [
    "Commission 1",
    "Reimbursement-Non Taxable",
    "Separation Pay Recurring",
]

# ---------------------------------------------------------------------------
# Columns posted as a single company-wide total (no department, no employee)
# These columns have no department/employee data in the payroll file.
# ---------------------------------------------------------------------------
COMPANY_WIDE_COLUMNS = [
    "Invoice Level Charges - Totals",
]

# ---------------------------------------------------------------------------
# Highlighted "totals" columns in the payroll file whose sum (in the grand
# total row) equals column AT = the expected JE provision amount.
# Formula in payroll file: AT = Q + X + AH + AJ + AL + AN + AS
# ---------------------------------------------------------------------------
GRAND_TOTAL_COLUMNS = [
    "Gross Wages - Totals",
    "Employer Paid Taxes - Totals",
    "Company Paid Benefits - Totals",
    "Fees - Totals",
    "Workers Compensation - Totals",
    "Returned Deductions - Totals",
    "Invoice Level Charges - Totals",
]

# ---------------------------------------------------------------------------
# Departments classified as COGS (all others → Indirect)
# ---------------------------------------------------------------------------
COGS_DEPARTMENTS = {"Travel", "Market Data"}

# ---------------------------------------------------------------------------
# Department name (from payroll file) → QBO Class value (hierarchical)
# Class is blank for rows whose GL account contains "Accrued"
# ---------------------------------------------------------------------------
DEPARTMENT_TO_CLASS = {
    "Procurement":    "COGS:Procurement",
    "Market Data":    "COGS:Procurement:Tech & MD:Market Data",
    "Travel":         "COGS:Procurement:Travel",
    "Client Expert":  "Client Service:Client Expert",
    "Client Success": "Client Service:Client Success",
    "Admin":          "G&A:Admin",
    "Operations":     "G&A:Operations",
    "Product":        "R&D:Product",
    "Marketing":      "S&M:Marketing",
    "Sales":          "S&M:Sales",
    "Technology":     "Technology",
}

# ---------------------------------------------------------------------------
# Payroll file column identifiers
# ---------------------------------------------------------------------------
EMPLOYEE_ID_COLUMN = "Employee ID"
DEPARTMENT_COLUMN = "Department Long Descr"
EMPLOYEE_NAME_COLUMN = "Employee Name"

# Number of header rows to skip in payroll files (actual column headers at row 5)
PAYROLL_HEADER_ROW = 5

# ---------------------------------------------------------------------------
# Maps payroll column name → Journal Description in the JE output
# ---------------------------------------------------------------------------
PAY_ITEM_JOURNAL_DESCRIPTIONS = {
    # Gross Wages — Salary (Regular + DTO + Overtime fold into one "Salary for {date}" row per dept)
    # Note: date suffix added dynamically in build_je using the pay date
    "Regular":                        "Salary",
    "Discretionary Time Off":         "Salary",
    "Overtime":                       "Salary",
    "Holiday Pay":                    "Salary",
    # Tech Stipend — Electronics Nontaxable posted SEPARATELY
    "Electronics Nontaxable":         "Tech Stipend",
    # Bonus types (aggregated per department)
    "Discretionary Bonus":            "Bonus",
    "Nondiscretionary Retention BNS": "Bonus",
    # Tax and benefits — Indirect descriptions (COGS variants in PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS)
    "Employer Paid Taxes - Totals":   "Payroll Taxes",
    "Company Paid Benefits - Totals": "Health Insurance/Benefits - ER",
    "Profit Sharing":                 "401k",          # date suffix added dynamically
    "Workers Compensation - Totals":  "Worker's comp",
    # Fees
    "Fees - Totals":                  "Payroll Benefit Admin Fees",
    "Returned Deductions - Totals":   "Returned Deductions",
    "Invoice Level Charges - Totals": "Invoice Level Charges",
    # Special columns (employee-level) — descriptions built dynamically in process_special_columns
    "Commission 1":                   "Commission",        # → "Sales Commission for {Name}"
    "Reimbursement-Non Taxable":      "Reimbursement",     # → "Reimb {Name}"
    "Separation Pay Recurring":       "Separation Pay",    # → "{Name} Separation Pay"
}

# COGS-specific Journal Descriptions — override PAY_ITEM_JOURNAL_DESCRIPTIONS for COGS depts
PAY_ITEM_JOURNAL_DESCRIPTIONS_COGS = {
    "Employer Paid Taxes - Totals":   "COS - Payroll Taxes",
    "Company Paid Benefits - Totals": "COGS - Health Insurance/Benefits - ER",
    "Profit Sharing":                 "COGS - 401k",
}

# ---------------------------------------------------------------------------
# Sort order for JE output (lower number = appears first)
# ---------------------------------------------------------------------------
JE_DESCRIPTION_ORDER = {
    "Salary":                              10,
    "Tech Stipend":                        15,
    "Bonus":                               20,
    "Commission":                          25,   # "Sales Commission for {Name}"
    "Separation Pay":                      30,   # "{Name} Separation Pay"
    "Health Insurance/Benefits - ER":      40,
    "COGS - Health Insurance/Benefits - ER": 41,
    "Payroll Benefit Admin Fees":          50,
    "Invoice Level Charges":               55,
    "Payroll Taxes":                       60,
    "COS - Payroll Taxes":                 61,
    "Returned Deductions":                 70,
    "Worker's comp":                       80,
    "401k":                                90,   # "401k for {date}"
    "COGS - 401k":                         91,
    "Reimbursement":                       100,
}

# ---------------------------------------------------------------------------
# QBO Journal Entry column headers (output file format)
# ---------------------------------------------------------------------------
JE_COLUMNS = [
    "Post?",
    "Journal Number",
    "Entry Date",
    "Journal Description",
    "Account",
    "Account ID",
    "Customer",
    "Vendor",
    "Employee",
    "Location",
    "Class",
    "Tax Rate",
    "Tax Application ON",
    "Currency",
    "Debit (exc. Tax)",
    "Credit (exc. Tax)",
    "Adjustment",
    "QBO Edit ID",
]
