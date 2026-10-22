// Final scores from ESPN's free scoreboard into the site's `games` table, so games grade without waiting for a
// CFBD sync. Runs at the start of every paper cycle, but only calls ESPN while some game that started 2+ hours ago
// (within the last 4 days) isn't marked final. ESPN's event id is `games.id`, so no name matching is needed to find
// the row; names are only checked to catch a flipped home/away. Rows are saved with score_source 'espn'; CFBD sync
// overwrites them once CFBD has its own final (api/cfbd-sync.ts keepEspnFinals).

import { matchTeamName } from "../../src/lib/teamNameMatch";
import { db } from "./io";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

export interface PendingGame {
  id: string;
  start_date: string;
  home_team: string;
  away_team: string;
}
export interface Final {
  id: string;
  home_points: number;
  away_points: number;
}

/** ESPN's college scoreboard is keyed by US Eastern calendar day, one day per request. */
export function espnDate(iso: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

const canon = (team: any): string | null => {
  for (const n of [team?.location, team?.displayName, team?.shortDisplayName]) {
    const m = n ? matchTeamName(String(n)).matched : null;
    if (m) return m;
  }
  return null;
};

/** Completed events for pending games, oriented to our home/away. A game whose names clearly disagree is skipped. */
export function finalsFrom(events: any[], pending: PendingGame[]): Final[] {
  const byId = new Map(pending.map((g) => [g.id, g]));
  const out: Final[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const g = byId.get(String(e?.id));
    if (!g || seen.has(g.id)) continue;
    const c = e.competitions?.[0];
    if (!(e.status?.type?.completed ?? c?.status?.type?.completed)) continue;
    const home = c?.competitors?.find((x: any) => x.homeAway === "home");
    const away = c?.competitors?.find((x: any) => x.homeAway === "away");
    const hs = Number(home?.score), as = Number(away?.score);
    if (!home || !away || home.score == null || away.score == null || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const h = canon(home.team), a = canon(away.team);
    let flip = false;
    if (h && a && h === g.away_team && a === g.home_team) flip = true;
    else if ((h && h !== g.home_team) || (a && a !== g.away_team)) continue; // not confidently the same orientation
    seen.add(g.id);
    out.push({ id: g.id, home_points: flip ? as : hs, away_points: flip ? hs : as });
  }
  return out;
}

export async function syncEspnFinals(fetchImpl: typeof fetch = fetch): Promise<{ pending: number; saved: number }> {
  const now = Date.now();
  const pending = await db.select<PendingGame>(
    "games",
    `select=id,start_date,home_team,away_team&completed=not.is.true&start_date=gte.${new Date(now - 4 * 86400e3).toISOString()}&start_date=lte.${new Date(now - 2 * 3600e3).toISOString()}&order=start_date&limit=400`
  );
  if (!pending.length) return { pending: 0, saved: 0 };
  const dates = [...new Set(pending.map((g) => espnDate(g.start_date)))].slice(0, 5);
  const events: any[] = [];
  for (const d of dates) {
    for (const group of ["80", "81"]) {
      const r = await fetchImpl(`${SCOREBOARD}?dates=${d}&groups=${group}&limit=400`);
      if (r.ok) events.push(...(((await r.json()) as any).events ?? []));
    }
  }
  const finals = finalsFrom(events, pending);
  const at = new Date().toISOString();
  for (const f of finals) {
    // Only fills a game that's still open: never touches a final CFBD (or an earlier run) already saved.
    await db.update("games", `id=eq.${encodeURIComponent(f.id)}&completed=not.is.true`, {
      completed: true, home_points: f.home_points, away_points: f.away_points, score_source: "espn", updated_at: at,
    });
  }
  return { pending: pending.length, saved: finals.length };
}
