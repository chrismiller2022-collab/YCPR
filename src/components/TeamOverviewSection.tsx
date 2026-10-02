import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TEAMS } from "../data/teams";
import { fetchTeamCoachSeasons, type TeamCoachSeasonRow } from "../lib/api/teamInfo";
import { SPLITS, fetchCoachGameLog, fmtRec, tallyCoachRows, winPct, type LogRow, type Rec } from "../lib/coachRecords";
import { TeamRatingHistoryChart, TeamWinsVsExpectedChart } from "./TeamTrendCharts";

const cell: CSSProperties = { padding: "0.3rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

const FBS_TEAMS = TEAMS.filter((t) => t.div === "FBS").sort((a, b) => a.team.localeCompare(b.team));

function RecCell({ r }: { r: Rec }) {
  const p = winPct(r);
  return (
    <td style={{ ...num, color: p == null ? undefined : p > 0.5 ? "#8fd39a" : p < 0.5 ? "#c45c52" : undefined }} title={p == null ? undefined : `${(p * 100).toFixed(0)}%`}>
      {fmtRec(r)}
    </td>
  );
}

interface CoachStint {
  coachId: string;
  name: string;
  firstYear: number;
  lastYear: number;
  seasons: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  bestSrs: number | null;
  years: TeamCoachSeasonRow[];
}

// CFBD coach-seasons collapsed to one line per coach (a mid-season firing
// leaves two coaches in the same year, each with their own games).
function toStints(rows: TeamCoachSeasonRow[]): CoachStint[] {
  const by = new Map<string, CoachStint>();
  for (const r of rows) {
    let s = by.get(r.coach_id);
    if (!s) {
      s = { coachId: r.coach_id, name: r.coach_name, firstYear: r.year, lastYear: r.year, seasons: 0, games: 0, wins: 0, losses: 0, ties: 0, bestSrs: null, years: [] };
      by.set(r.coach_id, s);
    }
    s.firstYear = Math.min(s.firstYear, r.year);
    s.lastYear = Math.max(s.lastYear, r.year);
    s.seasons += 1;
    s.games += r.games ?? 0;
    s.wins += r.wins ?? 0;
    s.losses += r.losses ?? 0;
    s.ties += r.ties ?? 0;
    if (r.srs != null) s.bestSrs = s.bestSrs == null ? r.srs : Math.max(s.bestSrs, r.srs);
    s.years.push(r);
  }
  return Array.from(by.values()).sort((a, b) => b.firstYear - a.firstYear || b.lastYear - a.lastYear);
}

/**
 * Per-team overview for the admin: the current head coach's record (SU + ATS,
 * overall and split by favorite/underdog, home/away and the combinations) over
 * his whole tenure here and over just the current season, the school's coach
 * history, and the same two trend charts shown on the public team page.
 */
export default function TeamOverviewSection({
  season,
  refreshKey = 0,
  fixedTeam,
  showCharts = true,
}: {
  season: number;
  refreshKey?: number;
  /** Pin one team (hides the picker) — used by the admin-only block at the bottom of the public team page. */
  fixedTeam?: string;
  /** The two trend charts; the public team page already shows them, so it turns them off here. */
  showCharts?: boolean;
}) {
  const [pickedTeam, setPickedTeam] = useState("Georgia");
  const team = fixedTeam ?? pickedTeam;
  const [lineMode, setLineMode] = useState<"close" | "open">("close");
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [history, setHistory] = useState<TeamCoachSeasonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLog(null);
    setHistory(null);
    setError(null);
    Promise.all([fetchCoachGameLog(team), fetchTeamCoachSeasons(team)])
      .then(([l, h]) => {
        if (cancelled) return;
        setLog(l);
        setHistory(h);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [team, refreshKey]);

  const coach = log && log.length > 0 ? log[0] : null;
  const dataFrom = log && log.length > 0 ? Math.min(...log.map((g) => g.season)) : null;
  const currentSeasonRows = useMemo(() => (log ?? []).filter((g) => g.season === season), [log, season]);
  const tenure = useMemo(() => tallyCoachRows(log ?? [], lineMode), [log, lineMode]);
  const thisSeason = useMemo(() => tallyCoachRows(currentSeasonRows, lineMode), [currentSeasonRows, lineMode]);
  const stints = useMemo(() => toStints(history ?? []), [history]);
  const partial = coach != null && coach.first_year_at_school != null && dataFrom != null && dataFrom > coach.first_year_at_school;

  return (
    <div style={{ marginTop: "2.5rem" }}>
      <h2>{fixedTeam ? `${team} — admin overview` : "Team Overview"}</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Current head coach's record over the whole tenure and over {season} only, in every home/away/favorite/underdog bucket, plus the school's coach history.
      </p>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        {!fixedTeam && (
          <select className="filter" value={team} onChange={(e) => setPickedTeam(e.target.value)}>
            {FBS_TEAMS.map((t) => (
              <option key={t.team} value={t.team}>
                {t.team}
              </option>
            ))}
          </select>
        )}
        {(["close", "open"] as const).map((m) => (
          <button key={m} className={`mode-btn ${lineMode === m ? "mode-btn-active" : ""}`} onClick={() => setLineMode(m)}>
            {m === "close" ? "Closing line" : "Opening line"}
          </button>
        ))}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!log && !error && <p>Loading…</p>}
      {log && log.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "#d9a441" }}>No coach game log for {team} — run "Pull Team Info" with Coaches checked.</p>
      )}

      {coach && (
        <>
          <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>
            {coach.coach_name}
            <span style={{ fontWeight: 400, color: "var(--chalk-dim)" }}> — at {team} since {coach.first_year_at_school ?? "?"}</span>
          </div>
          {partial && (
            <p style={{ fontSize: "0.8rem", color: "#d9a441", margin: "0 0 0.5rem" }}>
              ⚠ Games before {dataFrom} aren't in the database, so the tenure record is partial (coach arrived {coach.first_year_at_school}).
            </p>
          )}
          <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxWidth: 760 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: "left" }} rowSpan={2}>
                    Bucket
                  </th>
                  <th style={{ ...num, textAlign: "center" }} colSpan={2}>
                    Whole tenure ({tenure.games} G)
                  </th>
                  <th style={{ ...num, textAlign: "center" }} colSpan={2}>
                    {season} only ({thisSeason.games} G)
                  </th>
                </tr>
                <tr>
                  {["SU", "ATS", "SU", "ATS"].map((h, i) => (
                    <th key={i} style={{ ...num, color: "var(--chalk-dim)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SPLITS.map((s) => (
                  <tr key={s.key}>
                    <td style={{ ...cell, fontWeight: s.key === "all" ? 700 : 400 }}>{s.label}</td>
                    <RecCell r={tenure.su[s.key]} />
                    <RecCell r={tenure.ats[s.key]} />
                    <RecCell r={thisSeason.su[s.key]} />
                    <RecCell r={thisSeason.ats[s.key]} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>
            Neutral-site games count in Overall/Fav/Dog but not Home/Away. A game with no line counts SU only (Fav/Dog buckets need a line); ATS pushes are the third number. Tenure = every completed game since
            his first season here, {tenure.graded} of {tenure.games} with a {lineMode === "open" ? "opening" : "closing"} line.
          </p>
        </>
      )}

      <div style={{ fontWeight: 700, margin: "1.25rem 0 0.3rem" }}>Coach history</div>
      {history && stints.length === 0 && (
        <p style={{ fontSize: "0.82rem", color: "#d9a441" }}>
          No coach history stored yet — run "Pull Team Info" with "Coaches + tenure" checked (it now also saves each coach's season-by-season history from CFBD).
        </p>
      )}
      {stints.length > 0 && (
        <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxWidth: 760 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                {["Coach", "Years", "Seasons", "Record (CFBD)", "Win %", "Best SRS"].map((h, i) => (
                  <th key={h} style={{ ...(i >= 2 ? num : cell), textAlign: i >= 2 ? "right" : "left", color: "var(--chalk-dim)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stints.map((s) => {
                const decided = s.wins + s.losses;
                return (
                  <tr key={s.coachId} title={s.years.map((y) => `${y.year}: ${y.wins ?? "?"}-${y.losses ?? "?"}`).join("   ")}>
                    <td style={{ ...cell, fontWeight: s.lastYear >= season ? 700 : 400 }}>{s.name}</td>
                    <td style={cell}>{s.firstYear === s.lastYear ? s.firstYear : `${s.firstYear}–${s.lastYear}`}</td>
                    <td style={num}>{s.seasons}</td>
                    <td style={num}>
                      {s.wins}-{s.losses}
                      {s.ties ? `-${s.ties}` : ""}
                    </td>
                    <td style={num}>{decided > 0 ? `${((s.wins / decided) * 100).toFixed(1)}%` : "–"}</td>
                    <td style={num}>{s.bestSrs != null ? s.bestSrs.toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>
        Records and SRS are CFBD's season totals, not graded against the spread. Hover a row for the per-season record. The window is the last 30 seasons, so a coach who started earlier shows only those years.
      </p>

      {showCharts && (
        <div style={{ marginTop: "1.25rem", maxWidth: 760 }}>
          <TeamRatingHistoryChart team={team} season={season} />
          <TeamWinsVsExpectedChart team={team} season={season} />
        </div>
      )}
    </div>
  );
}
