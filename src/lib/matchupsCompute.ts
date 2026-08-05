import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, spreadToMoneyline, spreadToWinPct } from "./odds";
import { type GameWithLines, type BettingLineRow } from "./api/gamesLines";
import { DEFAULT_CUSTOM_PARAMS } from "./betHistory";
import { type ErrorStatsBundle, bundleErrors } from "./errorStats";

// ---------------------------------------------------------------------
// SIGN CONVENTION — worth double-checking against real results:
// This site's existing convention (TeamPage, MatchupsPage,
// ScheduleSwapPage) expresses spread from the AWAY team's perspective:
// negative = away favored, positive = home favored. CFBD's raw `spread`
// field is documented as home-team-perspective (negative = home
// favored), so it's negated here to convert into our convention:
//   vegasAwaySpread = -cfbdLine.spread
// This has NOT yet been verified against a completed game with a known
// final line — once a real graded game is in the data, it's worth
// eyeballing one row to confirm "Act. Cover Team" comes out right.
// ---------------------------------------------------------------------

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];

export function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const match = lines.find((l) => l.provider === p);
    if (match) return match;
  }
  return lines[0];
}

export function classOf(g: GameWithLines, side: "home" | "away"): string {
  const c = side === "home" ? g.home_classification : g.away_classification;
  return (c ?? "").toLowerCase();
}

export function isTracked(c: string) {
  return c === "fbs" || c === "fcs";
}

export interface MatchupComputed {
  game: GameWithLines;
  line: BettingLineRow | null;
  awayTeam: any | null;
  homeTeam: any | null;
  projAwaySpread: number | null;
  vegasAwaySpread: number | null;
  amountOff: number | null;
  absAmountOff: number | null;
  relativeOff: number | null;
  sigmaOff: number | null; // absAmountOff / 15.7 (site's game-outcome stddev) — how many "standard game swings" off the market
  projWinPct: number | null;
  projMoneyline: number | null;
  vegasMoneyline: number | null;
  vegasWinPct: number | null;
  ev: number | null; // projWinPct - vegasWinPct, in percentage points
  projCoverTeam: "away" | "home" | null;
  filteredBetTeam: "away" | "home" | null;
  weightedFilteredBetTeam: "away" | "home" | null;
  nwfbTeam: "away" | "home" | null; // sigmaOff > 0.4
  betTeam: "away" | "home" | null; // whichever team projCoverTeam picks, IF any of filtered/WFB/NWFB signal
  wtfTeam: "away" | "home" | null;
  actCoverTeam: "away" | "home" | "push" | null;
  totalResult: "Over" | "Under" | "Push" | null;
}

export interface Tally {
  w: number;
  l: number;
  push?: number;
}

export interface MatchupStatsBundle {
  straightUp: { yc: Tally; vegas: Tally };
  ats: { yc: Tally; baselineWins: number; baselineLosses: number; baselineTotal: number };
  filtered: Tally;
  wfb: Tally;
  nwfb: Tally;
}

// Standard -110 vig breakeven: at typical spread-betting odds (risk $110
// to win $100), you need to win 110/(110+100) = 52.38...% of your
// decided bets just to BREAK EVEN, before any profit — this is a fixed
// bankroll-management constant baked into how the vig works, not
// something computed from your predictions, your edge size, or the
// specific games in the dataset. It never changes regardless of what
// subset of games you're looking at.
export const ATS_BREAKEVEN_PCT = 110 / 210; // ~0.523809...

/**
 * Straight Up (YC's projected winner vs Vegas's implied favorite, each
 * graded against the actual winner) and ATS (YC's cover pick vs the
 * fixed -110 breakeven baseline above — NOT 50%, and not derived from
 * this dataset at all).
 */
