import { useEffect, useMemo, useState, type CSSProperties } from "react";
import TeamLink from "./TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchTeamGameAdvanced, type TeamGameAdvancedRow } from "../lib/api/teamInfo";

// Single-game review for a week's FBS-vs-FBS games: postgame win expectancy (PGWE) and net success rate (offense
// success rate minus the success rate its defense allowed) for both teams, next to each team's average over its
// earlier games. Data comes from the Team Info CFBD pull (Admin → Teams → Data pulls).

const cell: CSSProperties = { padding: "0.3rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

function fmtPct(v: number | null | undefined) {
  return v == null ? "–" : `${(v * 100).toFixed(1)}%`;
}
// Success-rate values are fractions; net SR reads in signed percentage points.
function fmtPts(v: number | null | undefined) {
  if (v == null) return "–";
  const p = v * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}`;
}
function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export default function MatchupReviewTable({ season, week, query }: { season: number; week: number; query: string }) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [advanced, setAdvanced] = useState<TeamGameAdvancedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchGamesWithLines(season), fetchTeamGameAdvanced(season)])
      .then(([g, a]) => {
        if (cancelled) return;
        setGames(g.filter((x) => x.home_classification === "fbs" && x.away_classification === "fbs"));
        setAdvanced(a);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const rows = useMemo(() => {
    const advByGameTeam = new Map(advanced.map((r) => [`${r.game_id}|${r.team}`, r]));
    // Each team's completed games, so the season averages only count games before this week.
    const played = new Map<string, { week: number; pgwe: number | null; netSr: number | null }[]>();
    for (const g of games) {
      if (!g.completed) continue;
      for (const isHome of [true, false]) {
        const team = isHome ? g.home_team : g.away_team;
        const list = played.get(team) ?? [];
        list.push({
          week: g.week,
          pgwe: isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability,
          netSr: advByGameTeam.get(`${g.id}|${team}`)?.net_success_rate ?? null,
        });
        played.set(team, list);
      }
    }
    const side = (g: GameWithLines, isHome: boolean) => {
      const team = isHome ? g.home_team : g.away_team;
      const before = (played.get(team) ?? []).filter((p) => p.week < week);
      return {
        team,
        pgwe: g.completed ? (isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability) : null,
        netSr: advByGameTeam.get(`${g.id}|${team}`)?.net_success_rate ?? null,
        seasonNetSr: mean(before.map((p) => p.netSr)),
        seasonPgwe: mean(before.map((p) => p.pgwe)),
      };
    };
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => g.week === week)
      .filter((g) => !q || g.home_team.toLowerCase().includes(q) || g.away_team.toLowerCase().includes(q))
      .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
      .map((g) => ({ game: g, away: side(g, false), home: side(g, true) }));
  }, [games, advanced, week, query]);

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Single-game PGWE and net success rate for both teams (filled in once a game is played and the Team Info pull has run), next
        to each team's average from its earlier games.
      </p>
      {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 720, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              {["Kickoff", "Team", "Score", "PGWE", "Net SR (pts)", "Avg PGWE before", "Avg net SR before"].map((h, i) => (
                <th key={h} style={{ ...(i >= 2 ? num : cell), position: "sticky", top: 0, background: "var(--turf-panel)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ game: g, away, home }) =>
              [away, home].map((s, i) => (
                <tr key={`${g.id}-${s.team}`} style={i === 1 ? { borderBottom: "2px solid var(--hash)" } : undefined}>
                  <td style={cell}>{i === 0 ? fmtKickoff(g.start_date) : ""}</td>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    <TeamLink team={s.team} />
                    <span style={{ color: "var(--chalk-dim)", fontWeight: 400, marginLeft: "0.3rem" }}>{i === 0 ? "A" : "H"}</span>
                  </td>
                  <td style={num}>{g.completed ? (i === 0 ? g.away_points : g.home_points) : "–"}</td>
                  <td style={num}>{fmtPct(s.pgwe)}</td>
                  <td style={{ ...num, color: s.netSr == null ? undefined : s.netSr > 0 ? "var(--c-ok)" : "var(--c-err)" }}>{fmtPts(s.netSr)}</td>
                  <td style={num}>{fmtPct(s.seasonPgwe)}</td>
                  <td style={num}>{fmtPts(s.seasonNetSr)}</td>
                </tr>
              ))
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {loading ? "Loading…" : "No FBS-vs-FBS games for that week."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
