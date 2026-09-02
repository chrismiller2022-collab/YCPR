import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  fetchFbsGamesForWeek,
  fetchRedditConfidencePicksForWeek,
  gradeRedditConfidencePick,
  summarizeRedditConfidencePoints,
  type RedditConfidencePickWithGame,
} from "../lib/api/redditConfidencePool";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

async function redditConfidenceSave(body: any) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "redditconfidence", ...body }),
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameSearch, setGameSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([fetchFbsGamesForWeek(season, week), fetchRedditConfidencePicksForWeek(season, week)])
      .then(([games, picks]) => {
        setAvailable(games);
        setSelected(new Set(picks.map((p) => p.game_id)));
      })
      .catch((err) => setError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [season, week, refreshToken]);

  function toggle(gameId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else {
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
      await redditConfidenceSave({ action: "selectGames", season, week, gameIds: Array.from(selected) });
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
      await redditConfidenceSave({ action: "selectGames", season, week, gameIds: [] });
      setSelected(new Set());
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
          <span style={{ color: selected.size === MAX_GAMES ? "green" : "#a15c00", fontWeight: 400 }}>
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
  const [picks, setPicks] = useState<RedditConfidencePickWithGame[]>([]);
  const [draft, setDraft] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  function load() {
    setLoading(true);
    fetchRedditConfidencePicksForWeek(season, week, liveByTeam)
      .then((data) => {
        setPicks(data);
        const d: Record<number, any> = {};
        // Confidence points auto-assign by spread magnitude, biggest
        // favorite = 10 down to smallest = 1 — only when NONE are saved
        // yet (once any are saved/edited, this doesn't silently
        // re-rank out from under a manual change).
        const anySaved = data.some((p) => p.confidence_points != null);
        const rankedByConfidence = [...data].sort((a, b) => Math.abs(b.myProjAwaySpread ?? 0) - Math.abs(a.myProjAwaySpread ?? 0));
        const autoPointsByPickId = new Map<number, number>();
        rankedByConfidence.forEach((p, i) => autoPointsByPickId.set(p.id, data.length - i));

        for (const p of data) {
          // Default to the straight-up (moneyline) winner via Bill R —
          // "make the picks for me by default," per Chris.
          const autoPick: "away" | "home" | null =
            p.picked_side ?? (p.myProjAwayWinPct == null ? null : p.myProjAwayWinPct > 0.5 ? "away" : p.myProjAwayWinPct < 0.5 ? "home" : null);
          d[p.id] = {
            picked_side: autoPick,
            confidence_points: anySaved ? p.confidence_points : autoPointsByPickId.get(p.id) ?? null,
          };
        }
        setDraft(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // See EspnMoneylinePanel.tsx for why this waits on ratingsLoading.
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
      await redditConfidenceSave({ action: "savePicks", picks: payload });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Reddit's own fallback input literally asks for this exact format:
  // team names only, comma-separated, descending confidence order —
  // no spreads, no amounts, nothing else, per Chris ("I think its just
  // the picked teams").
  const csvLine = useMemo(() => {
    const withPoints = picks
      .map((p) => {
        const d = draft[p.id] ?? {};
        const g = p.game;
        if (!g || d.picked_side == null || d.confidence_points == null) return null;
        const teamName = d.picked_side === "away" ? g.away_team : g.home_team;
        return { teamName, points: d.confidence_points as number };
      })
      .filter((x): x is { teamName: string; points: number } => x != null)
      .sort((a, b) => b.points - a.points);
    return withPoints.map((x) => x.teamName).join(",");
  }, [picks, draft]);

  async function handleCopyCsv() {
    try {
      await navigator.clipboard.writeText(csvLine);
      setCopyMsg("Copied.");
    } catch {
      setCopyMsg("Couldn't copy — select and copy the text manually.");
    }
    setTimeout(() => setCopyMsg(null), 3000);
  }

  if (ratingsLoading) return <p>Loading live ratings…</p>;
  if (loading) return <p>Loading picks…</p>;
  if (picks.length === 0) return null;

  const record = picks.reduce(
    (acc, p) => {
      const g = gradeRedditConfidencePick(p);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      return acc;
    },
    { wins: 0, losses: 0 }
  );
  const pointsSummary = summarizeRedditConfidencePoints(
    picks.map((p) => ({ ...p, confidence_points: draft[p.id]?.confidence_points ?? p.confidence_points }))
  );

  const usedPoints = new Set(Object.values(draft).map((d: any) => d.confidence_points).filter((v) => v != null));
  const allPointsAssigned = picks.length === MAX_GAMES && usedPoints.size === MAX_GAMES;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div className="section-label">
          2. Pick winners &amp; confidence points{" "}
          <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>
            · Record: {record.wins}-{record.losses} · {pointsSummary.earned}/{pointsSummary.possible} pts
          </span>
        </div>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Game</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Spread</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Vegas Spread</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Amt Off</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Pick</th>
              <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Confidence</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => {
              const g = p.game;
              if (!g) return null;
              const d = draft[p.id] ?? {};
              const grade = gradeRedditConfidencePick(p);
              return (
                <tr key={p.id}>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLogo team={g.away_team} /> {g.away_team} @ <TeamLogo team={g.home_team} /> {g.home_team}
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
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmt(p.vegasAwaySpread)}</td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmt(p.amountOff)}</td>
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
                    <input
                      type="number"
                      min={1}
                      max={MAX_GAMES}
                      value={d.confidence_points ?? ""}
                      onChange={(e) => updateDraft(p.id, { confidence_points: e.target.value === "" ? null : Number(e.target.value) })}
                      style={{ width: 45, textAlign: "right" }}
                    />
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

      {!allPointsAssigned && (
        <p style={{ color: "#a15c00", fontSize: "0.8rem", marginTop: "0.5rem" }}>
          Confidence points need to be exactly 1-{MAX_GAMES}, each used once, before exporting — check for duplicates or gaps above.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap" }}>
        <button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save picks"}
        </button>
        <button className="menu-btn" onClick={handleCopyCsv} disabled={!csvLine}>
          Copy picks for Reddit
        </button>
        {copyMsg && <span style={{ color: "var(--chalk-dim)", fontSize: "0.82rem" }}>{copyMsg}</span>}
      </div>
      {csvLine && (
        <textarea
          readOnly
          value={csvLine}
          style={{ width: "100%", marginTop: "0.5rem", fontFamily: "monospace", fontSize: "0.78rem", height: 50 }}
          onFocus={(e) => e.target.select()}
        />
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

export default function RedditConfidencePanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Reddit Confidence</h2>
        <a
          href="https://pickem.redditcfb.com/index.php"
          target="_blank"
          rel="noopener noreferrer"
          className="menu-btn"
          style={{ textDecoration: "none" }}
        >
          Open Reddit Pick 'Em ↗
        </a>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Straight confidence pool — pick the straight-up winner for exactly {MAX_GAMES} games and
        rank them 1-{MAX_GAMES} by confidence (auto-assigned by spread size, biggest favorite
        first — edit if you want it different). Export the team list and paste it into their
        contest's "comma-separated list of teams" fallback input, in descending point order.
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
