import { kalshiAdapter } from "./kalshi";
import { novigAdapter } from "./novig";
import { polymarketAdapter } from "./polymarket";
import { prophetxAdapter } from "./prophetx";
import type { VenueAdapter, VenueId } from "./types";

export * from "./types";
export const VENUES: VenueId[] = ["kalshi", "novig", "prophetx", "polymarket"];

export function makeAdapters(): Record<VenueId, VenueAdapter> {
  return { kalshi: kalshiAdapter(), novig: novigAdapter(), prophetx: prophetxAdapter(), polymarket: polymarketAdapter() };
}
