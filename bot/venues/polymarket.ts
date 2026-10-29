// Polymarket US: public market data only (no key, no account). Nothing here places orders.
//
// Read from docs.polymarket.us and the live gateway on 2026-10-29:
//  - Events:  GET https://gateway.polymarket.us/v2/leagues/cfb/events?limit&offset   (one moneyline market per event, with each side's team,
//             its home/away `ordering` and teamId). A game's full event (every market) is GET /v1/events/slug/{slug} (about 1 MB).
//  - Spreads: market slug = "asc-" + event slug + "-neg-<n>pt5" / "-pos-<n>pt5"; GET /v1/markets?slug=..&slug=.. returns them with
//             bestBidQuote / bestAskQuote, `line`, `marketSides` and `feeCoefficient`. sportsMarketType "football_team_full_game_spread".
//  - A spread market has a long side (marketSides[].long): the team the contract pays out on, with the team's signed line (Troy −1.5, Troy +9.5).
//    Prices are dollars per $1 contract for that long side. "Troy −1.5" covers when Troy wins by over 1.5, so as an engine rung:
//    side = that team's side, strike = −line (Troy −1.5 → strike 1.5; Troy +9.5 → strike −9.5).
//  - Lines are half points, overtime is included, tick 0.005 (orderPriceMinTickSize), 25 requests/s per IP.
//  - Fee: taker 0.0695 · p · (1 − p) (market.feeCoefficient), makers free (bot/venues/fees.ts).
//  - Do not parse titles: a positive-line market is titled from the other team's side. Team and side come from marketSides.
//
// Whether the user's account / jurisdiction can trade these markets is the user's call; paper mode needs no account.

import { matchTeamName } from "../../src/lib/teamNameMatch";
import { impliedHomeMargin, type Rung } from "../ladder/engine";
import { POLYMARKET_DEFAULT_COEF, polymarketFee } from "./fees";
import type { VenueAdapter, VenueGame } from "./types";

const BASE = process.env.POLYMARKET_BASE || "https://gateway.polymarket.us";

