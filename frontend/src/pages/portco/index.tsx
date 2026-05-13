import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { usePortco } from "../../context/PortcoContext";
import { useAuth } from "../../context/AuthContext";
import { METRIC_DEFS } from "./constants/metricDefs";
import { monthsForYear } from "./engine/periodCalc";
import InputTab from "./tabs/InputTab";
import DeptTab from "./tabs/DeptTab";
import EmployeeCostPage from "./budget/EmployeeCostPage";
import OtherCostPage from "./budget/OtherCostPage";
import { StepNav } from "./components/WorkflowBanner";

const BRAND = "#512D6D";
const YEARS = [2023, 2024, 2025, 2026, 2027];

const DEPT_LABELS: Record<string, string> = {
  proddev:    "Product Development",
  sales:      "Sales",
  marketing:  "Marketing",
  cs:         "Customer Success",
  finance:    "Finance",
};

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(
  data: Record<string, Record<string, number | null>>,
  year: number,
  dept: string | null,
  mode: string
) {
  const rows   = dept
    ? METRIC_DEFS.filter((r) => r.department === dept)
    : METRIC_DEFS;
  const months = monthsForYear(year);
  const header = ["Department", "Category", "Metric", "Units", ...months].join(",");
  const lines  = rows.map((row) => {
    const vals = months.map((m) => data[row.id]?.[m] ?? "").join(",");
    return `"${row.department}","${row.category}","${row.lineItem}","${row.units}",${vals}`;
  });
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `portco_${dept ?? "all"}_${mode}_${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Actuals / Budget page ─────────────────────────────────────────────────────
function ModeRoute({
  mode, selectedYear, userDept, isAdmin,
}: {
  mode:         "actuals" | "budget";
  selectedYear: number;
  userDept:     string | null | undefined;
  isAdmin:      boolean;
}) {
  const { derivedActuals, derivedBudget, updateActuals, updateBudget } = usePortco();

  const modeData = mode === "actuals" ? derivedActuals : derivedBudget;
  const deptLabel = userDept ? (DEPT_LABELS[userDept] ?? userDept) : null;

  const handleEdit = (id: string, month: string, value: number | null) => {
    if (mode === "actuals") updateActuals(id, month, value);
    else                    updateBudget(id, month, value);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sub-header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", background: "#FAFBFC",
        borderBottom: "1px solid #E5E7EB", flexShrink: 0, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {deptLabel && (
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B" }}>
              {deptLabel}
            </span>
          )}
          <span style={{
            fontSize: "0.68rem", fontWeight: 700,
            color: mode === "actuals" ? "#0369A1" : "#7C3AED",
            background: mode === "actuals" ? "#E0F2FE" : "#EDE9F7",
            borderRadius: 4, padding: "2px 8px",
          }}>
            {mode === "actuals" ? "Actuals Entry" : "Budget Entry"}
          </span>
          {!isAdmin && <StepNav currentStep={mode === "actuals" ? 1 : 2} />}
        </div>

        <button
          onClick={() => exportCSV(modeData, selectedYear, deptLabel, mode)}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 12px", borderRadius: 6, cursor: "pointer",
            background: "#fff", border: "1px solid #CBD5E1",
            fontSize: "0.75rem", fontWeight: 600, color: "#475569",
          }}
        >
          <span className="material-icons-round" style={{ fontSize: 14 }}>download</span>
          Export CSV
        </button>
      </div>

      {/* Table — all depts for admin, own dept for dept user */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
        {userDept ? (
          <DeptTab
            department={deptLabel!}
            selectedYear={selectedYear}
            derivedActuals={derivedActuals}
            derivedBudget={derivedBudget}
            mode={mode}
            onCellEdit={handleEdit}
          />
        ) : (
          <InputTab
            selectedYear={selectedYear}
            derivedActuals={derivedActuals}
            derivedBudget={derivedBudget}
            mode={mode}
            onCellEdit={handleEdit}
          />
        )}
      </div>
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────
export default function PortcoApp() {
  const {
    selectedYear, hasEdits, syncing,
    setYear, clearMode,
  } = usePortco();

  const location = useLocation();
  const currentMode: "actuals" | "budget" | null =
    location.pathname === "/portco/actuals" ? "actuals" :
    location.pathname === "/portco/budget"  ? "budget"  : null;

  const { user } = useAuth();
  const userDept      = user?.portco_dept ?? null;
  const userDeptLabel = userDept ? (DEPT_LABELS[userDept] ?? userDept) : null;
  const isAdmin       = user?.role === 'admin';


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* ── Header bar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 64, flexShrink: 0,
        background: BRAND, color: "#fff",
        display: "flex", alignItems: "center",
        padding: "0 24px", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <span className="material-icons-round" style={{ fontSize: 22 }}>business_center</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.2 }}>
              PortCo Monthly Reporting
            </div>
            <div style={{ fontSize: "0.68rem", opacity: 0.75, lineHeight: 1.2 }}>
              {syncing && <span style={{ color: "#FFC107", marginRight: 6 }}>●</span>}
              {syncing ? "Saving…" : hasEdits ? "Saved to server" : "All data synced"}
            </div>
          </div>
        </div>

        {/* Year picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.75rem", opacity: 0.85 }}>Year</label>
          <select
            value={selectedYear}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              padding: "4px 8px", borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.3)",
              background: "rgba(255,255,255,0.15)", color: "#fff",
              fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            {YEARS.map((y) => (
              <option key={y} value={y} style={{ background: BRAND }}>{y}</option>
            ))}
          </select>
        </div>

        {/* Clear — only shown on actuals/budget pages */}
        {currentMode && (
          <button
            onClick={() => {
              if (window.confirm(`Clear all ${currentMode} data?`)) clearMode(currentMode);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)",
              color: "#fff", borderRadius: 6, padding: "5px 10px",
              fontSize: "0.75rem", cursor: "pointer",
            }}
            title={`Clear ${currentMode} data`}
          >
            <span className="material-icons-round" style={{ fontSize: 14 }}>delete_outline</span>
            Clear
          </button>
        )}
      </div>

      {/* ── Content (sub-routes) ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", minHeight: 0 }}>
        <Routes>
          <Route
            path="actuals"
            element={
              <ModeRoute mode="actuals" selectedYear={selectedYear} userDept={userDept} isAdmin={isAdmin} />
            }
          />
          <Route
            path="budget"
            element={
              <ModeRoute mode="budget" selectedYear={selectedYear} userDept={userDept} isAdmin={isAdmin} />
            }
          />
          <Route
            path="budget/employee-cost"
            element={
              <EmployeeCostPage
                year={selectedYear}
                userDept={userDeptLabel}
                isAdmin={isAdmin}
              />
            }
          />
          <Route
            path="budget/other-cost"
            element={
              <OtherCostPage
                year={selectedYear}
                userDept={userDeptLabel}
                isAdmin={isAdmin}
              />
            }
          />
          <Route index element={<Navigate to="/portco/actuals" replace />} />
          <Route path="*" element={<Navigate to="/portco/actuals" replace />} />
        </Routes>
      </div>
    </div>
  );
}
