// BRD §6.6: Optional xlsx upload — populates actuals and/or budget via backend parser
import { useState, useRef } from "react";
import { apiClient as axios } from "../../../api/api";
import type { MetricMap } from "../types";

interface Props {
  onActualsLoaded: (map: MetricMap) => void;
  onBudgetLoaded:  (map: MetricMap) => void;
}

type Mode = "actuals" | "budget";

export default function UploadZone({ onActualsLoaded, onBudgetLoaded }: Props) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File, mode: Mode) => {
    setError(""); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post("/portco/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Build MetricMap from the parsed result
      const actuals = res.data?.actuals as { months: string[]; data: Record<string, Record<string, (number|null)[]>> };
      if (!actuals?.months) throw new Error("Unexpected response format");

      const map: MetricMap = {};
      for (const [dept, lines] of Object.entries(actuals.data ?? {})) {
        for (const [lineItem, vals] of Object.entries(lines)) {
          const id = `${dept} ${lineItem}`;
          map[id] = {};
          actuals.months.forEach((mo: string, i: number) => {
            map[id][mo] = (vals as (number|null)[])[i] ?? null;
          });
        }
      }

      if (mode === "actuals") {
        onActualsLoaded(map);
      } else {
        const budget = res.data?.budget as typeof actuals;
        const bmap: MetricMap = {};
        for (const [dept, lines] of Object.entries(budget?.data ?? {})) {
          for (const [lineItem, vals] of Object.entries(lines)) {
            const id = `${dept} ${lineItem}`;
            bmap[id] = {};
            (budget?.months ?? []).forEach((mo: string, i: number) => {
              bmap[id][mo] = (vals as (number|null)[])[i] ?? null;
            });
          }
        }
        onBudgetLoaded(bmap);
      }
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message ?? "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          const mode = (e.target as any).dataset.mode as Mode;
          if (f) handleFile(f, mode);
          e.target.value = "";
        }}
      />

      {(["actuals", "budget"] as Mode[]).map((mode) => (
        <button
          key={mode}
          disabled={loading}
          onClick={() => {
            if (inputRef.current) {
              (inputRef.current as any).dataset.mode = mode;
              inputRef.current.click();
            }
          }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 6, cursor: "pointer",
            background: "#fff", border: "1.5px solid #D4BBE8",
            fontSize: "0.78rem", fontWeight: 600, color: "#512D6D",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <span className="material-icons-round" style={{ fontSize: 15 }}>upload_file</span>
          {loading ? "Parsing…" : `Import ${mode === "actuals" ? "Actuals" : "Budget"}`}
        </button>
      ))}

      {error && (
        <span style={{ fontSize: "0.75rem", color: "#E74C3C" }}>{error}</span>
      )}
    </div>
  );
}
