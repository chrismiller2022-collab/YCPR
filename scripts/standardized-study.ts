// Raw vs Standardized rating-systems study, run outside the browser with the
// site's own fetchers and the same pure study code as the Rating Systems
// Matchups "Std Study" tab (src/lib/standardizedStudy.ts).
//
// Usage (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the environment):
//   npx vite-node scripts/standardized-study.ts -- --season 2026 --multiplier 13.5 --out study.json
// Optional: --scale mad   (robust spread instead of SD)
//           --div FBS|FCS|all  (home-team division filter, default FBS like the tab)

import { writeFileSync } from "node:fs";
import { fetchGamesWithLines } from "../src/lib/api/gamesLines";
import { fetchWeeklyPowerRatings, fetchRatingWeights } from "../src/lib/api/ratingSystems";
import { fetchAvailableWeeks, fetchWeeklyStats } from "../src/lib/api/weeklyStats";
import { buildRatingsByTeam } from "../src/lib/multiRatingMatchups";
import { runStandardizedStudy } from "../src/lib/standardizedStudy";
import { TEAMS_BY_NAME } from "../src/data/teams";
import type { ScaleStat } from "../src/lib/ratingStandardize";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const season = Number(arg("season", String(new Date().getFullYear())));
  const multiplier = Number(arg("multiplier", "13.5"));
  const scaleStat = arg("scale", "sd") as ScaleStat;
  const div = arg("div", "FBS");
  const out = arg("out", "standardized-study.json");

  const [games, weekly, weights, statWeeks] = await Promise.all([
    fetchGamesWithLines(season),
    fetchWeeklyPowerRatings(season),
    fetchRatingWeights(),
    fetchAvailableWeeks(),
  ]);
  const stats = await fetchWeeklyStats(statWeeks[0] ?? "preseason");
  const liveByTeam = Object.fromEntries(stats.map((r: any) => [r.team, r]));

  const byWeek = new Map<number, typeof weekly>();
  for (const r of weekly) (byWeek.get(r.week) ?? byWeek.set(r.week, []).get(r.week)!).push(r);
  const ratingsByWeek = new Map<number, Record<string, Record<string, number>>>();
  for (const [wk, rows] of byWeek) ratingsByWeek.set(wk, buildRatingsByTeam(rows));

  const include = (g: any) => {
    const home = TEAMS_BY_NAME[g.home_team];
    if (!home) return false;
    return div === "all" || home.div === div;
  };

  const result = runStandardizedStudy({ games, ratingsByWeek, liveByTeam, weights, multiplier, scaleStat, include });
  writeFileSync(out, JSON.stringify({ season, multiplier, scaleStat, div, ...result }, null, 1));
  console.log(`season ${season}: ${result.gamesGraded} completed games graded across weeks ${result.weeks.join(",")} -> ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
