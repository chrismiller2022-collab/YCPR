// Kalshi: KXNCAAFSPREAD events, public books and trades (no key needed for paper).

import { matchTeamName } from "../../src/lib/teamNameMatch";
import { kalshiFee } from "../fairPrice/kalshi";
import type { Rung } from "../ladder/engine";
import { openSpreadEvents, tradesSince, type LiveEvent } from "../runner/io";
import type { VenueAdapter, VenueGame } from "./types";

const canon = (s: string) => matchTeamName(s.trim()).matched;

export function kalshiRungs(game: Pick<VenueGame, "home_team" | "away_team">, event: LiveEvent): Rung[] {
  const rungs: Rung[] = [];
  for (const m of event.markets) {
    const team = canon(m.yes_sub_title.replace(/\s+wins by over.*$/i, ""));
    const side = team === game.home_team ? "home" : team === game.away_team ? "away" : null;
    if (!side || m.status !== "active") continue;
    const bid = Number(m.yes_bid_dollars);
    const ask = Number(m.yes_ask_dollars);
    rungs.push({ ticker: m.ticker, side, strike: Number(m.floor_strike), bid: bid > 0 ? bid : null, ask: ask > 0 && ask < 1 ? ask : null });
  }
  return rungs;
}

export function findKalshiEvent(game: Pick<VenueGame, "home_team" | "away_team">, events: LiveEvent[]): LiveEvent | null {
  for (const e of events) {
    const names = e.title.replace(/:\s*Spread$/i, "").split(/\s+(?:vs\.?|at|@)\s+/i).map(canon);
    if (names.length === 2 && names.includes(game.home_team) && names.includes(game.away_team)) return e;
  }
  return null;
}

export function kalshiAdapter(): VenueAdapter {
  let events: LiveEvent[] = [];
  const volume = new Map<string, number>();
  return {
    id: "kalshi",
    label: "Kalshi",
    tick: 0.01,
    available: () => true,
    async prepare() {
      events = await openSpreadEvents();
      for (const e of events) for (const m of e.markets) volume.set(m.ticker, Number(m.volume_fp ?? 0));
    },
    volume: (ticker) => volume.get(ticker),
    async ladder(game) {
      const e = game.eventKey ? events.find((x) => x.event_ticker === game.eventKey) ?? null : findKalshiEvent(game, events);
      return e ? { eventKey: e.event_ticker, rungs: kalshiRungs(game, e) } : null;
    },
    async trades(tickers, sinceTs) {
      const out = [];
      for (const ticker of tickers) for (const t of await tradesSince(ticker, sinceTs)) out.push({ ticker, ...t });
      return out;
    },
    fee: () => kalshiFee,
  };
}
