import { TEAMS_BY_NAME } from "../data/teams";
import { HFA, hfaFor, spreadToMoneyline, spreadToWinPct, fairMoneylineFromWinPct } from "./odds";
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
  betCategory: BetCategory | null;
  betSizePct: number | null; // 1/10 Kelly stake, as a fraction of bankroll (0.015 = 1.5%), capped at 0.05
}

// ---------------------------------------------------------------------
// Bet sizing — 1/10 Kelly, using historical win rates per bet category
// rather than a per-game probability, since the categories themselves
// (Bet 1/Filtered, Bet 2/WFB, Bet 3/NWFB, and their overlaps) are already
// the site's backtested signal buckets. Standard -110 odds are assumed
// throughout (matches the ATS_BREAKEVEN_PCT convention used elsewhere in
// this file) since that's the typical price being bet against.
//
// Categories are resolved by priority — strongest signal wins, so a game
// where all three bet flags happen to fire still lands in the best-known
// tier (Bets 1 & 2) rather than falling through unclassified:
//   1. Bet 1 AND Bet 2 both fire  -> 73.0% historical win rate
//   2. Bet 2 AND Bet 3 both fire  -> 70.0%
//   3. Bet 1 fires (alone)        -> 59.5%
//   4. Bet 2 or Bet 3 fires alone -> 60.9%
// ---------------------------------------------------------------------
export type BetCategory = "Bets 1 & 2" | "Bets 2 & 3" | "Bet 1" | "Bet 2 or 3";

export const BET_CATEGORY_WIN_PCT: Record<BetCategory, number> = {
  "Bets 1 & 2": 0.73,
  "Bets 2 & 3": 0.7,
  "Bet 1": 0.595,
  "Bet 2 or 3": 0.609,
};

const KELLY_FRACTION = 1 / 10; // 1/10 Kelly
const KELLY_ODDS = -110; // standard vig-adjusted spread/ATS price
const KELLY_CAP = 0.05; // never stake more than 5% of bankroll, regardless of category

export function resolveBetCategory(
  filteredBetTeam: "away" | "home" | null,
  weightedFilteredBetTeam: "away" | "home" | null,
  nwfbTeam: "away" | "home" | null
): BetCategory | null {
  const b1 = filteredBetTeam != null;
  const b2 = weightedFilteredBetTeam != null;
  const b3 = nwfbTeam != null;
  if (b1 && b2) return "Bets 1 & 2";
  if (b2 && b3) return "Bets 2 & 3";
  if (b1) return "Bet 1";
  if (b2 || b3) return "Bet 2 or 3";
  return null;
}

/** 1/10 Kelly stake, as a fraction of bankroll (0.015 = 1.5%), for a bet
 * at `winProb` win probability facing `odds` (American, e.g. -110). */
export function kellyStakePct(winProb: number, odds: number = KELLY_ODDS, fraction: number = KELLY_FRACTION): number {
  const decimalOdds = odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
  const b = decimalOdds - 1; // net odds
  const q = 1 - winProb;
  const fullKelly = winProb - q / b;
  const stake = fullKelly * fraction;
  return Math.max(0, Math.min(stake, KELLY_CAP));
}

