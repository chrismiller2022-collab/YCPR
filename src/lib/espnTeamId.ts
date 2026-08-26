import { TEAM_LOGOS } from "../data/logos";

// ESPN's futures API only gives a $ref URL per team outcome (e.g.
// ".../teams/194"), not a readable name — dereferencing every single
// outcome would mean one extra network call per team per market
// (hundreds, for a championship market with the full FBS+FCS field).
// We already have every FBS/FCS team's ESPN numeric id for free, though
// — it's embedded in the logo URL every team already has
// (a.espncdn.com/i/teamlogos/ncaa/500/{espnId}.png) — so this just
// parses that back out once and caches the reverse map.
let cache: Record<string, string> | null = null;

export function espnTeamIdToName(espnTeamId: string): string | null {
  if (!cache) {
    cache = {};
    for (const [team, url] of Object.entries(TEAM_LOGOS)) {
      const m = /\/(\d+)\.png$/.exec(url);
      if (m) cache[m[1]] = team;
    }
  }
  return cache[espnTeamId] ?? null;
}
