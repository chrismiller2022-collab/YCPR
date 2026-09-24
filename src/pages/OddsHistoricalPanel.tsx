import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import {
  fetchHistoricalEventOdds,
  fetchHistoricalEvents,
  matchEventToGame,
  parseEventOdds,
  savePeriodMarketLines,
  saveHistoricalTeamTotals,
  type GameRef,
} from "../lib/api/oddsHistorical";

// Manual, credit-costing pull of PAST games' additional markets (game-level
// team totals and 1H/2H/quarter markets) from The Odds API's historical
// endpoint, saved once and never re-pulled. Cost is 10 credits per market
// per game (+1 to look up the event id), so this shows the estimate, asks,
// and stops on the first error. Additional-market history only exists from
// 2023-05-03 onward.

const MARKET_OPTIONS: { key: string; label: string }[] = [
  { key: "team_totals", label: "Team totals (game)" },
  { key: "spreads_h1", label: "1H spread" },
  { key: "totals_h1", label: "1H total" },
  { key: "team_totals_h1", label: "1H team totals" },
  { key: "spreads_h2", label: "2H spread" },
  { key: "totals_h2", label: "2H total" },
  { key: "totals_q1", label: "Q1 total" },
  { key: "spreads_q1", label: "Q1 spread" },
];
const MAX_MARKETS = 4;
const MAX_GAMES = 60;

