import { useRef, useState } from "react";
import { pullDrogba } from "../../lib/api/drogbaData";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P } from "./shared";

const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];
const MAX_WEEK = 15; // regular season weeks CFBD uses for FBS (week 15 = championship games / Army-Navy)

export default function DrogbaDataTab({ state }: { state: DrogbaState }) {
  const [picked, setPicked] = useState<Record<number, boolean>>({ 2021: true, 2022: true, 2023: true, 2024: true, 2025: true, 2026: true });
  const [doAdv, setDoAdv] = useState(true);
  const [doPre, setDoPre] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const seasons = SEASONS.filter((s) => picked[s]);
  const requests = (doAdv ? seasons.length * MAX_WEEK : 0) + (doPre ? seasons.length : 0);

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
          for (let w = 1; w <= MAX_WEEK; w++) {
            if (stop.current) break;
            const r = await pullDrogba("gameadv", season, w);
            total += r.gameAdv?.saved ?? 0;
            withPpa += r.gameAdv?.withPpa ?? 0;
          }
          add(`${season} per-game advanced: ${total} team-games saved (${withPpa} with PPA)`);
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
                <td style={NUM}>{c.preseasonTeams}</td>
              </tr>
            ))}
            {cov.length === 0 && (
              <tr>
                <td style={CELL} colSpan={5}>{state.loading ? "Loading…" : state.building ? "Building ratings…" : "No data"}</td>
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
      </div>
      <p style={DIM}>
        This will make {requests} requests to the sync endpoint{doAdv ? ` (each week of per-game stats is one CFBD call; ${seasons.length * MAX_WEEK} total)` : ""}
        {doPre ? ` plus ${seasons.length * 4} CFBD calls for preseason inputs` : ""}. Weeks with no games just return empty. Safe to stop and resume.
      </p>
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
    </div>
  );
}
