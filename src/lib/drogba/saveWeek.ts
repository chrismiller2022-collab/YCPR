// Writes one week's DROGBA numbers to the picks log. The Sunday run calls it at the end of every run (so the log always
// has what the model said before kickoff, refreshed each rerun until a game starts); the week view's backfill calls it
// for a past week.
import { fetchMarketLines, invalidateDrogbaCache, saveDrogbaPicks, type SavePicksResult } from "../api/drogbaData";
import { buildPickRows, DEFAULT_MIN_EDGE, fitForWeek, MODEL_VERSION, projectWeek } from "./weekPlan";
import type { Engine } from "./engine";

export async function saveWeekPicks(engine: Engine, season: number, week: number, opts: { backfill?: boolean; minEdge?: number } = {}): Promise<SavePicksResult & { rows: number }> {
  const backfill = !!opts.backfill;
  const rows = projectWeek(engine, fitForWeek(engine, season, week), season, week, backfill);
  // Market lines are only meaningful before kickoff; a backfill of a played week would pick up their last (in-game) values.
  const markets = backfill ? undefined : await fetchMarketLines(season, week).catch(() => undefined);
  const picks = buildPickRows(rows, opts.minEdge ?? DEFAULT_MIN_EDGE, markets, backfill ? `${MODEL_VERSION}-backfill` : MODEL_VERSION);
  if (picks.length === 0) return { saved: 0, overwritten: 0, skippedExisting: 0, rows: 0 };
  const res = await saveDrogbaPicks(picks, true, backfill);
  invalidateDrogbaCache();
  return { ...res, rows: picks.length };
}
