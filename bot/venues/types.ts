// A venue adapter turns one exchange's spread markets into the engine's common
// rung: a binary contract "<side> wins by over <strike>" priced 0–1, with the
// best YES bid/ask. The engine, fair price and exposure math never see
// venue-specific formats.

import type { FeeFn, Rung } from "../ladder/engine";

export type VenueId = "kalshi" | "novig" | "prophetx" | "polymarket";

export interface VenueGame {
  home_team: string;
  away_team: string;
  /** Sportsbook home margin (−home spread), used to sanity-check venues that don't label sides. */
  bookHomeMargin: number | null;
  /** Event id already matched on this venue, if any. */
  eventKey: string | null;
}

export interface VenueLadder {
  eventKey: string;
  rungs: Rung[];
}

export interface VenueTrade {
  ticker: string;
  /** Unix seconds. */
  t: number;
  /** Trade price expressed as the YES price of `ticker`. */
  yesPrice: number;
}

export interface VenueAdapter {
  id: VenueId;
  label: string;
  /** Price grid for quotes. */
  tick: number;
  /** False when credentials or data access are missing; the runner skips the venue. */
  available(): boolean;
  /** Called once per cycle before ladders are requested (e.g. list events, log in). */
  prepare(): Promise<void>;
  /** The game's ladder on this venue, or null if the venue doesn't list it (or sides can't be verified). */
  ladder(game: VenueGame): Promise<VenueLadder | null>;
  /** Trades on these tickers since `sinceTs` (unix seconds), for paper fills. Empty if the venue has no public tape. */
  trades(tickers: string[], sinceTs: number): Promise<VenueTrade[]>;
  /** Fee for one fill, as the engine's FeeFn; `hoursToKickoff` lets venues that only charge live return 0 pre-game; `eventKey` lets a venue apply a per-event fee override. */
  fee(hoursToKickoff: number, eventKey?: string | null): FeeFn;
  /** Traded volume on a ticker as of the last ladder() call, when the venue reports it. */
  volume?(ticker: string): number | undefined;
  /** Response-shape notes for this cycle (names and counts only), stored with the run. */
  diag?(): unknown;
}
