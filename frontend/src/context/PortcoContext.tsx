import {
  createContext, useContext, useState, useMemo, useCallback,
  useEffect, useRef,
} from "react";
import type { ReactNode } from "react";
import type { MetricMap, TabId } from "../pages/portco/types";
import { METRIC_DEFS } from "../pages/portco/constants/metricDefs";
import { FORMULAS } from "../pages/portco/engine/formulas";
import { allDataMonths } from "../pages/portco/engine/periodCalc";
import { apiClient } from "../api/api";

const ALL_MONTHS = allDataMonths();

// ── Context shape ─────────────────────────────────────────────────────────────
interface PortcoCtx {
  actualsValues: MetricMap;
  budgetValues:  MetricMap;
  derivedActuals: MetricMap;
  derivedBudget:  MetricMap;

  selectedYear: number;
  activeTab:    TabId;
  hasEdits:     boolean;
  syncing:      boolean;

  updateActuals:     (id: string, month: string, value: number | null) => void;
  updateBudget:      (id: string, month: string, value: number | null) => void;
  loadActualsValues: (map: MetricMap) => void;
  loadBudgetValues:  (map: MetricMap) => void;
  setYear:           (y: number) => void;
  setActiveTab:      (t: TabId)  => void;
  clearAll:          () => void;
}

const PortcoContext = createContext<PortcoCtx>({} as PortcoCtx);

// ── Run all formulas over a base map ─────────────────────────────────────────
function deriveMap(base: MetricMap): MetricMap {
  const out: MetricMap = {};
  for (const id of Object.keys(base)) {
    out[id] = { ...base[id] };
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const [metricId, fn] of Object.entries(FORMULAS)) {
      out[metricId] = out[metricId] ?? {};
      for (const month of ALL_MONTHS) {
        out[metricId][month] = fn(out, month);
      }
    }
  }
  return out;
}

// ── localStorage helpers (offline fallback) ───────────────────────────────────
const LS_KEY = "portco_v1";

function lsLoad(): { actuals: MetricMap; budget: MetricMap; year: number } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { actuals: {}, budget: {}, year: new Date().getFullYear() };
}

function lsSave(a: MetricMap, b: MetricMap, y: number) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ actuals: a, budget: b, year: y }));
  } catch {}
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function PortcoProvider({ children }: { children: ReactNode }) {
  const saved = lsLoad();

  const [actualsValues, setActualsValues] = useState<MetricMap>(saved.actuals);
  const [budgetValues,  setBudgetValues]  = useState<MetricMap>(saved.budget);
  const [selectedYear,  setSelectedYear]  = useState<number>(saved.year);
  const [activeTab,     setActiveTab]     = useState<TabId>("exec");
  const [hasEdits,      setHasEdits]      = useState(false);
  const [syncing,       setSyncing]       = useState(false);

  // Debounce timer ref for server saves
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load from server on mount ─────────────────────────────────────────────
  useEffect(() => {
    apiClient
      .get<{ actuals: MetricMap; budget: MetricMap; year: number }>("/portco/data")
      .then(({ data }) => {
        setActualsValues(data.actuals ?? {});
        setBudgetValues(data.budget ?? {});
        setSelectedYear(data.year ?? new Date().getFullYear());
        // Keep localStorage in sync as offline fallback
        lsSave(data.actuals ?? {}, data.budget ?? {}, data.year ?? new Date().getFullYear());
      })
      .catch(() => {
        // Server unreachable — silently fall back to localStorage data already loaded
      });
  }, []);

  // ── Debounced server save ─────────────────────────────────────────────────
  const scheduleSave = useCallback((a: MetricMap, b: MetricMap, y: number) => {
    lsSave(a, b, y);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSyncing(true);
      apiClient
        .put("/portco/data", { actuals: a, budget: b, year: y })
        .finally(() => setSyncing(false));
    }, 800);
  }, []);

  const derivedActuals = useMemo(() => deriveMap(actualsValues), [actualsValues]);
  const derivedBudget  = useMemo(() => deriveMap(budgetValues),  [budgetValues]);

  const updateActuals = useCallback(
    (id: string, month: string, value: number | null) => {
      setActualsValues((prev) => {
        const next = { ...prev, [id]: { ...(prev[id] ?? {}), [month]: value } };
        scheduleSave(next, budgetValues, selectedYear);
        return next;
      });
      setHasEdits(true);
    },
    [budgetValues, scheduleSave, selectedYear]
  );

  const updateBudget = useCallback(
    (id: string, month: string, value: number | null) => {
      setBudgetValues((prev) => {
        const next = { ...prev, [id]: { ...(prev[id] ?? {}), [month]: value } };
        scheduleSave(actualsValues, next, selectedYear);
        return next;
      });
      setHasEdits(true);
    },
    [actualsValues, scheduleSave, selectedYear]
  );

  const loadActualsValues = useCallback(
    (map: MetricMap) => {
      setActualsValues(map);
      scheduleSave(map, budgetValues, selectedYear);
      setHasEdits(false);
    },
    [budgetValues, scheduleSave, selectedYear]
  );

  const loadBudgetValues = useCallback(
    (map: MetricMap) => {
      setBudgetValues(map);
      scheduleSave(actualsValues, map, selectedYear);
    },
    [actualsValues, scheduleSave, selectedYear]
  );

  const setYear = useCallback(
    (y: number) => {
      setSelectedYear(y);
      scheduleSave(actualsValues, budgetValues, y);
    },
    [actualsValues, budgetValues, scheduleSave]
  );

  const clearAll = useCallback(() => {
    setActualsValues({});
    setBudgetValues({});
    setHasEdits(false);
    localStorage.removeItem(LS_KEY);
    apiClient.put("/portco/data", { actuals: {}, budget: {}, year: new Date().getFullYear() });
  }, []);

  return (
    <PortcoContext.Provider
      value={{
        actualsValues,
        budgetValues,
        derivedActuals,
        derivedBudget,
        selectedYear,
        activeTab,
        hasEdits,
        syncing,
        updateActuals,
        updateBudget,
        loadActualsValues,
        loadBudgetValues,
        setYear,
        setActiveTab,
        clearAll,
      }}
    >
      {children}
    </PortcoContext.Provider>
  );
}

export function usePortco() {
  return useContext(PortcoContext);
}

export { METRIC_DEFS };
