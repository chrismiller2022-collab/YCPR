import { useRef, useState } from "react";
import { pullDrogba } from "../../lib/api/drogbaData";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import DrogbaFanDuelSection from "./DrogbaFanDuelSection";
import { CELL, DIM, H3, NUM, P } from "./shared";

const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];
const MAX_WEEK = 15; // regular season weeks CFBD uses for FBS (week 15 = championship games / Army-Navy)
const PLAY_MAX_WEEK = 16; // a couple of seasons have a week-16 game

export default function DrogbaDataTab({ state }: { state: DrogbaState }) {
  const [picked, setPicked] = useState<Record<number, boolean>>({ 2021: true, 2022: true, 2023: true, 2024: true, 2025: true, 2026: true });
  // Per-game advanced stats and preseason inputs are already loaded for 2021-26, so only the play-level pull is on by
  // default — each of these is a CFBD call and the free plan has 1,000 a month.
  const [doAdv, setDoAdv] = useState(false);
  const [doPre, setDoPre] = useState(false);
  const [doPlays, setDoPlays] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const [testSeason, setTestSeason] = useState(2025);
  const [testWeek, setTestWeek] = useState(6);
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<string | null>(null);

  // One play-level call (1 CFBD call) so the response shape can be checked before the full pull.
  async function runPlayTest() {
    setTesting(true);
    setTestOut(null);
    setError(null);
    try {
      const r = await pullDrogba("plays", testSeason, testWeek);
      const p = r.plays;
      if (!p) throw new Error("No plays section in the response");
      const cov = p.ppaCoverage;
      setTestOut(
        `${testSeason} week ${testWeek}: ${p.fetched.toLocaleString()} plays pulled → ${p.teamGames} team-games saved (${p.scrimmage.toLocaleString()} scrimmage plays kept, ${p.garbageDropped.toLocaleString()} garbage-time dropped). ` +
          `PPA present on ${cov.scrimmage == null ? "?" : Math.round(cov.scrimmage * 100)}% of scrimmage plays and ${cov.specialTeams == null ? "?" : Math.round(cov.specialTeams * 100)}% of special-teams plays. ` +
          `Net punt ${p.kicks.puntNetAvg == null ? "?" : p.kicks.puntNetAvg.toFixed(1)} yds (next snap found for ${p.kicks.puntNetCoverage == null ? "?" : Math.round(p.kicks.puntNetCoverage * 100)}% of punts), net kickoff ${p.kicks.koNetAvg == null ? "?" : p.kicks.koNetAvg.toFixed(1)} yds (${p.kicks.koNetCoverage == null ? "?" : Math.round(p.kicks.koNetCoverage * 100)}%) — both should sit near 38–42. ` +
          `Play types: ${p.topPlayTypes.map(([t, n]) => `${t} ${n}`).join(", ")}.${r.warnings?.length ? ` Warnings: ${r.warnings.join("; ")}` : ""}\nSample row: ${JSON.stringify(p.sample)}`
      );
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const seasons = SEASONS.filter((s) => picked[s]);
  // Don't spend calls on weeks that haven't been played yet.
  const lastWeekOf = (season: number, cap: number) => {
    const done = state.games.filter((g) => g.season === season && g.completed).map((g) => g.week);
    return done.length ? Math.min(cap, Math.max(...done)) : cap;
  };
  const requests = seasons.reduce((n, season) => n + (doAdv ? lastWeekOf(season, MAX_WEEK) : 0) + (doPre ? 1 : 0) + (doPlays ? lastWeekOf(season, PLAY_MAX_WEEK) : 0), 0);
  const playCalls = seasons.reduce((n, season) => n + lastWeekOf(season, PLAY_MAX_WEEK), 0);

  async function run() {
    stop.current = false;
    setRunning(true);
    setError(null);
    setLog([]);
    const add = (line: string) => setLog((l) => [...l, line]);
    try {
      for (const season of seasons) {
        if (doPre) {
          if (stop.current) break;
          const r = await pullDrogba("preseason", season, null);
          add(`${season} preseason inputs: ${r.preseason?.teams ?? 0} teams (${Object.entries(r.preseason?.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")})${r.warnings?.length ? ` — ${r.warnings.join("; ")}` : ""}`);
        }
        if (doAdv) {
          let total = 0;
          let withPpa = 0;
          for (let w = 1; w <= lastWeekOf(season, MAX_WEEK); w++) {
            if (stop.current) break;
            const r = await pullDrogba("gameadv", season, w);
            total += r.gameAdv?.saved ?? 0;
            withPpa += r.gameAdv?.withPpa ?? 0;
          }
          add(`${season} per-game advanced: ${total} team-games saved (${withPpa} with PPA)`);
        }
        if (doPlays) {
          let teamGames = 0;
          let plays = 0;
          let garbage = 0;
          let firstDiag: string | null = null;
          for (let w = 1; w <= lastWeekOf(season, PLAY_MAX_WEEK); w++) {
            if (stop.current) break;
            const r = await pullDrogba("plays", season, w);
            const p = r.plays;
            if (!p) continue;
            teamGames += p.saved;
            plays += p.fetched;
            garbage += p.garbageDropped;
            if (!firstDiag && p.fetched > 0) {
              const cov = p.ppaCoverage;
              firstDiag = `PPA on ${cov.scrimmage == null ? "?" : Math.round(cov.scrimmage * 100)}% of scrimmage plays and ${cov.specialTeams == null ? "?" : Math.round(cov.specialTeams * 100)}% of special-teams plays; most common play types: ${p.topPlayTypes.slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ")}${r.warnings?.length ? ` — ${r.warnings.join("; ")}` : ""}`;
            }
          }
          add(`${season} plays: ${plays.toLocaleString()} plays pulled, ${teamGames} team-games saved, ${garbage.toLocaleString()} garbage-time plays dropped`);
          if (firstDiag) add(`   ${firstDiag}`);
        }
      }
      add(stop.current ? "Stopped." : "Done — reloading ratings…");
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Pull failed");
    } finally {
      setRunning(false);
    }
  }

  const cov = state.engine?.coverage ?? [];
  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Data & sync</h2>
      <p style={P}>
        The model needs three things per season. Games and lines are already in the database for 2021–26 (opening lines are Bovada's, the only book with an open on ~99% of FBS games every year).
        What's missing is <strong>per-game advanced stats</strong> (the walk-forward efficiency ratings) and <strong>preseason inputs</strong> (returning production, talent, recruiting, portal) for 2021–25. The
        buttons below pull them from CFBD through the server (uses your existing CFBD key). Every pull is an upsert, so re-running is safe.
      </p>

      <h3 style={H3}>Coverage (completed FBS-vs-FBS games)</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Season</th>
              <th style={NUM}>Games</th>
              <th style={NUM}>With opening line</th>
              <th style={NUM}>With per-game advanced</th>
              <th style={NUM}>With play-level</th>
              <th style={NUM}>Preseason teams</th>
            </tr>
          </thead>
          <tbody>
            {cov.map((c) => (
              <tr key={c.season}>
                <td style={CELL}>{c.season}</td>
                <td style={NUM}>{c.fbsGames}</td>
                <td style={NUM}>{c.withOpen} ({c.fbsGames ? Math.round((100 * c.withOpen) / c.fbsGames) : 0}%)</td>
                <td style={NUM}>{c.withAdv} ({c.fbsGames ? Math.round((100 * c.withAdv) / c.fbsGames) : 0}%)</td>
                <td style={NUM}>{c.withPlays} ({c.fbsGames ? Math.round((100 * c.withPlays) / c.fbsGames) : 0}%)</td>
                <td style={NUM}>{c.preseasonTeams}</td>
              </tr>
            ))}
            {cov.length === 0 && (
              <tr>
                <td style={CELL} colSpan={6}>{state.loading ? "Loading…" : state.building ? "Building ratings…" : "No data"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={H3}>Backfill from CFBD</h3>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {SEASONS.map((s) => (
          <label key={s} style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" checked={!!picked[s]} onChange={(e) => setPicked({ ...picked, [s]: e.target.checked })} disabled={running} /> {s}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          <input type="checkbox" checked={doAdv} onChange={(e) => setDoAdv(e.target.checked)} disabled={running} /> Per-game advanced stats (one request per week)
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          <input type="checkbox" checked={doPre} onChange={(e) => setDoPre(e.target.checked)} disabled={running} /> Preseason inputs (4 CFBD calls per season in one request)
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          <input type="checkbox" checked={doPlays} onChange={(e) => setDoPlays(e.target.checked)} disabled={running} /> Play-level (one request per week: garbage-time-filtered success rate, isolated explosiveness, special teams)
        </label>
      </div>
      <p style={DIM}>
        This will make {requests} requests to the sync endpoint, each one CFBD call
        {doPlays ? ` (${playCalls} of them play-level: each is a big download, a few seconds)` : ""}. Only weeks that have been played are pulled. Safe to stop and resume. The free CFBD plan is 1,000 calls a month, so check your CFBD dashboard first;
        a full play-level pull for 2021–26 is about {playCalls} calls. Per-game advanced stats and preseason inputs are already loaded for every season, so they're off by default — tick them only to refresh.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.85rem" }}>Test the play-level pull first (1 CFBD call):</span>
        <select className="filter" value={testSeason} onChange={(e) => setTestSeason(Number(e.target.value))} disabled={testing || running}>
          {SEASONS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select className="filter" value={testWeek} onChange={(e) => setTestWeek(Number(e.target.value))} disabled={testing || running}>
          {Array.from({ length: PLAY_MAX_WEEK }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        <button className="menu-btn" onClick={runPlayTest} disabled={testing || running}>
          {testing ? "Testing…" : "Test one week"}
        </button>
      </div>
      {testOut && <pre style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", color: "var(--chalk-dim)", marginTop: 0 }}>{testOut}</pre>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="menu-btn" onClick={run} disabled={running || requests === 0}>
          {running ? "Pulling…" : "Run backfill"}
        </button>
        {running && (
          <button className="menu-btn" onClick={() => (stop.current = true)}>
            Stop after this request
          </button>
        )}
        <button className="menu-btn" onClick={state.reload} disabled={running}>
          Reload ratings
        </button>
      </div>
      {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
      {log.length > 0 && (
        <pre style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", color: "var(--chalk-dim)" }}>{log.join("\n")}</pre>
      )}
      <p style={DIM}>
        Note: the preseason endpoints (returning production, talent, recruiting, portal) follow CFBD's published response shapes but I could not test them against a live response from here. If a count comes back 0
        for a source, the line above says so — tell me and I'll fix the field mapping.
      </p>

      <DrogbaFanDuelSection state={state} />
    </div>
  );
}
