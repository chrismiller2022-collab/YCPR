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

import { matchTeamName } from "../../src/lib/teamNameMatch";
import type { Rung } from "../ladder/engine";
import type { VenueAdapter, VenueGame } from "./types";

const BASE = process.env.PROPHETX_BASE || "https://cash.api.prophetx.co/partner";
const canon = (s: string | undefined) => (s ? matchTeamName(s.trim()).matched : null);

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
  type?: string;
  status?: string;
  strike?: number;
  selections?: (PxSelection | PxSelection[])[];
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
  for (const m of markets) {
    if (!/spread/i.test(m.type ?? "") || (m.status && !/open|active/i.test(m.status))) continue;
    const outs = bestPerOutcome(m);
    if (outs.length !== 2) continue;
    const [a, b] = outs;
    const sideOf = (s: PxSelection) => (String(s.competitor_id) === homeId ? "home" : String(s.competitor_id) === awayId ? "away" : null);
    const side = sideOf(a);
    const line = a.strike ?? m.strike;
    if (!side || line == null || Number.isInteger(line)) continue;
    const backA = oddsToProb(a.price); // cost to buy "A covers"
    const backB = oddsToProb(b.price); // buying B = selling A
    rungs.push({
      ticker: `PX:${a.strike_id ?? m.id}`,
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

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`ProphetX ${res.status} on ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }

  return {
    id: "prophetx",
    label: "ProphetX",
    tick: 0.01,
    available: () => Boolean(access && secret),
    async prepare() {
      if (!token || Date.now() > tokenUntil) {
        const r = await call<{ data: { access_token: string } }>("/auth/login", { method: "POST", body: JSON.stringify({ access_key: access, secret_key: secret }) });
        token = r.data.access_token;
        tokenUntil = Date.now() + 8 * 60e3; // access tokens last ~10 minutes
      }
      const r = await call<{ data: { sport_events: PxEvent[] } }>("/mm/get_sport_events");
      events = (r.data?.sport_events ?? []).filter((e) => /college|ncaa/i.test(`${e.tournament_name} ${e.sport_name}`) && /football/i.test(`${e.sport_name} ${e.tournament_name}`));
    },
    async ladder(game: VenueGame) {
      const match = (e: PxEvent) => {
        const home = e.competitors?.find((c) => /home/i.test(c.side ?? ""));
        const away = e.competitors?.find((c) => /away/i.test(c.side ?? ""));
        return home && away && canon(home.display_name ?? home.name) === game.home_team && canon(away.display_name ?? away.name) === game.away_team ? { home, away } : null;
      };
      const ev = game.eventKey ? events.find((e) => String(e.event_id) === game.eventKey) : events.find((e) => match(e));
      const sides = ev && match(ev);
      if (!ev || !sides) return null;
      const r = await call<{ data: { markets: PxMarket[] } }>(`/v4/mm/get_markets?event_id=${ev.event_id}`);
      return { eventKey: String(ev.event_id), rungs: prophetxRungs(r.data?.markets ?? [], String(sides.home.id), String(sides.away.id)) };
    },
    trades: async () => [],
    fee: () => (price, opts = {}) => 0.02 * (opts.count ?? 1) * (1 - price),
  };
}
