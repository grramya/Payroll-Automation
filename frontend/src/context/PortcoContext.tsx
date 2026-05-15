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
import { SAMPLE_ACTUALS, SAMPLE_BUDGET } from "../pages/portco/data/sampleData";

const ALL_MONTHS = allDataMonths();

const MAX_HISTORY = 20

// Snapshot of editable data kept in the undo/redo stack
interface Snapshot {
  actuals: MetricMap;
  budget:  MetricMap;
}

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
  canUndo:      boolean;
  canRedo:      boolean;

  updateActuals:     (id: string, month: string, value: number | null) => void;
  updateBudget:      (id: string, month: string, value: number | null) => void;
  loadActualsValues: (map: MetricMap) => void;
  loadBudgetValues:  (map: MetricMap) => void;
  setYear:           (y: number) => void;
  setActiveTab:      (t: TabId)  => void;
  clearMode:         (mode: "actuals" | "budget") => void;
  undo:              () => void;
  redo:              () => void;
  reloadFromServer:  () => void;
  loadAll: (actuals: MetricMap, budget: MetricMap, year: number) => void;
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
const LS_KEY      = "portco_v1";
const CLEARED_KEY = "portco_cleared_v1";

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

  // ── Undo / redo history ───────────────────────────────────────────────────
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function pushHistory(actuals: MetricMap, budget: MetricMap) {
    undoStack.current.push({ actuals, budget });
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(false);
  }

  // Debounce timer ref for server saves
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load from server on mount ─────────────────────────────────────────────
  useEffect(() => {
    apiClient
      .get<{ actuals: MetricMap; budget: MetricMap; year: number }>("/portco/data")
      .then(({ data }) => {
        const actuals = data.actuals ?? {};
        const budget  = data.budget  ?? {};
        const year    = data.year    ?? new Date().getFullYear();
        const isEmpty = Object.keys(actuals).length === 0 && Object.keys(budget).length === 0;
        const wasCleared = !!localStorage.getItem(CLEARED_KEY);
        if (isEmpty && !wasCleared) {
          // First-time: seed with sample data so the UI isn't blank
          setActualsValues(SAMPLE_ACTUALS);
          setBudgetValues(SAMPLE_BUDGET);
          const seedYear = new Date().getFullYear();
          lsSave(SAMPLE_ACTUALS, SAMPLE_BUDGET, seedYear);
          apiClient.put("/portco/data", { actuals: SAMPLE_ACTUALS, budget: SAMPLE_BUDGET, year: seedYear });
        } else {
          setActualsValues(actuals);
          setBudgetValues(budget);
          setSelectedYear(year);
          lsSave(actuals, budget, year);
        }
      })
      .catch(() => {
        // Server unreachable — fall back to localStorage data already loaded
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
        pushHistory(prev, budgetValues);
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
        pushHistory(actualsValues, prev);
        const next = { ...prev, [id]: { ...(prev[id] ?? {}), [month]: value } };
        scheduleSave(actualsValues, next, selectedYear);
        return next;
      });
      setHasEdits(true);
    },
    [actualsValues, scheduleSave, selectedYear]
  );

  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push({ actuals: actualsValues, budget: budgetValues });
    setActualsValues(snapshot.actuals);
    setBudgetValues(snapshot.budget);
    scheduleSave(snapshot.actuals, snapshot.budget, selectedYear);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    setHasEdits(true);
  }, [actualsValues, budgetValues, scheduleSave, selectedYear]);

  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push({ actuals: actualsValues, budget: budgetValues });
    setActualsValues(snapshot.actuals);
    setBudgetValues(snapshot.budget);
    scheduleSave(snapshot.actuals, snapshot.budget, selectedYear);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    setHasEdits(true);
  }, [actualsValues, budgetValues, scheduleSave, selectedYear]);

  // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

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

  const clearMode = useCallback((mode: "actuals" | "budget") => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setHasEdits(false);
    localStorage.setItem(CLEARED_KEY, "1");
    if (mode === "actuals") {
      setActualsValues({});
      lsSave({}, budgetValues, selectedYear);
      apiClient.put("/portco/data", { actuals: {}, budget: budgetValues, year: selectedYear });
    } else {
      setBudgetValues({});
      lsSave(actualsValues, {}, selectedYear);
      apiClient.put("/portco/data", { actuals: actualsValues, budget: {}, year: selectedYear });
    }
  }, [actualsValues, budgetValues, selectedYear]);

  const loadAll = useCallback((actuals: MetricMap, budget: MetricMap, year: number) => {
    setActualsValues(actuals);
    setBudgetValues(budget);
    setSelectedYear(year);
    scheduleSave(actuals, budget, year);
  }, [scheduleSave]);

  const reloadFromServer = useCallback(() => {
    apiClient
      .get<{ actuals: MetricMap; budget: MetricMap; year: number }>("/portco/data")
      .then(({ data }) => {
        const actuals = data.actuals ?? {};
        const budget  = data.budget  ?? {};
        const year    = data.year    ?? new Date().getFullYear();
        setActualsValues(actuals);
        setBudgetValues(budget);
        setSelectedYear(year);
        lsSave(actuals, budget, year);
      })
      .catch(() => {});
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
        canUndo,
        canRedo,
        updateActuals,
        updateBudget,
        loadActualsValues,
        loadBudgetValues,
        setYear,
        setActiveTab,
        clearMode,
        undo,
        redo,
        reloadFromServer,
        loadAll,
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
