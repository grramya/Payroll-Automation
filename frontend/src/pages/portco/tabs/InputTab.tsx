import { METRIC_DEFS } from "../constants/metricDefs";
import MetricTable from "../components/MetricTable";
import type { MetricMap } from "../types";

const BRAND = "#512D6D";

const ALL_DEPTS = [
  "Product Development",
  "Marketing",
  "Sales",
  "Customer Success",
  "Finance",
];

interface Props {
  selectedYear:   number;
  derivedActuals: MetricMap;
  derivedBudget:  MetricMap;
  mode:           "actuals" | "budget";
  onCellEdit:     (id: string, month: string, value: number | null) => void;
}

export default function InputTab({ selectedYear, derivedActuals, derivedBudget, mode, onCellEdit }: Props) {
  return (
    <div>
      {ALL_DEPTS.map((dept) => {
        const rows = METRIC_DEFS.filter((r) => r.department === dept);
        if (!rows.length) return null;
        return (
          <div key={dept}>
            {/* Department banner */}
            <div style={{
              padding: "8px 16px",
              background: "#EDE9F7",
              borderTop: "2px solid #C4B3E0",
              borderBottom: "1px solid #D4BBE8",
              fontWeight: 700,
              fontSize: "0.78rem",
              color: BRAND,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>
              {dept}
            </div>
            <MetricTable
              rows={rows}
              selectedYear={selectedYear}
              derivedActuals={derivedActuals}
              derivedBudget={derivedBudget}
              mode={mode}
              onCellEdit={onCellEdit}
              view="input"
            />
          </div>
        );
      })}
    </div>
  );
}
