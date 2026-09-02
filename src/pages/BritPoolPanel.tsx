import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, moneylineToImpliedWinPct, spreadColor, spreadToMoneyline } from "../lib/odds";
import { formatProjectedScore } from "../lib/gameTotals";
import { billRAwayWinPct } from "../lib/moneylineBetHistory";
import { useWeeklyStats, type WeeklyTeamStats } from "../lib/api/weeklyStats";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import type { BettingLineRow } from "../lib/api/gamesLines";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import {
  fetchFbsGamesForWeek,
  fetchBritPicksForWeek,
  fetchBritSeasonPicks,
  fetchBritEntries,
  fetchBritSeasonBonus,
  gradeBritPick,
  summarizeWeekRecord,
  type BritPickWithGame,
} from "../lib/api/britPool";

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];
function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const m = lines.find((l) => l.provider === p);
    if (m) return m;
  }
  return lines[0];
}

// Shared by the auto-pick default (below) and the render — computing this
// twice with two copies of the formula is exactly the kind of divergence
// bug Chris has hit before (see conventions), so it's one function used
// both places.
function computeProjection(g: { away_team: string; home_team: string }, liveByTeam: Record<string, WeeklyTeamStats>) {
  const staticAwayTeam = TEAMS_BY_NAME[g.away_team];
  const staticHomeTeam = TEAMS_BY_NAME[g.home_team];
  const awayTeam = staticAwayTeam ? { ...staticAwayTeam, rating: liveByTeam[g.away_team]?.rating ?? staticAwayTeam.rating } : null;
  const homeTeam = staticHomeTeam ? { ...staticHomeTeam, rating: liveByTeam[g.home_team]?.rating ?? staticHomeTeam.rating } : null;
  const projAwaySpread = awayTeam && homeTeam ? awayTeam.rating - homeTeam.rating + hfaFor(g.home_team, liveByTeam) : null;
  // Bill R Method — the canonical site-wide moneyline model — not the
  // spread-derived curve, matching every other pool tool.
  const awayWinPct = awayTeam && homeTeam ? billRAwayWinPct(awayTeam.rating, homeTeam.rating) : null;
  return { awayTeam, homeTeam, projAwaySpread, awayWinPct };
}

function fmtPct(v: number | null): string {
  if (v == null) return "–";
  return `${(v * 100).toFixed(0)}%`;
}

async function britSave(body: any) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "brit", ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

