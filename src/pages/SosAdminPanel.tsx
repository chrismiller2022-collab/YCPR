import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import SortHeader from "../components/SortHeader";
import TeamLink from "../components/TeamLink";
import { CONFERENCES, TEAMS, TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchRatingPulls, fetchRatingWeights, saveSosToSite, type RatingPullRow } from "../lib/api/ratingSystems";
import { computeConglomeratedTable } from "../lib/ratingConglomerate";
import { computeBestWorst, type BestWorstCandidate } from "../lib/bestWorst";
import { getYcByTeam, conferenceOnly, computeAvgOppYc, computeAveragedSrsSos, type SrsSosRow } from "../lib/sos";
import {
  SOS_FACTOR_KEYS,
  SOS_FACTOR_LABELS,
  SOS_FACTOR_HIGHER_IS_EASIER,
  normalizeSosFactor,
  computeSosBlendScore,
  DEFAULT_SOS_WEIGHTS,
  type RawSosFactors,
  type SosWeights,
} from "../lib/sosBlend";

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
  hypoWins: number | null;
  top7: number | null;
}

// Same two calculations as the public Strength of Schedule page's
// "Hypothetical #12 Team Win Total" and "Top 7" modes (see
// StrengthOfSchedulePage.tsx) — ported here as-is (same site power
// rating basis, not the Rating Systems "YC" conglomerate the rest of
// this page's Avg Opp PR/SOS (SRS) columns use) so Admin shows the exact
// same numbers the public page does, just alongside everything else.
function ratingForTeam(name: string, liveByTeam: Record<string, any>): number | null {
  const fallback = TEAMS_BY_NAME[name]?.rating;
  if (fallback == null) return null;
  return liveByTeam[name]?.rating ?? fallback;
}

function computeHypoWinsFor(teamName: string, games: GameWithLines[], liveByTeam: Record<string, any>, top12Rating: number | null): number | null {
  if (top12Rating == null) return null;
  const teamGames = games.filter((g) => g.home_team === teamName || g.away_team === teamName);
  if (teamGames.length === 0) return null;
  let expWins = 0;
  for (const g of teamGames) {
    const isHome = g.home_team === teamName;
    const oppName = isHome ? g.away_team : g.home_team;
    const oppRating = ratingForTeam(oppName, liveByTeam);
    if (oppRating == null) continue;
    const spread = isHome
      ? top12Rating - oppRating - hfaFor(teamName, liveByTeam)
      : top12Rating - oppRating + hfaFor(oppName, liveByTeam);
    expWins += spreadToWinPct(spread);
  }
  return expWins;
}

