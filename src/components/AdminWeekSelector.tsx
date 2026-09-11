import { useAdminWeek } from "../lib/adminWeek";

const WEEK_CHOICES = Array.from({ length: 16 }, (_, i) => i + 1);

// Site-wide "which week" control for the whole Admin section — every
// pool page and admin tool defaults its own week to this one (see
// useDefaultToAdminWeek), so changing it here is the one place that
// needs to happen when moving on to a new week.
export default function AdminWeekSelector() {
  const { week, setWeek } = useAdminWeek();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.35rem 0.5rem 0.35rem 0.75rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 999,
      }}
    >
      <span
        style={{
          fontSize: "0.68rem",
          color: "var(--chalk-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        Week
      </span>
      <button
        onClick={() => setWeek(Math.max(1, week - 1))}
        disabled={week <= 1}
        aria-label="Previous week"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: "1px solid var(--hash)",
          background: "transparent",
          color: "inherit",
          cursor: week <= 1 ? "default" : "pointer",
          opacity: week <= 1 ? 0.4 : 1,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ‹
      </button>
      <select
        value={week}
        onChange={(e) => setWeek(parseInt(e.target.value, 10))}
        style={{
          fontWeight: 700,
          fontSize: "0.95rem",
          padding: "0.15rem 0.3rem",
          background: "transparent",
          color: "var(--gold, #d9a441)",
          border: "none",
          cursor: "pointer",
        }}
      >
        {WEEK_CHOICES.map((w) => (
          <option key={w} value={w} style={{ color: "initial" }}>
            Week {w}
          </option>
        ))}
      </select>
      <button
        onClick={() => setWeek(Math.min(16, week + 1))}
        disabled={week >= 16}
        aria-label="Next week"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: "1px solid var(--hash)",
          background: "transparent",
          color: "inherit",
          cursor: week >= 16 ? "default" : "pointer",
          opacity: week >= 16 ? 0.4 : 1,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ›
      </button>
    </div>
  );
}