function fmtKick(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OddsHistoricalPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(2024);
  const [week, setWeek] = useState(4);
  const [games, setGames] = useState<GameWithLines[]>([]);
  // Keys already saved: "<gameId>|tt" for game-level team totals, "<gameId>|<period>|<market_type>" for period markets.
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [markets, setMarkets] = useState<Set<string>>(new Set(["spreads_h1", "totals_h1"]));
  const [minutesBefore, setMinutesBefore] = useState(5);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [spent, setSpent] = useState(0);
  const [remaining, setRemaining] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPicked(new Set());
    (async () => {
      const g = (await fetchGamesWithLines(season, week)).filter((x) => x.home_classification === "fbs" && x.away_classification === "fbs");
      g.sort((a, b) => new Date(a.start_date ?? 0).getTime() - new Date(b.start_date ?? 0).getTime());
      const ids = g.map((x) => x.id);
      const [pl, tt] = ids.length
        ? await Promise.all([
            supabase.from("period_market_lines").select("game_id, period, market_type").in("game_id", ids),
            supabase.from("team_total_lines").select("game_id").in("game_id", ids),
          ])
        : [{ data: [] }, { data: [] }];
      if (cancelled) return;
      setGames(g);
      setPulled(
        new Set([
          ...(pl.data ?? []).map((r: any) => `${r.game_id}|${r.period}|${r.market_type}`),
          ...(tt.data ?? []).map((r: any) => `${r.game_id}|tt`),
        ])
      );
    })().catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, week, reloadTick]);

  const marketList = Array.from(markets);

  // Which saved-row key a chosen market would produce (team totals by period is stored per side, either side counts).
  function covered(gameId: string, marketKey: string): boolean {
    if (marketKey === "team_totals") return pulled.has(`${gameId}|tt`);
    const m = /^(spreads|totals|team_totals)_(h1|h2|q1|q2|q3|q4)$/.exec(marketKey);
    if (!m) return false;
    const type = m[1] === "spreads" ? ["spread"] : m[1] === "totals" ? ["total"] : ["team_total_home", "team_total_away"];
    return type.some((t) => pulled.has(`${gameId}|${m[2]}|${t}`));
  }
  const isDone = (gameId: string) => marketList.length > 0 && marketList.every((k) => covered(gameId, k));
  const estimate = picked.size * (1 + 10 * marketList.length);
  const monthly = 20000;

  function toggleMarket(k: string) {
    setMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else if (next.size < MAX_MARKETS) next.add(k);
      return next;
    });
  }
  function toggleGame(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_GAMES) next.add(id);
      return next;
    });
  }

  const chosen = useMemo(() => games.filter((g) => picked.has(g.id)), [games, picked]);

  async function handleRun() {
    if (chosen.length === 0 || marketList.length === 0) return;
    if (
      !window.confirm(
        `Pull ${marketList.join(", ")} for ${chosen.length} game(s)?\n\nEstimated cost up to ${estimate} credits (10 per market per game, +1 per event lookup; games with no data cost nothing). This is real spend against your ${monthly.toLocaleString()}/month plan.`
      )
    )
      return;
    setRunning(true);
    setLog([]);
    setSpent(0);
    const lines: string[] = [];
    const push = (l: string) => {
      lines.push(l);
      setLog([...lines]);
    };
    try {
      for (const g of chosen) {
        const label = `${g.away_team} @ ${g.home_team}`;
        if (!g.start_date) {
          push(`${label}: no kickoff time, skipped`);
          continue;
        }
        // Only ask for markets this game doesn't already have saved — never pay twice.
        const need = marketList.filter((k) => !covered(g.id, k));
        if (need.length === 0) {
          push(`${label}: already saved, skipped`);
          continue;
        }
        const kick = new Date(g.start_date).getTime();
        const snap = new Date(kick - minutesBefore * 60000).toISOString();
        const from = new Date(kick - 30 * 60000).toISOString();
        const to = new Date(kick + 30 * 60000).toISOString();
        const ref: GameRef = { id: g.id, season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team };

        const ev = await fetchHistoricalEvents(snap, from, to);
        setRemaining(ev.quota.remaining);
        setSpent((s) => s + Number(ev.quota.last ?? 0));
        const match = matchEventToGame(ev.events, ref);
        if (!match) {
          push(`${label}: no matching Odds API event at that time (${ev.events.length} events listed)`);
          continue;
        }
        const odds = await fetchHistoricalEventOdds(match.id, snap, need);
        setRemaining(odds.quota.remaining);
        setSpent((s) => s + Number(odds.quota.last ?? 0));
        const parsed = parseEventOdds(odds, ref, true);
        const books = new Set([...parsed.period.map((r) => r.provider), ...parsed.teamTotals.map((r) => r.provider)]);
        let savedNote = "nothing posted";
        if (parsed.period.length > 0 || parsed.teamTotals.length > 0) {
          const [a, b] = await Promise.all([
            parsed.period.length ? savePeriodMarketLines(parsed.period) : Promise.resolve({ saved: 0 }),
            parsed.teamTotals.length ? saveHistoricalTeamTotals(parsed.teamTotals) : Promise.resolve({ saved: 0 }),
          ]);
          savedNote = `saved ${a.saved} period + ${b.saved} team-total rows`;
        }
        push(`${label}: ${books.size} book(s) [${Array.from(books).join(", ") || "none"}] — ${savedNote} (snapshot ${odds.timestamp ?? snap})`);
      }
    } catch (err: any) {
      push(`Stopped: ${err.message ?? "request failed"}`);
    } finally {
      setRunning(false);
      setReloadTick((n) => n + 1);
    }
  }

  const cell = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", fontSize: "0.78rem" };

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Historical Odds Pull</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Manual, one-time pull of PAST games' game-level team totals and 1H/2H/quarter markets from The Odds API's historical endpoint.
        Costs 10 credits per market per game (+1 for the event lookup); a game already saved is disabled so it can't be pulled twice.
        History for these markets only exists from May 2023 onward. Start with a few games to see which books post what.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.8rem" }}>
        <label>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" min={1} max={16} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)} style={{ width: 60 }} />
        </label>
        <label title="Snapshot taken this many minutes before kickoff (a proxy for the closing line)">
          Snapshot <input type="number" min={1} max={120} value={minutesBefore} onChange={(e) => setMinutesBefore(parseInt(e.target.value, 10) || 5)} style={{ width: 55 }} /> min before kickoff
        </label>
      </div>

      <div style={{ marginBottom: "0.8rem", fontSize: "0.82rem" }}>
        <div style={{ color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>Markets — {marketList.length} of {MAX_MARKETS} selected{marketList.length >= MAX_MARKETS ? " (uncheck one to pick another; extra markets can go in a second pull)" : ""}:</div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {MARKET_OPTIONS.map((m) => (
            <label key={m.key} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" checked={markets.has(m.key)} disabled={!markets.has(m.key) && marketList.length >= MAX_MARKETS} onChange={() => toggleMarket(m.key)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
        <button className="menu-btn" onClick={handleRun} disabled={running || picked.size === 0 || marketList.length === 0}>
          {running ? "Pulling…" : `Pull ${picked.size} game(s)`}
        </button>
        <span style={{ fontSize: "0.82rem" }}>
          Estimated max cost: <b>{estimate}</b> credits
        </span>
        {(spent > 0 || remaining != null) && (
          <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
            Spent this run: {spent} · remaining: {remaining ?? "?"}
          </span>
        )}
      </div>

      {log.length > 0 && (
        <pre style={{ fontSize: "0.76rem", whiteSpace: "pre-wrap", border: "1px solid var(--hash)", borderRadius: 8, padding: "0.6rem 0.8rem", marginBottom: "1rem" }}>
          {log.join("\n")}
        </pre>
      )}

      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cell}> </th>
              <th style={{ ...cell, textAlign: "left" }}>Kickoff</th>
              <th style={{ ...cell, textAlign: "left" }}>Game</th>
              <th style={{ ...cell, textAlign: "left" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const done = isDone(g.id);
              return (
                <tr key={g.id}>
                  <td style={cell}>
                    <input type="checkbox" disabled={done || running} checked={picked.has(g.id)} onChange={() => toggleGame(g.id)} />
                  </td>
                  <td style={cell}>{fmtKick(g.start_date)}</td>
                  <td style={cell}>
                    <TeamLink team={g.away_team} size={16} /> @ <TeamLink team={g.home_team} size={16} />
                  </td>
                  <td style={{ ...cell, color: done ? "var(--gold, #d9a441)" : "var(--chalk-dim)" }}>{done ? "Saved" : marketList.some((k) => covered(g.id, k)) ? "Partly saved" : "Not pulled"}</td>
                </tr>
              );
            })}
            {games.length === 0 && (
              <tr>
                <td style={cell} colSpan={4}>
                  No FBS-vs-FBS games for this season/week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
