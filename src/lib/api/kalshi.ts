import { cachedFetch, invalidateCacheKey } from "./cache";

export interface KalshiTeamMarket {
  name: string;
  yesBid: number;
  yesAsk: number;
  volume: number;
}

export interface KalshiGameMarket {
  eventTicker: string;
  kickoff: string | null;
  teamA: KalshiTeamMarket;
  teamB: KalshiTeamMarket;
}

export interface KalshiGame extends KalshiGameMarket {
  teamAProb: number | null;
  teamBProb: number | null;
}

// Mid of yes bid/ask as the market's implied win probability. A market
// with zero volume and a 0/0 bid-ask is one Kalshi hasn't opened trading
// on yet (a placeholder, not a real price) — null rather than a
// misleading 50/50 or the default wide spread.
function impliedProb(t: KalshiTeamMarket): number | null {
  if (t.volume === 0 && t.yesBid === 0 && t.yesAsk === 0) return null;
  return (t.yesBid + t.yesAsk) / 2;
}

async function fetchKalshiCfbMarketsUncached(): Promise<KalshiGame[]> {
  const res = await fetch("/api/kalshi-markets");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch Kalshi markets");
  return (data.games as KalshiGameMarket[]).map((g) => ({
    ...g,
    teamAProb: impliedProb(g.teamA),
    teamBProb: impliedProb(g.teamB),
  }));
}

// Short TTL, not a real persistence layer — per Chris, live snapshot
// only, this just dedupes rapid re-renders/re-mounts within a browsing
// session rather than serving stale market prices.
export function fetchKalshiCfbMarkets(): Promise<KalshiGame[]> {
  return cachedFetch("kalshi-cfb-markets", fetchKalshiCfbMarketsUncached, 60_000);
}

export interface KalshiFuturesOutcome {
  ticker: string;
  name: string;
  title: string | null;
  yesBid: number;
  yesAsk: number;
  volume: number;
}
export interface KalshiFuturesEvent {
  eventTicker: string;
  outcomes: KalshiFuturesOutcome[];
}

// Confirmed series tickers (from Chris's own market links) — add more as
// they're confirmed rather than guessing at conference ticker patterns,
// since a wrong guess just 404s silently into an empty list.
export const KALSHI_FUTURES_SERIES = {
  championship: "KXNCAAF",
  championshipConference: "KXNCAAFCONF", // which conference the champion comes from — a meta-market, not a specific conference's own bracket
  playoffQualifier: "KXNCAAFPLAYOFF",
  finalist: "KXNCAAFFINALIST",
  semifinalist: "KXNCAAFSF",
  quarterfinalist: "KXNCAAFQF",
  undefeatedRegularSeason: "KXNCAAFUNDEFEATED",
  winTotals: "KXNCAAFWINS", // whole series = every team's win-total ladder in one call
  conferenceChampion: {
    Big12: "KXNCAAFB12",
    // more conferences to add once confirmed — same KXNCAAF<CONF> pattern
  },
} as const;

async function fetchKalshiFuturesUncached(seriesTicker: string): Promise<KalshiFuturesEvent[]> {
  const res = await fetch(`/api/kalshi-markets?mode=futures&series_ticker=${encodeURIComponent(seriesTicker)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to fetch Kalshi futures for ${seriesTicker}`);
  return data.events as KalshiFuturesEvent[];
}

/** Same short-TTL live-snapshot caching as fetchKalshiCfbMarkets — one cache entry per series. */
export function fetchKalshiFutures(seriesTicker: string): Promise<KalshiFuturesEvent[]> {
  return cachedFetch(`kalshi-futures:${seriesTicker}`, () => fetchKalshiFuturesUncached(seriesTicker), 60_000);
}

export interface KalshiSeriesInfo {
  ticker: string;
  title: string;
  category: string;
}

async function discoverKalshiNcaafSeriesUncached(): Promise<KalshiSeriesInfo[]> {
  const res = await fetch("/api/kalshi-markets?mode=discover");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to discover Kalshi NCAAF series");
  return data.series as KalshiSeriesInfo[];
}

/** All KXNCAAF-prefixed series Kalshi currently has — used to auto-find conference championship series without needing every ticker hand-fed. */
export function discoverKalshiNcaafSeries(): Promise<KalshiSeriesInfo[]> {
  return cachedFetch("kalshi-discover-ncaaf", discoverKalshiNcaafSeriesUncached, 60 * 60 * 1000);
}

export function invalidateKalshiFutures(): void {
  invalidateCacheKey("kalshi-futures:", true);
}
