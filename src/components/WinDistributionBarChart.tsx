import type { WinTotalBucket } from "../lib/montecarlo/distribution";

const BOWL_ELIGIBLE_WINS = 6;

export default function WinDistributionBarChart({
  buckets,
  rowHeight = 30,
  headerHeight = 0,
}: {
  buckets: WinTotalBucket[];
  rowHeight?: number;
  headerHeight?: number;
}) {
  if (buckets.length === 0) return null;

  const maxPct = Math.max(...buckets.map((b) => b.pct));

  return (
    <div
      role="img"
      aria-label="Win total distribution, horizontal bars for each win count, six or more wins highlighted as bowl eligible"
    >
      {headerHeight > 0 && <div style={{ height: headerHeight }} />}
      {buckets.map((b) => {
        const widthPct = maxPct > 0 ? (b.pct / maxPct) * 100 : 0;
        const isBowlEligible = b.wins >= BOWL_ELIGIBLE_WINS;
        return (
          <div
            key={b.wins}
            style={{ height: rowHeight, display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <div style={{ width: 44, flexShrink: 0, textAlign: "right", fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
              {b.wins}-{b.losses}
            </div>
            <div style={{ flex: 1, height: 14, borderRadius: 3, background: "rgba(255,255,255,0.06)", position: "relative" }}>
              <div
                title={`${b.wins}-${b.losses}: ${b.pct.toFixed(1)}%`}
                style={{
                  width: `${widthPct}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: isBowlEligible ? "var(--gold)" : "var(--chalk-dim)",
                  opacity: isBowlEligible ? 1 : 0.55,
                }}
              />
            </div>
            <div style={{ width: 40, flexShrink: 0, fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
              {b.pct.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
