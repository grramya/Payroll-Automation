// Calculation utilities for Employee Cost budget section.
// Monthly distribution logic matches the Excel reference (Sample version 2).

export interface EmployeeRecord {
  id: number;
  department: string;
  year: number;
  geography: string;
  name: string;
  title: string;
  start_date: string | null;      // "YYYY-MM-DD" or null
  base_salary: number;
  bonus_pct: number | null;       // decimal, e.g. 0.10 = 10%
  bonus_amount: number | null;
  taxes_benefits_pct: number;     // decimal, e.g. 0.18 = 18%
  hike_cycle_pct: number | null;  // Concertiv only, decimal
  payroll_expenses: number | null;
  tech_stipend: number | null;
}

export const MONTH_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

export function isConcer(emp: EmployeeRecord): boolean {
  return emp.geography.toLowerCase() === 'concertiv';
}

/** Derive bonus pct + amount from whichever field is filled. */
export function resolveBonus(
  base: number,
  pct: number | null | undefined,
  amt: number | null | undefined,
): { pct: number; amount: number } {
  if (pct != null) return { pct, amount: base * pct };
  if (amt != null) return { pct: base > 0 ? amt / base : 0, amount: amt };
  return { pct: 0, amount: 0 };
}

/** Total annual cost = Base + Bonus + Taxes/Benefits amount. */
export function computeTotal(emp: EmployeeRecord): number {
  const bonus = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
  const taxes = (emp.base_salary + bonus.amount) * (emp.taxes_benefits_pct ?? 0);
  return emp.base_salary + bonus.amount + taxes;
}

/** Whether the employee is active in a given month of the given year. */
export function isActiveInMonth(emp: EmployeeRecord, year: number, m: number): boolean {
  if (!emp.start_date) return true;
  const [sy, sm] = emp.start_date.split('-').map(Number);
  if (sy > year) return false;
  if (sy === year && m < sm) return false;
  return true;
}

/**
 * Monthly amount for one employee in one month.
 * - Before April (or non-Concertiv): Total / 12
 * - From April (Concertiv with hike): (Total × (1 + hike%)) / 12
 * Returns null if employee is not yet active that month.
 */
export function getMonthlyAmount(emp: EmployeeRecord, year: number, m: number): number | null {
  if (!isActiveInMonth(emp, year, m)) return null;
  const total = computeTotal(emp);
  const hike  = (isConcer(emp) && emp.hike_cycle_pct) ? emp.hike_cycle_pct : 0;
  if (isConcer(emp) && m >= 4 && hike > 0) {
    return (total * (1 + hike)) / 12;
  }
  return total / 12;
}

export interface EmployeeReportRow {
  emp: EmployeeRecord;
  bonus: { pct: number; amount: number };
  taxesAmt: number;
  total: number;
  months: (number | null)[];  // index 0=Jan … 11=Dec
  annualTotal: number;
}

export interface EmployeeCostReport {
  rows: EmployeeReportRow[];
  totalStaffCosts: number[];          // per month
  geoCounts: { geo: string; counts: number[] }[];
  payrollExpensesLine: number[];      // per month
  techStipendLine: number[];          // per month
}

export function buildReport(employees: EmployeeRecord[], year: number): EmployeeCostReport {
  const rows: EmployeeReportRow[] = employees.map(emp => {
    const bonus    = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
    const taxesAmt = (emp.base_salary + bonus.amount) * (emp.taxes_benefits_pct ?? 0);
    const total    = emp.base_salary + bonus.amount + taxesAmt;
    const months   = MONTH_NUMS.map(m => getMonthlyAmount(emp, year, m));
    const annualTotal: number = months.reduce<number>((s, v) => s + (v ?? 0), 0);
    return { emp, bonus, taxesAmt, total, months, annualTotal };
  });

  // Total Staff Costs per month (sum all employees)
  const totalStaffCosts = MONTH_NUMS.map((_, i) =>
    rows.reduce<number>((s, r) => s + (r.months[i] ?? 0), 0),
  );

  // Active employee counts per geography per month
  const geos = [...new Set(employees.map(e => e.geography))];
  const geoCounts = geos.map(geo => ({
    geo,
    counts: MONTH_NUMS.map(m =>
      employees.filter(e => e.geography === geo && isActiveInMonth(e, year, m)).length,
    ),
  }));

  // Payroll Expenses: sum of payroll_expenses for active Concertiv employees per month
  const payrollExpensesLine = MONTH_NUMS.map(m =>
    employees
      .filter(e => isConcer(e) && e.payroll_expenses && isActiveInMonth(e, year, m))
      .reduce((s, e) => s + (e.payroll_expenses ?? 0), 0),
  );

  // Tech Stipend: sum of tech_stipend for active Concertiv employees per month
  const techStipendLine = MONTH_NUMS.map(m =>
    employees
      .filter(e => isConcer(e) && e.tech_stipend && isActiveInMonth(e, year, m))
      .reduce((s, e) => s + (e.tech_stipend ?? 0), 0),
  );

  return { rows, totalStaffCosts, geoCounts, payrollExpensesLine, techStipendLine };
}

export function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}
