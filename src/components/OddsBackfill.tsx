// Backfill a whole season of team totals and period lines from The Odds API's historical feed, newest game first.
// Built on the same pieces as the per-week Historical Odds Pull below it:
//   - only markets a game doesn't already have are requested, so it never pays twice and a rerun resumes
//   - one event lookup per game day (1 credit), with a per-game lookup only if a game is missing from that day's list
//   - the odds snapshot is each game's own kickoff minus 5 minutes (closing line)
//   - The Odds API charges 10 credits per market it actually returns, so asking for markets that weren't posted costs
//     nothing; a cost guard stops the run if early games average more than expected anyway
//   - stops at the credit cap, on Stop, or on the first error; games where nothing was posted are remembered (this
//     browser) so a resume doesn't look them up again

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import {
  fetchHistoricalEventOdds,
  fetchHistoricalEvents,
  matchEventToGame,
  parseEventOdds,
  savePeriodMarketLines,
  saveHistoricalTeamTotals,
  type GameRef,
  type HistoricalEvent,
} from "../lib/api/oddsHistorical";

// Order matters: requests go out four at a time, and the first four decide whether the rest are worth asking for.
const BACKFILL_MARKETS = [
  "team_totals",
  "spreads_h1",
  "totals_h1",
  "team_totals_h1",
  "spreads_h2",
  "totals_h2",
  "spreads_q1",
  "totals_q1",
  "spreads_q2",
  "totals_q2",
  "spreads_q3",
  "totals_q3",
  "spreads_q4",
  "totals_q4",
];
const SNAP_MINUTES_BEFORE = 5;
const EXPECTED_MAX_AVG = 60; // credits per game; above this after a few games, stop and say so
const EMPTY_KEY = "oddsBackfill.empty"; // game ids that came back with nothing posted

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function loadEmpty(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EMPTY_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveEmpty(s: Set<string>) {
  try {
    localStorage.setItem(EMPTY_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // storage unavailable: a resume just looks those games up again (cheap)
  }
}

async function loadCoverage(ids: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [pl, tt] = await Promise.all([
      supabase.from("period_market_lines").select("game_id, period, market_type").in("game_id", chunk),
      supabase.from("team_total_lines").select("game_id, provider").in("game_id", chunk),
    ]);
    for (const r of (pl.data ?? []) as any[]) have.add(`${r.game_id}|${r.period}|${r.market_type}`);
    for (const r of (tt.data ?? []) as any[]) if (String(r.provider ?? "").startsWith("hist")) have.add(`${r.game_id}|tt`);
  }
  return have;
}

function covered(have: Set<string>, gameId: string, marketKey: string): boolean {
  if (marketKey === "team_totals") return have.has(`${gameId}|tt`);
  const m = /^(spreads|totals|team_totals)_(h1|h2|q1|q2|q3|q4)$/.exec(marketKey);
  if (!m) return false;
  const types = m[1] === "spreads" ? ["spread"] : m[1] === "totals" ? ["total"] : ["team_total_home", "team_total_away"];
  return types.some((t) => have.has(`${gameId}|${m[2]}|${t}`));
}

export default function OddsBackfill() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [cap, setCap] = useState(10000);
  const [games, setGames] = useState<GameWithLines[] | null>(null);
  const [have, setHave] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, spent: 0, saved: 0, remaining: null as string | null });
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setGames(null);
    (async () => {
      const g = (await fetchGamesWithLines(season)).filter(
        (x) => x.completed && x.start_date && (x.home_classification === "fbs" || x.away_classification === "fbs")
      );
      g.sort((a, b) => Date.parse(b.start_date!) - Date.parse(a.start_date!)); // newest first
      const h = await loadCoverage(g.map((x) => x.id));
      if (!cancelled) {
        setGames(g);
        setHave(h);
      }
    })().catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, reload]);

  const empty = loadEmpty();
  const todo = (games ?? []).filter((g) => !empty.has(g.id) && BACKFILL_MARKETS.some((k) => !covered(have, g.id, k)));
  const withTt = (games ?? []).filter((g) => covered(have, g.id, "team_totals")).length;
  const withH1 = (games ?? []).filter((g) => covered(have, g.id, "spreads_h1") || covered(have, g.id, "totals_h1")).length;

  async function run() {
    if (todo.length === 0) return;
    if (
      !window.confirm(
        `Backfill ${season}: up to ${todo.length} games, newest first, stopping at ${cap.toLocaleString()} credits.\n\nYou're only charged for markets the books posted (about 30 credits for a typical game: team totals + 1st-half spread and total). It stops on its own if the first games average more than ${EXPECTED_MAX_AVG}.`
      )
    )
      return;
    stopRef.current = false;
    setRunning(true);
    const lines: string[] = [];
    const push = (l: string) => {
      lines.unshift(l);
      setLog(lines.slice(0, 80));
    };
    let spent = 0;
    let saved = 0;
    let gamesCharged = 0;
    let done = 0;
    let remaining: string | null = null;
    const dayEvents = new Map<string, HistoricalEvent[]>();
    const emptySet = loadEmpty();
    const update = () => setProgress({ done, total: todo.length, spent, saved, remaining });
    update();
    try {
      for (const g of todo) {
        if (stopRef.current) {
          push("Stopped.");
          break;
        }
        const need = BACKFILL_MARKETS.filter((k) => !covered(have, g.id, k));
        const avg = gamesCharged ? spent / gamesCharged : 30;
        if (spent + Math.max(avg * 1.5, 31) > cap) {
          push(`Stopped at the ${cap.toLocaleString()}-credit cap (spent ${spent}). Press again after raising the cap or next month; it picks up here.`);
          break;
        }
        const label = `${g.away_team} @ ${g.home_team} (wk ${g.week})`;
        const kick = Date.parse(g.start_date!);
        const snap = iso(kick - SNAP_MINUTES_BEFORE * 60000);
        const ref: GameRef = { id: g.id, season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team };

        // One event list per game day: snapshot just before that day's earliest kickoff we still need.
        const dayKey = g.start_date!.slice(0, 10);
        let events = dayEvents.get(dayKey);
        if (!events) {
          const sameDay = todo.filter((x) => x.start_date!.slice(0, 10) === dayKey).map((x) => Date.parse(x.start_date!));
          const first = Math.min(...sameDay);
          const ev = await fetchHistoricalEvents(iso(first - SNAP_MINUTES_BEFORE * 60000), iso(first - 60 * 60000), iso(Math.max(...sameDay) + 60 * 60000));
          spent += Number(ev.quota.last ?? 0);
          remaining = ev.quota.remaining;
          events = ev.events;
          dayEvents.set(dayKey, events);
        }
        let match = matchEventToGame(events, ref);
        if (!match) {
          const ev = await fetchHistoricalEvents(snap, iso(kick - 30 * 60000), iso(kick + 30 * 60000));
          spent += Number(ev.quota.last ?? 0);
          remaining = ev.quota.remaining;
          match = matchEventToGame(ev.events, ref);
        }
        if (!match) {
          push(`${label}: not on the Odds API feed at kickoff, skipped`);
          emptySet.add(g.id);
          saveEmpty(emptySet);
          done++;
          update();
          continue;
        }
        // The proxy takes 4 markets per call. The first group is team totals + 1st half; the rest (2nd half,
        // quarters) is only asked for when the 1st half was posted, since quarters never are without it.
        const groups: string[][] = [];
        for (let i = 0; i < need.length; i += 4) groups.push(need.slice(i, i + 4));
        const parsed = { period: [] as ReturnType<typeof parseEventOdds>["period"], teamTotals: [] as ReturnType<typeof parseEventOdds>["teamTotals"] };
        let cost = 0;
        for (const [gi, group] of groups.entries()) {
          if (gi > 0 && !parsed.period.some((r) => r.period === "h1")) break;
          const odds = await fetchHistoricalEventOdds(match.id, snap, group);
          cost += Number(odds.quota.last ?? 0);
          remaining = odds.quota.remaining;
          const part = parseEventOdds(odds, ref, true);
          parsed.period.push(...part.period);
          parsed.teamTotals.push(...part.teamTotals);
        }
        spent += cost;
        if (cost > 0) gamesCharged++;
        if (parsed.period.length === 0 && parsed.teamTotals.length === 0) {
          push(`${label}: nothing posted (${cost} credits)`);
          emptySet.add(g.id);
          saveEmpty(emptySet);
        } else {
          const [a, b] = await Promise.all([
            parsed.period.length ? savePeriodMarketLines(parsed.period) : Promise.resolve({ saved: 0 }),
            parsed.teamTotals.length ? saveHistoricalTeamTotals(parsed.teamTotals, true) : Promise.resolve({ saved: 0 }),
          ]);
          saved += (a.saved ?? 0) + (b.saved ?? 0);
          const markets = new Set([...parsed.period.map((r) => `${r.period} ${r.market_type}`), ...(parsed.teamTotals.length ? ["team totals"] : [])]);
          push(`${label}: ${Array.from(markets).join(", ")} — ${cost} credits`);
        }
        done++;
        update();
        if (gamesCharged >= 5 && spent / gamesCharged > EXPECTED_MAX_AVG) {
          push(`Stopped: averaging ${Math.round(spent / gamesCharged)} credits a game, more than the ~30 expected. Nothing more was spent; check the log before continuing.`);
          break;
        }
      }
      if (done === todo.length) push(`Done: ${season} is backfilled.`);
    } catch (err: any) {
      push(`Stopped on an error: ${err.message ?? "request failed"} (spent ${spent}).`);
    } finally {
      update();
      setRunning(false);
      setReload((n) => n + 1);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.5rem" }}>
      <div className="section-label" style={{ marginBottom: "0.4rem" }}>
        Backfill a season (team totals + period lines)
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem", maxWidth: 860 }}>
        Every played game involving an FBS team, newest first: game team totals and 1H/2H/quarter spreads, totals and team totals as of 5 minutes
        before kickoff. Only markets a game doesn't already have are requested, and you're only charged for what the books posted (typically team
        totals + 1st half, about 30 credits a game). Stops at the cap; press again to pick up where it left off.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.85rem" }}>
        <label>
          Season{" "}
          <select value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10))} disabled={running}>
            {[new Date().getFullYear(), new Date().getFullYear() - 1].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Credit cap{" "}
          <input type="number" step={500} min={100} value={cap} onChange={(e) => setCap(Math.max(100, parseInt(e.target.value, 10) || 0))} style={{ width: 90 }} disabled={running} />
        </label>
        {!running ? (
          <button onClick={run} disabled={!games || todo.length === 0} style={{ fontWeight: 600 }}>
            {games == null ? "Loading…" : todo.length === 0 ? "Nothing left to pull" : `Backfill ${season} (${todo.length} games to go)`}
          </button>
        ) : (
          <button onClick={() => (stopRef.current = true)}>Stop</button>
        )}
        {games && (
          <span style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>
            {games.length} played games · team totals saved for {withTt} · 1st half for {withH1}
          </span>
        )}
      </div>
      {(running || progress.total > 0) && (
        <div style={{ marginTop: "0.6rem", fontSize: "0.8rem" }}>
          <div style={{ height: 6, background: "var(--a-tint-2)", borderRadius: 3, overflow: "hidden", maxWidth: 520 }}>
            <div style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%`, height: "100%", background: "var(--gold)" }} />
          </div>
          <div style={{ marginTop: "0.3rem" }}>
            {progress.done} of {progress.total} games · {progress.spent.toLocaleString()} credits spent · {progress.saved.toLocaleString()} rows saved
            {progress.remaining != null && ` · ${Number(progress.remaining).toLocaleString()} credits left this month`}
          </div>
        </div>
      )}
      {log.length > 0 && (
        <pre style={{ marginTop: "0.6rem", maxHeight: 260, overflow: "auto", fontSize: "0.72rem", background: "var(--a-tint-1)", padding: "0.5rem", borderRadius: 6, whiteSpace: "pre-wrap" }}>
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}
