import { useEffect, useState } from "react";
import {
  fetchFbsGamesForWeek,
  fetchCbsPickemPicksForWeek,
  gradeCbsPickemPick,
  type CbsPickemPickWithGame,
} from "../lib/api/cbsPickemPool";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

async function cbsPickemSave(body: any) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "cbspickem", ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

function fmt(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

const MAX_GAMES = 10;

function GameSelectionStep({
  season,
  week,
  onSaved,
  refreshToken,
}: {
  season: number;
  week: number;
  onSaved: () => void;
  refreshToken: number;
}) {
  const [available, setAvailable] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyGameId, setKeyGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([fetchFbsGamesForWeek(season, week), fetchCbsPickemPicksForWeek(season, week)])
      .then(([games, picks]) => {
        setAvailable(games);
        setSelected(new Set(picks.map((p) => p.game_id)));
        setKeyGameId(picks.find((p) => p.is_key_game)?.game_id ?? null);
      })
      .catch((err) => setError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [season, week, refreshToken]);

  function toggle(gameId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
        if (keyGameId === gameId) setKeyGameId(null);
      } else {
        if (next.size >= MAX_GAMES) return prev;
        next.add(gameId);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await cbsPickemSave({ action: "selectGames", season, week, gameIds: Array.from(selected), keyGameId });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetGames() {
    if (!confirm("Clear this week's selected games? Any picks made will be removed too.")) return;
    setSaving(true);
    setError(null);
    try {
      await cbsPickemSave({ action: "selectGames", season, week, gameIds: [], keyGameId: null });
      setSelected(new Set());
      setKeyGameId(null);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading games…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="section-label">
          1. Select this week's games (FBS vs FBS){" "}
          <span style={{ color: selected.size >= MAX_GAMES ? "#a15c00" : "var(--chalk-dim)", fontWeight: 400 }}>
            · {selected.size}/{MAX_GAMES}
          </span>
        </div>
        <button className="menu-btn" onClick={handleResetGames} disabled={saving}>
          Reset games
        </button>
      </div>
      {available.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No FBS-vs-FBS games saved for {season} week {week} yet — sync this week from Games &
          Lines first.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
          {available.map((g) => {
            const atCap = selected.size >= MAX_GAMES && !selected.has(g.id);
            return (
              <label
                key={g.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  padding: "0.45rem 0.6rem",
                  border: "1px solid var(--hash)",
                  borderRadius: 6,
                  background: selected.has(g.id) ? "var(--turf-panel)" : "transparent",
                  opacity: atCap ? 0.4 : 1,
                }}
              >
                <input type="checkbox" checked={selected.has(g.id)} disabled={atCap} onChange={() => toggle(g.id)} />
                <span style={{ flex: 1 }}>
                  {g.away_team} @ {g.home_team}
                </span>
                {selected.has(g.id) && (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem" }}>
                    <input type="radio" name="key-game" checked={keyGameId === g.id} onChange={() => setKeyGameId(g.id)} />
                    Key game (tiebreaker)
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      <button onClick={handleSave} disabled={saving || selected.size === 0}>
        {saving ? "Saving…" : "Save selected games"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

function PickingStep({ season, week, refreshToken }: { season: number; week: number; refreshToken: number }) {
  const [picks, setPicks] = useState<CbsPickemPickWithGame[]>([]);
  const [draft, setDraft] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  function load() {
    setLoading(true);
    fetchCbsPickemPicksForWeek(season, week, liveByTeam)
      .then((data) => {
        setPicks(data);
        const d: Record<number, any> = {};
        for (const p of data) {
          d[p.id] = { picked_side: p.picked_side };
        }
        setDraft(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [season, week, refreshToken]);

  function updateDraft(id: number, patch: any) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(draft).map(([id, v]: any) => ({ id: Number(id), ...v }));
      await cbsPickemSave({ action: "savePicks", picks: payload });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPicks() {
    if (!confirm("Clear all picks for this week? The game list stays as-is.")) return;
    setSaving(true);
    setError(null);
    try {
      await cbsPickemSave({ action: "resetPicks", season, week });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading picks…</p>;
  if (picks.length === 0) return null;

  const record = picks.reduce(
    (acc, p) => {
      const g = gradeCbsPickemPick(p);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div className="section-label">
          2. Pick against the spread{" "}
          <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>
            · Record: {record.wins}-{record.losses}
            {record.pushes > 0 ? `-${record.pushes}` : ""}
          </span>
        </div>
        <button className="menu-btn" onClick={handleResetPicks} disabled={saving}>
          Reset picks
        </button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Game</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Projection</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>CBS Spread</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Pick</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => {
              const g = p.game;
              if (!g) return null;
              const d = draft[p.id] ?? {};
              const grade = gradeCbsPickemPick(p);

              return (
                <tr key={p.id} style={{ background: p.is_key_game ? "var(--gold-dim)" : undefined }}>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {g.away_team} @ {g.home_team}
                    {p.is_key_game && (
                      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
                        Key game{p.vegasTotal != null ? ` · Vegas Total ${p.vegasTotal}` : ""}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: p.myProjAwaySpread != null ? spreadColor(p.myProjAwaySpread) : undefined,
                    }}
                  >
                    {fmt(p.myProjAwaySpread)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmt(p.cbsAwaySpread)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        className="menu-btn"
                        style={{ opacity: d.picked_side === "away" ? 1 : 0.5 }}
                        onClick={() => updateDraft(p.id, { picked_side: "away" })}
                      >
                        {g.away_team}
                      </button>
                      <button
                        className="menu-btn"
                        style={{ opacity: d.picked_side === "home" ? 1 : 0.5 }}
                        onClick={() => updateDraft(p.id, { picked_side: "home" })}
                      >
                        {g.home_team}
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {grade === "pending" ? "–" : grade === "win" ? "✅ Win" : grade === "push" ? "Push" : "❌ Loss"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.75rem" }}>
        {saving ? "Saving…" : "Save picks"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

export default function CbsPickemPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>CBS Pickem</h2>
        <a
          href="https://picks.cbssports.com/college-football/pickem/challenge?entryId=ivxhi4tzhizdkmjqgy3tcmbu"
          target="_blank"
          rel="noopener noreferrer"
          className="menu-btn"
          style={{ textDecoration: "none" }}
        >
          Open CBS Pickem ↗
        </a>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Pick against CBS's own spread for each game. The key game shows the Vegas Total
        purely as a reference.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
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
      </div>

      <GameSelectionStep season={season} week={week} refreshToken={refreshKey} onSaved={() => setRefreshKey((k) => k + 1)} />
      <PickingStep season={season} week={week} refreshToken={refreshKey} />
    </div>
  );
}
