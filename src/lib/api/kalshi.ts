import { cachedFetch } from "./cache";

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
