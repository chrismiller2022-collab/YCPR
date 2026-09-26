import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchSeasonRatingsByWeeks } from "../lib/api/seasonWeeklyRatings";
import { fetchGameProjectionLocks, type GameProjectionLockRow } from "../lib/api/gameProjectionLocks";
import { fetchPeriodLocks, lockedPeriodValue, type PeriodLockRow } from "../lib/api/periodLocks";
import { fetchGameTotalSnapshots } from "../lib/api/gameTotalsData";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { pickLine } from "../lib/matchupsCompute";
import { billRAwayWinPct } from "../lib/moneylineBetHistory";
import { fairMoneylineFromWinPct, hfaFor } from "../lib/odds";
import { PERIOD_KEYS, buildPeriodDistribution, summarize, type PeriodKey } from "../lib/periodSim";
import { actualPeriodPoints, consensusLines, type GradePeriod, type PeriodLineRowLite } from "../lib/periodGrading";

// One matchup slate (a week's games), viewed "as of" every week of the
// season: the Wk N column is what the numbers said in week N — ratings
// archived that week for spread/moneyline, the totals snapshot saved that
// week for totals — so a week-14 game can be read as it looked in week 1,
// 2, 3 ... 14. Switching tabs keeps the picked slate.

type TabKey = "ml" | "spread" | "total" | "teamTotal" | "h1Total" | "h2Total" | "h1Spread" | "h2Spread" | "qSpread" | "qTeamTotal";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ml", label: "Moneyline" },
  { key: "spread", label: "Spread" },
  { key: "total", label: "Totals" },
  { key: "teamTotal", label: "Team Totals" },
  { key: "h1Total", label: "1H Total" },
  { key: "h2Total", label: "2H Total" },
  { key: "h1Spread", label: "1H Spread" },
  { key: "h2Spread", label: "2H Spread" },
  { key: "qSpread", label: "Quarter Spreads" },
  { key: "qTeamTotal", label: "Quarter Team Totals" },
];
const DERIVATIVE_TABS: TabKey[] = ["h1Total", "h2Total", "h1Spread", "h2Spread", "qSpread", "qTeamTotal"];
const QUARTERS: GradePeriod[] = ["q1", "q2", "q3", "q4"];

interface PeriodVals {
  awaySpread: number | null;
  total: number | null;
  awayTotal: number | null;
  homeTotal: number | null;
}

// Everything the site said about one game as of one week.
interface Snap {
  awaySpread: number | null;
  awayWinPct: number | null;
  total: number | null;
  spreadSource: "lock" | "ratings" | null;
  totalSource: "lock" | "snapshot" | null;
  // Frozen period projections (only the game's own week can have these).
  periodLock: PeriodLockRow | null;
}

