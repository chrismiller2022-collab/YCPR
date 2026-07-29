import { useEffect, useState } from "react";
import { fetchGamesWithLines, fetchSyncedWeeks, type GameWithLines } from "../lib/api/gamesLines";

function dateLabel(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

export default function GamesLinesPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [syncedWeeks, setSyncedWeeks] = useState<{ season: number; week: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  function loadView() {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchGamesWithLines(season, week), fetchSyncedWeeks()])
      .then(([g, weeks]) => {
        setGames(g);
        setSyncedWeeks(weeks);
      })
      .catch((err) => setLoadError(err.message ?? "Failed to load games/lines"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const storedPassword = sessionStorage.getItem("admin_password") ?? "";
      const res = await fetch("/api/cfbd-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: storedPassword, year: season, week }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? "Sync failed");
      } else {
        setSyncResult(
          `Synced ${data.gamesUpserted} games and ${data.linesUpserted} lines for ${data.year} week ${data.week}.`
        );
        loadView();
      }
    } catch (err: any) {
      setSyncError(err.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Games & Lines</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Games and betting lines pulled from CFBD, stored in Supabase. Sync pulls fresh
        data for the selected season/week; the table below always reflects what's
        currently saved.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", margin: "1rem 0" }}>
        <label>
          Season{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)}
            style={{ width: 90 }}
          />
        </label>
        <label>
          Week{" "}
          <input
            type="number"
            min={1}
            max={16}
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)}
            style={{ width: 70 }}
          />
        </label>

        <button onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync from CFBD"}
        </button>
        <button className="menu-btn" onClick={loadView} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh view"}
        </button>
      </div>

      {syncResult && <p style={{ color: "green" }}>{syncResult}</p>}
      {syncError && <p style={{ color: "crimson" }}>{syncError}</p>}
      {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}

      {syncedWeeks.length > 0 && (
        <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Synced so far:{" "}
          {syncedWeeks
            .slice(0, 8)
            .map((w) => `${w.season} wk${w.week}`)
            .join(", ")}
          {syncedWeeks.length > 8 ? "…" : ""}
        </p>
      )}

      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginTop: "1rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>Date</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>Away</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>Home</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>Score</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>Lines (provider · spread · O/U)</th>
            </tr>
          </thead>
          <tbody>
            {games.length === 0 && !loading && (
              <tr>
                <td colSpan={5} style={{ padding: "1rem", textAlign: "center", color: "var(--chalk-dim)" }}>
                  No games saved for {season} week {week} yet — try Sync from CFBD.
                </td>
              </tr>
            )}
            {games.map((g) => (
              <tr key={g.id}>
                <td style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>{dateLabel(g.start_date)}</td>
                <td style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>{g.away_team}</td>
                <td style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>
                  {g.neutral_site ? "* " : ""}
                  {g.home_team}
                </td>
                <td style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {g.away_points != null && g.home_points != null ? `${g.away_points}-${g.home_points}` : "–"}
                </td>
                <td style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--hash)" }}>
                  {g.lines.length === 0
                    ? "–"
                    : g.lines
                        .map(
                          (l) =>
                            `${l.provider} · ${l.spread != null ? l.spread : "–"} · ${
                              l.over_under != null ? l.over_under : "–"
                            }`
                        )
                        .join("  |  ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="footer-note" style={{ marginTop: "0.75rem" }}>
        * = neutral site. Lines shown are whatever CFBD returned for that game — usually
        one row per sportsbook that reported a line.
      </div>
    </div>
  );
}
