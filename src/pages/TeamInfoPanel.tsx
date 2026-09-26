import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { invalidateCache } from "../lib/api/cache";
import {
  fetchTeamCoaches,
  fetchTeamGameAdvanced,
  pullTeamInfo,
  type TeamCoachRow,
  type TeamGameAdvancedRow,
} from "../lib/api/teamInfo";

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

interface TeamLine {
  key: string;
  game: GameWithLines;
  team: string;
  opponent: string;
  isHome: boolean;
  pgwe: number | null;
  netSr: number | null;
  seasonNetSr: number | null;
  seasonPgwe: number | null;
  coach: TeamCoachRow | null;
}

export default function TeamInfoPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);

  const [wholeSeason, setWholeSeason] = useState(false);
  const [parts, setParts] = useState<Record<string, boolean>>({ pgwe: true, netsr: true, coaches: true });
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [advanced, setAdvanced] = useState<TeamGameAdvancedRow[]>([]);
  const [coaches, setCoaches] = useState<Record<string, TeamCoachRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchGamesWithLines(season), fetchTeamGameAdvanced(season), fetchTeamCoaches(season)])
      .then(([g, a, c]) => {
        if (cancelled) return;
        setGames(g.filter((x) => x.home_classification === "fbs" && x.away_classification === "fbs"));
        setAdvanced(a);
        setCoaches(c);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, reloadTick]);

  const lines = useMemo<TeamLine[]>(() => {
    const advByGameTeam = new Map(advanced.map((r) => [`${r.game_id}|${r.team}`, r]));
    // Every team's played games (chronological) so "season" values only count
    // games before the picked week — what was known going into the matchup.
    const played = new Map<string, { week: number; pgwe: number | null; netSr: number | null }[]>();
    for (const g of games) {
      if (!g.completed) continue;
      for (const isHome of [true, false]) {
        const team = isHome ? g.home_team : g.away_team;
        const pgwe = isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability;
        const netSr = advByGameTeam.get(`${g.id}|${team}`)?.net_success_rate ?? null;
        const list = played.get(team) ?? [];
        list.push({ week: g.week, pgwe, netSr });
        played.set(team, list);
      }
    }
    const out: TeamLine[] = [];
    for (const g of games.filter((x) => x.week === week)) {
      for (const isHome of [false, true]) {
        const team = isHome ? g.home_team : g.away_team;
        const before = (played.get(team) ?? []).filter((p) => p.week < week);
        out.push({
          key: `${g.id}|${team}`,
          game: g,
          team,
          opponent: isHome ? g.away_team : g.home_team,
          isHome,
          pgwe: g.completed ? (isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability) : null,
          netSr: advByGameTeam.get(`${g.id}|${team}`)?.net_success_rate ?? null,
          seasonNetSr: mean(before.map((p) => p.netSr)),
          seasonPgwe: mean(before.map((p) => p.pgwe)),
          coach: coaches[team] ?? null,
        });
      }
    }
    return out;
  }, [games, advanced, coaches, week]);

  async function handlePull() {
    const selected = Object.entries(parts).filter(([, on]) => on).map(([k]) => k);
    if (selected.length === 0) return;
    if (!window.confirm(`Pull ${selected.length} CFBD dataset(s) (${selected.length} request${selected.length > 1 ? "s" : ""}) for ${season}${wholeSeason ? " (whole season)" : ` week ${week}`}?`)) return;
    setPulling(true);
    setPullMsg(null);
    setPullError(null);
    try {
      const r = await pullTeamInfo(season, wholeSeason ? null : week, selected);
      const bits: string[] = [];
      if (r.pgwe) bits.push(`PGWE: ${r.pgwe.withPgwe} of ${r.pgwe.games} games have it`);
      if (r.netSr) bits.push(`Net success rate: ${r.netSr.saved} team-games saved`);
      if (r.coaches) bits.push(`Coaches: ${r.coaches.teams} teams${r.coaches.staleTeams ? ` (${r.coaches.staleTeams} using last season's coach)` : ""}`);
      setPullMsg(bits.join(" · ") + (r.warnings?.length ? ` — ${r.warnings.join(" ")}` : ""));
      invalidateCache();
      setReloadTick((n) => n + 1);
    } catch (e: any) {
      setPullError(e.message ?? "Pull failed");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Team Info</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        CFBD data for each team in a week's matchups: postgame win expectancy (PGWE) and net success rate (offense success rate minus the
        success rate its defense allowed) for the game itself once it's played, the same two averaged over the team's earlier games, and the
        head coach with tenure at the school (seasons coached there, current included). Upcoming games have no PGWE or net SR yet — the
        season columns are what's known going in.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 70 }} />
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Week <input type="number" min={1} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem", padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf-panel)" }}>
        <button className="menu-btn" onClick={handlePull} disabled={pulling || !Object.values(parts).some(Boolean)}>
          {pulling ? "Pulling…" : "Pull Team Info"}
        </button>
        {(
          [
            ["pgwe", "PGWE"],
            ["netsr", "Net success rate"],
            ["coaches", "Coaches + tenure"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="checkbox" checked={parts[k]} onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))} />
            {label}
          </label>
        ))}
        <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={wholeSeason} onChange={(e) => setWholeSeason(e.target.checked)} />
          Whole season (else just week {week})
        </label>
        <span style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>One CFBD request per box checked. Coaches ignores the week (pulls the current staff either way).</span>
      </div>
      {pullMsg && <p style={{ color: "#8fd39a", fontSize: "0.82rem" }}>{pullMsg}</p>}
      {pullError && <p style={{ color: "crimson", fontSize: "0.82rem" }}>{pullError}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 720, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              {["Kickoff", "Team", "Opponent", "Coach", "Tenure", "PGWE", "Net SR (pts)", "Season Net SR", "Season Avg PGWE"].map((h, i) => (
                <th key={h} style={{ ...(i >= 5 ? num : cell), textAlign: i >= 5 ? "right" : "left", position: "sticky", top: 0, background: "var(--turf-panel)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} style={i % 2 === 1 ? { borderBottom: "2px solid var(--hash)" } : undefined}>
                <td style={cell}>{fmtKickoff(l.game.start_date)}</td>
                <td style={{ ...cell, fontWeight: 700 }}>
                  <TeamLink team={l.team} />
                  <span style={{ color: "var(--chalk-dim)", fontWeight: 400, marginLeft: "0.3rem" }}>{l.isHome ? "H" : "A"}</span>
                </td>
                <td style={cell}>{l.opponent}</td>
                <td style={cell}>{l.coach?.coach_name ?? "–"}</td>
                <td style={cell} title={l.coach?.hire_date ? `Hired ${l.coach.hire_date.slice(0, 10)}` : undefined}>
                  {l.coach?.tenure_seasons != null ? `Yr ${l.coach.tenure_seasons}${l.coach.first_year_at_school ? ` (since ${l.coach.first_year_at_school})` : ""}` : "–"}
                </td>
                <td style={num}>{fmtPct(l.pgwe)}</td>
                <td style={num}>{fmtPts(l.netSr)}</td>
                <td style={num}>{fmtPts(l.seasonNetSr)}</td>
                <td style={num}>{fmtPct(l.seasonPgwe)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
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
