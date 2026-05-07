export type AggMethod = "Sum" | "Average" | "EoP";
export type Units = "#" | "%" | "$" | "";

export interface MetricRow {
  department: string;
  category: string;
  id: string;
  lineItem: string;
  units: Units;
  assignee: string;
  isEditable: boolean;
  aggMethod: AggMethod;
}

// id → "YYYY-MM" → value
export type MetricMap = Record<string, Record<string, number | null>>;

export type TabId =
  | "exec"
  | "proddev"
  | "sales"
  | "marketing"
  | "cs"
  | "finance";

export const TABS: { id: TabId; label: string }[] = [
  { id: "exec",      label: "Executive Summary" },
  { id: "proddev",   label: "Prod Dev" },
  { id: "sales",     label: "Sales" },
  { id: "marketing", label: "Marketing" },
  { id: "cs",        label: "Customer Success" },
  { id: "finance",   label: "Finance" },
];

export const DEPT_FOR_TAB: Record<TabId, string> = {
  exec:      "",
  proddev:   "Product Development",
  sales:     "Sales",
  marketing: "Marketing",
  cs:        "Customer Success",
  finance:   "Finance",
};