function computeTop7For(teamName: string, games: GameWithLines[], liveByTeam: Record<string, any>): number | null {
  const teamGames = games.filter((g) => g.home_team === teamName || g.away_team === teamName);
  const oppRatings: number[] = [];
  for (const g of teamGames) {
    const isHome = g.home_team === teamName;
    const oppName = isHome ? g.away_team : g.home_team;
    const oppRating = ratingForTeam(oppName, liveByTeam);
    if (oppRating != null) oppRatings.push(oppRating);
  }
  if (oppRatings.length === 0) return null;
  const toughest7 = [...oppRatings].sort((a, b) => a - b).slice(0, 7);
  return toughest7.reduce((s, r) => s + r, 0) / toughest7.length;
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
    case "hypoWins":
      return r.hypoWins;
    case "top7":
      return r.top7;
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
  useDefaultToAdminWeek(setSaveWeek);
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

  const [sosWeights, setSosWeights] = useState<SosWeights>({ ...DEFAULT_SOS_WEIGHTS });
  const [sosValueMode, setSosValueMode] = useState<"raw" | "normalized">("raw");
  const [blendSortKey, setBlendSortKey] = useState<string>("score");
  const [blendSortDir, setBlendSortDir] = useState<"asc" | "desc">("asc"); // negative-is-harder -> ascending shows hardest first

  function setSosWeight(key: string, value: number) {
    setSosWeights((prev) => ({ ...prev, [key]: value }));
  }

  function handleBlendSort(key: string) {
    if (blendSortKey === key) setBlendSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setBlendSortKey(key);
      setBlendSortDir("asc");
    }
  }

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

  // Same "#12 power-rated FBS team" reference point as the public page —
  // sorted ascending (most negative/best first), index 11.
  const top12Rating = useMemo(() => {
    const ratings = TEAMS.filter((t) => t.div === "FBS")
      .map((t) => ratingForTeam(t.team, liveByTeam))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return ratings.length >= 12 ? ratings[11] : null;
  }, [liveByTeam]);

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
        hypoWins: computeHypoWinsFor(t.team, games, liveByTeam, top12Rating),
        top7: computeTop7For(t.team, games, liveByTeam),
      };
    });
  }, [games, ycByTeam, srsSos, runsUsedForSrs, liveByTeam, top12Rating]);

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

  // SOS Blend — same normalize-then-weight pattern as Resume Rating,
  // applied to this page's own four schedule-strength numbers instead
  // of resume-quality metrics. Normalized against whichever teams are
  // currently shown (`filtered`), so switching the division/conference
  // filter re-scales -10..+10 to that pool, same as Resume's own
  // per-division normalization.
  const blendRawByTeam = useMemo(() => {
    const map = new Map<string, RawSosFactors>();
    for (const r of filtered) {
      map.set(r.team, { avgOppPR: r.avgOppYcTotal, sosSrs: r.sosSrsTotal, hypoWins: r.hypoWins, top7: r.top7 });
    }
    return map;
  }, [filtered]);

  const blendNormalizedByTeam = useMemo(() => {
    const pools: Partial<Record<keyof RawSosFactors, (number | null)[]>> = {};
    for (const key of SOS_FACTOR_KEYS) {
      pools[key] = filtered.map((r) => blendRawByTeam.get(r.team)?.[key] ?? null);
    }
    const result = new Map<string, Partial<Record<keyof RawSosFactors, number | null>>>();
    for (const r of filtered) {
      const raw = blendRawByTeam.get(r.team);
      const norm: Partial<Record<keyof RawSosFactors, number | null>> = {};
      for (const key of SOS_FACTOR_KEYS) {
        norm[key] = normalizeSosFactor(raw?.[key] ?? null, pools[key]!, SOS_FACTOR_HIGHER_IS_EASIER[key]);
      }
      result.set(r.team, norm);
    }
    return result;
  }, [filtered, blendRawByTeam]);

  const blendRows = useMemo(() => {
    return filtered.map((r) => {
      const raw = blendRawByTeam.get(r.team)!;
      const norm = blendNormalizedByTeam.get(r.team) ?? {};
      const score = computeSosBlendScore(norm, sosWeights);
      return { team: r.team, conf: r.conf, raw, norm, score };
    });
  }, [filtered, blendRawByTeam, blendNormalizedByTeam, sosWeights]);

  const sortedBlendRows = useMemo(() => {
    return [...blendRows].sort((a, b) => {
      const av =
        blendSortKey === "team" ? a.team : blendSortKey === "conf" ? a.conf : blendSortKey === "score" ? a.score : a.raw[blendSortKey as keyof RawSosFactors];
      const bv =
        blendSortKey === "team" ? b.team : blendSortKey === "conf" ? b.conf : blendSortKey === "score" ? b.score : b.raw[blendSortKey as keyof RawSosFactors];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return blendSortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return blendSortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [blendRows, blendSortKey, blendSortDir]);

  const loading = gamesLoading || pullsLoading || liveLoading;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Strength of Schedule</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Avg Opp PR is the average YC power rating of a team's opponents (site convention: lower/negative is better,
        so a lower Avg Opp PR means a tougher schedule) — "YC" is the Rating Systems conglomerate blend (Rating
        Systems → weights), NOT the plain power rating the public SOS pages use, which is why this number's ORDER
        roughly tracks the public page's Avg Opp PR/Top 7 columns (both are opponent-quality signals) but the actual
        VALUES don't match — different underlying rating. SOS (SRS) averages {numRuns} independent Monte Carlo
        simulated-season realizations through the same engine as the Monte Carlo SRS tab — that tab's number is a
        single realization and changes on every re-roll, this is the stabilized version. Hypo #12 Wins and Top 7 Avg
        PR are the exact same calculations as the public page's own "Hypothetical #12 Team Win Total" and "Top 7"
        modes (plain power rating, not YC — ported as-is so these two numbers match the public page exactly).
        In-Conference restricts the games going into each calculation to conference games only, then reruns the
        identical math on that subset — it is not simply an average of conference opponents' ratings. Best/Worst PR
        use each opponent's current live rating (YC, once pushed from Rating Systems) for completed games only.
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
                  <SortHeader label="Hypo #12 Wins" sortKey="hypoWins" active={sortKey === "hypoWins"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Top 7 Avg PR" sortKey="top7" active={sortKey === "top7"} dir={sortDir} onClick={handleSort} align="right" />
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
                      <TeamLink team={r.team} />
                    </td>
                    <td style={rightCellStyle}>{fmtNum(r.avgOppYcTotal)}</td>
                    <td style={rightCellStyle}>{fmtNum(r.avgOppYcConf)}</td>
                    <td style={rightCellStyle}>{r.sosSrsTotal != null ? r.sosSrsTotal.toFixed(2) : "–"}</td>
                    <td style={rightCellStyle}>{r.sosSrsConf != null ? r.sosSrsConf.toFixed(2) : "–"}</td>
                    <td style={rightCellStyle}>{r.hypoWins != null ? r.hypoWins.toFixed(2) : "–"}</td>
                    <td style={rightCellStyle}>{fmtNum(r.top7)}</td>
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
                    <td colSpan={14} className="empty">
                      No teams to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: "2rem" }}>SOS Blend</h2>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
            Each factor is normalized -10 (hardest of the {filtered.length} teams currently shown by the filters
            above) to +10 (easiest), min-max — switching the Division/Conference filter re-normalizes against that
            narrower pool. The blend score is a weighted average of whichever normalized factors have a non-zero
            weight — it stays on the same -10..+10 scale as the inputs, so a team weighting only Avg Opp PR would
            score identically to that factor's own normalized value. Set a weight to 0 to drop a factor entirely.
            Weights here are local to this browser session — they don't persist to the site the way Resume's weights
            do (yet).
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1rem",
              padding: "1rem",
              background: "var(--turf-panel)",
              border: "1px solid var(--hash)",
              borderRadius: 8,
              maxWidth: 700,
            }}
          >
            {SOS_FACTOR_KEYS.map((key) => (
              <label key={key} style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                {SOS_FACTOR_LABELS[key]}
                <br />
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={sosWeights[key] ?? 0}
                  onChange={(e) => setSosWeight(key, parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", marginTop: "0.2rem" }}
                />
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
            <button className="menu-btn" onClick={() => setSosWeights({ ...DEFAULT_SOS_WEIGHTS })}>
              Reset to 1x Each
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Values:</span>
            <button className={`mode-btn ${sosValueMode === "raw" ? "mode-btn-active" : ""}`} onClick={() => setSosValueMode("raw")}>
              Raw
            </button>
            <button className={`mode-btn ${sosValueMode === "normalized" ? "mode-btn-active" : ""}`} onClick={() => setSosValueMode("normalized")}>
              Normalized (-10..+10)
            </button>
          </div>

          <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Conf" sortKey="conf" active={blendSortKey === "conf"} dir={blendSortDir} onClick={handleBlendSort} />
                  <SortHeader label="Team" sortKey="team" active={blendSortKey === "team"} dir={blendSortDir} onClick={handleBlendSort} />
                  <SortHeader label="Blend Score" sortKey="score" active={blendSortKey === "score"} dir={blendSortDir} onClick={handleBlendSort} align="right" />
                  {SOS_FACTOR_KEYS.map((key) => (
                    <SortHeader
                      key={key}
                      label={SOS_FACTOR_LABELS[key]}
                      sortKey={key}
                      active={blendSortKey === key}
                      dir={blendSortDir}
                      onClick={handleBlendSort}
                      align="right"
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedBlendRows.map((r) => (
                  <tr key={r.team}>
                    <td style={cellStyle}>{r.conf}</td>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>
                      <TeamLink team={r.team} />
                    </td>
                    <td style={{ ...rightCellStyle, fontWeight: 700 }}>{fmtNum(r.score)}</td>
                    {SOS_FACTOR_KEYS.map((key) => (
                      <td key={key} style={rightCellStyle}>
                        {fmtNum(sosValueMode === "raw" ? r.raw[key] : r.norm[key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {sortedBlendRows.length === 0 && (
                  <tr>
                    <td colSpan={3 + SOS_FACTOR_KEYS.length} className="empty">
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
