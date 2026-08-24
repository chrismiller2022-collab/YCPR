import type { WinTotalBucket } from "../lib/montecarlo/distribution";

const BOWL_ELIGIBLE_WINS = 6;
const CHART_HEIGHT = 150;
const BAR_GAP = 6;

export default function WinDistributionBarChart({ buckets }: { buckets: WinTotalBucket[] }) {
  if (buckets.length === 0) return null;

  const maxPct = Math.max(...buckets.map((b) => b.pct));
  const barWidth = 34;
  const width = buckets.length * (barWidth + BAR_GAP) + BAR_GAP;
  const labelSpace = 34;
  const svgHeight = CHART_HEIGHT + labelSpace;

  return (
    <svg
      viewBox={`0 0 ${width} ${svgHeight}`}
      width="100%"
      style={{ maxWidth: width, display: "block", margin: "0 auto" }}
      role="img"
      aria-label="Win total distribution bar chart, bars for six or more wins highlighted as bowl eligible"
    >
      {buckets.map((b, i) => {
        const barHeight = maxPct > 0 ? (b.pct / maxPct) * CHART_HEIGHT : 0;
        const x = BAR_GAP + i * (barWidth + BAR_GAP);
        const y = CHART_HEIGHT - barHeight;
        const isBowlEligible = b.wins >= BOWL_ELIGIBLE_WINS;
        return (
          <g key={b.wins}>
            <text
              x={x + barWidth / 2}
              y={y - 6}
              textAnchor="middle"
              fontSize="10"
              fill="var(--chalk-dim)"
            >
              {b.pct.toFixed(1)}%
            </text>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={3}
              fill={isBowlEligible ? "var(--gold)" : "var(--chalk-dim)"}
              opacity={isBowlEligible ? 1 : 0.55}
            >
              <title>{`${b.wins}-${b.losses}: ${b.pct.toFixed(1)}%`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={CHART_HEIGHT + 16}
              textAnchor="middle"
              fontSize="11"
              fontWeight={700}
              fill="var(--chalk)"
            >
              {b.wins}
            </text>
            <text
              x={x + barWidth / 2}
              y={CHART_HEIGHT + 29}
              textAnchor="middle"
              fontSize="9"
              fill="var(--chalk-dim)"
            >
              {b.wins}-{b.losses}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
