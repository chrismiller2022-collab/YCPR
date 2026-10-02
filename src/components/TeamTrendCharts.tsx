import { useEffect, useMemo, useState } from "react";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchTeamRatingHistory } from "../lib/api/seasonWeeklyRatings";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { computeRow } from "../lib/matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";

// ---------------------------------------------------------------------
// Small dependency-free SVG line chart shared by the team page's two trend
// charts. Every point carries its own hover text (native SVG <title>).
// ---------------------------------------------------------------------
interface ChartPoint {
  x: number; // position on the x axis (week or game number)
  y: number;
  tip: string;
}
interface ChartSeries {
  label: string;
  color: string;
  dashed?: boolean;
  points: ChartPoint[];
}

const W = 680;
const H = 280;
const PAD = { left: 48, right: 16, top: 14, bottom: 34 };

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const span = max - min;
  const rough = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function LineChart({
  series,
  xLabel,
  xTickLabel,
  yFormat,
  invertY = false,
  yIncludeZero = false,
}: {
  series: ChartSeries[];
  xLabel: string;
  xTickLabel: (x: number) => string;
  yFormat: (v: number) => string;
  invertY?: boolean; // true when a LOWER value is better (power rating) — better plots toward the top
  yIncludeZero?: boolean;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const xs = Array.from(new Set(all.map((p) => p.x))).sort((a, b) => a - b);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  let yMin = Math.min(...all.map((p) => p.y), ...(yIncludeZero ? [0] : []));
  let yMax = Math.max(...all.map((p) => p.y), ...(yIncludeZero ? [0] : []));
  const padY = (yMax - yMin || 1) * 0.12;
  yMin -= padY;
  yMax += padY;
  const sx = (x: number) => PAD.left + (xMax === xMin ? (W - PAD.left - PAD.right) / 2 : ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right));
  const sy = (y: number) => {
    const t = (y - yMin) / (yMax - yMin);
    return PAD.top + (invertY ? t : 1 - t) * (H - PAD.top - PAD.bottom);
  };
  const yTicks = niceTicks(yMin, yMax);
  // Thin x labels so a long season doesn't overlap.
  const labelEvery = Math.ceil(xs.length / 12);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.08)" />
          <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="var(--chalk-dim)">
            {yFormat(t)}
          </text>
        </g>
      ))}
      {xs.map((x, i) =>
        i % labelEvery === 0 || i === xs.length - 1 ? (
          <text key={x} x={sx(x)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize="10" fill="var(--chalk-dim)">
            {xTickLabel(x)}
          </text>
        ) : null
      )}
      <text x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--chalk-dim)">
        {xLabel}
      </text>
      {series.map((s) => (
        <g key={s.label}>
          <polyline
            fill="none"
            stroke={s.color}
            strokeWidth={2.2}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
          />
          {s.points.map((p) => (
            <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={s.dashed ? 3 : 3.5} fill={s.dashed ? "var(--turf-panel, #1a1b2e)" : s.color} stroke={s.color} strokeWidth={1.6}>
              <title>{p.tip}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <svg width="26" height="8">
            <line x1="0" x2="26" y1="4" y2="4" stroke={i.color} strokeWidth="2.2" strokeDasharray={i.dashed ? "6 4" : undefined} />
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Power rating history — the team's saved (locked) rating at every archived
// week of the season. Lower rating = better team, so the axis is flipped:
// moving UP the chart is improving.
// ---------------------------------------------------------------------
export function TeamRatingHistoryChart({ team, season }: { team: string; season: number }) {
  const [rows, setRows] = useState<{ week_number: number; rating: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    fetchTeamRatingHistory(season, team)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [season, team]);

  const points: ChartPoint[] = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.rating != null)
        .map((r, i, arr) => {
          const rating = r.rating as number;
          const prev = i > 0 ? (arr[i - 1].rating as number) : null;
          const chg = prev != null ? rating - prev : null;
          const label = r.week_number === 0 ? "Preseason" : `Week ${r.week_number}`;
          return {
            x: r.week_number,
            y: rating,
            tip: `${label}: ${rating > 0 ? "+" : ""}${rating.toFixed(2)}${chg != null ? ` (${chg > 0 ? "+" : ""}${chg.toFixed(2)} vs prior week)` : ""}`,
          };
        }),
    [rows]
  );

  if (error) return null;
  if (!rows || points.length < 2) return null; // a line needs at least two saved weeks

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.y - first.y;

  return (
    <div className="table-wrap">
      <div className="section-label">{team} power rating history</div>
      <LineChart
        series={[{ label: "Power rating", color: "var(--gold, #d9a441)", points }]}
        xLabel="Saved week"
        xTickLabel={(x) => (x === 0 ? "Pre" : `Wk ${x}`)}
        yFormat={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
        invertY
      />
      <div className="footer-note" style={{ marginTop: "0.5rem" }}>
        {Math.abs(delta) < 0.005
          ? "Unchanged since the first saved week."
          : `${delta < 0 ? "Improved" : "Dropped"} ${Math.abs(delta).toFixed(2)} since ${first.x === 0 ? "the preseason" : `Week ${first.x}`}.`}{" "}
        Saved weekly ratings only; lower is better, so up the chart means a stronger team.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Actual vs expected wins — for each completed game, the win probability my
// ratings gave this team going in (the frozen projection when the game was
// locked, else the saved ratings for that week) is added to a running
// "expected wins" total; the actual line adds 1 per win (0.5 per tie).
// ---------------------------------------------------------------------
export function TeamWinsVsExpectedChart({ team, season }: { team: string; season: number }) {
  const [games, setGames] = useState<GameWithLines[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season)
      .then((g) => !cancelled && setGames(g.filter((x) => x.home_team === team || x.away_team === team)))
      .catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, team]);

  const weekNumbers = useMemo(() => Array.from(new Set((games ?? []).map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(season, weekNumbers, season);
  const { locks, loading: locksLoading } = useGameProjectionLocks(season, weekNumbers);

  const data = useMemo(() => {
    if (!games || ratingsLoading || locksLoading) return null;
    // The ratings hook briefly reports "not loading" with an empty map right after the games arrive — wait until every week's snapshot is in.
    if (weekNumbers.length === 0 || !weekNumbers.every((w) => ratingsByWeek[w])) return null;
    const completed = games
      .filter((g) => g.completed && g.home_points != null && g.away_points != null)
      .sort((a, b) => a.week - b.week || (a.start_date ?? "").localeCompare(b.start_date ?? ""));
    const actual: ChartPoint[] = [];
    const expected: ChartPoint[] = [];
    let cumActual = 0;
    let cumExpected = 0;
    let n = 0;
    for (const g of completed) {
      const isHome = g.home_team === team;
      const lock = locks[g.id];
      const row = computeRow(
        g,
        ratingsByWeek[g.week] ?? {},
        "team",
        DEFAULT_CUSTOM_PARAMS,
        lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null
      );
      if (row.projWinPct == null) continue; // no ratings for one side — leave the game out of both lines
      const pWin = isHome ? 1 - row.projWinPct : row.projWinPct;
      const mine = (isHome ? g.home_points : g.away_points) as number;
      const theirs = (isHome ? g.away_points : g.home_points) as number;
      const won = mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      n += 1;
      cumActual += won;
      cumExpected += pWin;
      const opp = isHome ? g.away_team : g.home_team;
      const desc = `Wk ${g.week} ${isHome ? "vs" : "@"} ${opp}: ${won === 1 ? "W" : won === 0 ? "L" : "T"} ${mine}-${theirs}, ${(pWin * 100).toFixed(0)}% win prob${lock?.my_away_win_pct != null ? " (locked)" : ""}`;
      actual.push({ x: n, y: cumActual, tip: `${desc}\nActual wins so far: ${cumActual}` });
      expected.push({ x: n, y: cumExpected, tip: `${desc}\nExpected wins so far: ${cumExpected.toFixed(2)}` });
    }
    return { actual, expected, cumActual, cumExpected, n };
  }, [games, weekNumbers, ratingsByWeek, locks, ratingsLoading, locksLoading, team]);

  if (!data || data.n < 2) return null; // a line needs at least two games

  const diff = data.cumActual - data.cumExpected;
  return (
    <div className="table-wrap">
      <div className="section-label">{team} wins vs expected</div>
      <LineChart
        series={[
          { label: "Expected wins", color: "#8babe4", dashed: true, points: data.expected },
          { label: "Actual wins", color: "var(--gold, #d9a441)", points: data.actual },
        ]}
        xLabel="Games played (completed)"
        xTickLabel={(x) => `G${x}`}
        yFormat={(v) => v.toFixed(Number.isInteger(v) ? 0 : 1)}
        yIncludeZero
      />
      <Legend
        items={[
          { label: "Actual wins (cumulative)", color: "var(--gold, #d9a441)" },
          { label: "Expected wins from my ratings (cumulative)", color: "#8babe4", dashed: true },
        ]}
      />
      <div className="footer-note" style={{ marginTop: "0.5rem" }}>
        {data.cumActual} actual wins vs {data.cumExpected.toFixed(1)} expected ({diff > 0 ? "+" : ""}
        {diff.toFixed(1)}) through {data.n} game{data.n === 1 ? "" : "s"}. Each game adds this team's pre-game win probability to the expected line (the frozen projection
        when it was locked) and 1 to the actual line for a win. Hover a point for the game.
      </div>
    </div>
  );
}
