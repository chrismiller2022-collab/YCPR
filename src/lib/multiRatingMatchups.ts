// Per-system projected spread / cover team / filtered-bet / NWFB grading,
// mirroring matchupsCompute.ts's computeRow but looped across every rating
// system (using each system's saved weekly_power_ratings value in place of
// the site's own live power rating) instead of computing just one row for
// YC. Same formulas, same DEFAULT_CUSTOM_PARAMS thresholds, same sign
// convention (spread expressed from the away team's perspective, negative
// = away favored) — so every system is graded identically and comparably.

import { hfaFor } from "./odds";
import { pickLine } from "./matchupsCompute";
import { type GameWithLines } from "./api/gamesLines";
import { DEFAULT_CUSTOM_PARAMS } from "./betHistory";
import { RATING_SYSTEMS } from "./ratingSystems";
import type { WeeklyPowerRatingRow } from "./api/ratingSystems";

export function buildRatingsByTeam(weekly: WeeklyPowerRatingRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of weekly) {
    const entry = out[r.team] ?? {};
    entry[r.system_key] = r.value;
    out[r.team] = entry;
  }
  return out;
}

export interface SystemGameResult {
  systemKey: string;
  projAwaySpread: number | null;
  projCoverTeam: "away" | "home" | null;
  filteredBetTeam: "away" | "home" | null;
  nwfbTeam: "away" | "home" | null;
}

export interface MultiSystemGameRow {
  game: GameWithLines;
  vegasAwaySpread: number | null;
  systems: Record<string, SystemGameResult>;
  actCoverTeam: "away" | "home" | "push" | null;
}

function computeSystemResult(
  systemKey: string,
  awayValue: number | null,
  homeValue: number | null,
  homeTeam: string,
  liveByTeam: Record<string, any>,
  vegasAwaySpread: number | null
): SystemGameResult {
  if (awayValue == null || homeValue == null) {
    return { systemKey, projAwaySpread: null, projCoverTeam: null, filteredBetTeam: null, nwfbTeam: null };
  }
  const projAwaySpread = awayValue - homeValue + hfaFor(homeTeam, liveByTeam);
  if (vegasAwaySpread == null) {
    return { systemKey, projAwaySpread, projCoverTeam: null, filteredBetTeam: null, nwfbTeam: null };
  }

  const amountOff = projAwaySpread - vegasAwaySpread;
  const absAmountOff = Math.abs(amountOff);
  const projDiff = vegasAwaySpread - projAwaySpread;
  const projCoverTeam = projDiff > 0 ? "away" : projDiff < 0 ? "home" : null;

  const filteredBetTeam = absAmountOff > DEFAULT_CUSTOM_PARAMS.filterThreshold ? projCoverTeam : null;

  const sigmaOff = absAmountOff / DEFAULT_CUSTOM_PARAMS.sigmaDivisor;
  const nwfbTeam = sigmaOff > DEFAULT_CUSTOM_PARAMS.sigmaThreshold ? projCoverTeam : null;

  return { systemKey, projAwaySpread, projCoverTeam, filteredBetTeam, nwfbTeam };
}

export function computeMultiSystemRow(
  game: GameWithLines,
  ratingsByTeam: Record<string, Record<string, number>>,
  liveByTeam: Record<string, any>
): MultiSystemGameRow {
  const line = pickLine(game.lines);
  const vegasAwaySpread = line?.spread != null ? -line.spread : null;

  const awayRatings = ratingsByTeam[game.away_team] ?? {};
  const homeRatings = ratingsByTeam[game.home_team] ?? {};

  const systems: Record<string, SystemGameResult> = {};
  for (const s of RATING_SYSTEMS) {
    systems[s.key] = computeSystemResult(
      s.key,
      awayRatings[s.key] ?? null,
      homeRatings[s.key] ?? null,
      game.home_team,
      liveByTeam,
      vegasAwaySpread
    );
  }

  // Same formula as matchupsCompute.ts's computeRow, verbatim.
  let actCoverTeam: "away" | "home" | "push" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && vegasAwaySpread != null) {
    const actualAwayMargin = game.away_points - game.home_points;
    const coverMargin = actualAwayMargin + vegasAwaySpread;
    actCoverTeam = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  }

  return { game, vegasAwaySpread, systems, actCoverTeam };
}

// ---------------------------------------------------------------------
// Aggregation — per-system Every Bet / Filtered Bet / NWFB records, for
// the Results tab's week + season records and "live win %" display.
// ---------------------------------------------------------------------
export interface SystemRecord {
  w: number;
  l: number;
  push: number;
}

function emptyRecord(): SystemRecord {
  return { w: 0, l: 0, push: 0 };
}

export function winPct(r: SystemRecord): number {
  const decided = r.w + r.l;
  return decided === 0 ? 0 : (r.w / decided) * 100;
}

export interface SystemPerformance {
  everyBet: SystemRecord;
  filteredBet: SystemRecord;
  nwfb: SystemRecord;
}

function grade(pickedTeam: "away" | "home" | null, actCoverTeam: "away" | "home" | "push" | null, into: SystemRecord) {
  if (pickedTeam == null || actCoverTeam == null) return;
  if (actCoverTeam === "push") into.push++;
  else if (pickedTeam === actCoverTeam) into.w++;
  else into.l++;
}

/** Per-system performance across a set of already-computed rows (typically one week or a full season's worth). */
export function aggregateSystemPerformance(rows: MultiSystemGameRow[]): Record<string, SystemPerformance> {
  const out: Record<string, SystemPerformance> = {};
  for (const s of RATING_SYSTEMS) {
    out[s.key] = { everyBet: emptyRecord(), filteredBet: emptyRecord(), nwfb: emptyRecord() };
  }
  for (const row of rows) {
    if (row.actCoverTeam == null) continue; // game not completed / no line yet
    for (const s of RATING_SYSTEMS) {
      const sys = row.systems[s.key];
      if (!sys) continue;
      grade(sys.projCoverTeam, row.actCoverTeam, out[s.key].everyBet);
      grade(sys.filteredBetTeam, row.actCoverTeam, out[s.key].filteredBet);
      grade(sys.nwfbTeam, row.actCoverTeam, out[s.key].nwfb);
    }
  }
  return out;
}
