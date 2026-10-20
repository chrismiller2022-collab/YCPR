import { TEAMS, TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, spreadToWinPct } from "./odds";
import type { GameWithLines } from "./api/gamesLines";
import { computeConglomeratedTable } from "./ratingConglomerate";
import { computeBestWorst, type BestWorstCandidate } from "./bestWorst";
import { getYcByTeam, conferenceOnly, computeAvgOppYc, computeAveragedSrsSos, type SrsSosRow } from "./sos";
import { computeSosBlendByTeam, DEFAULT_SOS_WEIGHTS, type RawSosFactors, type SosWeights } from "./sosBlend";
import { fetchGamesWithLines } from "./api/gamesLines";
import { fetchRatingPulls, fetchRatingWeights, fetchWeeklyPowerRatings, saveSosToSite } from "./api/ratingSystems";
import { fetchSeasonWeeklyRatingsForWeeks } from "./api/seasonWeeklyRatings";
import { fetchAvailableWeeks, fetchWeeklyStats } from "./api/weeklyStats";

// SOS for every team: Avg Opp PR (YC), SOS (SRS), best/worst wins and losses, the hypothetical #12 team's win total,
// Top 7, and the SOS Blend of those. Shared by the SOS admin page, the Monte Carlo run (which saves SOS for the week
// it runs) and the past-week backfill, so all three store the same numbers for the same inputs.

export interface OppCell {
  opp: string;
  rating: number;
}

export function toCell(c: BestWorstCandidate | null): OppCell | null {
  return c ? { opp: c.opponent.team, rating: c.oppCurrentRating } : null;
}

export interface SosRow {
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


/** Same "#12 power-rated FBS team" reference as the public page: ascending (best first), index 11. */
export function top12RatingOf(liveByTeam: Record<string, any>): number | null {
  const ratings = TEAMS.filter((t) => t.div === "FBS")
    .map((t) => ratingForTeam(t.team, liveByTeam))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  return ratings.length >= 12 ? ratings[11] : null;
}

export function computeSosRows(input: {
  games: GameWithLines[];
  ycByTeam: Record<string, number | null>;
  liveByTeam: Record<string, any>;
  srsSos: Map<string, SrsSosRow> | null;
  numSrsRuns: number | null;
}): SosRow[] {
  const { games, ycByTeam, liveByTeam, srsSos, numSrsRuns } = input;
  if (games.length === 0) return [];
  const confGames = conferenceOnly(games);
  const top12 = top12RatingOf(liveByTeam);
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
      numSrsRuns: srs ? numSrsRuns : null,
      bestWinTotal: toCell(totalBw.bestWin.actual),
      bestWinConf: toCell(confBw.bestWin.actual),
      bestLossTotal: toCell(totalBw.bestLoss.actual),
      bestLossConf: toCell(confBw.bestLoss.actual),
      worstLossTotal: toCell(totalBw.worstLoss.actual),
      worstLossConf: toCell(confBw.worstLoss.actual),
      hypoWins: computeHypoWinsFor(t.team, games, liveByTeam, top12),
      top7: computeTop7For(t.team, games, liveByTeam),
    };
  });
}

export function sosBlendFor(rows: SosRow[], weights: SosWeights) {
  return computeSosBlendByTeam(
    rows.map((r) => ({ team: r.team, div: r.div, factors: { avgOppPR: r.avgOppYcTotal, sosSrs: r.sosSrsTotal, hypoWins: r.hypoWins, top7: r.top7 } as RawSosFactors })),
    weights
  );
}

/** The rows as Save to Site stores them (with blend score and the weights used). */
export function sosSaveRows(rows: SosRow[], weights: SosWeights) {
  const blend = sosBlendFor(rows, weights);
  return rows.map((r) => ({ ...r, blendScore: blend.get(r.team)?.score ?? null, blendWeights: weights }));
}

/** The schedule as it stood going into `week`: games from that week on count as unplayed (no scores). */
export function gamesAsOfWeek(games: GameWithLines[], week: number): GameWithLines[] {
  return games.map((g) => (g.week >= week ? { ...g, completed: false, home_points: null, away_points: null } : g));
}

export const DEFAULT_SRS_RUNS = 25;

/**
 * Computes and saves SOS for (season, week) from the live tables: current rating pulls (YC) and the live power
 * ratings. Called by the Monte Carlo run so a week's SOS is saved along with its sim.
 */
export async function computeAndSaveLiveSos(season: number, week: number, weights: SosWeights = DEFAULT_SOS_WEIGHTS) {
  // The live power ratings: the newest week label, same as useWeeklyStats("latest").
  const label = (await fetchAvailableWeeks())[0] ?? "preseason";
  const [games, pulls, ratingWeights, liveRows] = await Promise.all([fetchGamesWithLines(season), fetchRatingPulls(), fetchRatingWeights(), fetchWeeklyStats(label)]);
  const liveByTeam: Record<string, any> = {};
  for (const r of liveRows) liveByTeam[r.team] = r;
  const ycByTeam = getYcByTeam(computeConglomeratedTable(pulls, ratingWeights));
  const srsSos = computeAveragedSrsSos(games, liveByTeam, DEFAULT_SRS_RUNS);
  const rows = computeSosRows({ games, ycByTeam, liveByTeam, srsSos, numSrsRuns: DEFAULT_SRS_RUNS });
  const saveRows = sosSaveRows(rows, weights);
  await saveSosToSite(season, week, saveRows);
  return { saved: saveRows.length, withBlend: saveRows.filter((r) => r.blendScore != null).length };
}

/**
 * SOS for a past week as it would have been saved then: that week's saved power ratings (Save as Week), that week's
 * saved YC, and only the results played before it. Returns rows for preview; nothing is written.
 */
export async function computeSosForPastWeek(season: number, week: number, weights: SosWeights = DEFAULT_SOS_WEIGHTS) {
  const [allGames, ratingsByWeek, powerRows] = await Promise.all([fetchGamesWithLines(season), fetchSeasonWeeklyRatingsForWeeks(season, [week]), fetchWeeklyPowerRatings(season, week)]);
  const liveByTeam = ratingsByWeek[week] ?? {};
  const ycByTeam: Record<string, number | null> = {};
  for (const r of powerRows) if (r.system_key === "yc") ycByTeam[r.team] = r.value;
  const games = gamesAsOfWeek(allGames, week);
  const srsSos = computeAveragedSrsSos(games, liveByTeam, DEFAULT_SRS_RUNS);
  const rows = computeSosRows({ games, ycByTeam, liveByTeam, srsSos, numSrsRuns: DEFAULT_SRS_RUNS });
  return { rows, saveRows: sosSaveRows(rows, weights), ratedTeams: Object.keys(liveByTeam).length, ycTeams: Object.keys(ycByTeam).length };
}
