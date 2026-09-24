import { matchSchoolMascotName } from "../teamNameMatch";

// Client side of the manual, credit-costing historical Odds API pulls
// (see api/odds-feed.ts). Every call sends the admin password as a header;
// nothing here ever runs on its own.

function pw(): Record<string, string> {
  return { "x-admin-password": sessionStorage.getItem("admin_password") ?? "" };
}

export interface Quota {
  remaining: string | null;
  used: string | null;
  last: string | null;
}

export interface HistoricalEvent {
  id: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}

export async function fetchHistoricalEvents(dateISO: string, fromISO: string, toISO: string): Promise<{ events: HistoricalEvent[]; quota: Quota }> {
  const qs = new URLSearchParams({ mode: "historical-events", date: dateISO, from: fromISO, to: toISO });
  const res = await fetch(`/api/odds-feed?${qs.toString()}`, { headers: pw() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Historical events request failed");
  return data;
}

export interface HistoricalEventOdds {
  timestamp: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  bookmakers: { key: string; lastUpdate: string; markets: { key: string; outcomes: any[] }[] }[];
  quota: Quota;
}

export async function fetchHistoricalEventOdds(eventId: string, dateISO: string, markets: string[]): Promise<HistoricalEventOdds> {
  const qs = new URLSearchParams({ mode: "historical-event-odds", eventId, date: dateISO, markets: markets.join(",") });
  const res = await fetch(`/api/odds-feed?${qs.toString()}`, { headers: pw() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Historical event odds request failed");
  return data;
}

export type PeriodCode = "h1" | "h2" | "q1" | "q2" | "q3" | "q4";
export interface PeriodLineRow {
  game_id: string;
  season: number;
  week: number;
  period: PeriodCode;
  market_type: "spread" | "total" | "team_total_home" | "team_total_away";
  provider: string;
  point: number | null;
  home_price: number | null;
  away_price: number | null;
  over_price: number | null;
  under_price: number | null;
  is_historical: boolean;
  pulled_at: string;
}
export interface TeamTotalRow {
  game_id: string;
  season: number;
  week: number;
  team: string;
  provider: string;
  point: number | null;
  over_price: number | null;
  under_price: number | null;
  pulled_at: string;
}

export interface GameRef {
  id: string;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
}

const MARKET_RE = /^(spreads|totals|team_totals)(?:_(h1|h2|q1|q2|q3|q4))?$/;

/** Turn one historical event response into rows for period_market_lines (period markets) and team_total_lines (game-level team_totals). */
export function parseEventOdds(odds: HistoricalEventOdds, game: GameRef, isHistorical: boolean): { period: PeriodLineRow[]; teamTotals: TeamTotalRow[] } {
  const period: PeriodLineRow[] = [];
  const teamTotals: TeamTotalRow[] = [];
  const pulledAt = odds.timestamp ?? new Date().toISOString();
  const canon = (name: string | null | undefined) => (name ? matchSchoolMascotName(name) ?? name : null);

  for (const book of odds.bookmakers) {
    for (const m of book.markets) {
      const parsed = MARKET_RE.exec(m.key);
      if (!parsed) continue;
      const [, kind, per] = parsed;

      if (kind === "spreads" && per) {
        let homePoint: number | null = null;
        let homePrice: number | null = null;
        let awayPrice: number | null = null;
        for (const o of m.outcomes) {
          const team = canon(o.name);
          if (team === game.home_team) {
            homePoint = o.point ?? null;
            homePrice = o.price ?? null;
          } else if (team === game.away_team) awayPrice = o.price ?? null;
        }
        if (homePoint != null) {
          period.push({ game_id: game.id, season: game.season, week: game.week, period: per as PeriodCode, market_type: "spread", provider: book.key, point: homePoint, home_price: homePrice, away_price: awayPrice, over_price: null, under_price: null, is_historical: isHistorical, pulled_at: pulledAt });
        }
      } else if (kind === "totals" && per) {
        let point: number | null = null;
        let over: number | null = null;
        let under: number | null = null;
        for (const o of m.outcomes) {
          point = o.point ?? point;
          if (o.name === "Over") over = o.price ?? null;
          if (o.name === "Under") under = o.price ?? null;
        }
        if (point != null) {
          period.push({ game_id: game.id, season: game.season, week: game.week, period: per as PeriodCode, market_type: "total", provider: book.key, point, home_price: null, away_price: null, over_price: over, under_price: under, is_historical: isHistorical, pulled_at: pulledAt });
        }
      } else if (kind === "team_totals") {
        const byTeam = new Map<string, { point: number | null; over: number | null; under: number | null }>();
        for (const o of m.outcomes) {
          const team = canon(o.description);
          if (!team) continue;
          const e = byTeam.get(team) ?? { point: null, over: null, under: null };
          e.point = o.point ?? e.point;
          if (o.name === "Over") e.over = o.price ?? null;
          if (o.name === "Under") e.under = o.price ?? null;
          byTeam.set(team, e);
        }
        for (const [team, e] of byTeam) {
          if (team !== game.home_team && team !== game.away_team) continue;
          if (per) {
            period.push({ game_id: game.id, season: game.season, week: game.week, period: per as PeriodCode, market_type: team === game.home_team ? "team_total_home" : "team_total_away", provider: book.key, point: e.point, home_price: null, away_price: null, over_price: e.over, under_price: e.under, is_historical: isHistorical, pulled_at: pulledAt });
          } else {
            teamTotals.push({ game_id: game.id, season: game.season, week: game.week, team, provider: book.key, point: e.point, over_price: e.over, under_price: e.under, pulled_at: pulledAt });
          }
        }
      }
    }
  }
  return { period, teamTotals };
}

async function savePost(action: string, rows: unknown[]): Promise<{ saved: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}
export const savePeriodMarketLines = (rows: PeriodLineRow[]) => savePost("savePeriodMarketLines", rows);
export const saveHistoricalTeamTotals = (rows: TeamTotalRow[]) => savePost("saveHistoricalTeamTotals", rows);

export function matchEventToGame(events: HistoricalEvent[], game: GameRef): HistoricalEvent | null {
  const key = [game.home_team, game.away_team].sort().join("|");
  for (const e of events) {
    const h = matchSchoolMascotName(e.homeTeam);
    const a = matchSchoolMascotName(e.awayTeam);
    if (h && a && [h, a].sort().join("|") === key) return e;
  }
  return null;
}
