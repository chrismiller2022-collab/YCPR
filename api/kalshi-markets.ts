// Read-only proxy to Kalshi's public (unauthenticated) market-data API,
// scoped to college football single-game markets (series KXNCAAFGAME —
// one event per matchup, two binary "Team X wins" markets per event).
// No API key or admin password needed: this is public market data,
// identical to what anyone sees on kalshi.com. Proxied through our own
// server rather than called directly from the client purely to avoid any
// CORS surprises and to keep this consistent with every other external
// API pull in this repo (all go through api/*.ts, never straight from
// the browser).

const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";

async function kalshiFetch(path: string) {
  const res = await fetch(`${KALSHI_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kalshi request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

interface KalshiMarket {
  event_ticker: string;
  ticker: string;
  yes_sub_title: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  volume_fp: string;
  occurrence_datetime?: string;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const seriesTicker = typeof req.query?.series_ticker === "string" ? req.query.series_ticker : "KXNCAAFGAME";

  try {
    const allMarkets: KalshiMarket[] = [];
    let cursor: string | null = null;
    // Kalshi paginates with a cursor; cap the number of pages so a bug on
    // their end (an endless cursor) can't hang this function forever.
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ series_ticker: seriesTicker, status: "open", limit: "1000" });
      if (cursor) qs.set("cursor", cursor);
      const data = await kalshiFetch(`/markets?${qs.toString()}`);
      const pageMarkets: KalshiMarket[] = data.markets ?? [];
      allMarkets.push(...pageMarkets);
      cursor = data.cursor || null;
      if (!cursor || pageMarkets.length === 0) break;
    }

    // Each game is one event_ticker carrying exactly two markets (one per
    // team) — group them back into games for the client so it doesn't
    // have to re-derive matchups from raw market rows.
    const byEvent = new Map<string, KalshiMarket[]>();
    for (const m of allMarkets) {
      const list = byEvent.get(m.event_ticker) ?? [];
      list.push(m);
      byEvent.set(m.event_ticker, list);
    }

    const games: any[] = [];
    for (const [eventTicker, markets] of byEvent) {
      if (markets.length !== 2) continue; // malformed/unexpected shape — skip rather than guess which side is which
      const [a, b] = markets;
      games.push({
        eventTicker,
        kickoff: a.occurrence_datetime ?? null,
        teamA: {
          name: a.yes_sub_title,
          yesBid: Number(a.yes_bid_dollars) || 0,
          yesAsk: Number(a.yes_ask_dollars) || 0,
          volume: Number(a.volume_fp) || 0,
        },
        teamB: {
          name: b.yes_sub_title,
          yesBid: Number(b.yes_bid_dollars) || 0,
          yesAsk: Number(b.yes_ask_dollars) || 0,
          volume: Number(b.volume_fp) || 0,
        },
      });
    }

    res.status(200).json({ games });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Kalshi fetch failed" });
  }
}
