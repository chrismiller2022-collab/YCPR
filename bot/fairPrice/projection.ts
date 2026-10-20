// Projected margin for a game, taken from the same computeRow() that
// Admin Matchups uses (week-accurate ratings, frozen lock once a game has
// one, no HFA at neutral sites), so the bot's fair price and the site's
// "my spread" can never disagree.

import { computeRow, type GameProjectionLock } from "../../src/lib/matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "../../src/lib/betHistory";
import type { GameWithLines } from "../../src/lib/api/gamesLines";
import { DEFAULT_MARGIN_MODEL, marginPmf, type MarginModel, type MarginPmf } from "./marginDistribution";

export interface ProjectionOptions {
  /** Matchups uses "team" (per-team HFA, falling back to the flat 2.4). */
  hfaMode?: "team" | "flat";
  lock?: GameProjectionLock | null;
}

/**
 * Projected home margin (home points − away points), or null when either
 * team has no rating. computeRow's projAwaySpread is away-perspective
 * (negative = away favored), which is numerically the home margin.
 */
export function projectedHomeMargin(game: GameWithLines, liveByTeam: Record<string, any>, opts: ProjectionOptions = {}): number | null {
  const row = computeRow(game, liveByTeam, opts.hfaMode ?? "team", DEFAULT_CUSTOM_PARAMS, opts.lock ?? null);
  return row.projAwaySpread;
}

/** Margin distribution for a game around our projection. */
export function gameMarginPmf(
  game: GameWithLines,
  liveByTeam: Record<string, any>,
  opts: ProjectionOptions & { model?: MarginModel } = {}
): MarginPmf | null {
  const mean = projectedHomeMargin(game, liveByTeam, opts);
  return mean == null ? null : marginPmf(mean, opts.model ?? DEFAULT_MARGIN_MODEL);
}