export function computeMatchupStats(rows: MatchupComputed[]): MatchupStatsBundle {
  const ycStraightUp: Tally = { w: 0, l: 0 };
  const vegasStraightUp: Tally = { w: 0, l: 0 };
  const ats: Tally = { w: 0, l: 0, push: 0 };
  const filtered: Tally = { w: 0, l: 0, push: 0 };
  const wfb: Tally = { w: 0, l: 0, push: 0 };
  const nwfb: Tally = { w: 0, l: 0, push: 0 };

  function grade(tally: Tally, team: "away" | "home" | null, actCoverTeam: "away" | "home" | "push" | null) {
    if (!team || !actCoverTeam) return;
    if (actCoverTeam === "push") {
      tally.push = (tally.push ?? 0) + 1;
      return;
    }
    if (team === actCoverTeam) tally.w++;
    else tally.l++;
  }

  for (const r of rows) {
    if (!r.game.completed || r.game.away_points == null || r.game.home_points == null) continue;
    if (r.game.away_points === r.game.home_points) continue; // guard, shouldn't happen in real CFB

    const actualAwayWon = r.game.away_points > r.game.home_points;

    if (r.projAwaySpread != null && r.projAwaySpread !== 0) {
      const ycPickedAway = r.projAwaySpread < 0;
      if (ycPickedAway === actualAwayWon) ycStraightUp.w++;
      else ycStraightUp.l++;
    }

    if (r.vegasAwaySpread != null && r.vegasAwaySpread !== 0) {
      const vegasPickedAway = r.vegasAwaySpread < 0;
      if (vegasPickedAway === actualAwayWon) vegasStraightUp.w++;
      else vegasStraightUp.l++;
    }

    grade(ats, r.projCoverTeam, r.actCoverTeam);
    grade(filtered, r.filteredBetTeam, r.actCoverTeam);
    grade(wfb, r.weightedFilteredBetTeam, r.actCoverTeam);
    grade(nwfb, r.nwfbTeam, r.actCoverTeam);
  }

  const decided = ats.w + ats.l;
  const baselineWins = decided * ATS_BREAKEVEN_PCT;
  const baselineLosses = decided - baselineWins;

  return {
    straightUp: { yc: ycStraightUp, vegas: vegasStraightUp },
    ats: { yc: ats, baselineWins, baselineLosses, baselineTotal: decided },
    filtered,
    wfb,
    nwfb,
  };
}

// ---------------------------------------------------------------------
// Error metrics — how far off each projection was from the ACTUAL final
// margin, for YC's model vs Vegas's own line. Both projAwaySpread and
// vegasAwaySpread already use this site's away-perspective convention
// (positive = home favored), which is the same sign convention as
// "actual home margin" (homePoints - awayPoints, positive = home won) —
// no conversion needed, they subtract directly.
// ---------------------------------------------------------------------
export function computeErrorStats(rows: MatchupComputed[]): ErrorStatsBundle {
  const ycErrors: number[] = [];
  const vegasErrors: number[] = [];

  for (const r of rows) {
    if (!r.game.completed || r.game.away_points == null || r.game.home_points == null) continue;
    const actualHomeMargin = r.game.home_points - r.game.away_points;

    if (r.projAwaySpread != null) ycErrors.push(actualHomeMargin - r.projAwaySpread);
    if (r.vegasAwaySpread != null) vegasErrors.push(actualHomeMargin - r.vegasAwaySpread);
  }

  return bundleErrors(ycErrors, vegasErrors);
}

