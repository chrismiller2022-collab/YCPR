import { useMemo, useState } from "react";
import type { PerformanceSegment, AmountOffBucket, AmountOffMetric } from "../lib/gameTotalsEngine";

const CP: React.CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };

// ---------------------------------------------------------------------
// Week-only vs full-season filter — shared by Game Totals / Team Totals
// main tables and their Performance tabs.
// ---------------------------------------------------------------------
export type ViewMode = "season" | "week";

export function WeekSeasonToggle({
  mode,
  setMode,
  week,
  setWeek,
  availableWeeks,
}: {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  week: number;
  setWeek: (w: number) => void;
  availableWeeks: number[];
}) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
      <button className={`mode-btn ${mode === "season" ? "mode-btn-active" : ""}`} onClick={() => setMode("season")}>
        Full Season
      </button>
      <button className={`mode-btn ${mode === "week" ? "mode-btn-active" : ""}`} onClick={() => setMode("week")}>
        Week Only
      </button>
      {mode === "week" && (
        <select className="filter" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {availableWeeks.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function filterByViewMode<T extends { game: { week: number } }>(rows: T[], mode: ViewMode, week: number): T[] {
  return mode === "week" ? rows.filter((r) => r.game.week === week) : rows;
}

function pct(v: number | null): string {
  return v == null ? "–" : `${(v * 100).toFixed(1)}%`;
}

function record(s: { wins: number; losses: number; pushes: number }): string {
  return s.pushes > 0 ? `${s.wins}-${s.losses}-${s.pushes}` : `${s.wins}-${s.losses}`;
}

// ---------------------------------------------------------------------
// Segment breakdown table — sortable by win% (EB or FB).
// ---------------------------------------------------------------------
export function PerformanceTable({ segments }: { segments: PerformanceSegment[] }) {
  const [sortKey, setSortKey] = useState<"label" | "ebWinPct" | "fbWinPct">("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "label" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const withVals = segments.map((s) => ({ s, ebWinPct: s.eb.winPct ?? -1, fbWinPct: s.fb.winPct ?? -1 }));
    withVals.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "label") {
        av = a.s.label;
        bv = b.s.label;
      } else if (sortKey === "ebWinPct") {
        av = a.ebWinPct;
        bv = b.ebWinPct;
      } else {
        av = a.fbWinPct;
        bv = b.fbWinPct;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return withVals.map((w) => w.s);
  }, [segments, sortKey, sortDir]);

  function sortArrow(key: string) {
    if (sortKey !== key) return "—";
    return sortDir === "asc" ? "▲" : "▼";
  }

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...CP, cursor: "pointer" }} onClick={() => handleSort("label")}>
              Segment {sortArrow("label")}
            </th>
            <th style={{ ...CP, textAlign: "right" }}>EB Record</th>
            <th style={{ ...CP, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("ebWinPct")}>
              EB Win% {sortArrow("ebWinPct")}
            </th>
            <th style={{ ...CP, textAlign: "right" }}>EB MOE</th>
            <th style={{ ...CP, textAlign: "right" }}>FB Record</th>
            <th style={{ ...CP, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("fbWinPct")}>
              FB Win% {sortArrow("fbWinPct")}
            </th>
            <th style={{ ...CP, textAlign: "right" }}>FB MOE</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.key}>
              <td style={CP}>{s.label}</td>
              <td style={{ ...CP, textAlign: "right" }}>{record(s.eb)}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{pct(s.eb.winPct)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{s.eb.marginOfError != null ? `±${(s.eb.marginOfError * 100).toFixed(1)}%` : "–"}</td>
              <td style={{ ...CP, textAlign: "right" }}>{record(s.fb)}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{pct(s.fb.winPct)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{s.fb.marginOfError != null ? `±${(s.fb.marginOfError * 100).toFixed(1)}%` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Amount-off distribution chart — plain hand-rolled SVG bars (no chart
// dependency in this repo), win% per 0.5-pt bucket, bar height = win%,
// label under each bar = sample size so a thin bar doesn't get
// overread. Buckets go 0 -> the actual max |amount off| in the data,
// regardless of what that max happens to be.
// ---------------------------------------------------------------------
export function AmountOffMetricToggle({ metric, setMetric }: { metric: AmountOffMetric; setMetric: (m: AmountOffMetric) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
      <button className={`mode-btn ${metric === "stdDevOff" ? "mode-btn-active" : ""}`} onClick={() => setMetric("stdDevOff")}>
        Std Dev Off
      </button>
      <button className={`mode-btn ${metric === "amountOff" ? "mode-btn-active" : ""}`} onClick={() => setMetric("amountOff")}>
        Amount Off
      </button>
    </div>
  );
}

export function AmountOffChart({ buckets, metric = "stdDevOff" }: { buckets: AmountOffBucket[]; metric?: AmountOffMetric }) {
  if (buckets.length === 0) {
    return <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>Not enough graded bets yet to chart.</p>;
  }
  const width = Math.max(400, buckets.length * 46);
  const height = 220;
  const barWidth = 32;
  const gap = 14;
  const chartTop = 20;
  const chartBottom = height - 50;
  const chartHeight = chartBottom - chartTop;

  return (
    <div className="table-scroll">
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* 50% reference line */}
        <line
          x1={0}
          x2={width}
          y1={chartTop + chartHeight * 0.5}
          y2={chartTop + chartHeight * 0.5}
          stroke="var(--hash)"
          strokeDasharray="4,4"
        />
        {buckets.map((b, i) => {
          const x = i * (barWidth + gap) + gap / 2;
          const h = b.winPct != null ? b.winPct * chartHeight : 0;
          const y = chartBottom - h;
          const barColor = b.winPct == null ? "var(--hash)" : b.winPct >= 0.5 ? "#8fd39a" : "#e07a7a";
          return (
            <g key={b.label}>
              <rect x={x} y={y} width={barWidth} height={h} fill={barColor} rx={2} />
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize="10" fill="var(--chalk)">
                {b.winPct != null ? `${(b.winPct * 100).toFixed(0)}%` : "–"}
              </text>
              <text x={x + barWidth / 2} y={chartBottom + 14} textAnchor="middle" fontSize="9" fill="var(--chalk-dim)">
                {b.label}
              </text>
              <text x={x + barWidth / 2} y={chartBottom + 26} textAnchor="middle" fontSize="9" fill="var(--chalk-dim)">
                n={b.n}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
        {metric === "stdDevOff"
          ? "Win% by |std dev off| bucket (this pool's own amount-off distribution), pushes excluded."
          : "Win% by |amount off| bucket (points from Vegas), pushes excluded."}{" "}
        Dashed line = 50%.
      </p>
    </div>
  );
}
