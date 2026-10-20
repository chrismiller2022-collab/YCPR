import type { BetHistoryRecord } from "../data/betHistory.data";
import { TEAMS_BY_NAME } from "../data/teams";
import { BLUE_CHIP_HFA } from "../data/blueChipHfa";
import { aggregateCustom, DEFAULT_CUSTOM_PARAMS, pickSpreadLine, type LineMode, type RecordTally } from "./betHistory";
import { splitTeamTotal } from "./gameTotals";
import { hfaAsOf, type HfaBySource } from "./api/teamHfa";
import type { GameWithLines } from "./api/gamesLines";

// HFA backtest: re-projects every completed game from that week's saved power ratings with a different home-field
// advantage per variant, then grades the projections the same way Bet History does (Every / Filtered / WFB / NWFB at the
// default thresholds) plus straight-up error against the final margin and the team-total split. Locks are ignored on
// purpose: the point is what each HFA would have said, not what was posted.
//
// Sign convention (same as computeRow): projected away spread = away rating − home rating + HFA, which is also the
// projected home margin. The actual equivalent is home points − away points. Neutral sites get no HFA in every variant.

export interface HfaContext {
  index: HfaBySource; // saved Massey / TR / TR home / TR away by week
  elevationM: Record<string, number>; // home stadium elevation (meters) by team
}

export interface HfaSettings {
  flat: number; // flat HFA (slider 0–5)
  centerTr: boolean; // TR ÷10 averages well under the usual 2.4, so optionally re-center it on the flat value
  weights: { massey: number; tr: number; bluechip: number }; // Blend weights
  splitShrink: number; // home/away split experiment: flat + k × (split − league mean split) / 2
  elevation: { on: boolean; thresholdM: number; factor: number }; // dampen HFA when both teams' home stadiums are high
}

export const DEFAULT_HFA_SETTINGS: HfaSettings = {
  flat: 2.4,
  centerTr: true,
  weights: { massey: 1, tr: 1, bluechip: 1 },
  splitShrink: 0.25,
  elevation: { on: false, thresholdM: 1200, factor: 0.5 },
};

export type VariantKey = "flat" | "massey" | "tr" | "bluechip" | "average" | "blend" | "split" | "live";

export const VARIANTS: { key: VariantKey; label: string; note: string }[] = [
  { key: "flat", label: "Flat", note: "The slider value for every home team" },
  { key: "massey", label: "Massey", note: "HFA column of the Massey CSV" },
  { key: "tr", label: "TeamRankings", note: "Home Advantage ÷ 10" },
  { key: "bluechip", label: "Blue Chip", note: "Static table" },
  { key: "average", label: "Average", note: "Mean of whichever of Massey, TR, Blue Chip the team has" },
  { key: "blend", label: "Blend", note: "Weighted by the sliders" },
  { key: "split", label: "Home/away split", note: "Flat + shrink × (TR home rating − TR away rating, centered) ÷ 2" },
  { key: "live", label: "As the site runs today", note: "Flat 2.4, including at neutral sites" },
];

