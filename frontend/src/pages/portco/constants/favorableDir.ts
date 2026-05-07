// "higher" = Actual > Budget is favourable (green)
// "lower"  = Actual < Budget is favourable (green)
// Costs stored negative → "higher" still means less spending (closer to 0)
export const FAVORABLE_DIR: Record<string, "higher" | "lower"> = {
  // Costs stored negative — higher (less negative) = good
  "Finance (-) Service/Delivery (CoS/CoGS)": "higher",
  "Finance (-) Product":                      "higher",
  "Finance (-) Technology":                   "higher",
  "Finance (-) Sales":                        "higher",
  "Finance (-) Marketing":                    "higher",
  "Finance (-) Customer Success":             "higher",
  "Finance (-) G&A":                          "higher",
  "Customer Success (-) Churn":              "higher",
  // Cost efficiency ratios — lower is better
  "Marketing Mktg exp. per $1 ARR":          "lower",
  "Sales Sales exp. per $1 ARR":             "lower",
  "Customer Success C.S. exp. per $1 ARR":  "lower",
  "Finance Mktg exp. per $1 ARR":            "lower",
  "Finance Sales exp. per $1 ARR":           "lower",
  "Finance C.S. exp. per $1 ARR":            "lower",
  // Churn % — lower is better
  "Customer Success Churn %":                "lower",
  // Default for everything else: higher is better
};

export function isFavorable(metricId: string, delta: number): boolean {
  const dir = FAVORABLE_DIR[metricId] ?? "higher";
  return dir === "higher" ? delta >= 0 : delta <= 0;
}
