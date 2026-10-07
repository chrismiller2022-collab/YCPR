import { useState } from "react";
import { useDrogba } from "../lib/drogba/useDrogba";
import DrogbaDataTab from "../components/drogba/DrogbaDataTab";
import DrogbaBacktestTab from "../components/drogba/DrogbaBacktestTab";
import DrogbaThisWeekTab from "../components/drogba/DrogbaThisWeekTab";
import DrogbaPicksLogTab from "../components/drogba/DrogbaPicksLogTab";
import DrogbaMethodologyTab from "../components/drogba/DrogbaMethodologyTab";

const TABS = ["thisweek", "backtest", "log", "data", "methodology"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  thisweek: "This week",
  backtest: "Backtest",
  log: "Picks log",
  data: "Data & sync",
  methodology: "Methodology",
};

// DROGBA — Data Ridge on Games By Agent. Spread model aimed at the OPENING line.
export default function DrogbaAdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("thisweek");
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
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} className={`mode-btn ${tab === t ? "mode-btn-active" : ""}`} onClick={() => setTab(t)}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "thisweek" && <DrogbaThisWeekTab state={state} />}
      {tab === "backtest" && <DrogbaBacktestTab state={state} />}
      {tab === "log" && <DrogbaPicksLogTab state={state} />}
      {tab === "data" && <DrogbaDataTab state={state} />}
      {tab === "methodology" && <DrogbaMethodologyTab />}
    </div>
  );
}