const cell: CSSProperties = { padding: "0.3rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

function fmtSpread(v: number | null | undefined) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtNum(v: number | null | undefined) {
  return v == null ? "–" : v.toFixed(1);
}
function fmtMl(v: number | null | undefined) {
  if (v == null) return "–";
  const r = Math.round(v);
  return `${r > 0 ? "+" : ""}${r}`;
}
function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function periodValsFromLock(lock: PeriodLockRow, p: PeriodKey): PeriodVals {
  if (p === "game") {
    const sp = lock.game_home_spread != null ? -lock.game_home_spread : null;
    const tot = lock.game_total;
    return {
      awaySpread: sp,
      total: tot,
      awayTotal: sp != null && tot != null ? (tot - sp) / 2 : null,
      homeTotal: sp != null && tot != null ? (tot + sp) / 2 : null,
    };
  }
  const v = lockedPeriodValue(lock, p);
  return {
    awaySpread: v.awaySpread,
    total: v.total,
    awayTotal: v.awaySpread != null && v.total != null ? (v.total - v.awaySpread) / 2 : null,
    homeTotal: v.awaySpread != null && v.total != null ? (v.total + v.awaySpread) / 2 : null,
  };
}

export default function MatchupHistoryPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [tab, setTab] = useState<TabKey>("spread");
  const [quarter, setQuarter] = useState<GradePeriod>("q1");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [ratingsByWeek, setRatingsByWeek] = useState<Record<number, Record<string, number | null>>>({});
  const [gameLocks, setGameLocks] = useState<Record<string, GameProjectionLockRow>>({});
  const [periodLocks, setPeriodLocks] = useState<Record<string, PeriodLockRow>>({});
  // week -> gameId -> saved totals-model projection
  const [snapTotals, setSnapTotals] = useState<Record<number, Record<string, number | null>>>({});
  const [marketLines, setMarketLines] = useState<Record<string, Map<string, { line: number; books: number }>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ratings + totals snapshots are season-wide; load once per season.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSeasonRatingsByWeeks(season), fetchGameTotalSnapshots(season)])
      .then(([r, snaps]) => {
        if (cancelled) return;
        setRatingsByWeek(r.byWeek);
        const byWeek: Record<number, Record<string, number | null>> = {};
        for (const s of snaps) (byWeek[s.week] ??= {})[s.gameId] = s.projectedTotal;
        setSnapTotals(byWeek);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load weekly archives"));
    return () => {
      cancelled = true;
    };
  }, [season]);

  // The picked slate.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const all = await fetchGamesWithLines(season, week);
      const slate = all.filter((g) => g.home_classification === "fbs" && g.away_classification === "fbs");
      const ids = slate.map((g) => g.id);
      const [gl, pl, lineRows] = await Promise.all([
        fetchGameProjectionLocks(season, [week]),
        fetchPeriodLocks(season, week),
        ids.length
          ? supabase
              .from("period_market_lines")
              .select("game_id, period, market_type, provider, point")
              .eq("season", season)
              .in("game_id", ids)
              .then(({ data, error: e }) => {
                if (e) throw e;
                return (data ?? []) as PeriodLineRowLite[];
              })
          : Promise.resolve([] as PeriodLineRowLite[]),
      ]);
      if (cancelled) return;
      const byGame: Record<string, PeriodLineRowLite[]> = {};
      for (const r of lineRows) (byGame[r.game_id] ??= []).push(r);
      const consensus: Record<string, Map<string, { line: number; books: number }>> = {};
      for (const [id, rows] of Object.entries(byGame)) consensus[id] = consensusLines(rows);
      setGames(slate);
      setGameLocks(gl);
      setPeriodLocks(pl);
      setMarketLines(consensus);
    })()
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load matchups"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  // Columns: every week up to the picked one that has ratings or a saved
  // totals snapshot (a game can't be "as of" a week after it was played).
  const columns = useMemo(() => {
    const set = new Set<number>();
    for (const w of Object.keys(ratingsByWeek)) if (Number(w) <= week) set.add(Number(w));
    for (const w of Object.keys(snapTotals)) if (Number(w) <= week) set.add(Number(w));
    if (Object.keys(gameLocks).length > 0) set.add(week);
    return Array.from(set).sort((a, b) => a - b);
  }, [ratingsByWeek, snapTotals, gameLocks, week]);

  const snaps = useMemo(() => {
    const out: Record<string, Record<number, Snap>> = {};
    for (const g of games) {
      out[g.id] = {};
      for (const k of columns) {
        const lock = k === week ? gameLocks[g.id] : undefined;
        const r = ratingsByWeek[k];
        const away = r?.[g.away_team];
        const home = r?.[g.home_team];
        const fromRatings = away != null && home != null ? away - home + hfaFor(g.home_team, liveByTeam) : null;
        const awaySpread = lock?.my_away_spread != null ? lock.my_away_spread : fromRatings;
        const awayWinPct =
          lock?.my_away_win_pct != null ? lock.my_away_win_pct : away != null && home != null ? billRAwayWinPct(away, home) : null;
        const lockTotal = lock?.my_total ?? null;
        const snapTotal = snapTotals[k]?.[g.id] ?? null;
        out[g.id][k] = {
          awaySpread,
          awayWinPct,
          total: lockTotal ?? snapTotal,
          spreadSource: lock?.my_away_spread != null ? "lock" : fromRatings != null ? "ratings" : null,
          totalSource: lockTotal != null ? "lock" : snapTotal != null ? "snapshot" : null,
          periodLock: k === week ? periodLocks[g.id] ?? null : null,
        };
      }
    }
    return out;
  }, [games, columns, week, gameLocks, ratingsByWeek, snapTotals, periodLocks, liveByTeam]);

  // Derivative markets need the simulator (kNN over historical scoreboards)
  // for every game x week column — run lazily, only once a derivative tab is
  // open, in small batches so the page stays responsive.
  const [periodCache, setPeriodCache] = useState<Record<string, Record<PeriodKey, PeriodVals>>>({});
  const [simProgress, setSimProgress] = useState<{ done: number; total: number } | null>(null);
  const isDerivative = DERIVATIVE_TABS.includes(tab);

  function simKey(gameId: string, k: number, s: Snap) {
    return `${gameId}|${k}|${s.awaySpread?.toFixed(3)}|${s.total?.toFixed(3)}`;
  }

  useEffect(() => {
    if (!isDerivative) return;
    const todo: { key: string; g: GameWithLines; s: Snap }[] = [];
    for (const g of games) {
      for (const k of columns) {
        const s = snaps[g.id]?.[k];
        if (!s || s.periodLock || s.awaySpread == null || s.total == null) continue;
        const key = simKey(g.id, k, s);
        if (!periodCache[key]) todo.push({ key, g, s });
      }
    }
    if (todo.length === 0) {
      setSimProgress(null);
      return;
    }
    let cancelled = false;
    let i = 0;
    setSimProgress({ done: 0, total: todo.length });
    const step = () => {
      if (cancelled) return;
      const chunk = todo.slice(i, i + 6);
      const add: Record<string, Record<PeriodKey, PeriodVals>> = {};
      for (const { key, g, s } of chunk) {
        const dist = buildPeriodDistribution({ homeSpread: -(s.awaySpread as number), total: s.total as number, neutralSite: g.neutral_site });
        const vals = {} as Record<PeriodKey, PeriodVals>;
        for (const p of PERIOD_KEYS) {
          const sm = summarize(dist, p);
          vals[p] = { awaySpread: sm.meanAwaySpread, total: sm.meanTotal, awayTotal: sm.meanAwayTotal, homeTotal: sm.meanHomeTotal };
        }
        add[key] = vals;
      }
      i += chunk.length;
      setPeriodCache((prev) => ({ ...prev, ...add }));
      if (i < todo.length) {
        setSimProgress({ done: i, total: todo.length });
        setTimeout(step, 0);
      } else {
        setSimProgress(null);
      }
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
    // periodCache intentionally omitted: it only grows from this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDerivative, games, columns, snaps]);

  function periodVals(gameId: string, k: number, p: PeriodKey): PeriodVals | null {
    const s = snaps[gameId]?.[k];
    if (!s) return null;
    if (s.periodLock) return periodValsFromLock(s.periodLock, p);
    if (s.awaySpread == null || s.total == null) return null;
    return periodCache[simKey(gameId, k, s)]?.[p] ?? null;
  }

  function teamTotals(s: Snap | undefined): [number, number] | null {
    if (!s || s.awaySpread == null || s.total == null) return null;
    return [(s.total - s.awaySpread) / 2, (s.total + s.awaySpread) / 2];
  }

  // What one Wk column shows for this tab.
  function projectionCell(g: GameWithLines, k: number): string {
    const s = snaps[g.id]?.[k];
    if (!s) return "–";
    switch (tab) {
      case "ml":
        return s.awayWinPct == null ? "–" : `${fmtMl(fairMoneylineFromWinPct(s.awayWinPct))} / ${fmtMl(fairMoneylineFromWinPct(1 - s.awayWinPct))}`;
      case "spread":
        return fmtSpread(s.awaySpread);
      case "total":
        return fmtNum(s.total);
      case "teamTotal": {
        const t = teamTotals(s);
        return t ? `${fmtNum(t[0])} / ${fmtNum(t[1])}` : "–";
      }
      case "h1Total":
        return fmtNum(periodVals(g.id, k, "h1")?.total);
      case "h2Total":
        return fmtNum(periodVals(g.id, k, "h2")?.total);
      case "h1Spread":
        return fmtSpread(periodVals(g.id, k, "h1")?.awaySpread);
      case "h2Spread":
        return fmtSpread(periodVals(g.id, k, "h2")?.awaySpread);
      case "qSpread":
        return fmtSpread(periodVals(g.id, k, quarter)?.awaySpread);
      case "qTeamTotal": {
        const v = periodVals(g.id, k, quarter);
        return v && v.awayTotal != null && v.homeTotal != null ? `${fmtNum(v.awayTotal)} / ${fmtNum(v.homeTotal)}` : "–";
      }
    }
  }

  // Market + actual reference columns for this tab.
  function referenceCells(g: GameWithLines): { headers: string[]; values: string[] } {
    const line = pickLine(g.lines);
    const closeSpread = line?.spread != null ? -line.spread : null;
    const openSpread = line?.opening_spread != null ? -line.opening_spread : null;
    const done = g.completed && g.home_points != null && g.away_points != null;
    const margin = done ? (g.home_points as number) - (g.away_points as number) : null; // home - away = away-side spread equivalent
    const gameTotal = done ? (g.home_points as number) + (g.away_points as number) : null;
    const period = (p: GradePeriod) => actualPeriodPoints(g.away_line_scores, g.home_line_scores, p);
    const market = (p: GradePeriod, m: "spread" | "total") => marketLines[g.id]?.get(`${p}|${m}`)?.line ?? null;
    const impliedTT = (sp: number | null, tot: number | null): string =>
      sp != null && tot != null ? `${fmtNum((tot - sp) / 2)} / ${fmtNum((tot + sp) / 2)}` : "–";

    switch (tab) {
      case "ml":
        return {
          headers: ["Vegas ML (away / home)", "Final"],
          values: [
            line ? `${fmtMl(line.away_moneyline)} / ${fmtMl(line.home_moneyline)}` : "–",
            done ? `${(g.home_points as number) > (g.away_points as number) ? g.home_team : (g.home_points as number) < (g.away_points as number) ? g.away_team : "Tie"}` : "–",
          ],
        };
      case "spread":
        return { headers: ["Vegas Open", "Vegas Close", "Actual"], values: [fmtSpread(openSpread), fmtSpread(closeSpread), fmtSpread(margin)] };
      case "total":
        return { headers: ["Vegas Open", "Vegas Close", "Actual"], values: [fmtNum(line?.opening_over_under), fmtNum(line?.over_under), fmtNum(gameTotal)] };
      case "teamTotal":
        return {
          headers: ["Vegas implied (close)", "Actual"],
          values: [impliedTT(closeSpread, line?.over_under ?? null), done ? `${g.away_points} / ${g.home_points}` : "–"],
        };
      case "h1Total":
      case "h2Total": {
        const p: GradePeriod = tab === "h1Total" ? "h1" : "h2";
        const a = period(p);
        return { headers: ["Market (median)", "Actual"], values: [fmtNum(market(p, "total")), a ? fmtNum(a[0] + a[1]) : "–"] };
      }
      case "h1Spread":
      case "h2Spread": {
        const p: GradePeriod = tab === "h1Spread" ? "h1" : "h2";
        const a = period(p);
        return { headers: ["Market (median)", "Actual"], values: [fmtSpread(market(p, "spread")), a ? fmtSpread(a[1] - a[0]) : "–"] };
      }
      case "qSpread": {
        const a = period(quarter);
        return { headers: ["Market (median)", "Actual"], values: [fmtSpread(market(quarter, "spread")), a ? fmtSpread(a[1] - a[0]) : "–"] };
      }
      case "qTeamTotal": {
        const a = period(quarter);
        return { headers: ["Actual (away / home)"], values: [a ? `${a[0]} / ${a[1]}` : "–"] };
      }
    }
  }

  const refHeaders = games.length > 0 ? referenceCells(games[0]).headers : [];
  const twoSided = tab === "ml" || tab === "teamTotal" || tab === "qTeamTotal";

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Matchup History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Pick a week's matchups, then read them as they looked in every earlier week: the Wk N column uses the numbers from week N
        (ratings archived that week for spread and moneyline; the totals-model snapshot saved that week for totals). The picked week's own
        column uses the frozen lock when the game is locked. Halves, quarters and team totals are built from that week's spread and total.
        Spreads are the away line (negative = away favored); two-sided cells read away / home.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 70 }} />
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Matchups from week{" "}
          <input type="number" min={1} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} />
        </label>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          {loading ? "Loading…" : `${games.length} FBS-vs-FBS games · ${columns.length} week column(s)`}
          {simProgress ? ` · simulating ${simProgress.done}/${simProgress.total}…` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {TABS.map((t) => (
          <button key={t.key} className={`mode-btn ${tab === t.key ? "mode-btn-active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {(tab === "qSpread" || tab === "qTeamTotal") && (
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem" }}>
          {QUARTERS.map((q) => (
            <button key={q} className={`mode-btn ${quarter === q ? "mode-btn-active" : ""}`} onClick={() => setQuarter(q)}>
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 720, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: "left", position: "sticky", top: 0, left: 0, background: "var(--turf-panel)", zIndex: 2 }}>Game</th>
              {refHeaders.slice(0, -1).map((h) => (
                <th key={h} style={{ ...num, position: "sticky", top: 0, background: "var(--turf-panel)" }}>
                  {h}
                </th>
              ))}
              {columns.map((k) => (
                <th
                  key={k}
                  style={{
                    ...num,
                    position: "sticky",
                    top: 0,
                    background: "var(--turf-panel)",
                    color: k === week ? "#e6c34a" : undefined,
                  }}
                  title={k === week ? "The picked week — frozen lock when the game is locked" : `Numbers as of week ${k}`}
                >
                  {k === 0 ? "Pre" : `Wk ${k}`}
                  {twoSided ? " (A / H)" : ""}
                </th>
              ))}
              {refHeaders.slice(-1).map((h) => (
                <th key={h} style={{ ...num, position: "sticky", top: 0, background: "var(--turf-panel)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const ref = referenceCells(g);
              // The last reference value is always the actual/final result, shown after the week columns.
              const head = ref.values.slice(0, -1);
              const tail = ref.values.slice(-1);
              return (
                <tr key={g.id}>
                  <td style={{ ...cell, position: "sticky", left: 0, background: "var(--turf, #0b1f14)", fontWeight: 600 }}>
                    <TeamLink team={g.away_team} /> @ <TeamLink team={g.home_team} />
                    <span style={{ color: "var(--chalk-dim)", fontWeight: 400, marginLeft: "0.4rem" }}>{fmtKickoff(g.start_date)}</span>
                  </td>
                  {head.map((v, i) => (
                    <td key={i} style={num}>
                      {v}
                    </td>
                  ))}
                  {columns.map((k) => (
                    <td key={k} style={{ ...num, fontWeight: k === week ? 700 : 400 }}>
                      {projectionCell(g, k)}
                    </td>
                  ))}
                  {tail.map((v, i) => (
                    <td key={i} style={num}>
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
            {games.length === 0 && (
              <tr>
                <td colSpan={2 + columns.length + refHeaders.length} className="empty">
                  {loading ? "Loading…" : "No FBS-vs-FBS games for that week."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--chalk-dim)", fontSize: "0.75rem" }}>
        "–" means that week has nothing stored for the game: spread/moneyline need that week's archived ratings; totals need a totals snapshot
        saved that week (Totals → Save as week) or the game's own lock. Hitting "Save as week" on Totals every week is what fills the earlier
        columns for totals, team totals and every derivative tab.
      </p>
    </div>
  );
}
