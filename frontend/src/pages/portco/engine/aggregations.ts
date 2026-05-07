import type { AggMethod } from "../types";

export function aggregate(values: (number | null)[], method: AggMethod): number | null {
  const valid = values.filter((v): v is number => v !== null && isFinite(v));
  if (!valid.length) return null;
  switch (method) {
    case "Sum":     return valid.reduce((a, b) => a + b, 0);
    case "Average": return valid.reduce((a, b) => a + b, 0) / valid.length;
    case "EoP":     return valid[valid.length - 1];
  }
}

// Safe division — returns null on zero denominator or null inputs
export function safeDiv(
  num: number | null | undefined,
  den: number | null | undefined,
  mult = 1
): number | null {
  if (den == null || den === 0 || num == null) return null;
  const result = (num / den) * mult;
  return isFinite(result) ? result : null;
}

export function safeSum(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v !== null && v !== undefined && isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
}

export function l3mAvg(
  data: Record<string, number | null>,
  month: string,
  allMonths: string[]
): number | null {
  const idx = allMonths.indexOf(month);
  if (idx < 0) return null;
  const window = allMonths.slice(Math.max(0, idx - 2), idx + 1).map((m) => data[m] ?? null);
  return aggregate(window, "Average");
}