// ---------------------------------------------------------------------
// Step 1: game selection
// ---------------------------------------------------------------------
function GameSelectionStep({
  season,
  week,
  onSaved,
}: {
  season: number;
  week: number;
  onSaved: () => void;
}) {
  const [available, setAvailable] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [specialId, setSpecialId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameSearch, setGameSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  // Separate from gameSearch above (which only filters the FBS-vs-FBS
  // list already loaded) — this searches EVERY game this week,
  // specifically so an FCS-vs-FCS or FBS-vs-FCS game can be found and
  // added singly, without switching the default list to include all of
  // them (Chris: "I dont want to sort through all fcs and cross div
  // games").
  const [nonFbsSearch, setNonFbsSearch] = useState("");
  const [nonFbsResults, setNonFbsResults] = useState<any[]>([]);
  const [nonFbsSearching, setNonFbsSearching] = useState(false);
  const [nonFbsError, setNonFbsError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchFbsGamesForWeek(season, week), fetchBritPicksForWeek(season, week)])
      .then(([games, picks]) => {
        setAvailable(games);
        setSelected(new Set(picks.map((p) => p.game_id)));
        const special = picks.find((p) => p.is_special);
        setSpecialId(special?.game_id ?? null);
      })
      .catch((err) => setError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
  }, [season, week]);

  function toggle(gameId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
        if (specialId === gameId) setSpecialId(null);
      } else {
        next.add(gameId);
      }
      return next;
    });
  }

  async function searchNonFbsGames(query: string) {
    setNonFbsSearch(query);
    setNonFbsError(null);
    if (query.trim().length < 2) {
      setNonFbsResults([]);
      return;
    }
    setNonFbsSearching(true);
    try {
      // Reuses the same broad fetch the rest of the site uses for
      // "every game this week regardless of division" — fetchFbsGamesForWeek
      // above is FBS-only on purpose, this one isn't.
      const allGames = await fetchGamesWithLines(season, week);
      const q = query.trim().toLowerCase();
      const alreadyAdded = new Set(available.map((g) => g.id));
      const results = allGames.filter((g) => {
        const isFbsVFbs = (g.home_classification ?? "").toLowerCase() === "fbs" && (g.away_classification ?? "").toLowerCase() === "fbs";
        if (isFbsVFbs) return false; // already reachable via the main list/search above
        if (alreadyAdded.has(g.id)) return false;
        return g.away_team.toLowerCase().includes(q) || g.home_team.toLowerCase().includes(q);
      });
      setNonFbsResults(results);
    } catch (err: any) {
      setNonFbsError(err.message ?? "Search failed");
    } finally {
      setNonFbsSearching(false);
    }
  }

  function addNonFbsGame(g: any) {
    setAvailable((prev) => [...prev, g]);
    setSelected((prev) => new Set(prev).add(g.id));
    setNonFbsResults((prev) => prev.filter((r) => r.id !== g.id));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await britSave({
        action: "selectGames",
        season,
        week,
        gameIds: Array.from(selected),
        specialGameId: specialId,
      });
      onSaved();
      setCollapsed(true);
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
        <div className="section-label">1. Select this week's games (FBS vs FBS)</div>
        {collapsed ? (
          <button className="menu-btn" onClick={() => setCollapsed(false)}>
            Show games
          </button>
        ) : (
          <input
            type="text"
            placeholder="Search teams…"
            value={gameSearch}
            onChange={(e) => setGameSearch(e.target.value)}
            style={{ width: 160 }}
          />
        )}
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
            .map((g) => (
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
              }}
            >
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
              <span style={{ flex: 1 }}>
                <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
              </span>
              {selected.has(g.id) && (
                <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem" }}>
                  <input
                    type="radio"
                    name="special-game"
                    checked={specialId === g.id}
                    onChange={() => setSpecialId(g.id)}
                  />
                  Special game
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {!collapsed && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="section-label" style={{ fontSize: "0.85rem" }}>
            Add an FCS/cross-division game
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0, marginBottom: "0.4rem" }}>
            The list above is FBS-vs-FBS only. Search a team name to find their game this week if
            it's FCS-vs-FCS or FBS-vs-FCS, and add it singly instead of switching the whole list to include every non-FBS game.
          </p>
          <input
            type="text"
            placeholder="Search any team…"
            value={nonFbsSearch}
            onChange={(e) => searchNonFbsGames(e.target.value)}
            style={{ width: 200 }}
          />
          {nonFbsSearching && <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Searching…</span>}
          {nonFbsError && <p style={{ color: "crimson", fontSize: "0.8rem" }}>{nonFbsError}</p>}
          {nonFbsResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
              {nonFbsResults.map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    padding: "0.4rem 0.6rem",
                    border: "1px solid var(--hash)",
                    borderRadius: 6,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
                  </span>
                  <button className="menu-btn" onClick={() => addNonFbsGame(g)}>
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
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
// Step 2: picking
// ---------------------------------------------------------------------
function PickingStep({
  season,
  week,
  onChanged,
}: {
  season: number;
  week: number;
  onChanged: () => void;
}) {
  const [picks, setPicks] = useState<BritPickWithGame[]>([]);
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
    fetchBritPicksForWeek(season, week)
      .then((data) => {
        setPicks(data);
        const d: Record<number, any> = {};
        for (const p of data) {
          const { awayWinPct } = p.game ? computeProjection(p.game, liveByTeam) : { awayWinPct: null };
          // Default to whichever side my model favors outright, if
          // nothing's been picked yet — same idea as ESPN Moneyline's
          // auto-pick. Chris can still change it before saving.
          const autoPick: "away" | "home" | null =
            p.picked_side ?? (awayWinPct == null ? null : awayWinPct > 0.5 ? "away" : awayWinPct < 0.5 ? "home" : null);
          d[p.id] = {
            picked_side: autoPick,
            predicted_home_score: p.predicted_home_score,
            predicted_away_score: p.predicted_away_score,
          };
        }
        setDraft(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // See EspnMoneylinePanel.tsx for why this waits on ratingsLoading —
  // without it, the auto-pick above would run once at mount against
  // whatever liveByTeam was at that instant (often {} on a cold load)
  // and never recompute once real ratings arrived.
  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, ratingsLoading]);

  function updateDraft(id: number, patch: any) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(draft).map(([id, v]: any) => ({ id: Number(id), ...v }));
      await britSave({ action: "savePicks", picks: payload });
      onChanged();
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

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="section-label">2. Pick winners</div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Game</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Power Ratings</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Spread</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Win %</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Vegas Spread</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Vegas ML</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Vegas Win %</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Pick</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => {
              const g = p.game;
              if (!g) return null;
              const line = pickLine(p.lines);
              const { awayTeam, homeTeam, projAwaySpread, awayWinPct } = computeProjection(g, liveByTeam);
              const homeWinPct = awayWinPct != null ? 1 - awayWinPct : null;
              const vegasAwaySpread = line?.spread != null ? -line.spread : null;
              const vegasAwayWinPct = moneylineToImpliedWinPct(line?.away_moneyline ?? null);
              const vegasHomeWinPct = moneylineToImpliedWinPct(line?.home_moneyline ?? null);
              const d = draft[p.id] ?? {};
              const grade = gradeBritPick(p);

              return (
                <tr key={p.id} style={{ background: p.is_special ? "var(--gold-dim)" : undefined }}>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
                    {p.is_special && (
                      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
                        Special game{line?.over_under != null ? ` · Vegas Total ${line.over_under}` : ""}
                        {(() => {
                          const myTotal = totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
                          return myTotal != null ? ` · My Total ${myTotal.toFixed(1)}` : "";
                        })()}
                        {(() => {
                          const myTotal = totalsRowByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
                          const label = formatProjectedScore(myTotal, projAwaySpread != null ? -projAwaySpread : null, g.away_team, g.home_team);
                          return label ? ` · My Score ${label}` : "";
                        })()}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {awayTeam ? awayTeam.rating.toFixed(1) : "–"} / {homeTeam ? homeTeam.rating.toFixed(1) : "–"}
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: projAwaySpread != null ? spreadColor(projAwaySpread) : undefined,
                    }}
                  >
                    {projAwaySpread != null ? `${projAwaySpread > 0 ? "+" : ""}${projAwaySpread.toFixed(1)}` : "–"}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtPct(awayWinPct)} / {fmtPct(homeWinPct)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {vegasAwaySpread != null ? `${vegasAwaySpread > 0 ? "+" : ""}${vegasAwaySpread.toFixed(1)}` : "–"}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {line?.away_moneyline != null ? Math.round(line.away_moneyline) : "–"} /{" "}
                    {line?.home_moneyline != null ? Math.round(line.home_moneyline) : "–"}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtPct(vegasAwayWinPct)} / {fmtPct(vegasHomeWinPct)}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <div style={{ display: "flex", gap: "0.3rem", marginBottom: p.is_special ? "0.4rem" : 0 }}>
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
                    {p.is_special && (
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.75rem" }}>
                        <span>Score:</span>
                        <input
                          type="number"
                          placeholder="Away"
                          value={d.predicted_away_score ?? ""}
                          onChange={(e) =>
                            updateDraft(p.id, { predicted_away_score: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55 }}
                        />
                        <span>-</span>
                        <input
                          type="number"
                          placeholder="Home"
                          value={d.predicted_home_score ?? ""}
                          onChange={(e) =>
                            updateDraft(p.id, { predicted_home_score: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55 }}
                        />
                        {d.predicted_away_score != null && d.predicted_home_score != null && (
                          <span style={{ color: "var(--chalk-dim)" }}>Total: {d.predicted_away_score + d.predicted_home_score}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {grade === "pending" ? "–" : grade === "win" ? "✅ Win" : grade === "push" ? "Push" : "❌ Loss"}
                    {p.is_special && g.completed && g.away_points != null && g.home_points != null && (
                      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
                        Actual: {g.away_points}-{g.home_points}
                        {d.predicted_away_score != null && d.predicted_home_score != null
                          ? ` (predicted ${d.predicted_away_score}-${d.predicted_home_score})`
                          : ""}
                      </div>
                    )}
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

// ---------------------------------------------------------------------
// Weekly entry fee / winnings quick-entry
// ---------------------------------------------------------------------
function WeeklyEntryStep({ season, week }: { season: number; week: number }) {
  const [entryFee, setEntryFee] = useState(10);
  const [winnings, setWinnings] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchBritEntries(season).then((entries) => {
      const row = entries.find((e) => e.week === week);
      setEntryFee(row?.entry_fee ?? 10);
      setWinnings(row?.winnings ?? 0);
      setNote(row?.note ?? "");
    });
  }, [season, week]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await britSave({ action: "saveEntry", season, week, entry_fee: entryFee, winnings, note });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="section-label">3. This week's entry & winnings</div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Entry fee ${" "}
          <input type="number" value={entryFee} onChange={(e) => setEntryFee(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <label>
          Winnings ${" "}
          <input type="number" value={winnings} onChange={(e) => setWinnings(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, minWidth: 150 }}
        />
        <button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ color: "green" }}>Saved</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Season tracking / PnL
// ---------------------------------------------------------------------
function SeasonTrackingTab({ season }: { season: number }) {
  const [picksByWeek, setPicksByWeek] = useState<Record<number, BritPickWithGame[]>>({});
  const [entries, setEntries] = useState<Record<number, { entry_fee: number; winnings: number }>>({});
  const [bonusPayout, setBonusPayout] = useState(0);
  const [bonusNote, setBonusNote] = useState("");
  const [savingBonus, setSavingBonus] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchBritSeasonPicks(season), fetchBritEntries(season), fetchBritSeasonBonus(season)])
      .then(([picks, entryRows, bonus]) => {
        const byWeek: Record<number, BritPickWithGame[]> = {};
        for (const p of picks) {
          (byWeek[p.week] = byWeek[p.week] ?? []).push(p);
        }
        setPicksByWeek(byWeek);
        const entryMap: Record<number, { entry_fee: number; winnings: number }> = {};
        for (const e of entryRows) entryMap[e.week] = { entry_fee: e.entry_fee, winnings: e.winnings };
        setEntries(entryMap);
        setBonusPayout(bonus?.payout ?? 0);
        setBonusNote(bonus?.note ?? "");
      })
      .finally(() => setLoading(false));
  }, [season]);

  async function saveBonus() {
    setSavingBonus(true);
    try {
      await britSave({ action: "saveSeasonBonus", season, payout: bonusPayout, note: bonusNote });
    } finally {
      setSavingBonus(false);
    }
  }

  const weeks = Object.keys(picksByWeek).map(Number).sort((a, b) => a - b);
  let cumulativeNet = 0;

  if (loading) return <p>Loading season data…</p>;

  return (
    <div>
      <div className="section-label">Season record & PnL — {season}</div>
      {weeks.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No picks saved yet this season.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Entry Fee</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Winnings</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Net (wk)</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const record = summarizeWeekRecord(picksByWeek[w]);
                const entry = entries[w] ?? { entry_fee: 10, winnings: 0 };
                const net = entry.winnings - entry.entry_fee;
                cumulativeNet += net;
                return (
                  <tr key={w}>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{w}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      {record.wins}-{record.losses}
                      {record.pushes > 0 ? `-${record.pushes}` : ""}
                      {record.pending > 0 ? ` (${record.pending} pending)` : ""}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      ${entry.entry_fee.toFixed(2)}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      ${entry.winnings.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderBottom: "1px solid var(--hash)",
                        textAlign: "right",
                        color: net >= 0 ? "green" : "crimson",
                      }}
                    >
                      {net >= 0 ? "+" : ""}
                      {net.toFixed(2)}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {cumulativeNet >= 0 ? "+" : ""}
                      {cumulativeNet.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <div className="section-label">End-of-season payout</div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Payout ${" "}
            <input type="number" value={bonusPayout} onChange={(e) => setBonusPayout(Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <input
            placeholder="Note (optional)"
            value={bonusNote}
            onChange={(e) => setBonusNote(e.target.value)}
            style={{ flex: 1, minWidth: 150 }}
          />
          <button onClick={saveBonus} disabled={savingBonus}>
            {savingBonus ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: "1rem", fontWeight: 700 }}>
        Season net PnL: {cumulativeNet + bonusPayout >= 0 ? "+" : ""}
        {(cumulativeNet + bonusPayout).toFixed(2)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Top-level Brit panel
// ---------------------------------------------------------------------
export default function BritPoolPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"week" | "season">("week");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <h2 style={{ marginTop: 0 }}>The Brit</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Weekly $10 pick'em with the local pub — one game each week also needs a predicted
        final score.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button className={`mode-btn ${tab === "week" ? "mode-btn-active" : ""}`} onClick={() => setTab("week")}>
          This Week
        </button>
        <button className={`mode-btn ${tab === "season" ? "mode-btn-active" : ""}`} onClick={() => setTab("season")}>
          Season Tracking
        </button>
      </div>

      {tab === "week" && (
        <>
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

          <GameSelectionStep season={season} week={week} onSaved={() => setRefreshKey((k) => k + 1)} />
          <PickingStep key={`picking-${refreshKey}`} season={season} week={week} onChanged={() => {}} />
          <WeeklyEntryStep key={`entry-${refreshKey}`} season={season} week={week} />
        </>
      )}

      {tab === "season" && <SeasonTrackingTab season={season} />}
    </div>
  );
}
