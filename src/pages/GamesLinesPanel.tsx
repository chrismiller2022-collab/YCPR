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

function pctLabel(v: number | null) {
  return v != null ? `${(v * 100).toFixed(0)}%` : "–";
}

export default function GamesLinesPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [wholeSeason, setWholeSeason] = useState(false);
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
    Promise.all([fetchGamesWithLines(season, wholeSeason ? undefined : week), fetchSyncedWeeks()])
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
  }, [season, week, wholeSeason]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const storedPassword = sessionStorage.getItem("admin_password") ?? "";
      const res = await fetch("/api/cfbd-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: storedPassword,
          year: season,
          week: wholeSeason ? null : week,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? "Sync failed");
      } else {
        const skippedNote =
          data.gamesSkippedByDivision > 0
            ? ` (${data.gamesSkippedByDivision} skipped — below FCS on both sides)`
            : "";
        setSyncResult(
          `Synced ${data.gamesUpserted} games and ${data.linesUpserted} lines for ${data.year}${
            data.week === "all" ? " (whole season)" : ` week ${data.week}`
          }.${skippedNote}`
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
        Games and betting lines pulled from CFBD, stored in Supabase. Includes FBS vs FBS,
        FBS vs FCS, FCS vs FCS, and FCS vs other-division games — games where both sides
        are below FCS (e.g. D2 vs D2) are skipped since we don't track ratings for those
        teams anyway.
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

        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={wholeSeason}
            onChange={(e) => setWholeSeason(e.target.checked)}
          />
          Whole season
        </label>

        {!wholeSeason && (
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
        )}

        <button onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing…" : wholeSeason ? "Sync whole season from CFBD" : "Sync from CFBD"}
        </button>
        <button className="menu-btn" onClick={loadView} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh view"}
        </button>
      </div>

      {wholeSeason && (
        <p style={{ fontSize: "0.78rem", color: "#a15c00" }}>
          A whole-season sync pulls every FBS/FCS-involved game for the year in one call —
          it can take a while and may be more prone to timing out than a single week. If it
          fails partway, re-running is safe; already-saved games and lines just get
          overwritten with the same or fresher data.
        </p>
      )}

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
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Date</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Wk</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Away</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Home</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Score</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Status</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win % (H/A)</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Lines (provider · spread · O/U)</th>
            </tr>
          </thead>
          <tbody>
            {games.length === 0 && !loading && (
              <tr>
                <td colSpan={8} style={{ padding: "1rem", textAlign: "center", color: "var(--chalk-dim)" }}>
                  No games saved for this selection yet — try Sync from CFBD.
                </td>
              </tr>
            )}
            {games.map((g) => (
              <tr key={g.id}>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{dateLabel(g.start_date)}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{g.week}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  {g.away_team}
                  <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}> ({g.away_classification ?? "?"})</span>
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  {g.neutral_site ? "* " : ""}
                  {g.home_team}
                  <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}> ({g.home_classification ?? "?"})</span>
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {g.away_points != null && g.home_points != null ? `${g.away_points}-${g.home_points}` : "–"}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  {g.completed ? "Final" : "Scheduled"}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {pctLabel(g.home_postgame_win_probability)} / {pctLabel(g.away_postgame_win_probability)}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
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
        * = neutral site. Win % is CFBD's own postgame win probability model (only
        populated for completed games). Lines shown are whatever CFBD returned — usually
        one row per sportsbook that reported a line.
      </div>
    </div>
  );
}