export function computeRow(game: GameWithLines, liveByTeam: Record<string, any>): MatchupComputed {
  const line = pickLine(game.lines);
  const awayTeam = TEAMS_BY_NAME[game.away_team] ?? null;
  const homeTeam = TEAMS_BY_NAME[game.home_team] ?? null;

  const projAwaySpread =
    awayTeam && homeTeam ? awayTeam.rating - homeTeam.rating + hfaFor(game.home_team, liveByTeam) : null;

  const vegasAwaySpread = line?.spread != null ? -line.spread : null;

  const amountOff = projAwaySpread != null && vegasAwaySpread != null ? projAwaySpread - vegasAwaySpread : null;

  const projWinPct = projAwaySpread != null ? spreadToWinPct(projAwaySpread) : null;
  const projMoneyline = projAwaySpread != null ? spreadToMoneyline(projAwaySpread) : null;
  const vegasMoneyline = line?.away_moneyline ?? null;

  // Standard moneyline-to-implied-probability conversion. This includes
  // the sportsbook's vig (implied probabilities on both sides of a
  // two-way market sum to slightly more than 100%), so it's "Vegas's
  // implied win% for the away side," not a de-vigged true probability.
  const vegasWinPct =
    vegasMoneyline != null
      ? vegasMoneyline > 0
        ? 100 / (vegasMoneyline + 100)
        : Math.abs(vegasMoneyline) / (Math.abs(vegasMoneyline) + 100)
      : null;

  const ev = projWinPct != null && vegasWinPct != null ? (projWinPct - vegasWinPct) * 100 : null;

  let projCoverTeam: "away" | "home" | null = null;
  if (projAwaySpread != null && vegasAwaySpread != null) {
    const projDiff = vegasAwaySpread - projAwaySpread;
    projCoverTeam = projDiff > 0 ? "away" : projDiff < 0 ? "home" : null;
  }

  const absAmountOff = amountOff != null ? Math.abs(amountOff) : null;
  const absBettingLine = vegasAwaySpread != null ? Math.abs(vegasAwaySpread) : null;
  const relativeOff =
    amountOff != null && vegasAwaySpread != null && vegasAwaySpread !== 0 ? Math.abs(amountOff) / vegasAwaySpread : null;

  const filteredBetTeam =
    absAmountOff != null && absAmountOff > DEFAULT_CUSTOM_PARAMS.filterThreshold ? projCoverTeam : null;

  // Favorite flip — Vegas and our model disagree on which side is even
  // favored at all, not just by how much. Computed here (before Weighted
  // Filtered) because it overrides that check below: a flip is a
  // qualitatively different, stronger signal than the relative-off ratio
  // was ever designed to capture, and dividing by a large Vegas line
  // systematically shrinks that ratio for exactly the biggest flips
  // (a 10+ point underdog flipped to favorite reads as a "small" relative
  // number purely because the denominator is big) — so a real flip always
  // qualifies regardless of what the ratio says.
  let wtfTeam: "away" | "home" | null = null;
  if (projAwaySpread != null && vegasAwaySpread != null && projAwaySpread !== 0 && vegasAwaySpread !== 0) {
    const oursFavorsAway = projAwaySpread < 0;
    const vegasFavorsAway = vegasAwaySpread < 0;
    if (oursFavorsAway !== vegasFavorsAway) {
      wtfTeam = oursFavorsAway ? "away" : "home";
    }
  }

  const weightedFilteredBetTeam =
    wtfTeam != null && absBettingLine != null && absBettingLine > DEFAULT_CUSTOM_PARAMS.minAbsLine
      ? projCoverTeam
      : absBettingLine != null &&
        absBettingLine > DEFAULT_CUSTOM_PARAMS.minAbsLine &&
        relativeOff != null &&
        (relativeOff > DEFAULT_CUSTOM_PARAMS.posThreshold || relativeOff < DEFAULT_CUSTOM_PARAMS.negThreshold)
      ? projCoverTeam
      : null;

  // Sigma Off: absAmountOff expressed in units of the site's own
  // game-outcome standard deviation (15.7, from the Monte Carlo
  // methodology) — "how many standard game swings is this disagreement
  // worth," independent of the size of the line itself.
  const sigmaOff = absAmountOff != null ? absAmountOff / 15.7 : null;

  const nwfbTeam = sigmaOff != null && sigmaOff > 0.4 ? projCoverTeam : null;

  const betTeam = filteredBetTeam ?? weightedFilteredBetTeam ?? nwfbTeam;

  let actCoverTeam: "away" | "home" | "push" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && vegasAwaySpread != null) {
    const actualAwayMargin = game.away_points - game.home_points;
    const coverMargin = actualAwayMargin + vegasAwaySpread;
    actCoverTeam = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  }

  let totalResult: "Over" | "Under" | "Push" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && line?.over_under != null) {
    const actualTotal = game.away_points + game.home_points;
    totalResult = actualTotal > line.over_under ? "Over" : actualTotal < line.over_under ? "Under" : "Push";
  }

  return {
    game,
    line,
    awayTeam,
    homeTeam,
    projAwaySpread,
    vegasAwaySpread,
    amountOff,
    absAmountOff,
    relativeOff,
    sigmaOff,
    projWinPct,
    projMoneyline,
    vegasMoneyline,
    vegasWinPct,
    ev,
    projCoverTeam,
    filteredBetTeam,
    weightedFilteredBetTeam,
    nwfbTeam,
    betTeam,
    wtfTeam,
    actCoverTeam,
    totalResult,
  };
}
