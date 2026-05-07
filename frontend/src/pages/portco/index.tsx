import { useEffect } from "react";
import { Routes, Route, Navigate, useParams, NavLink, useNavigate } from "react-router-dom";
import { usePortco } from "../../context/PortcoContext";
import { useAuth } from "../../context/AuthContext";
import { METRIC_DEFS } from "./constants/metricDefs";
import type { TabId } from "./types";
import { monthsForYear } from "./engine/periodCalc";
import ExecSummary from "./tabs/ExecSummary";
import DeptTab from "./tabs/DeptTab";
import { SAMPLE_ACTUALS, SAMPLE_BUDGET } from "./data/sampleData";

const BRAND = "#512D6D";
const YEARS = [2023, 2024, 2025, 2026, 2027];

const DEPT_LABELS: Record<string, string> = {
  proddev:    "Product Development",
  sales:      "Sales",
  marketing:  "Marketing",
  cs:         "Customer Success",
  onboarding: "Onboarding",
  finance:    "Finance",
};

// ── Actuals / Budget mode toggle tabs ────────────────────────────────────────
function ModeTabs({ deptKey }: { deptKey: string }) {
  const linkStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "6px 18px", borderRadius: 6,
    fontSize: "0.78rem", fontWeight: active ? 700 : 500,
    textDecoration: "none",
    background: active ? BRAND : "transparent",
    color: active ? "#fff" : "#64748B",
    border: `1.5px solid ${active ? BRAND : "#CBD5E1"}`,
    transition: "all .15s",
  });

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <NavLink to={`/portco/${deptKey}/actuals`} style={({ isActive }) => linkStyle(isActive)}>
        <span className="material-icons-round" style={{ fontSize: 14 }}>edit_note</span>
        Actuals
      </NavLink>
      <NavLink to={`/portco/${deptKey}/budget`} style={({ isActive }) => linkStyle(isActive)}>
        <span className="material-icons-round" style={{ fontSize: 14 }}>calculate</span>
        Budget
      </NavLink>
    </div>
  );
}

// Maps TabId → dept key for exec summary navigation
const TAB_TO_DEPT_KEY: Partial<Record<TabId, string>> = {
  proddev:   "proddev",
  sales:     "sales",
  marketing: "marketing",
  cs:        "cs",
  finance:   "finance",
};

