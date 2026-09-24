import { supabase } from "../supabaseClient";
import { matchSchoolMascotName } from "../teamNameMatch";
import type { GameWithLines } from "./gamesLines";

export interface TeamTotalLineRow {
  game_id: string;
  team: string;
  provider: string | null;
  point: number | null;
  over_price: number | null;
  under_price: number | null;
}

/** Real market team-total lines for a season+week set, keyed by "week|team". */
export async function fetchTeamTotalLines(season: number, weekNumbers: number[]): Promise<Record<string, TeamTotalLineRow>> {
  if (weekNumbers.length === 0) return {};
  const { data, error } = await supabase
    .from("team_total_lines")
    .select("game_id, week, team, provider, point, over_price, under_price")
    .eq("season", season)
    .in("week", weekNumbers);
  if (error) throw error;
  const map: Record<string, TeamTotalLineRow> = {};
  for (const row of (data ?? []) as (TeamTotalLineRow & { week: number })[]) {
    map[`${row.week}|${row.team}`] = row;
  }
  return map;
}

interface OddsEventLite {
  id: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * One-shot, manual team_totals sync for specific games — no TTL, no hook —
 * used by the Period Projections "Sync lines" button. Same matching/saving
 * as the removed hourly auto-sync did (consensus median across books comes from
 * api/odds-feed.ts). Costs 1 credit per matched event.
 */
export async function syncTeamTotalsNow(games: GameWithLines[], season: number): Promise<{ events: number; rows: number }> {
  const eventsRes = await fetch("/api/odds-feed?mode=team-totals-events");
  const eventsBody = await eventsRes.json();
  if (!eventsRes.ok) throw new Error(eventsBody.error ?? "team-totals-events fetch failed");
  const oddsEvents = (eventsBody.events ?? []) as OddsEventLite[];

  const eventByTeamPairKey = new Map<string, OddsEventLite>();
  for (const e of oddsEvents) {
    const evHome = matchSchoolMascotName(e.homeTeam);
    const evAway = matchSchoolMascotName(e.awayTeam);
    if (!evHome || !evAway) continue;
    eventByTeamPairKey.set([evHome, evAway].sort().join("|"), e);
  }
  const eventByGameId = new Map<string, OddsEventLite>();
  for (const g of games) {
    const match = eventByTeamPairKey.get([g.home_team, g.away_team].sort().join("|"));
    if (match) eventByGameId.set(g.id, match);
  }
  if (eventByGameId.size === 0) return { events: 0, rows: 0 };

  const eventIds = Array.from(new Set(Array.from(eventByGameId.values()).map((e) => e.id)));
  const oddsRes = await fetch(`/api/odds-feed?mode=team-totals&eventIds=${eventIds.join(",")}`);
  const oddsBody = await oddsRes.json();
  if (!oddsRes.ok) throw new Error(oddsBody.error ?? "team-totals fetch failed");
  const byEventId = new Map<string, any>(((oddsBody.results ?? []) as any[]).map((r) => [r.eventId, r]));

  const rows: any[] = [];
  for (const g of games) {
    const event = eventByGameId.get(g.id);
    if (!event) continue;
    const result = byEventId.get(event.id);
    for (const t of result?.teams ?? []) {
      const canonicalTeam = matchSchoolMascotName(t.team) ?? t.team;
      if (canonicalTeam !== g.home_team && canonicalTeam !== g.away_team) continue;
      rows.push({
        game_id: g.id,
        season,
        week: g.week,
        team: canonicalTeam,
        provider: result?.provider ?? null,
        point: t.point ?? null,
        over_price: t.overPrice ?? null,
        under_price: t.underPrice ?? null,
      });
    }
  }
  if (rows.length > 0) {
    const res = await fetch("/api/admin-bets-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "syncTeamTotals", rows }),
    });
    if (!res.ok) throw new Error("Saving team totals failed");
  }
  return { events: eventIds.length, rows: rows.length };
}