export interface PmTeam {
  id: number;
  name: string;
  safeName?: string;
  ordering?: "home" | "away" | null;
}
export interface PmSide {
  long?: boolean;
  teamId?: number;
  description?: string;
  team?: PmTeam;
}
export interface PmMarket {
  slug: string;
  sportsMarketType?: string;
  status?: string;
  line?: number | string;
  active?: boolean;
  closed?: boolean;
  feeCoefficient?: number;
  orderPriceMinTickSize?: number;
  bestBidQuote?: { value?: string } | null;
  bestAskQuote?: { value?: string } | null;
  marketSides?: PmSide[];
}
export interface PmEvent {
  id?: string;
  slug: string;
  title?: string;
  startTime?: string;
  closed?: boolean;
  teams?: PmTeam[];
  markets?: PmMarket[];
  marketCounts?: { numMarkets?: number; numSpreadsAndTotalsMarkets?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// At most 4 requests in flight across the whole process (the shared limit is 25/s per IP; this stays far under it).
const MAX_INFLIGHT = 4;
let inflight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}
async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await slot(() => fetch(BASE + path, { headers: { "User-Agent": "ycpr-bot" } }));
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retry = Number(res.headers.get("retry-after"));
      await sleep(retry > 0 ? retry * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Polymarket ${res.status} on ${path.split("?")[0]}`);
  }
}

// Polymarket spellings the site's matcher doesn't know (checked against every CFB event, 2026-10-29).
const PM_NAMES: Record<string, string> = { "K-State": "Kansas State" };

/** Exact or alias matches only: a fuzzy match could trade the wrong game. */
export const pmCanon = (s: string | undefined) => {
  if (!s) return null;
  const r = matchTeamName(PM_NAMES[s.trim()] ?? s.trim());
  return r.confidence === "fuzzy" ? null : r.matched || null;
};

/** home/away team of an event, from the sides of its markets (the team objects carry the ordering). */
export function pmEventSides(ev: PmEvent): { home: PmTeam; away: PmTeam } | null {
  const seen = new Map<number, PmTeam>();
  for (const t of ev.teams ?? []) seen.set(t.id, t);
  for (const m of ev.markets ?? []) for (const s of m.marketSides ?? []) if (s.team) seen.set(s.team.id, { ...seen.get(s.team.id), ...s.team });
  const home = [...seen.values()].find((t) => t.ordering === "home");
  const away = [...seen.values()].find((t) => t.ordering === "away");
  return home && away ? { home, away } : null;
}

export const pmEventMatches = (ev: PmEvent, game: Pick<VenueGame, "home_team" | "away_team">): boolean => {
  const s = pmEventSides(ev);
  return !!s && pmCanon(s.home.name) === game.home_team && pmCanon(s.away.name) === game.away_team;
};

/** "1.5" → "1pt5". */
const slugNum = (x: number) => String(x).replace(".", "pt");

/** Every spread slug this game can have (the ladder runs from about −7 to +70 for the long team); unknown ones simply aren't returned. */
export function pmSpreadSlugs(eventSlug: string, neg = 25.5, pos = 70.5): string[] {
  const out: string[] = [];
  for (let k = 0.5; k <= neg; k++) out.push(`asc-${eventSlug}-neg-${slugNum(k)}`);
  for (let k = 0.5; k <= pos; k++) out.push(`asc-${eventSlug}-pos-${slugNum(k)}`);
  return out;
}

const px = (q: { value?: string } | null | undefined) => {
  const v = q?.value == null ? NaN : Number(q.value);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
};

/** Engine rungs from an event's full-game spread markets (YES = the long side covers). Whole-number lines (pushes) are skipped. */
export function pmSpreadRungs(markets: PmMarket[], sides: { home: PmTeam; away: PmTeam }): { rungs: Rung[]; coef: number | null } {
  const rungs: Rung[] = [];
  let coef: number | null = null;
  for (const m of markets) {
    if (m.sportsMarketType !== "football_team_full_game_spread") continue;
    if (m.closed || (m.status && m.status !== "MARKET_STATUS_OPEN")) continue;
    const line = Number(m.line);
    if (!Number.isFinite(line) || Number.isInteger(line)) continue;
    const long = (m.marketSides ?? []).find((s) => s.long);
    const teamId = long?.teamId ?? long?.team?.id;
    const side = teamId === sides.home.id ? "home" : teamId === sides.away.id ? "away" : null;
    if (!side) continue;
    if (Number.isFinite(Number(m.feeCoefficient))) coef = Number(m.feeCoefficient);
    rungs.push({ ticker: `PM:${m.slug}`, side, strike: -line, bid: px(m.bestBidQuote), ask: px(m.bestAskQuote) });
  }
  return { rungs, coef };
}

export function polymarketAdapter(): VenueAdapter {
  let events: PmEvent[] = [];
  let coef = POLYMARKET_DEFAULT_COEF;
  const notListed: string[] = [];
  const unresolved: string[] = [];
  const counts = { found: 0, rungs: 0, fallback: 0 };
  return {
    id: "polymarket",
    label: "Polymarket",
    tick: 0.005,
    available: () => true,
    async prepare() {
      events = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const page = (await get<{ events?: PmEvent[] }>(`/v2/leagues/cfb/events?limit=100&offset=${offset}`)).events ?? [];
        events.push(...page.filter((e) => !e.closed));
        if (page.length < 100) break;
      }
    },
    async ladder(game) {
      const ev = game.eventKey ? events.find((e) => e.slug === game.eventKey) : events.find((e) => pmEventMatches(e, game));
      if (!ev) {
        notListed.push(`${game.away_team} @ ${game.home_team}`);
        return null;
      }
      const sides = pmEventSides(ev);
      if (!sides || pmCanon(sides.home.name) !== game.home_team || pmCanon(sides.away.name) !== game.away_team) {
        unresolved.push(`${game.away_team} @ ${game.home_team}`);
        return null;
      }
      // The cheap way: the spread slugs this game can have, in two requests. The full event (about 1 MB) is the fallback if the slug scheme ever changes.
      const slugs = pmSpreadSlugs(ev.slug);
      const half = Math.ceil(slugs.length / 2);
      const pages = await Promise.all([slugs.slice(0, half), slugs.slice(half)].map((b) => get<{ markets?: PmMarket[] }>(`/v1/markets?${b.map((s) => `slug=${encodeURIComponent(s)}`).join("&")}`)));
      let markets = pages.flatMap((p) => p.markets ?? []);
      if (!markets.some((m) => m.sportsMarketType === "football_team_full_game_spread")) {
        counts.fallback++;
        markets = (await get<{ event?: PmEvent }>(`/v1/events/slug/${encodeURIComponent(ev.slug)}`)).event?.markets ?? [];
      }
      const built = pmSpreadRungs(markets, sides);
      if (!built.rungs.length) {
        notListed.push(`${game.away_team} @ ${game.home_team}`);
        return null;
      }
      // Side check against the sportsbook line, like Novig: refuse a game whose ladder doesn't look like this game.
      const implied = impliedHomeMargin(built.rungs);
      if (implied != null && game.bookHomeMargin != null && Math.abs(game.bookHomeMargin) >= 2.5 && Math.abs(implied - game.bookHomeMargin) > 8) {
        unresolved.push(`${game.away_team} @ ${game.home_team}`);
        return null;
      }
      if (built.coef != null) coef = built.coef;
      counts.found++;
      counts.rungs += built.rungs.length;
      return { eventKey: ev.slug, rungs: built.rungs };
    },
    // No public trade tape is documented; fills come from the book crossing a resting price.
    trades: async () => [],
    diag: () => ({ events: events.length, notListed, unresolved, ...counts, coef }),
    fee: () => polymarketFee(coef),
  };
}
