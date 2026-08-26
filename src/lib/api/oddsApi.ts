import { cachedFetch, invalidateCacheKey } from "./cache";

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}
export interface OddsMarket {
  key: "spreads" | "h2h" | "totals";
  outcomes: OddsOutcome[];
}
export interface OddsBookmaker {
  key: string; // "bovada" | "betonlineag" | "novig"
  title: string;
  lastUpdate: string;
  markets: OddsMarket[];
}
export interface OddsGame {
  id: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: OddsBookmaker[];
}

const CACHE_KEY = "odds-feed";

async function fetchOddsFeedUncached(): Promise<OddsGame[]> {
  const res = await fetch("/api/odds-feed");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch odds feed");
  return data.games as OddsGame[];
}

// No background polling, per Chris — this only ever fires when a
// component mounts (page opened) or invalidateOddsFeed() is called (the
// page's own manual "Refresh" button), never on a timer. The 15-minute
// TTL just dedupes re-mounts of the same page within a browsing session
// (switching Oddscreen <-> Game Cards, opening/closing a game's expanded
// view) so those don't each burn a fresh credit-metered request.
export function fetchOddsFeed(): Promise<OddsGame[]> {
  return cachedFetch(CACHE_KEY, fetchOddsFeedUncached, 15 * 60 * 1000);
}

/** Forces the next fetchOddsFeed() call to hit the network again — wired to the page's manual Refresh button. */
export function invalidateOddsFeed(): void {
  invalidateCacheKey(CACHE_KEY);
}

// Where each book's header/best-line link should point. Deep links into a
// specific bet slip aren't available from the odds data (none of these
// books expose one) — this goes to the book's general CFB odds page.
export const BOOK_META: Record<string, { label: string; url: string; color: string }> = {
  novig: { label: "Novig", url: "https://www.novig.us/", color: "#4f8ff7" },
  kalshi: { label: "Kalshi", url: "https://kalshi.com/markets/kxncaafgame", color: "#00d4a0" },
  betonlineag: { label: "BetOnline", url: "https://www.betonline.ag/sportsbook/football/ncaa", color: "#e8792e" },
  bovada: { label: "Bovada", url: "https://www.bovada.lv/sports/football/college-football", color: "#c9a84c" },
};

export const BOOK_ORDER = ["novig", "kalshi", "betonlineag", "bovada"];

export interface OddsApiFuturesOutcome {
  team: string;
  book: string;
  price: number;
}

async function fetchOddsFuturesUncached(): Promise<OddsApiFuturesOutcome[]> {
  const res = await fetch("/api/odds-feed?mode=futures");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch championship futures");
  return data.outcomes as OddsApiFuturesOutcome[];
}

/** NCAAF Championship Winner outrights — same no-polling, manual-refresh-only caching as fetchOddsFeed. */
export function fetchOddsFutures(): Promise<OddsApiFuturesOutcome[]> {
  return cachedFetch("odds-futures:championship", fetchOddsFuturesUncached, 15 * 60 * 1000);
}

export function invalidateOddsFutures(): void {
  invalidateCacheKey("odds-futures:championship");
}
