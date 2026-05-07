import { useMemo } from "react";
import { METRIC_DEFS } from "../constants/metricDefs";
import MetricTable from "../components/MetricTable";
import type { MetricMap } from "../types";

interface Props {
  department:     string;
  selectedYear:   number;
  derivedActuals: MetricMap;
  derivedBudget:  MetricMap;
  // Omit both for report (read-only) view; provide both for editable input view
  mode?:       "actuals" | "budget";
  onCellEdit?: (id: string, month: string, value: number | null) => void;
}

export default function DeptTab({
  department, selectedYear, derivedActuals, derivedBudget, mode, onCellEdit,
}: Props) {
  const rows = useMemo(
    () => METRIC_DEFS.filter((r) => r.department === department),
    [department]
  );

  if (!rows.length) {
    return <p style={{ padding: 24, color: "#94A3B8" }}>No metrics defined for {department}.</p>;
  }

  const isInput = mode !== undefined && onCellEdit !== undefined;

  return (
    <MetricTable
      rows={rows}
      selectedYear={selectedYear}
      derivedActuals={derivedActuals}
      derivedBudget={derivedBudget}
      mode={mode ?? "actuals"}
      onCellEdit={onCellEdit ?? (() => {})}
      view={isInput ? "input" : "report"}
    />
  );
}
