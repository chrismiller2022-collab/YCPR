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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// ---------------------------------------------------------------------
// Ratings cache. Every bot job is a fresh process (the tower runs `npx tsx`
// per cycle, every 90 s for paper and 5 min for the recorder), and ratings
// change about once a week, so re-downloading the week lists and every
// team's rating each run was most of the bot's database egress. The ratings
// are kept in a file and reused while both tables' newest updated_at is
// unchanged — two one-row reads per run instead of thousands of rows — and
// refetched at least every MAX_AGE_MS in case rows were deleted without an
// update.
// ---------------------------------------------------------------------
const MAX_AGE_MS = 6 * 3600_000;
const CACHE_DIR = process.env.BOT_CACHE_DIR || join(tmpdir(), "ycpr-bot-cache");

interface RatingsCache {
  token: string; // newest updated_at of season_weekly_ratings (this season) | weekly_team_stats
  fetchedAt: number;
  archived: number[]; // week_numbers saved in season_weekly_ratings
  liveLabels: string[]; // weekly_team_stats week labels
  weeks: Record<string, Ratings>; // ratings already resolved, by game week
}

const memory = new Map<number, RatingsCache>();
const cacheFile = (season: number) => join(CACHE_DIR, `ratings-${season}.json`);

function readCache(season: number): RatingsCache | null {
  const m = memory.get(season);
  if (m) return m;
  try {
    return JSON.parse(readFileSync(cacheFile(season), "utf8")) as RatingsCache;
  } catch {
    return null;
  }
}

function writeCache(season: number, c: RatingsCache) {
  memory.set(season, c);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(season), JSON.stringify(c));
  } catch {
    // read-only or no disk: the in-memory copy still saves repeat reads within this process
  }
}

async function freshnessToken(season: number): Promise<string> {
  const [a] = await db.select<{ updated_at: string | null }>("season_weekly_ratings", `select=updated_at&season=eq.${season}&order=updated_at.desc.nullslast&limit=1`);
  const [b] = await db.select<{ updated_at: string | null }>("weekly_team_stats", "select=updated_at&order=updated_at.desc.nullslast&limit=1");
  return `${a?.updated_at ?? "-"}|${b?.updated_at ?? "-"}`;
}

async function ratingsForWeeks(season: number, weeks: number[]): Promise<Map<number, Ratings>> {
  const token = await freshnessToken(season);
  // No timestamps at all (an empty or test database): nothing to tell a stale cache from a fresh one, so don't use one.
  const cacheable = token !== "-|-";
  let cache = cacheable ? readCache(season) : null;
  if (!cache || cache.token !== token || Date.now() - cache.fetchedAt > MAX_AGE_MS) {
    const archivedRows = await db.selectAll<{ week_number: number }>("season_weekly_ratings", `select=week_number&season=eq.${season}&order=id`);
    const liveRows = await db.selectAll<{ week: string }>("weekly_team_stats", "select=week&order=id");
    cache = { token, fetchedAt: Date.now(), archived: [...new Set(archivedRows.map((r) => r.week_number))], liveLabels: [...new Set(liveRows.map((r) => r.week))], weeks: {} };
  }
  const archived = new Set(cache.archived);
  const out = new Map<number, Ratings>();
  let added = false;
  for (const wk of new Set(weeks)) {
    const hit = cache.weeks[String(wk)];
    if (hit) {
      out.set(wk, hit);
      continue;
    }
    const map: Ratings = {};
    if (archived.has(wk)) {
      const rows = await db.selectAll<{ team: string; rating: number | null }>("season_weekly_ratings", `select=team,rating&season=eq.${season}&week_number=eq.${wk}&order=id`);
      for (const r of rows) map[r.team] = { rating: r.rating };
    } else {
      const numbered = cache.liveLabels.map((w) => ({ w, n: labelNumber(w) })).filter((x) => x.n >= 0);
      const atOrBefore = numbered.filter((x) => x.n <= wk).sort((a, b) => b.n - a.n)[0] ?? numbered.sort((a, b) => a.n - b.n)[0];
      if (atOrBefore) {
        const rows = await db.selectAll<{ team: string; rating: number | null }>("weekly_team_stats", `select=team,rating&week=eq.${atOrBefore.w}&order=id`);
        for (const r of rows) map[r.team] = { rating: r.rating };
      }
    }
    cache.weeks[String(wk)] = map;
    added = true;
    out.set(wk, map);
  }
  if (cacheable && (added || memory.get(season) !== cache)) writeCache(season, cache);
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