/** League mean of a source's values for one week (for centering TR and the home/away split). */
function weekMean(index: HfaBySource, source: "tr" | "tr_home" | "tr_away", week: number): number | null {
  const byWeek = index[source];
  if (!byWeek) return null;
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  const w = weeks.filter((x) => x <= week).pop() ?? weeks[0];
  if (w == null) return null;
  const vals = Object.values(byWeek[w]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export interface TeamHfaInputs {
  massey: number | null;
  tr: number | null; // ÷10, centered when settings.centerTr
  trRaw: number | null;
  bluechip: number | null;
  split: number | null; // TR home − TR away (points)
  // Inputs taken from a week after this one (that source wasn't saved yet for this week), per source.
  lookahead: { massey: boolean; tr: boolean; split: boolean };
}

export function teamInputs(ctx: HfaContext, s: HfaSettings, team: string, week: number, means: { tr: number | null; split: number | null }): TeamHfaInputs {
  const m = hfaAsOf(ctx.index, "massey", team, week);
  const t = hfaAsOf(ctx.index, "tr", team, week);
  const h = hfaAsOf(ctx.index, "tr_home", team, week);
  const a = hfaAsOf(ctx.index, "tr_away", team, week);
  const trCentered = t != null && s.centerTr && means.tr != null ? s.flat + (t.value - means.tr) : t?.value ?? null;
  return {
    massey: m?.value ?? null,
    tr: trCentered,
    trRaw: t?.value ?? null,
    bluechip: BLUE_CHIP_HFA[team] ?? null,
    split: h != null && a != null ? h.value - a.value : null,
    lookahead: { massey: !!m?.lookahead, tr: !!t?.lookahead, split: !!(h?.lookahead || a?.lookahead) },
  };
}

function weighted(parts: { v: number | null; w: number }[]): number | null {
  let sum = 0;
  let wsum = 0;
  for (const p of parts) if (p.v != null && p.w > 0) {
    sum += p.v * p.w;
    wsum += p.w;
  }
  return wsum > 0 ? sum / wsum : null;
}

export function variantHfa(key: VariantKey, inp: TeamHfaInputs, s: HfaSettings, splitMean: number | null): number {
  switch (key) {
    case "flat":
      return s.flat;
    case "live":
      return 2.4;
    case "massey":
      return inp.massey ?? s.flat;
    case "tr":
      return inp.tr ?? s.flat;
    case "bluechip":
      return inp.bluechip ?? s.flat;
    case "average":
      return weighted([{ v: inp.massey, w: 1 }, { v: inp.tr, w: 1 }, { v: inp.bluechip, w: 1 }]) ?? s.flat;
    case "blend":
      return weighted([{ v: inp.massey, w: s.weights.massey }, { v: inp.tr, w: s.weights.tr }, { v: inp.bluechip, w: s.weights.bluechip }]) ?? s.flat;
    case "split":
      return inp.split != null && splitMean != null ? s.flat + (s.splitShrink * (inp.split - splitMean)) / 2 : s.flat;
  }
}

export function isHighElevationMatchup(ctx: HfaContext, s: HfaSettings, home: string, away: string): boolean {
  const h = ctx.elevationM[home];
  const a = ctx.elevationM[away];
  return h != null && a != null && h >= s.elevation.thresholdM && a >= s.elevation.thresholdM;
}

export interface BacktestGame {
  game: GameWithLines;
  awayRating: number;
  homeRating: number;
  vegasHomeSpread: number; // betting_lines.spread (home relation)
  projectedTotal: number | null; // the Totals model's saved projection for that week
  highElevation: boolean;
}

/** Completed games that can be graded: both teams rated that week and a spread line in the chosen mode. */
export function backtestGames(
  games: GameWithLines[],
  ratingsByWeek: Record<number, Record<string, { rating: number | null }>>,
  ctx: HfaContext,
  s: HfaSettings,
  lineMode: LineMode,
  totalsByGameId: Record<string, number>,
  fbsOnly: boolean
): BacktestGame[] {
  const out: BacktestGame[] = [];
  for (const g of games) {
    if (!g.completed || g.home_points == null || g.away_points == null) continue;
    if (fbsOnly && !(g.home_classification === "fbs" && g.away_classification === "fbs")) continue;
    const line = pickSpreadLine(g.lines, lineMode);
    const spread = lineMode === "open" ? line?.opening_spread : line?.spread;
    if (spread == null) continue;
    const wk = ratingsByWeek[g.week] ?? {};
    const homeRating = wk[g.home_team]?.rating ?? TEAMS_BY_NAME[g.home_team]?.rating ?? null;
    const awayRating = wk[g.away_team]?.rating ?? TEAMS_BY_NAME[g.away_team]?.rating ?? null;
    if (homeRating == null || awayRating == null) continue;
    out.push({
      game: g,
      awayRating,
      homeRating,
      vegasHomeSpread: spread,
      projectedTotal: totalsByGameId[g.id] ?? null,
      highElevation: !g.neutral_site && isHighElevationMatchup(ctx, s, g.home_team, g.away_team),
    });
  }
  return out;
}

export interface VariantResult {
  key: VariantKey;
  games: number;
  mae: number;
  rmse: number;
  homeResidual: number; // mean(actual home margin − projected): + means home teams beat the projection (HFA too low)
  avgHfa: number; // mean HFA applied at true home games
  everyBet: RecordTally;
  filtered: RecordTally;
  wfb: RecordTally;
  nwfb: RecordTally;
  ttGames: number;
  ttMae: number | null; // team-total error, both teams
  homeTtResidual: number | null; // mean(home points − projected home team total)
  awayTtResidual: number | null; // same for the away team; home and away both high means the Totals model runs low, not HFA
  lookaheadGames: number;
  elevationGames: number; // games where the elevation dampener changed the HFA
}

export function runVariant(key: VariantKey, rows: BacktestGame[], ctx: HfaContext, s: HfaSettings): VariantResult {
  const records: BetHistoryRecord[] = [];
  let absErr = 0;
  let sqErr = 0;
  let resid = 0;
  let hfaSum = 0;
  let hfaN = 0;
  let ttAbs = 0;
  let ttN = 0;
  let ttHomeResid = 0;
  let ttAwayResid = 0;
  let ttGames = 0;
  let lookaheadGames = 0;
  let elevationGames = 0;
  const meanCache = new Map<number, { tr: number | null; split: number | null }>();

  for (const r of rows) {
    const g = r.game;
    let means = meanCache.get(g.week);
    if (!means) {
      const h = weekMean(ctx.index, "tr_home", g.week);
      const a = weekMean(ctx.index, "tr_away", g.week);
      means = { tr: weekMean(ctx.index, "tr", g.week), split: h != null && a != null ? h - a : null };
      meanCache.set(g.week, means);
    }
    let hfa: number;
    if (key === "live") hfa = 2.4;
    else if (g.neutral_site) hfa = 0;
    else {
      const inp = teamInputs(ctx, s, g.home_team, g.week, means);
      const la = inp.lookahead;
      const usesMassey = key === "massey" || ((key === "average" || (key === "blend" && s.weights.massey > 0)) && inp.massey != null);
      const usesTr = key === "tr" || ((key === "average" || (key === "blend" && s.weights.tr > 0)) && inp.tr != null);
      if ((usesMassey && la.massey) || (usesTr && la.tr) || (key === "split" && la.split)) lookaheadGames++;
      hfa = variantHfa(key, inp, s, means.split);
      if (s.elevation.on && r.highElevation) {
        hfa *= s.elevation.factor;
        elevationGames++;
      }
    }
    if (!g.neutral_site) {
      hfaSum += hfa;
      hfaN++;
    }

    const projAway = r.awayRating - r.homeRating + hfa; // = projected home margin
    const actualHomeMargin = g.home_points! - g.away_points!;
    const err = projAway - actualHomeMargin;
    absErr += Math.abs(err);
    sqErr += err * err;
    resid += actualHomeMargin - projAway;

    if (r.projectedTotal != null) {
      const split = splitTeamTotal(r.projectedTotal, -projAway);
      if (split.home != null && split.away != null) {
        ttAbs += Math.abs(g.home_points! - split.home) + Math.abs(g.away_points! - split.away);
        ttN += 2;
        ttHomeResid += g.home_points! - split.home;
        ttAwayResid += g.away_points! - split.away;
        ttGames++;
      }
    }

    const base: BetHistoryRecord = {
      season: g.season,
      week: g.week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      homeScore: g.home_points!,
      awayScore: g.away_points!,
      spread: r.vegasHomeSpread,
      prediction: -projAway,
      actualFinalSpread: actualHomeMargin,
      everyBetTeam: null,
      amountOff: 0,
      absAmountOff: 0,
      filteredBetTeam: null,
      weightedFilteredBetTeam: null,
      actualCoverTeam: null,
      everyBetResult: null,
      filteredBetResult: null,
      weightedFilteredBetResult: null,
      absBettingLine: Math.abs(r.vegasHomeSpread),
      relativeAmountOff: 0,
    };
    records.push(base); // aggregateCustom grades from the raw spread/prediction
  }

  const agg = aggregateCustom(records, DEFAULT_CUSTOM_PARAMS).overall;
  const n = rows.length || 1;
  return {
    key,
    games: rows.length,
    mae: absErr / n,
    rmse: Math.sqrt(sqErr / n),
    homeResidual: resid / n,
    avgHfa: hfaN ? hfaSum / hfaN : 0,
    everyBet: agg.everyBet,
    filtered: agg.filteredBet,
    wfb: agg.weightedFilteredBet,
    nwfb: agg.nwfb,
    ttGames,
    ttMae: ttN ? ttAbs / ttN : null,
    homeTtResidual: ttGames ? ttHomeResid / ttGames : null,
    awayTtResidual: ttGames ? ttAwayResid / ttGames : null,
    lookaheadGames,
    elevationGames,
  };
}

/** The single flat HFA that minimizes squared error on true home games, with its standard error. */
export function bestFlatHfa(rows: BacktestGame[]): { value: number; se: number; n: number } | null {
  const xs = rows.filter((r) => !r.game.neutral_site).map((r) => r.game.home_points! - r.game.away_points! - (r.awayRating - r.homeRating));
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return { value: mean, se: sd / Math.sqrt(xs.length), n: xs.length };
}
