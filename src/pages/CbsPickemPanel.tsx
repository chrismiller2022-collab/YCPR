import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  fetchFbsGamesForWeek,
  fetchCbsPickemPicksForWeek,
  gradeCbsPickemPick,
  type CbsPickemPickWithGame,
} from "../lib/api/cbsPickemPool";
import { spreadColor } from "../lib/odds";
import { formatProjectedScore, splitTeamTotal } from "../lib/gameTotals";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";

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

const MAX_GAMES = 15;
const MAX_KEY_GAMES = 2;

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
  const [keyGameIds, setKeyGameIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameSearch, setGameSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([fetchFbsGamesForWeek(season, week), fetchCbsPickemPicksForWeek(season, week)])
      .then(([games, picks]) => {
        setAvailable(games);
        setSelected(new Set(picks.map((p) => p.game_id)));
        setKeyGameIds(new Set(picks.filter((p) => p.is_key_game).map((p) => p.game_id)));
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
        setKeyGameIds((k) => {
          const nk = new Set(k);
          nk.delete(gameId);
          return nk;
        });
      } else {
        if (next.size >= MAX_GAMES) return prev;
        next.add(gameId);
      }
      return next;
    });
  }

  function toggleKeyGame(gameId: string) {
    setKeyGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        if (next.size >= MAX_KEY_GAMES) return prev;
        next.add(gameId);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await cbsPickemSave({ action: "selectGames", season, week, gameIds: Array.from(selected), keyGameIds: Array.from(keyGameIds) });
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
      await cbsPickemSave({ action: "selectGames", season, week, gameIds: [], keyGameIds: [] });
      setSelected(new Set());
      setKeyGameIds(new Set());
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
          </span>{" "}
          <span style={{ color: keyGameIds.size === MAX_KEY_GAMES ? "green" : "#a15c00", fontWeight: 400 }}>
            · Tiebreakers: {keyGameIds.size}/{MAX_KEY_GAMES}
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
                    <input
                      type="checkbox"
                      checked={keyGameIds.has(g.id)}
                      disabled={!keyGameIds.has(g.id) && keyGameIds.size >= MAX_KEY_GAMES}
                      onChange={() => toggleKeyGame(g.id)}
                    />
                    Tiebreaker game
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

function PickingStep({ season, week, refreshToken }: { season: number; week: number; refreshToken: number }) {
  const [picks, setPicks] = useState<CbsPickemPickWithGame[]>([]);
  const [draft, setDraft] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    fetchCbsPickemPicksForWeek(season, week, liveByTeam)
      .then((data) => {
        setPicks(data);
        const d: Record<number, any> = {};
        for (const p of data) {
          // Default to whichever side covers per my model vs CBS's own
          // line, if nothing's been picked yet — same ATS logic as ESPN
          // Spreads. Chris can still change it before submitting.
          const autoPick: "away" | "home" | null =
            p.picked_side ??
            (p.myProjAwaySpread == null || p.cbsAwaySpread == null
              ? null
              : p.myProjAwaySpread < p.cbsAwaySpread
              ? "away"
              : p.myProjAwaySpread > p.cbsAwaySpread
              ? "home"
              : null);
          // Defaults the input to Vegas (same reasoning as
          // peayPool.ts) so only games where CBS's actual line
          // diverges from Vegas need to be typed over.
          // Tiebreaker score predictions default to my own model's
          // projected score split, rounded — same "default to my
          // model, editable" convention as everything else on this
          // site, rather than starting blank.
          let defaultAway = p.predicted_away_score;
          let defaultHome = p.predicted_home_score;
          if (p.is_key_game && defaultAway == null && defaultHome == null) {
            const myTotal = totalsRowByGame.get(`${week}|${p.game?.home_team}|${p.game?.away_team}`) ?? null;
            const split = splitTeamTotal(myTotal, p.myProjAwaySpread != null ? -p.myProjAwaySpread : null);
            defaultAway = split.away != null ? Math.round(split.away) : null;
            defaultHome = split.home != null ? Math.round(split.home) : null;
          }
          d[p.id] = {
            picked_side: autoPick,
            cbs_line: p.cbs_line ?? p.vegasAwaySpread ?? null,
            predicted_away_score: defaultAway,
            predicted_home_score: defaultHome,
          };
        }
        setDraft(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // See EspnMoneylinePanel.tsx for why this waits on ratingsLoading —
  // without it, this effect ran once at mount using whatever liveByTeam
  // was at that instant (often {} on a cold load, before live ratings
  // finish fetching) and never re-ran once real data arrived, so the
  // same game could show a different "My" number on different page
  // loads depending on cache timing.
  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, refreshToken, ratingsLoading]);

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

  if (ratingsLoading) return <p>Loading live ratings…</p>;
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
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Vegas Spread</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>CBS Line</th>
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
                    <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
                    {p.is_key_game && (
                      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "0.3rem" }}>
                        <div>
                          Tiebreaker{p.vegasTotal != null ? ` · Vegas Total ${p.vegasTotal}` : ""}
                          {(() => {
                            const myTotal = totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
                            return myTotal != null ? ` · My Total ${myTotal.toFixed(1)}` : "";
                          })()}
                          {(() => {
                            const myTotal = totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
                            const label = formatProjectedScore(myTotal, p.myProjAwaySpread != null ? -p.myProjAwaySpread : null, g.away_team, g.home_team);
                            return label ? ` · My Score ${label}` : "";
                          })()}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.2rem" }}>
                          <span>Your prediction:</span>
                          <TeamLogo team={g.away_team} size={14} />
                          <input
                            type="number"
                            value={d.predicted_away_score ?? ""}
                            onChange={(e) => updateDraft(p.id, { predicted_away_score: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 45 }}
                          />
                          <span>–</span>
                          <input
                            type="number"
                            value={d.predicted_home_score ?? ""}
                            onChange={(e) => updateDraft(p.id, { predicted_home_score: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 45 }}
                          />
                          <TeamLogo team={g.home_team} size={14} />
                        </div>
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
                    {fmt(p.vegasAwaySpread)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    <input
                      type="number"
                      step="0.5"
                      value={d.cbs_line ?? ""}
                      onChange={(e) => updateDraft(p.id, { cbs_line: e.target.value === "" ? null : Number(e.target.value) })}
                      style={{ width: 55, textAlign: "right" }}
                    />
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
        Pick against CBS's own spread for each game. The two tiebreaker games ask for a
        predicted score for both teams, defaulting to my own model's projected split.
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
