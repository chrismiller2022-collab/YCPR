import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONFERENCES, TEAMS } from "../data/teams";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchRatingPulls, fetchRatingWeights, saveSosToSite, type RatingPullRow } from "../lib/api/ratingSystems";
import { computeConglomeratedTable } from "../lib/ratingConglomerate";
import { computeBestWorst, type BestWorstCandidate } from "../lib/bestWorst";
import { getYcByTeam, conferenceOnly, computeAvgOppYc, computeAveragedSrsSos, type SrsSosRow } from "../lib/sos";

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

interface OppCell {
  opp: string;
  rating: number;
}

function toCell(c: BestWorstCandidate | null): OppCell | null {
  return c ? { opp: c.opponent.team, rating: c.oppCurrentRating } : null;
}

interface SosRow {
  team: string;
  div: "FBS" | "FCS";
  conf: string;
  avgOppYcTotal: number | null;
  avgOppYcConf: number | null;
  sosSrsTotal: number | null;
  sosSrsConf: number | null;
  numSrsRuns: number | null;
  bestWinTotal: OppCell | null;
  bestWinConf: OppCell | null;
  bestLossTotal: OppCell | null;
  bestLossConf: OppCell | null;
  worstLossTotal: OppCell | null;
  worstLossConf: OppCell | null;
}

