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
  // Game-level team totals are stored as ONE consensus row per team (median
  // point; prices averaged over the books on that median), not one per book.
  const ttByTeam = new Map<string, { point: number; over: number | null; under: number | null }[]>();
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
          } else if (e.point != null) {
            const list = ttByTeam.get(team) ?? [];
            list.push({ point: e.point, over: e.over, under: e.under });
            ttByTeam.set(team, list);
          }
        }
      }
    }
  }
  for (const [team, entries] of ttByTeam) {
    const pts = entries.map((e) => e.point).sort((a, b) => a - b);
    const mid = pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
    const pool = entries.filter((e) => e.point === mid);
    const use = pool.length ? pool : entries;
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    teamTotals.push({
      game_id: game.id,
      season: game.season,
      week: game.week,
      team,
      provider: "hist_median",
      point: mid,
      over_price: avg(use.map((e) => e.over)),
      under_price: avg(use.map((e) => e.under)),
      book_count: entries.length,
      pulled_at: pulledAt,
    });
  }
  return { period, teamTotals };
}

async function savePost(action: string, rows: unknown[], extra: Record<string, unknown> = {}): Promise<{ saved: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action, rows, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}
export const savePeriodMarketLines = (rows: PeriodLineRow[], overwrite = false) => savePost("savePeriodMarketLines", rows, { overwrite });
export const saveHistoricalTeamTotals = (rows: TeamTotalRow[], overwrite = false) => savePost("saveHistoricalTeamTotals", rows, { overwrite });

export function matchEventToGame(events: HistoricalEvent[], game: GameRef): HistoricalEvent | null {
  const key = [game.home_team, game.away_team].sort().join("|");
  for (const e of events) {
    const h = matchSchoolMascotName(e.homeTeam);
    const a = matchSchoolMascotName(e.awayTeam);
    if (h && a && [h, a].sort().join("|") === key) return e;
  }
  return null;
}

export interface LivePeriodLines {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: { key: string; lastUpdate: string; markets: { key: string; outcomes: any[] }[] }[];
  error?: string;
}

/** Current (not historical) period lines for specific Odds API event ids — 1 credit per market per event. */
export async function fetchLivePeriodLines(eventIds: string[], markets: string[]): Promise<{ results: LivePeriodLines[]; quota: Quota }> {
  const qs = new URLSearchParams({ mode: "period-lines", eventIds: eventIds.join(","), markets: markets.join(",") });
  const res = await fetch(`/api/odds-feed?${qs.toString()}`, { headers: pw() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Period lines request failed");
  return data;
}

/** Odds API's current upcoming-events list (free) — used to find event ids for this week's games. */
export async function fetchUpcomingEvents(): Promise<HistoricalEvent[]> {
  const res = await fetch("/api/odds-feed?mode=team-totals-events");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "events request failed");
  return data.events as HistoricalEvent[];
}
