import type { AggMethod } from "../types";
import { aggregate } from "./aggregations";

// All YYYY-MM keys for a given year
export function monthsForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, "0")}`
  );
}

// All months across the full data range (2023-01 … 2027-12)
export function allDataMonths(): string[] {
  const months: string[] = [];
  for (let y = 2023; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }
  return months;
}

export function monthOffset(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function prevMonth(ym: string): string {
  return monthOffset(ym, -1);
}

// QTD: from start of quarter containing lastMonth up to and including lastMonth
export function getQTD(
  data: Record<string, number | null>,
  year: number,
  lastMonth: number, // 1-12
  method: AggMethod
): number | null {
  const qStart = Math.floor((lastMonth - 1) / 3) * 3 + 1;
  const months = range(qStart, lastMonth).map(
    (m) => `${year}-${String(m).padStart(2, "0")}`
  );
  return aggregate(months.map((m) => data[m] ?? null), method);
}

// YTD: Jan through lastMonth of selected year
export function getYTD(
  data: Record<string, number | null>,
  year: number,
  lastMonth: number, // 1-12
  method: AggMethod
): number | null {
  const months = range(1, lastMonth).map(
    (m) => `${year}-${String(m).padStart(2, "0")}`
  );
  return aggregate(months.map((m) => data[m] ?? null), method);
}

// Last 12 months ending at currentMonthKey
export function getLTM(
  data: Record<string, number | null>,
  currentMonthKey: string,
  method: AggMethod
): number | null {
  const months = Array.from({ length: 12 }, (_, i) =>
    monthOffset(currentMonthKey, -i)
  ).reverse();
  return aggregate(months.map((m) => data[m] ?? null), method);
}

// Get aggregated value for a full quarter (1=Q1 Jan-Mar, 2=Q2 Apr-Jun, 3=Q3 Jul-Sep, 4=Q4 Oct-Dec)
export function getQuarterValue(
  data: Record<string, number | null>,
  year: number,
  quarter: 1 | 2 | 3 | 4,
  method: AggMethod
): number | null {
  const startMonth = (quarter - 1) * 3 + 1;
  const months = [startMonth, startMonth + 1, startMonth + 2].map(
    (m) => `${year}-${String(m).padStart(2, "0")}`
  );
  return aggregate(months.map((m) => data[m] ?? null), method);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// Determine last non-null month in the selected year (for QTD/YTD context)
export function lastFilledMonth(
  data: Record<string, number | null>,
  year: number
): number {
  for (let m = 12; m >= 1; m--) {
    if (data[`${year}-${String(m).padStart(2, "0")}`] != null) return m;
  }
  return 12;
}