export function betSizeFor(category: BetCategory | null): number | null {
  if (!category) return null;
  return kellyStakePct(BET_CATEGORY_WIN_PCT[category]);
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

// Exact starting lines (from the PROJ COVER TEAM's own perspective —
// positive = that team is the underdog, negative = favored, matching a
// real bet slip) and their nearest-first target checks. Deliberately
// literal, not a generic +/-0.5/+/-1 sweep — only these four starting
// numbers are checked, and only against these specific targets.
const WATCH_TARGETS: Record<string, number[]> = {
  "2.5": [3, 3.5],
  "6.5": [7, 7.5],
  "-3.5": [-3, -2.5],
  "-7.5": [-7, -6.5],
};

/**
 * "If the line moves to a key number, would this game become a bet
 * (Filtered, WFB, or NWFB) that it isn't already?" Only fires for games
 * currently on none of the three lists, and only for the four specific
 * starting lines above — everything else is ignored, even if a nearby
 * move would technically cross a threshold. Returns a display string
 * like "Need +3", or null if nothing applies.
 */
export function computeWatchSignal(
  projAwaySpread: number | null,
  vegasAwaySpread: number | null,
  projCoverTeam: "away" | "home" | null,
  alreadyFlagged: boolean
): string | null {
  if (alreadyFlagged || projAwaySpread == null || vegasAwaySpread == null || projCoverTeam == null) return null;

  const betTeamLine = projCoverTeam === "away" ? vegasAwaySpread : -vegasAwaySpread;
  const targets = WATCH_TARGETS[String(betTeamLine)];
  if (!targets) return null;

  for (const target of targets) {
    const hypotheticalVegasAwaySpread = projCoverTeam === "away" ? target : -target;
    const hypotheticalAmountOff = Math.abs(projAwaySpread - hypotheticalVegasAwaySpread);
    const hypotheticalAbsLine = Math.abs(hypotheticalVegasAwaySpread);
    const hypotheticalRelativeOff =
      hypotheticalVegasAwaySpread !== 0 ? hypotheticalAmountOff / hypotheticalVegasAwaySpread : 0;
    const hypotheticalSigma = hypotheticalAmountOff / 15.7;

    const filteredTriggers = hypotheticalAmountOff > DEFAULT_CUSTOM_PARAMS.filterThreshold;
    const wfbTriggers =
      hypotheticalAbsLine > DEFAULT_CUSTOM_PARAMS.minAbsLine &&
      (hypotheticalRelativeOff > DEFAULT_CUSTOM_PARAMS.posThreshold || hypotheticalRelativeOff < DEFAULT_CUSTOM_PARAMS.negThreshold);
    const nwfbTriggers = hypotheticalSigma > 0.4;

    if (filteredTriggers || wfbTriggers || nwfbTriggers) {
      return `Need ${target > 0 ? "+" : ""}${target}`;
    }
  }

  return null;
}

// hfaMode "team" (default) uses each home team's own saved HFA value
// (hfaFor, falling back to the flat HFA constant when a team doesn't have
// one saved yet) — this is the site's normal behavior, unchanged. "flat"
// forces every game to use the flat HFA constant regardless of any
// team-specific value, for A/B-comparing signal quality between the two
// approaches on live/current games. Only meaningful going forward — the
// historical 2024/25 admin bet history dataset has no per-team HFA
// history to recompute against, so this only applies here (live matchups).
export function computeRow(
  game: GameWithLines,
  liveByTeam: Record<string, any>,
  hfaMode: "team" | "flat" = "team"
): MatchupComputed {
  const line = pickLine(game.lines);
  const staticAwayTeam = TEAMS_BY_NAME[game.away_team] ?? null;
  const staticHomeTeam = TEAMS_BY_NAME[game.home_team] ?? null;
  // Ratings are live-preferred (falling back to each team's static
  // preseason rating) so projected spreads move with the season instead
  // of staying frozen at preseason numbers — matches the pattern used
  // everywhere else on the site.
  const awayTeam = staticAwayTeam
    ? { ...staticAwayTeam, rating: liveByTeam[game.away_team]?.rating ?? staticAwayTeam.rating }
    : null;
  const homeTeam = staticHomeTeam
    ? { ...staticHomeTeam, rating: liveByTeam[game.home_team]?.rating ?? staticHomeTeam.rating }
    : null;

  const hfa = hfaMode === "flat" ? HFA : hfaFor(game.home_team, liveByTeam);
  const projAwaySpread = awayTeam && homeTeam ? awayTeam.rating - homeTeam.rating + hfa : null;

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

  const betCategory = resolveBetCategory(filteredBetTeam, weightedFilteredBetTeam, nwfbTeam);
  const betSizePct = betSizeFor(betCategory);

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
    betCategory,
    betSizePct,
  };
}

// Home-side moneyline values aren't stored on MatchupComputed (only the
// away side is — projMoneyline/projWinPct/vegasWinPct/ev), so anywhere
// that needs the home side (Admin Matchups' Moneyline tab, the Odds
// Dashboard's bet badges) derives it here instead of separately —
// centralized so none of them can quietly drift apart from each other.
export function homeSideMlValues(c: MatchupComputed) {
  const homeWinPct = c.projWinPct != null ? 1 - c.projWinPct : null;
  const homeMoneyline = homeWinPct != null ? fairMoneylineFromWinPct(homeWinPct) : null;
  const vegasHomeMoneyline = c.line?.home_moneyline ?? null;
  const vegasHomeWinPct =
    vegasHomeMoneyline != null
      ? vegasHomeMoneyline > 0
        ? 100 / (vegasHomeMoneyline + 100)
        : Math.abs(vegasHomeMoneyline) / (Math.abs(vegasHomeMoneyline) + 100)
      : null;
  const evHome = homeWinPct != null && vegasHomeWinPct != null ? (homeWinPct - vegasHomeWinPct) * 100 : null;
  return { homeWinPct, homeMoneyline, vegasHomeMoneyline, vegasHomeWinPct, evHome };
}

// Whichever side is positive EV (mirrors the Every-Bet rule) — used
// anywhere a single moneyline "the bet is X" pick is needed.
export function mlBetSideFor(c: MatchupComputed): "away" | "home" | null {
  const { evHome } = homeSideMlValues(c);
  if (c.ev != null && evHome != null) {
    if (c.ev > 0 && !(evHome > 0)) return "away";
    if (evHome > 0 && !(c.ev > 0)) return "home";
  }
  return null;
}
