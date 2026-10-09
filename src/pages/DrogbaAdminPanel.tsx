import { useState } from "react";
import { useDrogba } from "../lib/drogba/useDrogba";
import { OPEN_MODE_LABELS, type OpenMode } from "../lib/drogba/dataset";
import DrogbaDataTab from "../components/drogba/DrogbaDataTab";
import DrogbaBacktestTab from "../components/drogba/DrogbaBacktestTab";
import DrogbaBucketsTab from "../components/drogba/DrogbaBucketsTab";
import DrogbaSundayTab from "../components/drogba/DrogbaSundayTab";
import DrogbaThisWeekTab from "../components/drogba/DrogbaThisWeekTab";
import DrogbaPicksLogTab from "../components/drogba/DrogbaPicksLogTab";
import DrogbaMethodologyTab from "../components/drogba/DrogbaMethodologyTab";

const TABS = ["sunday", "thisweek", "backtest", "buckets", "log", "data", "methodology"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  sunday: "Sunday check",
  thisweek: "This week",
  backtest: "Backtest",
  buckets: "Buckets",
  log: "Picks log",
  data: "Data & sync",
  methodology: "Methodology",
};

// DROGBA — Data Ridge on Games By Agent. Spread model aimed at the OPENING line.
export default function DrogbaAdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("sunday");
  const state = useDrogba();
  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h1 style={{ marginTop: 0, marginBottom: "0.2rem" }}>DROGBA</h1>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Data Ridge on Games By Agent — a spread model that looks for games where the opening line is off, built on walk-forward efficiency ratings and checked against the open and the close.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Opening line:{" "}
          <select className="filter" value={state.openMode} onChange={(e) => state.setOpenMode(e.target.value as OpenMode)}>
            {(Object.keys(OPEN_MODE_LABELS) as OpenMode[]).map((m) => (
              <option key={m} value={m}>{OPEN_MODE_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>{state.fanduelGames} games with a FanDuel open on file</span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} className={`mode-btn ${tab === t ? "mode-btn-active" : ""}`} onClick={() => setTab(t)}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "sunday" && <DrogbaSundayTab state={state} />}
      {tab === "thisweek" && <DrogbaThisWeekTab state={state} />}
      {tab === "backtest" && <DrogbaBacktestTab state={state} />}
      {tab === "buckets" && <DrogbaBucketsTab state={state} />}
      {tab === "log" && <DrogbaPicksLogTab state={state} />}
      {tab === "data" && <DrogbaDataTab state={state} />}
      {tab === "methodology" && <DrogbaMethodologyTab />}
    </div>
  );
}
