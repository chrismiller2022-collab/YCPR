import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/api/fetchAll";
import { TEAMS_BY_NAME } from "../data/teams";
import SortHeader from "./SortHeader";
import TeamLink from "./TeamLink";

// Every FBS team's record under its CURRENT head coach — straight up and
// against the spread, overall and split by favorite/underdog, home/away and
// the four combinations. Reads the coach_game_log view (each completed game
// since the coach's first season at the school, with the site's preferred
// line oriented to the team) and grades in the browser so the opening/closing
// toggle is instant.

interface LogRow {
  team: string;
  coach_name: string;
  first_year_at_school: number | null;
  game_id: string;
  season: number;
  week: number;
  season_type: string;
  location: "home" | "away" | "neutral";
  opponent: string;
  team_points: number;
  opp_points: number;
  close_spread: number | null;
  open_spread: number | null;
  line_provider: string | null;
}

interface Rec {
  w: number;
  l: number;
  p: number;
}
const empty = (): Rec => ({ w: 0, l: 0, p: 0 });

const SPLITS = [
  { key: "all", label: "Overall" },
  { key: "fav", label: "Fav" },
  { key: "dog", label: "Dog" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "homeFav", label: "Home Fav" },
  { key: "homeDog", label: "Home Dog" },
  { key: "awayFav", label: "Away Fav" },
  { key: "awayDog", label: "Away Dog" },
] as const;
type SplitKey = (typeof SPLITS)[number]["key"];

type Outcome = "W" | "L" | "P" | null;

function grade(g: LogRow, spread: number | null) {
  const margin = g.team_points - g.opp_points;
  const su: Outcome = margin > 0 ? "W" : margin < 0 ? "L" : "P";
  let ats: Outcome = null;
  if (spread != null) {
    const v = margin + spread;
    ats = v > 0 ? "W" : v < 0 ? "L" : "P";
  }
  return { su, ats };
}

// Which splits a game counts toward. Fav/dog needs a line (and a non-zero
// spread); home/away excludes neutral-site games.
function splitsFor(g: LogRow, spread: number | null): SplitKey[] {
  const out: SplitKey[] = ["all"];
  const role = spread == null || spread === 0 ? null : spread < 0 ? "Fav" : "Dog";
  if (role) out.push(role === "Fav" ? "fav" : "dog");
  if (g.location === "home" || g.location === "away") {
    out.push(g.location);
    if (role) out.push(`${g.location}${role}` as SplitKey);
  }
  return out;
}

