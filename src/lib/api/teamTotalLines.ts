import { useEffect, useState } from "react";
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

const SYNC_TTL_MS = 60 * 60 * 1000; // once an hour per week, not once per page view — see api/odds-feed.ts's cost note (1 credit/event/region)

function lastSyncedAt(season: number, week: number): number {
  try {
    return Number(localStorage.getItem(`team_totals_synced_at:${season}:${week}`) ?? 0);
  } catch {
    return 0; // private-browsing / storage blocked — just re-sync every time rather than erroring
  }
}

function markSynced(season: number, week: number) {
  try {
    localStorage.setItem(`team_totals_synced_at:${season}:${week}`, String(Date.now()));
  } catch {
    // best-effort only, see lastSyncedAt
  }
}

interface OddsEventLite {
  id: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Self-healing, rate-limited team_totals sync — same "fires opportunistically
 * whenever a Matchups page happens to be open" philosophy as
 * useAutoLockProjections, but gated by an hourly per-week TTL instead of a
 * "have we ever locked this game" check, since team_totals lines (unlike a
 * locked projection) are meant to keep updating right up to kickoff, not
 * freeze after the first successful write. Every additional-market request
 * costs real API credits (1 per event per region — see api/odds-feed.ts),
 * so this only ever fetches the weeks actually being viewed, only fetches
 * events it already matched by team name, and only re-fires once an hour.
 */
export function useAutoSyncTeamTotals(games: GameWithLines[], season: number) {
  const [syncedAtTick, setSyncedAtTick] = useState(0); // bump to let callers re-fetch fetchTeamTotalLines after a sync lands

  useEffect(() => {
    if (games.length === 0) return;
    const weeks = Array.from(new Set(games.map((g) => g.week)));
    // Only weeks with at least one game that hasn't finished yet — no
    // point spending credits re-checking a line for a game that's over.
    const dueWeeks = weeks.filter((w) => {
      if (Date.now() - lastSyncedAt(season, w) < SYNC_TTL_MS) return false;
      return games.some((g) => g.week === w && !g.completed);
    });
    if (dueWeeks.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const eventsRes = await fetch("/api/odds-feed?mode=team-totals-events");
        const eventsBody = await eventsRes.json();
        if (!eventsRes.ok) throw new Error(eventsBody.error ?? "team-totals-events fetch failed");
        const oddsEvents = (eventsBody.events ?? []) as OddsEventLite[];

        // Match by team-name SET rather than home/away position — a
        // neutral-site game can have either side's naming flipped
        // between this app's source (CFBD) and Odds API's own listing.
        // Indexed as one O(events + games) pass, not a nested
        // games-times-events scan: matchSchoolMascotName's fuzzy
        // fallback does a Levenshtein scan over all ~266 teams, so
        // calling it per (game, event) pair instead of once per event
        // was measured to freeze the tab for real on the "all weeks"
        // view (thousands of games) — see chat, 2026-09-05.
        const eventByTeamPairKey = new Map<string, OddsEventLite>();
        for (const e of oddsEvents) {
          const evHome = matchSchoolMascotName(e.homeTeam);
          const evAway = matchSchoolMascotName(e.awayTeam);
          if (!evHome || !evAway) continue;
          eventByTeamPairKey.set([evHome, evAway].sort().join("|"), e);
        }
        const eventByGameId = new Map<string, OddsEventLite>();
        for (const g of games) {
          if (!dueWeeks.includes(g.week)) continue;
          const match = eventByTeamPairKey.get([g.home_team, g.away_team].sort().join("|"));
          if (match) eventByGameId.set(g.id, match);
        }
        if (eventByGameId.size === 0) {
          dueWeeks.forEach((w) => markSynced(season, w));
          return;
        }

        const eventIds = Array.from(new Set(Array.from(eventByGameId.values()).map((e) => e.id)));
        const oddsRes = await fetch(`/api/odds-feed?mode=team-totals&eventIds=${eventIds.join(",")}`);
        const oddsBody = await oddsRes.json();
        if (!oddsRes.ok) throw new Error(oddsBody.error ?? "team-totals fetch failed");
        const results = (oddsBody.results ?? []) as {
          eventId: string;
          provider?: string | null;
          teams?: { team: string; point: number; overPrice: number | null; underPrice: number | null }[];
        }[];
        const byEventId = new Map(results.map((r) => [r.eventId, r]));

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
          await fetch("/api/admin-bets-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "syncTeamTotals", rows }),
          });
        }
        dueWeeks.forEach((w) => markSynced(season, w));
        if (!cancelled) setSyncedAtTick((n) => n + 1);
      } catch {
        // Best-effort — a failed sync just means this page keeps showing
        // whatever was last saved (or nothing); a later page view retries
        // naturally once the TTL passes again.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, season]);

  return syncedAtTick;
}