function ExecSummaryWrapper({
  derivedActuals, derivedBudget, selectedYear,
}: {
  derivedActuals: Record<string, Record<string, number | null>>;
  derivedBudget:  Record<string, Record<string, number | null>>;
  selectedYear:   number;
}) {
  const navigate = useNavigate();
  return (
    <ExecSummary
      derivedActuals={derivedActuals}
      derivedBudget={derivedBudget}
      selectedYear={selectedYear}
      onNavigate={(tab: TabId) => {
        const deptKey = TAB_TO_DEPT_KEY[tab];
        if (deptKey) navigate(`/portco/${deptKey}`);
      }}
    />
  );
}

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCSV(
  data: Record<string, Record<string, number | null>>,
  year: number,
  dept: string,
  mode: string
) {
  const rows   = METRIC_DEFS.filter((r) => r.department === dept);
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
  a.download = `portco_${dept}_${mode}_${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Dept + Mode input page (Actuals or Budget entry) ─────────────────────────
function DeptModeRoute({
  selectedYear, userDept,
}: {
  selectedYear: number;
  userDept:     string | null | undefined;
}) {
  const { dept, mode } = useParams<{ dept: string; mode: string }>();
  const { derivedActuals, derivedBudget, updateActuals, updateBudget } = usePortco();

  const deptKey = dept ?? "";
  const modeKey = (mode === "budget" ? "budget" : "actuals") as "actuals" | "budget";

  // Role guard: restricted users can only see their own dept
  if (userDept && userDept !== deptKey) {
    return <Navigate to={`/portco/${userDept}/actuals`} replace />;
  }

  if (!DEPT_LABELS[deptKey]) {
    return <Navigate to="/portco/exec" replace />;
  }

  const department = DEPT_LABELS[deptKey];
  const modeData   = modeKey === "actuals" ? derivedActuals : derivedBudget;

  const handleEdit = (id: string, month: string, value: number | null) => {
    if (modeKey === "actuals") updateActuals(id, month, value);
    else                       updateBudget(id, month, value);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sub-header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", background: "#FAFBFC",
        borderBottom: "1px solid #E5E7EB", flexShrink: 0, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B" }}>
            {department}
          </span>
          <span style={{
            fontSize: "0.68rem", fontWeight: 700,
            color: modeKey === "actuals" ? "#0369A1" : "#7C3AED",
            background: modeKey === "actuals" ? "#E0F2FE" : "#EDE9F7",
            borderRadius: 4, padding: "2px 8px",
          }}>
            {modeKey === "actuals" ? "Actuals Entry" : "Budget Entry"}
          </span>
        </div>

        <ModeTabs deptKey={deptKey} />

        <button
          onClick={() => exportCSV(modeData, selectedYear, department, modeKey)}
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

      {/* Editable table */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
        <DeptTab
          department={department}
          selectedYear={selectedYear}
          derivedActuals={derivedActuals}
          derivedBudget={derivedBudget}
          mode={modeKey}
          onCellEdit={handleEdit}
        />
      </div>
    </div>
  );
}

// ── Dept report page (read-only output generated from actuals + budget) ───────
function DeptReportRoute({
  selectedYear, userDept,
}: {
  selectedYear: number;
  userDept:     string | null | undefined;
}) {
  const { dept } = useParams<{ dept: string }>();
  const { derivedActuals, derivedBudget } = usePortco();

  const deptKey = dept ?? "";

  if (userDept && userDept !== deptKey) {
    return <Navigate to={`/portco/${userDept}`} replace />;
  }

  if (!DEPT_LABELS[deptKey]) {
    return <Navigate to="/portco/exec" replace />;
  }

  const department = DEPT_LABELS[deptKey];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sub-header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", background: "#FAFBFC",
        borderBottom: "1px solid #E5E7EB", flexShrink: 0, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B" }}>
            {department}
          </span>
          <span style={{
            fontSize: "0.68rem", fontWeight: 700,
            color: BRAND, background: "#EDE9F7",
            borderRadius: 4, padding: "2px 8px",
          }}>
            Department Report
          </span>
        </div>
        <button
          onClick={() => exportCSV(derivedActuals, selectedYear, department, "report")}
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

      {/* Read-only report table */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
        <DeptTab
          department={department}
          selectedYear={selectedYear}
          derivedActuals={derivedActuals}
          derivedBudget={derivedBudget}
        />
      </div>
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────
export default function PortcoApp() {
  const {
    derivedActuals, derivedBudget,
    selectedYear, hasEdits, syncing,
    setYear, clearAll,
    loadActualsValues, loadBudgetValues,
  } = usePortco();

  const { user } = useAuth();
  const userDept = user?.portco_dept ?? null;

  useEffect(() => {
    loadActualsValues(SAMPLE_ACTUALS);
    loadBudgetValues(SAMPLE_BUDGET);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* Clear */}
        <button
          onClick={() => { if (window.confirm("Clear all data?")) clearAll(); }}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)",
            color: "#fff", borderRadius: 6, padding: "5px 10px",
            fontSize: "0.75rem", cursor: "pointer",
          }}
          title="Clear all data"
        >
          <span className="material-icons-round" style={{ fontSize: 14 }}>delete_outline</span>
          Clear
        </button>
      </div>

      {/* ── Content (sub-routes) ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", minHeight: 0 }}>
        <Routes>
          {/* Executive summary */}
          <Route
            path="exec"
            element={
              <ExecSummaryWrapper
                derivedActuals={derivedActuals}
                derivedBudget={derivedBudget}
                selectedYear={selectedYear}
              />
            }
          />

          {/* Per-dept Actuals / Budget entry (role-filtered) */}
          <Route
            path=":dept/:mode"
            element={<DeptModeRoute selectedYear={selectedYear} userDept={userDept} />}
          />

          {/* Per-dept read-only report (generated from actuals + budget) */}
          <Route
            path=":dept"
            element={<DeptReportRoute selectedYear={selectedYear} userDept={userDept} />}
          />

          {/* Default redirect */}
          <Route
            index
            element={
              <Navigate
                to={userDept ? `/portco/${userDept}/actuals` : "/portco/exec"}
                replace
              />
            }
          />
          <Route path="*" element={<Navigate to="/portco/exec" replace />} />
        </Routes>
      </div>
    </div>
  );
}