function add(r: Rec, o: Outcome) {
  if (o === "W") r.w += 1;
  else if (o === "L") r.l += 1;
  else if (o === "P") r.p += 1;
}
function fmtRec(r: Rec) {
  return r.w + r.l + r.p === 0 ? "–" : `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
}
function winPct(r: Rec): number | null {
  return r.w + r.l === 0 ? null : r.w / (r.w + r.l);
}
function fmtSpread(v: number | null) {
  return v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

interface TeamAgg {
  team: string;
  coach: string;
  since: number | null;
  dataFrom: number;
  games: number;
  graded: number;
  su: Record<SplitKey, Rec>;
  ats: Record<SplitKey, Rec>;
  log: LogRow[];
}

const cell: CSSProperties = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

export default function CoachAtsSection({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineMode, setLineMode] = useState<"close" | "open">("close");
  const [metric, setMetric] = useState<"ats" | "su">("ats");
  const [sortKey, setSortKey] = useState<string>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAllRows<LogRow>((from, to) =>
      supabase
        .from("coach_game_log")
        .select("team, coach_name, first_year_at_school, game_id, season, week, season_type, location, opponent, team_points, opp_points, close_spread, open_spread, line_provider")
        .order("team")
        .order("game_id")
        .range(from, to)
    )
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load coach game log"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const teams = useMemo<TeamAgg[]>(() => {
    const by = new Map<string, TeamAgg>();
    for (const g of rows) {
      if (TEAMS_BY_NAME[g.team]?.div !== "FBS") continue;
      let t = by.get(g.team);
      if (!t) {
        t = {
          team: g.team,
          coach: g.coach_name,
          since: g.first_year_at_school,
          dataFrom: g.season,
          games: 0,
          graded: 0,
          su: Object.fromEntries(SPLITS.map((s) => [s.key, empty()])) as Record<SplitKey, Rec>,
          ats: Object.fromEntries(SPLITS.map((s) => [s.key, empty()])) as Record<SplitKey, Rec>,
          log: [],
        };
        by.set(g.team, t);
      }
      const spread = lineMode === "open" ? g.open_spread : g.close_spread;
      const { su, ats } = grade(g, spread);
      t.games += 1;
      if (ats) t.graded += 1;
      t.dataFrom = Math.min(t.dataFrom, g.season);
      for (const k of splitsFor(g, spread)) {
        // SU by role/location uses only games with a line for the fav/dog splits (splitsFor already gates those)
        add(t.su[k], su);
        if (ats) add(t.ats[k], ats);
      }
      t.log.push(g);
    }
    return Array.from(by.values());
  }, [rows, lineMode]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = teams.filter((t) => !q || t.team.toLowerCase().includes(q) || t.coach.toLowerCase().includes(q));
    const value = (t: TeamAgg): string | number | null => {
      if (sortKey === "team") return t.team;
      if (sortKey === "coach") return t.coach;
      if (sortKey === "since") return t.since;
      if (sortKey === "games") return t.games;
      const rec = (metric === "ats" ? t.ats : t.su)[sortKey as SplitKey];
      return rec ? winPct(rec) : null;
    };
    return [...list].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [teams, sortKey, sortDir, metric, query]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" || key === "coach" ? "asc" : "desc");
    }
  }

  const partial = teams.filter((t) => t.since != null && t.dataFrom > t.since).length;

  return (
    <div style={{ marginTop: "2.5rem" }}>
      <h2>Coach Records (current coach, every FBS team)</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Each team's record since its current head coach's first season there — straight up and against the spread, split by favorite/underdog,
        home/away and the combinations. Neutral-site games count in Overall/Fav/Dog but not in Home/Away. A game with no line counts SU only;
        ATS pushes are the third number. Win% sorts (pushes excluded). Click a team for its game-by-game log.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        {(["ats", "su"] as const).map((m) => (
          <button key={m} className={`mode-btn ${metric === m ? "mode-btn-active" : ""}`} onClick={() => setMetric(m)}>
            {m === "ats" ? "Against the spread" : "Straight up"}
          </button>
        ))}
        <span style={{ width: "0.5rem" }} />
        {(["close", "open"] as const).map((m) => (
          <button key={m} className={`mode-btn ${lineMode === m ? "mode-btn-active" : ""}`} onClick={() => setLineMode(m)}>
            {m === "close" ? "Closing line" : "Opening line"}
          </button>
        ))}
        <input className="search" placeholder="Search team or coach…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 190 }} />
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!loading && rows.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "#d9a441" }}>
          No data yet — run "Pull Team Info" with Coaches checked (it sets each coach's first season), then reload this section.
        </p>
      )}
      {partial > 0 && (
        <p style={{ fontSize: "0.8rem", color: "#d9a441" }}>
          ⚠ {partial} coach(es) started before the earliest season in the database, so their records are partial (marked ⚠). Load the missing seasons
          with Games &amp; Lines → sync whole season, then Refresh.
        </p>
      )}

      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 760, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Coach" sortKey="coach" active={sortKey === "coach"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Since" sortKey="since" active={sortKey === "since"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="G" sortKey="games" active={sortKey === "games"} dir={sortDir} onClick={handleSort} align="right" />
              {SPLITS.map((s) => (
                <SortHeader key={s.key} label={s.label} sortKey={s.key} active={sortKey === s.key} dir={sortDir} onClick={handleSort} align="right" />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const recs = metric === "ats" ? t.ats : t.su;
              const isOpen = open === t.team;
              return (
                <Fragment key={t.team}>
                  <tr onClick={() => setOpen(isOpen ? null : t.team)} style={{ cursor: "pointer" }}>
                    <td style={{ ...cell, fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
                      <TeamLink team={t.team} />
                    </td>
                    <td style={cell}>{t.coach}</td>
                    <td
                      style={num}
                      title={t.since != null && t.dataFrom > t.since ? `Games before ${t.dataFrom} aren't loaded — record is partial` : undefined}
                    >
                      {t.since ?? "–"}
                      {t.since != null && t.dataFrom > t.since ? " ⚠" : ""}
                    </td>
                    <td style={num} title={`${t.graded} of ${t.games} games have a ${lineMode === "open" ? "opening" : "closing"} line`}>
                      {t.games}
                    </td>
                    {SPLITS.map((s) => {
                      const r = recs[s.key];
                      const p = winPct(r);
                      return (
                        <td
                          key={s.key}
                          style={{ ...num, color: p == null ? undefined : p > 0.5 ? "#8fd39a" : p < 0.5 ? "#c45c52" : undefined }}
                          title={p == null ? undefined : `${(p * 100).toFixed(0)}%`}
                        >
                          {fmtRec(r)}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={4 + SPLITS.length} style={{ padding: "0.5rem 1rem 1rem", background: "var(--turf-panel)" }}>
                        <table style={{ borderCollapse: "collapse", fontSize: "0.74rem" }}>
                          <thead>
                            <tr>
                              {["Season", "Wk", "Opponent", "Loc", "Spread", "Final", "SU", "ATS"].map((h) => (
                                <th key={h} style={{ ...cell, textAlign: "left", color: "var(--chalk-dim)" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[...t.log]
                              .sort((a, b) => a.season - b.season || a.week - b.week)
                              .map((g) => {
                                const spread = lineMode === "open" ? g.open_spread : g.close_spread;
                                const { su, ats } = grade(g, spread);
                                const col = (o: Outcome) => (o === "W" ? "#8fd39a" : o === "L" ? "#c45c52" : undefined);
                                return (
                                  <tr key={g.game_id}>
                                    <td style={cell}>{g.season}</td>
                                    <td style={cell}>{g.week}</td>
                                    <td style={cell}>{g.opponent}</td>
                                    <td style={cell}>{g.location === "home" ? "H" : g.location === "away" ? "A" : "N"}</td>
                                    <td style={cell}>{fmtSpread(spread)}</td>
                                    <td style={cell}>
                                      {g.team_points}-{g.opp_points}
                                    </td>
                                    <td style={{ ...cell, color: col(su), fontWeight: 700 }}>{su}</td>
                                    <td style={{ ...cell, color: col(ats), fontWeight: 700 }}>{ats ?? "–"}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4 + SPLITS.length} className="empty">
                  {loading ? "Loading…" : "No teams to show."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
