// ProphetX: Trading API (keys from the website's "API Integration" menu, no
// approval). Paper mode only reads: /auth/login → /mm/get_sport_events →
// /v4/mm/get_multiple_markets (50 events per request). Needs
// PROPHETX_ACCESS_KEY and PROPHETX_SECRET_KEY. Nothing here places orders.
//
// Prices are American odds; each spread line's selections are per-outcome
// ladders, best first. Trades come from the public trade_execution broadcast,
// recorded by bot/runner/pxtape.ts into bot_mkt_trades. Fee: 2% of net
// winnings, modeled conservatively as 2%·(1−p) per contract on every fill.

import { canon as novigCanon } from "./novig";
import type { Rung } from "../ladder/engine";
import { prophetxFee } from "./fees";
import type { VenueAdapter, VenueGame } from "./types";

const BASE = process.env.PROPHETX_BASE || "https://cash.api.prophetx.co/partner";
// Same spellings as Novig ("Miami Florida", "New Haven College"); exact or alias matches only.
const canon = (s: string | undefined) => (s ? novigCanon(s) : null);

export interface PxCompetitor {
  id: number | string;
  name?: string;
  display_name?: string;
  side?: string; // "home" | "away" (to confirm)
}
export interface PxEvent {
  event_id: number;
  tournament_id?: number | string;
  name?: string;
  sport_name?: string;
  tournament_name?: string;
  scheduled?: string;
  status?: string;
  competitors?: PxCompetitor[];
}
export interface PxSelection {
  competitor_id?: number | string;
  outcome_id?: number | string;
  strike?: number;
  strike_id?: string;
  price?: number;
  quantity?: number;
  name?: string;
}
export interface PxMarket {
  id: number | string;
  name?: string;
  category_name?: string;
  sub_type?: string;
  type?: string;
  status?: string;
  strike?: number;
  selections?: (PxSelection | PxSelection[])[];
  /** v4: one child market per line, each with its own selections. */
  market_strikes?: PxMarket[];
}

/** Full-game spread markets only (not halves or quarters). */
export const isGameSpread = (m: PxMarket) =>
  /spread/i.test(m.type ?? "") && !/half|quarter|\b[1-4](st|nd|rd|th)?\s*(h|q)\b|\b(1h|2h|q[1-4])\b|period|team total/i.test(`${m.name ?? ""} ${m.category_name ?? ""} ${m.sub_type ?? ""}`);

/** Each line of a game-spread market as its own market (v4 nests lines under market_strikes). */
export function spreadLines(markets: PxMarket[]): PxMarket[] {
  const out: PxMarket[] = [];
  for (const m of markets) {
    if (!isGameSpread(m)) continue;
    if (m.market_strikes?.length) for (const k of m.market_strikes) out.push({ ...k, type: k.type ?? m.type, status: k.status ?? m.status });
    else out.push(m);
  }
  return out;
}

/** Odds → implied probability. |x| ≥ 100 = American; 1 < x < 100 = decimal. */
export function oddsToProb(x: number | undefined | null): number | null {
  if (x == null || !Number.isFinite(x)) return null;
  if (Math.abs(x) >= 100) return x < 0 ? -x / (-x + 100) : 100 / (x + 100);
  if (x > 1) return 1 / x;
  return null;
}

/** Each outcome's best level, whether selections come flat or as per-outcome ladders. */
export function bestPerOutcome(m: PxMarket): PxSelection[] {
  const sel = m.selections ?? [];
  if (sel.length && Array.isArray(sel[0])) return (sel as PxSelection[][]).map((ladder) => ladder[0]).filter(Boolean);
  const byOutcome = new Map<string, PxSelection>();
  for (const s of sel as PxSelection[]) {
    const k = String(s.competitor_id ?? s.outcome_id ?? s.name);
    if (!byOutcome.has(k)) byOutcome.set(k, s);
  }
  return [...byOutcome.values()];
}

/** Engine rungs from ProphetX spread markets. homeId/awayId = competitor ids. */
export function prophetxRungs(markets: PxMarket[], homeId: string, awayId: string): Rung[] {
  const rungs: Rung[] = [];
  const seen = new Set<string>();
  for (const m of spreadLines(markets)) {
    if (m.status && !/open|active/i.test(m.status)) continue;
    const outs = bestPerOutcome(m);
    if (outs.length !== 2) continue;
    const [a, b] = outs;
    const sideOf = (s: PxSelection) => (String(s.competitor_id) === homeId ? "home" : String(s.competitor_id) === awayId ? "away" : null);
    const side = sideOf(a);
    const line = a.strike ?? m.strike;
    if (!side || line == null || Number.isInteger(line)) continue;
    const backA = oddsToProb(a.price); // cost to buy "A covers"
    const backB = oddsToProb(b.price); // buying B = selling A
    const ticker = `PX:${a.strike_id ?? m.id}`;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    rungs.push({
      ticker,
      side,
      strike: -line,
      ask: backA != null && backA > 0 && backA < 1 ? Math.round(backA * 1000) / 1000 : null,
      bid: backB != null && backB > 0 && backB < 1 ? Math.round((1 - backB) * 1000) / 1000 : null,
    });
  }
  return rungs;
}

