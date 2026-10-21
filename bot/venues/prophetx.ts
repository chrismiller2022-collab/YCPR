// ProphetX: Trading API (keys from the website's "API Integration" menu, no
// approval). Paper mode only reads: /auth/login → /mm/get_sport_events →
// /v4/mm/get_markets. Needs PROPHETX_ACCESS_KEY and PROPHETX_SECRET_KEY.
//
// UNVERIFIED until real keys are available: response shapes below follow the
// docs, and parsing is defensive (prices in American or decimal odds;
// selections as a flat list or a list of per-outcome ladders). There is no
// public trade tape, so paper fills only happen when the book moves through
// a quote. Fee: 2% of net winnings, modeled conservatively as 2%·(1−p) per
// contract on every fill.

import { canon as novigCanon } from "./novig";
import type { Rung } from "../ladder/engine";
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

export function prophetxAdapter(): VenueAdapter {
  const access = process.env.PROPHETX_ACCESS_KEY;
  const secret = process.env.PROPHETX_SECRET_KEY;
  let token: string | null = null;
  let tokenUntil = 0;
  let events: PxEvent[] = [];
  // Shape notes for the run record: names, keys and counts only (the repo's logs are public; this goes to the DB).
  const diag: Record<string, unknown> = {};
  const keysOf = (x: unknown) => (x && typeof x === "object" ? Object.keys(x as object).slice(0, 30) : typeof x);
  const ladders: unknown[] = [];

  // The paper cycle and the recorder start together, so back off and retry on 429/5xx.
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  return {
    id: "prophetx",
    label: "ProphetX",
    tick: 0.01,
    available: () => Boolean(access && secret),
    async prepare() {
      if (!token || Date.now() > tokenUntil) {
        const r = await call<any>("/auth/login", { method: "POST", body: JSON.stringify({ access_key: access, secret_key: secret }) });
        diag.login = keysOf(r?.data ?? r);
        token = r?.data?.access_token ?? r?.access_token ?? null;
        if (!token) throw new Error("ProphetX login returned no access_token");
        tokenUntil = Date.now() + 8 * 60e3; // access tokens last ~10 minutes
      }
      const r = await call<any>("/mm/get_sport_events");
      const all: PxEvent[] = r?.data?.sport_events ?? r?.sport_events ?? (Array.isArray(r?.data) ? r.data : []);
      events = all.filter((e) => /college|ncaa/i.test(`${e.tournament_name} ${e.sport_name}`) && /football/i.test(`${e.sport_name} ${e.tournament_name}`));
      const kinds: Record<string, number> = {};
      for (const e of all) kinds[`${e.sport_name} / ${e.tournament_name}`] = (kinds[`${e.sport_name} / ${e.tournament_name}`] ?? 0) + 1;
      Object.assign(diag, {
        response: keysOf(r?.data ?? r),
        events: all.length,
        cfb: events.length,
        kinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 15)),
        eventKeys: keysOf(events[0] ?? all[0]),
        sample: events.slice(0, 4).map((e) => ({ name: e.name, competitors: e.competitors?.map((c) => ({ ...c, id: undefined, keys: keysOf(c) })) })),
      });
    },
    diag: () => (access && secret ? { ...diag, ladders } : undefined),
    async ladder(game: VenueGame) {
      const match = (e: PxEvent) => {
        const home = e.competitors?.find((c) => /home/i.test(c.side ?? ""));
        const away = e.competitors?.find((c) => /away/i.test(c.side ?? ""));
        return home && away && canon(home.display_name ?? home.name) === game.home_team && canon(away.display_name ?? away.name) === game.away_team ? { home, away } : null;
      };
      const ev = game.eventKey ? events.find((e) => String(e.event_id) === game.eventKey) : events.find((e) => match(e));
      const sides = ev && match(ev);
      if (!ev || !sides) {
        const words = [game.home_team, game.away_team].flatMap((t) => t.split(/[\s()]+/).filter((x) => x.length > 3));
        ladders.push({
          game: `${game.away_team} @ ${game.home_team}`, found: false,
          nearMisses: events.filter((e) => words.some((x) => (e.name ?? "").includes(x))).slice(0, 5).map((e) => ({ name: e.name, competitors: e.competitors?.map((c) => `${c.side}: ${c.display_name ?? c.name}`) })),
        });
        return null;
      }
      const r = await call<any>(`/v4/mm/get_markets?event_id=${ev.event_id}`);
      const markets: PxMarket[] = r?.data?.markets ?? r?.markets ?? (Array.isArray(r?.data) ? r.data : []);
      const rungs = prophetxRungs(markets, String(sides.home.id), String(sides.away.id));
      const types: Record<string, number> = {};
      for (const m of markets) types[String(m.type)] = (types[String(m.type)] ?? 0) + 1;
      const spreads = markets.filter((m) => /spread/i.test(m.type ?? ""));
      const line = spreadLines(markets)[0];
      const sel = line?.selections?.[0];
      ladders.push({
        game: `${game.away_team} @ ${game.home_team}`, found: true, markets: markets.length, types, rungs: rungs.length,
        response: keysOf(r?.data ?? r),
        spreads: spreads.map((m) => ({ name: m.name, category: m.category_name, sub_type: m.sub_type, status: m.status, game: isGameSpread(m), lines: m.market_strikes?.length ?? 0 })),
        lineKeys: keysOf(line), selectionKeys: keysOf(Array.isArray(sel) ? sel[0] : sel), nested: Array.isArray(sel),
        sampleLine: line ? { strike: line.strike, status: line.status, selections: (line.selections ?? []).slice(0, 2).map((x) => (Array.isArray(x) ? x.slice(0, 2) : x)) } : null,
      });
      return { eventKey: String(ev.event_id), rungs };
    },
    trades: async () => [],
    fee: () => (price, opts = {}) => 0.02 * (opts.count ?? 1) * (1 - price),
  };
}
