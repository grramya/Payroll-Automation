// BRD §5.4: Executive Summary — KPI cards per department, 2-column grid
import { useMemo } from "react";
import { METRIC_DEFS } from "../constants/metricDefs";
import type { MetricMap, TabId } from "../types";
import KpiCard from "../components/KpiCard";

interface Props {
  derivedActuals: MetricMap;
  derivedBudget:  MetricMap;
  selectedYear:   number;
  onNavigate:     (tab: TabId) => void;
}

// Key KPI per department (label, metricId)
const DEPT_KPIS: Record<string, { label: string; id: string }[]> = {
  "Product Development": [
    { label: "# of Squads",       id: "Product Development # of Squads" },
    { label: "Headcount (Total)", id: "Product Development Headcount (Total)" },
    { label: "SP Committed",      id: "Product Development Story Points Committed" },
    { label: "Sprint Velocity",   id: "Product Development % Completed" },
  ],
  "Sales": [
    { label: "New Logo ARR",      id: "Sales New Logo ARR ($)" },
    { label: "Pipeline (EoP)",    id: "Sales EoP Value - Total" },
    { label: "Win Rate",          id: "Sales Win rate: Total" },
    { label: "Opps Generated",   id: "Sales New Pipeline Opportunities" },
  ],
  "Marketing": [
    { label: "MQLs",              id: "Marketing Marketing Qualified Leads" },
    { label: "Mktg Pipeline EoP", id: "Marketing Mktg sourced pipeline, EoP" },
    { label: "Won ARR",           id: "Marketing Mktg sourced Won ARR" },
    { label: "Mktg Expense",      id: "Marketing Mktg expense" },
  ],
  "Customer Success": [
    { label: "NRR %",             id: "Customer Success NRR %" },
    { label: "Churn %",           id: "Customer Success Churn %" },
    { label: "# of Clients",      id: "Customer Success # of Clients" },
    { label: "NPS Estimate",      id: "Customer Success NPS Estimate" },
  ],
  "Finance": [
    { label: "ARR",               id: "Finance ARR" },
    { label: "Revenue",           id: "Finance Revenue" },
    { label: "Adj. EBITDA",       id: "Finance Adj. EBITDA" },
    { label: "Gross Margin",      id: "Finance Gross Margin" },
  ],
};

const DEPT_TO_TAB: Record<string, TabId> = {
  "Product Development": "proddev",
  "Sales":               "sales",
  "Marketing":           "marketing",
  "Customer Success":    "cs",
  "Finance":             "finance",
};

export default function ExecSummary({ derivedActuals, derivedBudget, selectedYear, onNavigate }: Props) {
  // Get latest non-null month for the selected year
  const latestMonth = useMemo(() => {
    const yearPrefix = `${selectedYear}-`;
    const finARR = derivedActuals["Finance ARR"] ?? {};
    for (let m = 12; m >= 1; m--) {
      const key = `${selectedYear}-${String(m).padStart(2, "0")}`;
      if (finARR[key] != null) return key;
    }
    return `${selectedYear}-12`;
  }, [derivedActuals, selectedYear]);

  const depts = Object.keys(DEPT_KPIS);

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
        {depts.map((dept) => {
          const kpiDefs = DEPT_KPIS[dept];
          const kpis = kpiDefs.map(({ label, id }) => {
            const row = METRIC_DEFS.find((r) => r.id === id);
            return {
              label,
              value:    derivedActuals[id]?.[latestMonth] ?? null,
              budget:   derivedBudget[id]?.[latestMonth]  ?? null,
              units:    row?.units ?? "#" as const,
              metricId: id,
            };
          });
          return (
            <KpiCard
              key={dept}
              department={dept}
              kpis={kpis}
              onClick={() => onNavigate(DEPT_TO_TAB[dept])}
            />
          );
        })}
      </div>
    </div>
  );
}
