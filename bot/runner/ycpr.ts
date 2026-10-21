// YCPR's projected spread for upcoming games, computed exactly the way Admin
// Matchups does it (src/lib/weekAccurateRatings.ts + computeRow):
// - a week that's been "Saved As Week N" (season_weekly_ratings has that
//   week_number) uses that saved snapshot;
// - otherwise the latest live weekly_team_stats label at or before the
//   game's week (or the earliest label if none);
// - computeRow(game, {team: {rating}}, "team") — with ratings-only rows that
//   resolves to the flat 2.4 HFA, none at neutral sites, as on Matchups.
// Returned as the AWAY spread (negative = away favored), which is also the
// projected home margin (home − away) used by the bot internally.

import { computeRow } from "../../src/lib/matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "../../src/lib/betHistory";
import { db } from "./io";

export interface YcprGame {
  id: string | number;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  neutral_site: boolean | null;
}

type Ratings = Record<string, { rating: number | null }>;

const labelNumber = (w: string) => (w === "preseason" ? 0 : /^week(\d+)$/.test(w) ? Number(w.slice(4)) : -1);

async function ratingsForWeeks(season: number, weeks: number[]): Promise<Map<number, Ratings>> {
  const out = new Map<number, Ratings>();
  const archivedRows = await db.selectAll<{ week_number: number }>("season_weekly_ratings", `select=week_number&season=eq.${season}&order=id`);
  const archived = new Set(archivedRows.map((r) => r.week_number));
  const liveLabels = [...new Set((await db.selectAll<{ week: string }>("weekly_team_stats", "select=week&order=id")).map((r) => r.week))];
  for (const wk of new Set(weeks)) {
    const map: Ratings = {};
    if (archived.has(wk)) {
      const rows = await db.selectAll<{ team: string; rating: number | null }>("season_weekly_ratings", `select=team,rating&season=eq.${season}&week_number=eq.${wk}&order=id`);
      for (const r of rows) map[r.team] = { rating: r.rating };
    } else {
      const numbered = liveLabels.map((w) => ({ w, n: labelNumber(w) })).filter((x) => x.n >= 0);
      const atOrBefore = numbered.filter((x) => x.n <= wk).sort((a, b) => b.n - a.n)[0] ?? numbered.sort((a, b) => a.n - b.n)[0];
      if (atOrBefore) {
        const rows = await db.selectAll<{ team: string; rating: number | null }>("weekly_team_stats", `select=team,rating&week=eq.${atOrBefore.w}&order=id`);
        for (const r of rows) map[r.team] = { rating: r.rating };
      }
    }
    out.set(wk, map);
  }
  return out;
}

/** game id → YCPR away spread (null when a team has no rating). */
export async function ycprAwaySpreads(games: YcprGame[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const bySeason = new Map<number, YcprGame[]>();
  for (const g of games) (bySeason.get(g.season) ?? bySeason.set(g.season, []).get(g.season)!).push(g);
  for (const [season, list] of bySeason) {
    const ratings = await ratingsForWeeks(season, list.map((g) => g.week));
    for (const g of list) {
      const row = computeRow(
        { ...g, id: String(g.id), lines: [], completed: false, home_points: null, away_points: null } as any,
        ratings.get(g.week) ?? {},
        "team",
        DEFAULT_CUSTOM_PARAMS,
        null
      );
      out.set(String(g.id), row.projAwaySpread != null ? Math.round(row.projAwaySpread * 100) / 100 : null);
    }
  }
  return out;
}
