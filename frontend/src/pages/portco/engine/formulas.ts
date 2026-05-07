import type { MetricMap } from "../types";
import { safeDiv, safeSum, l3mAvg } from "./aggregations";
import { prevMonth, allDataMonths } from "./periodCalc";

type FormulaFn = (data: MetricMap, month: string) => number | null;

const ALL_MONTHS = allDataMonths();

const get = (data: MetricMap, id: string, month: string): number | null =>
  data[id]?.[month] ?? null;

const prevARR = (data: MetricMap, month: string): number | null =>
  get(data, "Finance ARR", prevMonth(month));

export const FORMULAS: Record<string, FormulaFn> = {

  // ── Product Development ──────────────────────────────────────────────────
  "Product Development % Completed": (d, m) =>
    safeDiv(
      get(d, "Product Development Story Points Completed", m),
      get(d, "Product Development Story Points Committed", m)
    ),

  "Product Development Headcount (Total)": (d, m) =>
    safeSum([
      get(d, "Product Development Headcount - Squad - Onshore", m),
      get(d, "Product Development Headcount - Squad - Offshore", m),
      get(d, "Product Development Headcount - Non-Squad", m),
    ]),

  // ── Marketing ────────────────────────────────────────────────────────────
  "Marketing = Mktg sourced New Opportunities": (d, m) => {
    const mqls = get(d, "Marketing Marketing Qualified Leads", m);
    const conv = get(d, "Marketing (x) MQL to New Opp. Conversion %", m);
    if (mqls == null || conv == null) return null;
    return Math.round(mqls * conv);
  },

  "Marketing = Mktg sourced New Opp. Value": (d, m) => {
    const opps = get(d, "Marketing = Mktg sourced New Opportunities", m);
    const acv  = get(d, "Marketing (x) Mktg sourced New Opp. ACV", m);
    return opps != null && acv != null ? opps * acv : null;
  },

  "Marketing = Expected Revenue of New Opp.": (d, m) => {
    const val  = get(d, "Marketing = Mktg sourced New Opp. Value", m);
    const rate = get(d, "Marketing (x) Expected Win Rate", m);
    return val != null && rate != null ? val * rate : null;
  },

  "Marketing Mktg exp. per $1 ARR": (d, m) => {
    const mktgL3M = l3mAvg(d["Marketing Mktg expense"] ?? {}, m, ALL_MONTHS);
    const arrL3M  = l3mAvg(d["Finance ARR"] ?? {}, m, ALL_MONTHS);
    return safeDiv(mktgL3M, arrL3M);
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  "Sales New Pipeline Opportunities": (d, m) =>
    safeSum([
      get(d, "Sales Sales Generated Opps.", m),
      get(d, "Sales Marketing Generated Opps.", m),
      get(d, "Sales Referral Generated Opps.", m),
    ]),

  "Sales Win rate: Total": (d, m) => {
    const won  = get(d, "Sales Won", m);
    const lost = get(d, "Sales Lost + Nurture", m);
    return safeDiv(won, (won ?? 0) + (lost ?? 0));
  },

  "Sales EoP Value - Total": (d, m) =>
    safeSum([
      get(d, "Sales EoP Value - Early Stage", m),
      get(d, "Sales EoP Value - Intermediate Stage", m),
      get(d, "Sales EoP Value - Advanced Stage", m),
    ]),

  "Sales EoP Count - Total": (d, m) =>
    safeSum([
      get(d, "Sales EoP Count - Early Stage", m),
      get(d, "Sales EoP Count - Intermediate Stage", m),
      get(d, "Sales EoP Count - Advanced Stage", m),
    ]),

  // Note: Excel spells "Nurtured" as "Nutured" — must match exactly
  "Sales Lost + Nutured - Total": (d, m) =>
    safeSum([
      get(d, "Sales Lost + Nutured - Early", m),
      get(d, "Sales Lost + Nutured - Intermediate", m),
      get(d, "Sales Lost + Nutured - Advanced", m),
    ]),

  "Sales Sales exp. per $1 ARR": (d, m) => {
    const salL3M = l3mAvg(d["Sales Sales expense"] ?? {}, m, ALL_MONTHS);
    const arrL3M = l3mAvg(d["Finance ARR"] ?? {}, m, ALL_MONTHS);
    return safeDiv(salL3M, arrL3M);
  },

  // ── Customer Success ──────────────────────────────────────────────────────
  "Customer Success Total Gross Growth": (d, m) =>
    safeSum([
      get(d, "Customer Success Cross-sell", m),
      get(d, "Customer Success Upsell", m),
      get(d, "Customer Success Price", m),
    ]),

  "Customer Success Total Net Growth": (d, m) =>
    safeSum([
      get(d, "Customer Success Total Gross Growth", m),
      get(d, "Customer Success (-) Churn", m),
    ]),

  "Customer Success Gross Growth %": (d, m) =>
    safeDiv(
      get(d, "Customer Success Total Gross Growth", m),
      prevARR(d, m)
    ),

  "Customer Success Churn %": (d, m) =>
    safeDiv(
      get(d, "Customer Success (-) Churn", m),
      prevARR(d, m)
    ),

  "Customer Success NRR %": (d, m) => {
    const prior = prevARR(d, m);
    const net   = get(d, "Customer Success Total Net Growth", m);
    if (prior == null || prior === 0) return null;
    return safeDiv((prior ?? 0) + (net ?? 0), prior);
  },

  "Customer Success % of Total": (d, m) =>
    safeDiv(
      get(d, "Customer Success ARR up for Renewal", m),
      get(d, "Finance ARR", m)
    ),

  "Customer Success NRR on Renewal": (d, m) =>
    safeDiv(
      get(d, "Customer Success Obtainment", m),
      get(d, "Customer Success ARR up for Renewal", m)
    ),

  "Customer Success NPS Estimate": (d, m) => {
    const verySat = get(d, "Customer Success Very Satisfied Clients (NPS 9-10)", m) ?? 0;
    const atRisk  = get(d, "Customer Success At-Risk Clients (NPS <4)", m) ?? 0;
    const total   = get(d, "Customer Success # of Clients", m);
    return safeDiv(verySat - atRisk, total, 100);
  },

  "Customer Success C.S. upsell / cross-sell ARR": (d, m) =>
    get(d, "Customer Success Total Gross Growth", m),

  "Customer Success C.S. exp. per $1 ARR": (d, m) =>
    safeDiv(
      get(d, "Customer Success C.S. expense", m),
      prevARR(d, m)
    ),

  // ── Onboarding ────────────────────────────────────────────────────────────
  "Onboarding In-Progress (EoP)": (d, m) =>
    safeSum([
      get(d, "Onboarding In-Progress (BoP)", m),
      get(d, "Onboarding + New in Period", m),
      get(d, "Onboarding - Closed in Period", m),
    ]),

  // ── Finance ───────────────────────────────────────────────────────────────
  "Finance Adj. EBITDA": (d, m) =>
    safeSum([
      get(d, "Finance Revenue", m),
      get(d, "Finance (-) Service/Delivery (CoS/CoGS)", m),
      get(d, "Finance (-) Product", m),
      get(d, "Finance (-) Technology", m),
      get(d, "Finance (-) Sales", m),
      get(d, "Finance (-) Marketing", m),
      get(d, "Finance (-) Customer Success", m),
      get(d, "Finance (-) G&A", m),
    ]),

  "Finance Net Debt": (d, m) =>
    safeSum([
      get(d, "Finance Debt & Debt-like Items", m),
      get(d, "Finance (-) Cash", m),
    ]),

  "Finance Total Headcount": (d, m) =>
    safeSum([
      get(d, "Finance Employees", m),
      get(d, "Finance VeArc", m),
      get(d, "Finance 3rd Party Providers", m),
    ]),

  // Zero-Based Budgeting — cross-department links
  "Finance Avg. Personnel Cost per Squad": (d, m) =>
    get(d, "Product Development Avg. Personnel Cost per Squad", m),

  "Finance P&T Overhead": (d, m) =>
    get(d, "Product Development P&T Overhead", m),

  "Finance Mktg exp. per $1 ARR": (d, m) =>
    get(d, "Marketing Mktg exp. per $1 ARR", m),

  "Finance Sales exp. per $1 ARR": (d, m) =>
    get(d, "Sales Sales exp. per $1 ARR", m),

  "Finance C.S. exp. per $1 ARR": (d, m) =>
    get(d, "Customer Success C.S. exp. per $1 ARR", m),

  "Finance Onboarding. Rev - Onboarding Costs": (d, m) =>
    get(d, "Onboarding Onboarding. Rev - Onboarding Costs", m),

  // Rule of 200
  "Finance Gross Margin": (d, m) => {
    const rev  = get(d, "Finance Revenue", m);
    const cogs = safeSum([
      get(d, "Finance (-) Service/Delivery (CoS/CoGS)", m),
      get(d, "Finance (-) Product", m),
      get(d, "Finance (-) Technology", m),
    ]);
    if (rev == null || rev === 0) return null;
    return safeDiv((rev ?? 0) + (cogs ?? 0), rev);
  },

  "Finance EBITDA Margin": (d, m) => {
    const eb  = get(d, "Finance Adj. EBITDA", m);
    const rev = get(d, "Finance Revenue", m);
    return safeDiv(eb, rev);
  },

  // NRR annualized = product of last 12 monthly NRR % values
  "Finance NRR (annualized)": (d, m) => {
    const idx = ALL_MONTHS.indexOf(m);
    if (idx < 0) return null;
    const window = ALL_MONTHS.slice(Math.max(0, idx - 11), idx + 1);
    const vals = window.map((mo) => d["Customer Success NRR %"]?.[mo] ?? null);
    if (vals.every((v) => v == null)) return null;
    return vals.reduce<number>((prod, v) => prod * (v ?? 1), 1);
  },

  // New Logo ARR Growth (annualized) = YoY change / prior year ARR
  "Finance New Logo ARR Growth (annualized)": (d, m) => {
    const curr  = get(d, "Finance ARR", m);
    const prior = d["Finance ARR"]?.[monthOffset12Ago(m)] ?? null;
    return safeDiv((curr ?? 0) - (prior ?? 0), prior);
  },

  "Finance Score": (d, m) => {
    const nrr    = get(d, "Customer Success NRR %", m);
    const growth = get(d, "Finance New Logo ARR Growth (annualized)", m);
    const gm     = get(d, "Finance Gross Margin", m);
    const ebitda = get(d, "Finance EBITDA Margin", m);
    if ([nrr, growth, gm, ebitda].every((v) => v == null)) return null;
    return safeSum([nrr, growth, gm, ebitda]);
  },

  // Rule of 200 (YTD) — mirrors monthly but uses YTD window; computed elsewhere in periodCalc
  // Stored here as pass-through to avoid "missing formula" warnings — actual YTD values
  // are computed in MetricRow via getYTD, these just return null as placeholders
  "Finance New Logo ARR Growth (YTD)": (_d, _m) => null,
  "Finance NRR (YTD)":                 (_d, _m) => null,
  "Finance Gross Margin (YTD)":        (_d, _m) => null,
  "Finance EBITDA Margin (YTD)":       (_d, _m) => null,
  "Finance Score (YTD)":               (_d, _m) => null,
};

function monthOffset12Ago(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y - 1, m - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
