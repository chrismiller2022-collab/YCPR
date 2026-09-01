import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadColor } from "../lib/odds";
import { formatProjectedScore } from "../lib/gameTotals";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import {
  fetchFbsGamesForWeek,
  fetchEspnConfidencePicksForWeek,
  gradeEspnConfidencePick,
  summarizeConfidencePoints,
  type EspnConfidencePickWithGame,
} from "../lib/api/espnConfidencePool";

function fmtMl(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}

async function espnConfidenceSave(body: any) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "espnconfidence", ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

// ---------------------------------------------------------------------
// Step 1: game selection
// ---------------------------------------------------------------------
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
  const [gameSearch, setGameSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([fetchFbsGamesForWeek(season, week), fetchEspnConfidencePicksForWeek(season, week)])
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
      await espnConfidenceSave({ action: "selectGames", season, week, gameIds: Array.from(selected), keyGameId });
      onSaved();
      setCollapsed(true);
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
      await espnConfidenceSave({ action: "selectGames", season, week, gameIds: [], keyGameId: null });
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div className="section-label">
          1. Select this week's games (FBS vs FBS){" "}
          <span style={{ color: selected.size >= MAX_GAMES ? "#a15c00" : "var(--chalk-dim)", fontWeight: 400 }}>
            · {selected.size}/{MAX_GAMES}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {collapsed ? (
            <button className="menu-btn" onClick={() => setCollapsed(false)}>
              Show games
            </button>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search teams…"
                value={gameSearch}
                onChange={(e) => setGameSearch(e.target.value)}
                style={{ width: 160 }}
              />
              <button className="menu-btn" onClick={handleResetGames} disabled={saving}>
                Reset games
              </button>
            </>
          )}
        </div>
      </div>
      {collapsed ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>Saved — {selected.size} games selected.</p>
      ) : available.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No FBS-vs-FBS games saved for {season} week {week} yet — sync this week from Games &
          Lines first.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
          {available
            .filter(
              (g) =>
                gameSearch.trim() === "" ||
                g.away_team.toLowerCase().includes(gameSearch.trim().toLowerCase()) ||
                g.home_team.toLowerCase().includes(gameSearch.trim().toLowerCase())
            )
            .map((g) => {
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
                  <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
                </span>
                {selected.has(g.id) && (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem" }}>
                    <input type="radio" name="key-game" checked={keyGameId === g.id} onChange={() => setKeyGameId(g.id)} />
                    Key game
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {!collapsed && (
        <button onClick={handleSave} disabled={saving || selected.size === 0}>
          {saving ? "Saving…" : "Save selected games"}
        </button>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Step 2: sortable picks table with confidence points
// ---------------------------------------------------------------------
function PickingStep({ season, week, refreshToken }: { season: number; week: number; refreshToken: number }) {
  const [picks, setPicks] = useState<EspnConfidencePickWithGame[]>([]);
  const [draft, setDraft] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("start_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");
  const { rows: totalsRows } = useGameTotalsEngine(season);
  const totalsRowByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsRows]);

  function load() {
    setLoading(true);
    fetchEspnConfidencePicksForWeek(season, week, liveByTeam)
      .then((data) => {
        setPicks(data);
        const d: Record<number, any> = {};
        for (const p of data) {
          d[p.id] = { picked_side: p.picked_side, confidence_points: p.confidence_points };
        }
        setDraft(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // See EspnMoneylinePanel.tsx for why this waits on ratingsLoading —
  // same missing-dependency bug (this effect never used to re-run once
  // live ratings actually arrived) produced a different, wrong "My ML"
  // for the same game depending on cache timing between page loads.
  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, refreshToken, ratingsLoading]);

  function updateDraft(id: number, patch: any) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const usedPoints = useMemo(() => {
    const s = new Set<number>();
    Object.values(draft).forEach((d: any) => {
      if (d.confidence_points != null) s.add(d.confidence_points);
    });
    return s;
  }, [draft]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(draft).map(([id, v]: any) => ({ id: Number(id), ...v }));
      await espnConfidenceSave({ action: "savePicks", picks: payload });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPicks() {
    if (!confirm("Clear all picks and confidence points for this week? The game list stays as-is.")) return;
    setSaving(true);
    setError(null);
    try {
      await espnConfidenceSave({ action: "resetPicks", season, week });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const accessor = (p: EspnConfidencePickWithGame, key: string): any => {
    const g = p.game;
    switch (key) {
      case "away_team":
        return g?.away_team ?? "";
      case "home_team":
        return g?.home_team ?? "";
      case "start_date":
        return g?.start_date ?? "";
      case "myProjAwayMoneyline":
        return p.myProjAwayMoneyline;
      case "vegasAwayMoneyline":
        return p.vegasAwayMoneyline;
      case "confidence_points":
        return draft[p.id]?.confidence_points ?? null;
      default:
        return null;
    }
  };

  const sortedPicks = useMemo(() => {
    return [...picks].sort((a, b) => {
      const av = accessor(a, sortKey);
      const bv = accessor(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, draft, sortKey, sortDir]);

  if (ratingsLoading) return <p>Loading live ratings…</p>;
  if (loading) return <p>Loading picks…</p>;
  if (picks.length === 0) return null;

  const { earned, possible } = summarizeConfidencePoints(picks);
  const N = picks.length;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div className="section-label">
          2. Pick winners & assign confidence{" "}
          <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>
            · Points: {earned} earned / {possible} decided so far (max possible {(N * (N + 1)) / 2})
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
              <SortHeader label="Away" sortKey="away_team" active={sortKey === "away_team"} dir={sortDir} onClick={handleSort} />
              <SortHeader
                label="Vegas ML (Away)"
                sortKey="vegasAwayMoneyline"
                active={sortKey === "vegasAwayMoneyline"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="My ML (Away)"
                sortKey="myProjAwayMoneyline"
                active={sortKey === "myProjAwayMoneyline"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader label="Home" sortKey="home_team" active={sortKey === "home_team"} dir={sortDir} onClick={handleSort} />
              <th className="th th-right">Vegas ML (Home)</th>
              <th className="th th-right">My ML (Home)</th>
              <th className="th">Pick</th>
              <SortHeader
                label="Points"
                sortKey="confidence_points"
                active={sortKey === "confidence_points"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <th className="th">Result</th>
            </tr>
          </thead>
          <tbody>
            {sortedPicks.map((p) => {
              const g = p.game;
              if (!g) return null;
              const d = draft[p.id] ?? {};
              const grade = gradeEspnConfidencePick(p);
              const currentPoints = d.confidence_points;

              return (
                <tr key={p.id} style={{ background: p.is_key_game ? "var(--gold-dim)" : undefined }}>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLogo team={g.away_team} /> {g.away_team}
                    {p.is_key_game && (
                      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
                        Key game
                        {p.vegasTotal != null ? ` · Vegas Total ${p.vegasTotal}` : ""}
                        {(() => {
                          const myTotal = g ? totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) : null;
                          return myTotal != null ? ` · My Total ${myTotal.toFixed(1)}` : "";
                        })()}
                        {(() => {
                          const myTotal = g ? totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) : null;
                          const label = formatProjectedScore(myTotal ?? null, p.myProjAwaySpread != null ? -p.myProjAwaySpread : null, g.away_team, g.home_team);
                          return label ? ` · My Score ${label}` : "";
                        })()}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtMl(p.vegasAwayMoneyline)}
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: p.myProjAwaySpread != null ? spreadColor(p.myProjAwaySpread) : undefined,
                    }}
                  >
                    {fmtMl(p.myProjAwayMoneyline)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}><TeamLogo team={g.home_team} /> {g.home_team}</td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtMl(p.vegasHomeMoneyline)}
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: p.myProjAwaySpread != null ? spreadColor(-p.myProjAwaySpread) : undefined,
                    }}
                  >
                    {fmtMl(p.myProjHomeMoneyline)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        className="menu-btn"
                        style={{ opacity: d.picked_side === "away" ? 1 : 0.5 }}
                        onClick={() => updateDraft(p.id, { picked_side: "away" })}
                      >
                        <TeamLogo team={g.away_team} /> {g.away_team}
                      </button>
                      <button
                        className="menu-btn"
                        style={{ opacity: d.picked_side === "home" ? 1 : 0.5 }}
                        onClick={() => updateDraft(p.id, { picked_side: "home" })}
                      >
                        <TeamLogo team={g.home_team} /> {g.home_team}
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    <select
                      value={currentPoints ?? ""}
                      onChange={(e) =>
                        updateDraft(p.id, { confidence_points: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    >
                      <option value="">–</option>
                      {Array.from({ length: N }, (_, i) => i + 1)
                        .filter((v) => v === currentPoints || !usedPoints.has(v))
                        .map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {grade === "pending" ? "–" : grade === "win" ? "✅ Win" : "❌ Loss"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.5rem" }}>
        Points range from 1 (least confident) to {N} (most confident) — each value can only be
        used once; the dropdown hides values already assigned elsewhere.
      </p>
      <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.5rem" }}>
        {saving ? "Saving…" : "Save picks"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

export default function EspnConfidencePanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>ESPN Confidence</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="https://fantasy.espn.com/games/college-football-pickem-2026/picks?id=2cd903c0-86ad-11f1-9e6e-c5424dfb4a18"
            target="_blank"
            rel="noopener noreferrer"
            className="menu-btn"
            style={{ textDecoration: "none" }}
          >
            Entry 1 ↗
          </a>
          <a
            href="https://fantasy.espn.com/games/college-football-pickem-2026/picks?id=c8e4fb70-86ad-11f1-9e6e-c5424dfb4a18"
            target="_blank"
            rel="noopener noreferrer"
            className="menu-btn"
            style={{ textDecoration: "none" }}
          >
            Entry 2 ↗
          </a>
        </div>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Pick straight-up winners and rank them by confidence — 1 for your least confident
        pick up to the total number of games for your most confident. The key game shows the
        Vegas Total purely as a reference.
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
