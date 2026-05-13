import { METRIC_DEFS } from "../constants/metricDefs";
import MetricTable from "../components/MetricTable";
import type { MetricMap } from "../types";

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
            <MetricTable
              rows={rows}
              selectedYear={selectedYear}
              derivedActuals={derivedActuals}
              derivedBudget={derivedBudget}
              mode={mode}
              onCellEdit={onCellEdit}
              view="input"
              deptLabel={dept}
            />
          </div>
        );
      })}
    </div>
  );
}
