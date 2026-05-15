import { useState, useRef } from "react";
import { apiClient } from "../../../api/api";
import type { MetricMap } from "../types";

type Mode = "actuals" | "budget";

interface Props {
  singleMode?: Mode;
  onImported: (actuals: MetricMap, budget: MetricMap, year: number) => void;
}

export default function UploadZone({ singleMode, onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File, mode: Mode) => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiClient.post(`/portco/upload-and-save?sheet=${mode}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const count: number = res.data?.imported_count ?? 0;
      if (count === 0) {
        setError("No data found. Ensure the file has Sheet1 with an ID column.");
      } else {
        setSuccess(`Imported ${count} metrics`);
        setTimeout(() => setSuccess(""), 4000);
        const actuals: MetricMap = res.data?.actuals ?? {};
        const budget:  MetricMap = res.data?.budget  ?? {};
        const year:    number    = res.data?.year    ?? new Date().getFullYear();
        onImported(actuals, budget, year);
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

      {(["actuals", "budget"] as Mode[])
        .filter(m => !singleMode || m === singleMode)
        .map((mode) => (
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
              padding: "6px 12px", borderRadius: 6, cursor: loading ? "default" : "pointer",
              background: "#fff", border: "1.5px solid #D4BBE8",
              fontSize: "0.78rem", fontWeight: 600, color: "#512D6D",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <span className="material-icons-round" style={{ fontSize: 15 }}>upload_file</span>
            {loading ? "Importing…" : `Import ${mode === "actuals" ? "Actuals" : "Budget"}`}
          </button>
        ))}

      {error   && <span style={{ fontSize: "0.75rem", color: "#E74C3C" }}>{error}</span>}
      {success && <span style={{ fontSize: "0.75rem", color: "#16A34A" }}>{success}</span>}
    </div>
  );
}