const cellStyle: CSSProperties = { padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" };
const rightCellStyle: CSSProperties = { ...cellStyle, textAlign: "right" };

function OppCellDisplay({ v }: { v: OppCell | null }) {
  if (!v) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  return (
    <span>
      {fmtNum(v.rating)} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({v.opp})</span>
    </span>
  );
}

function sortValue(r: SosRow, key: string): string | number | null {
  switch (key) {
    case "team":
      return r.team;
    case "conf":
      return r.conf;
    case "avgOppYcTotal":
      return r.avgOppYcTotal;
    case "avgOppYcConf":
      return r.avgOppYcConf;
    case "sosSrsTotal":
      return r.sosSrsTotal;
    case "sosSrsConf":
      return r.sosSrsConf;
    case "bestWinTotal":
      return r.bestWinTotal?.rating ?? null;
    case "bestWinConf":
      return r.bestWinConf?.rating ?? null;
    case "bestLossTotal":
      return r.bestLossTotal?.rating ?? null;
    case "bestLossConf":
      return r.bestLossConf?.rating ?? null;
    case "worstLossTotal":
      return r.worstLossTotal?.rating ?? null;
    case "worstLossConf":
      return r.worstLossConf?.rating ?? null;
    default:
      return null;
  }
}

export default function SosAdminPanel({ onBack }: { onBack: () => void }) {
  const season = new Date().getFullYear();
  // Which week this save represents — team_sos is week-scoped now (was
  // a single overwritten row per team before), so this needs to be
  // explicit rather than assumed.
  const [saveWeek, setSaveWeek] = useState(1);
  const { byTeam: liveByTeam, loading: liveLoading } = useWeeklyStats("latest");

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [pulls, setPulls] = useState<RatingPullRow[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [pullsLoading, setPullsLoading] = useState(true);

  const [numRuns, setNumRuns] = useState(25);
  const [srsSos, setSrsSos] = useState<Map<string, SrsSosRow> | null>(null);
  const [runsUsedForSrs, setRunsUsedForSrs] = useState<number | null>(null);
  const [computingSrs, setComputingSrs] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [divFilter, setDivFilter] = useState<"all" | "FBS" | "FCS">("FBS");
  const [confFilter, setConfFilter] = useState("");
  const [sortKey, setSortKey] = useState("avgOppYcTotal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // negative-is-better -> ascending shows toughest first

  useEffect(() => {
    setGamesLoading(true);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setGamesLoading(false));
  }, [season]);

  useEffect(() => {
    setPullsLoading(true);
    Promise.all([fetchRatingPulls(), fetchRatingWeights()])
      .then(([p, w]) => {
        setPulls(p);
        setWeights(w);
      })
      .catch(() => {
        setPulls([]);
        setWeights({});
      })
      .finally(() => setPullsLoading(false));
  }, []);

  const conglomerated = useMemo(() => computeConglomeratedTable(pulls, weights), [pulls, weights]);
  const ycByTeam = useMemo(() => getYcByTeam(conglomerated), [conglomerated]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function runSrsSos() {
    if (games.length === 0 || computingSrs) return;
    setComputingSrs(true);
    // Deferred a tick so the "Computing…" state actually paints before the
    // (synchronous, potentially slow with a high run count) simulation
    // loop blocks the main thread.
    setTimeout(() => {
      try {
        setSrsSos(computeAveragedSrsSos(games, liveByTeam, numRuns));
        setRunsUsedForSrs(numRuns);
      } finally {
        setComputingSrs(false);
      }
    }, 30);
  }

  async function handleSaveToSite() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveSosToSite(season, saveWeek, rows);
      setSaveMsg(`Saved ${rows.length} teams to the site for week ${saveWeek}.`);
    } catch (err: any) {
      setSaveMsg(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const rows: SosRow[] = useMemo(() => {
    if (games.length === 0) return [];
    const confGames = conferenceOnly(games);

    return TEAMS.map((t) => {
      const oppYc = computeAvgOppYc(t.team, games, ycByTeam);
      const srs = srsSos?.get(t.team);

      const teamConfGames = confGames.filter((g) => g.home_team === t.team || g.away_team === t.team);
      const totalBw = computeBestWorst(t, games, liveByTeam);
      const confBw = computeBestWorst(t, teamConfGames, liveByTeam);

      return {
        team: t.team,
        div: t.div,
        conf: t.conf,
        avgOppYcTotal: oppYc.total,
        avgOppYcConf: oppYc.conference,
        sosSrsTotal: srs?.sosTotal ?? null,
        sosSrsConf: srs?.sosConference ?? null,
        numSrsRuns: srs ? runsUsedForSrs : null,
        bestWinTotal: toCell(totalBw.bestWin.actual),
        bestWinConf: toCell(confBw.bestWin.actual),
        bestLossTotal: toCell(totalBw.bestLoss.actual),
        bestLossConf: toCell(confBw.bestLoss.actual),
        worstLossTotal: toCell(totalBw.worstLoss.actual),
        worstLossConf: toCell(confBw.worstLoss.actual),
      };
    });
  }, [games, ycByTeam, srsSos, runsUsedForSrs, liveByTeam]);

  const filtered = rows.filter((r) => {
    if (divFilter !== "all" && r.div !== divFilter) return false;
    if (confFilter && r.conf !== confFilter) return false;
    return true;
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const loading = gamesLoading || pullsLoading || liveLoading;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Strength of Schedule</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Avg Opp PR is the average YC power rating of a team's opponents (site convention: lower/negative is better,
        so a lower Avg Opp PR means a tougher schedule). SOS (SRS) averages {numRuns} independent Monte Carlo
        simulated-season realizations through the same engine as the Monte Carlo SRS tab — that tab's number is a
        single realization and changes on every re-roll, this is the stabilized version. In-Conference restricts
        the games going into each calculation to conference games only, then reruns the identical math on that
        subset — it is not simply an average of conference opponents' ratings. Best/Worst PR use each opponent's
        current live rating (YC, once pushed from Rating Systems) for completed games only.
      </p>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
              Simulated runs:{" "}
              <input
                type="number"
                min={1}
                max={500}
                value={numRuns}
                onChange={(e) => setNumRuns(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 70 }}
              />
            </label>
            <button className="menu-btn" onClick={runSrsSos} disabled={computingSrs || games.length === 0}>
              {computingSrs ? "Computing…" : srsSos ? "Recompute SOS (SRS)" : "Compute SOS (SRS)"}
            </button>
            {!srsSos && !computingSrs && (
              <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                SOS (SRS) columns are empty until you run this — it's a heavier calc than the rest of the page.
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Save as week{" "}
              <input type="number" value={saveWeek} onChange={(e) => setSaveWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} min={0} />
            </label>
            <button className="menu-btn" onClick={handleSaveToSite} disabled={saving || rows.length === 0}>
              {saving ? "Saving…" : "Save to Site"}
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
              {saveMsg ?? "Saves every row above (regardless of the filters below) as this week's snapshot — public pages like Conference Previews read the latest saved week without recomputing, and this week's own numbers stay put once saved, no matter what gets saved for a later week."}
            </span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {(["FBS", "FCS", "all"] as const).map((d) => (
              <button key={d} className={`mode-btn ${divFilter === d ? "mode-btn-active" : ""}`} onClick={() => setDivFilter(d)}>
                {d === "all" ? "All" : d}
              </button>
            ))}
            <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
              <option value="">All conferences</option>
              {CONFERENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Avg Opp PR" sortKey="avgOppYcTotal" active={sortKey === "avgOppYcTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg Opp PR (Conf)" sortKey="avgOppYcConf" active={sortKey === "avgOppYcConf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="SOS (SRS)" sortKey="sosSrsTotal" active={sortKey === "sosSrsTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="SOS (SRS, Conf)" sortKey="sosSrsConf" active={sortKey === "sosSrsConf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Best Win PR" sortKey="bestWinTotal" active={sortKey === "bestWinTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Best Win PR (Conf)" sortKey="bestWinConf" active={sortKey === "bestWinConf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Best Loss PR" sortKey="bestLossTotal" active={sortKey === "bestLossTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Best Loss PR (Conf)" sortKey="bestLossConf" active={sortKey === "bestLossConf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Worst Loss PR" sortKey="worstLossTotal" active={sortKey === "worstLossTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Worst Loss PR (Conf)" sortKey="worstLossConf" active={sortKey === "worstLossConf"} dir={sortDir} onClick={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.team}>
                    <td style={cellStyle}>{r.conf}</td>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>
                      <TeamLogo team={r.team} /> {r.team}
                    </td>
                    <td style={rightCellStyle}>{fmtNum(r.avgOppYcTotal)}</td>
                    <td style={rightCellStyle}>{fmtNum(r.avgOppYcConf)}</td>
                    <td style={rightCellStyle}>{r.sosSrsTotal != null ? r.sosSrsTotal.toFixed(2) : "–"}</td>
                    <td style={rightCellStyle}>{r.sosSrsConf != null ? r.sosSrsConf.toFixed(2) : "–"}</td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.bestWinTotal} />
                    </td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.bestWinConf} />
                    </td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.bestLossTotal} />
                    </td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.bestLossConf} />
                    </td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.worstLossTotal} />
                    </td>
                    <td style={rightCellStyle}>
                      <OppCellDisplay v={r.worstLossConf} />
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={12} className="empty">
                      No teams to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
