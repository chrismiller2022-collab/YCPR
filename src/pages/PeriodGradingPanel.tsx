import { HistoryGrading } from "./PeriodProjectionsPanel";

export default function PeriodGradingPanel({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Period Grading</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Every game that has saved period lines (Historical Odds Pull or Sync lines), graded: my 1st/2nd half and quarter spread and total
        projections against the market median, using the real quarter scores. Pick a season and week (0 = all).
      </p>
      <HistoryGrading />
    </div>
  );
}