/** Both outcomes' strike_ids per game-spread line → the rung ticker, and whether backing it is YES. */
export function prophetxStrikeMap(markets: PxMarket[], homeId: string, awayId: string): Map<string, { ticker: string; isYes: boolean }> {
  const out = new Map<string, { ticker: string; isYes: boolean }>();
  for (const m of spreadLines(markets)) {
    const outs = bestPerOutcome(m);
    if (outs.length !== 2) continue;
    const [a, b] = outs;
    if (![homeId, awayId].includes(String(a.competitor_id))) continue;
    // Same lines as prophetxRungs: active, half-point (no pushes).
    const line = a.strike ?? m.strike;
    if ((m.status && !/open|active/i.test(m.status)) || line == null || Number.isInteger(line)) continue;
    const ticker = `PX:${a.strike_id ?? m.id}`;
    // Every level of a ladder shares its outcome's strike_id; take any that's present.
    const idOf = (k: number) => {
      const sel = m.selections?.[k];
      return (Array.isArray(sel) ? sel.find((x) => x.strike_id)?.strike_id : sel?.strike_id) ?? null;
    };
    const aid = idOf(0) ?? a.strike_id;
    const bid = idOf(1) ?? b.strike_id;
    if (aid) out.set(aid, { ticker, isYes: true });
    if (bid) out.set(bid, { ticker, isYes: false });
  }
  return out;
}

/** Logged-in ProphetX client (token refreshed before its ~10 minute expiry; retries 429/5xx). */
export function prophetxClient() {
  const access = process.env.PROPHETX_ACCESS_KEY;
  const secret = process.env.PROPHETX_SECRET_KEY;
  let token: string | null = null;
  let tokenUntil = 0;
  async function raw<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retry = Number(res.headers.get("retry-after"));
        await new Promise((r) => setTimeout(r, retry > 0 ? retry * 1000 : 1000 * 2 ** attempt + Math.random() * 500));
        continue;
      }
      throw new Error(`ProphetX ${res.status} on ${path.split("?")[0]}`);
    }
  }
  async function login() {
    if (token && Date.now() < tokenUntil) return;
    token = null;
    const r = await raw<any>("/auth/login", { method: "POST", body: JSON.stringify({ access_key: access, secret_key: secret }) });
    token = r?.data?.access_token ?? r?.access_token ?? null;
    if (!token) throw new Error("ProphetX login returned no access_token");
    tokenUntil = Date.now() + 8 * 60e3;
  }
  return {
    available: () => Boolean(access && secret),
    async call<T>(path: string, init: RequestInit = {}): Promise<T> {
      await login();
      return raw<T>(path, init);
    },
  };
}

export function prophetxAdapter(): VenueAdapter & { strikes: Map<string, { ticker: string; isYes: boolean; eventKey: string }>; tournaments: () => string[] } {
  const client = prophetxClient();
  const call = client.call;
  let events: PxEvent[] = [];
  let marketsBy: Promise<Map<string, PxMarket[]>> | null = null; // event_id → markets, batched once per cycle (shared by concurrent callers)
  const strikes = new Map<string, { ticker: string; isYes: boolean; eventKey: string }>();
  const diag: Record<string, unknown> = {};
  const counts = { found: 0, notFound: [] as string[], batches: 0 };

  async function marketsFor(eventId: string): Promise<PxMarket[]> {
    marketsBy ??= (async () => {
      const m = new Map<string, PxMarket[]>();
      const ids = events.map((e) => String(e.event_id));
      for (let i = 0; i < ids.length; i += 50) {
        const r = await call<any>(`/v4/mm/get_multiple_markets?event_ids=${ids.slice(i, i + 50).join(",")}`);
        counts.batches++;
        for (const [k, v] of Object.entries(r?.data ?? {})) if (Array.isArray(v)) m.set(String(k), v as PxMarket[]);
      }
      return m;
    })();
    const all = await marketsBy;
    if (!all.has(eventId)) {
      // Not in the batch (e.g. listed after prepare): fetch it alone.
      const r = await call<any>(`/v4/mm/get_markets?event_id=${eventId}`);
      all.set(eventId, r?.data?.markets ?? r?.markets ?? []);
    }
    return all.get(eventId)!;
  }

  return {
    id: "prophetx",
    label: "ProphetX",
    tick: 0.01,
    available: client.available,
    async prepare() {
      const r = await call<any>("/mm/get_sport_events");
      const all: PxEvent[] = r?.data?.sport_events ?? r?.sport_events ?? (Array.isArray(r?.data) ? r.data : []);
      events = all.filter((e) => /college|ncaa/i.test(`${e.tournament_name} ${e.sport_name}`) && /football/i.test(`${e.sport_name} ${e.tournament_name}`));
      marketsBy = null;
      Object.assign(diag, { events: all.length, cfb: events.length });
    },
    diag: () => (client.available() ? { ...diag, ...counts } : undefined),
    strikes,
    tournaments: () => [...new Set(events.map((e) => (e as { tournament_id?: number | string }).tournament_id).filter((x) => x != null).map(String))],
    async ladder(game: VenueGame) {
      const match = (e: PxEvent) => {
        const home = e.competitors?.find((c) => /home/i.test(c.side ?? ""));
        const away = e.competitors?.find((c) => /away/i.test(c.side ?? ""));
        return home && away && canon(home.display_name ?? home.name) === game.home_team && canon(away.display_name ?? away.name) === game.away_team ? { home, away } : null;
      };
      const ev = game.eventKey ? events.find((e) => String(e.event_id) === game.eventKey) : events.find((e) => match(e));
      const sides = ev && match(ev);
      if (!ev || !sides) {
        counts.notFound.push(`${game.away_team} @ ${game.home_team}`);
        return null;
      }
      const markets = await marketsFor(String(ev.event_id));
      counts.found++;
      for (const [k, v] of prophetxStrikeMap(markets, String(sides.home.id), String(sides.away.id))) strikes.set(k, { ...v, eventKey: String(ev.event_id) });
      return { eventKey: String(ev.event_id), rungs: prophetxRungs(markets, String(sides.home.id), String(sides.away.id)) };
    },
    trades: async () => [],
    fee: () => prophetxFee(),
  };
}
