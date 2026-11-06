// Read-only proxy to Kalshi's public (unauthenticated) market-data API.
// Two shapes:
//   - Game markets (series KXNCAAFGAME): one event per matchup, exactly
//     two binary "Team X wins" markets per event — returned as `games`.
//   - Futures markets (KXNCAAF, KXNCAAFCONF, KXNCAAFPLAYOFF,
//     KXNCAAFFINALIST, KXNCAAFSF, KXNCAAFQF, KXNCAAFUNDEFEATED,
//     KXNCAAFWINS, KXNCAAFB12, etc.): one event can carry anywhere from a
//     couple to 130+ outcomes (every team's title odds, or one team's
//     whole win-total ladder) — returned as `events` when `mode=futures`
//     is passed, no assumption about outcome count per event.
// No API key or admin password needed: this is public market data,
// identical to what anyone sees on kalshi.com. Proxied server-side, same
// as every other external API in this repo, so this function controls
// exactly when a request fires and stays consistent with the rest of
// the site's read-only external-API pattern.

const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";
const NOVIG_BASE = "https://api.novig.com/v3/public";

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
  title?: string;
  yes_sub_title: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  volume_fp: string;
  occurrence_datetime?: string;
}

async function fetchAllMarketsForSeries(seriesTicker: string): Promise<KalshiMarket[]> {
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
  return allMarkets;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const mode = req.query?.mode === "futures" ? "futures" : req.query?.mode === "discover" ? "discover" : "game";

  // Exchange spread ladders for "Refresh Vegas lines" (games the sportsbook feed doesn't carry, mostly FCS):
  //   mode=spreads          Kalshi KXNCAAFSPREAD events with their nested markets (every strike, both sides)
  //   mode=novig-events     Novig's NCAAF event list (public catalog, no key)
  //   mode=novig-markets&events=id,id,...  Novig SPREAD markets for those events (at most 40 per call)
  // Same public data the bot reads; the client turns each ladder into one implied spread (bot/ladder/engine.ts).
  const rawMode = String(req.query?.mode ?? "");
  try {
    if (rawMode === "spreads") {
      const events: any[] = [];
      let cursor = "";
      for (let page = 0; page < 20; page++) {
        const d = await kalshiFetch(`/events?series_ticker=KXNCAAFSPREAD&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`);
        for (const e of d.events ?? []) {
          events.push({
            event_ticker: e.event_ticker,
            title: e.title,
            markets: (e.markets ?? []).map((m: any) => ({
              ticker: m.ticker,
              yes_sub_title: m.yes_sub_title,
              floor_strike: m.floor_strike,
              yes_bid_dollars: m.yes_bid_dollars,
              yes_ask_dollars: m.yes_ask_dollars,
              status: m.status,
            })),
          });
        }
        cursor = d.cursor ?? "";
        if (!cursor) break;
      }
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ events });
      return;
    }
    if (rawMode === "novig-events") {
      const r = await fetch(`${NOVIG_BASE}/catalog/events?league=NCAAF&limit=200`, { headers: { "User-Agent": "ycpr" } });
      if (!r.ok) throw new Error(`Novig events failed (${r.status})`);
      const d = await r.json();
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ events: (d.items ?? []).map((e: any) => ({ eventId: e.eventId, description: e.description, startsTs: e.startsTs, status: e.status })) });
      return;
    }
    if (rawMode === "novig-markets") {
      const ids = String(req.query?.events ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^[\w-]+$/.test(x))
        .slice(0, 40);
      const out: Record<string, any[]> = {};
      // Novig rate-limits bursts: four at a time, with a short retry on 429.
      const queue = [...ids];
      async function worker() {
        for (let id = queue.shift(); id; id = queue.shift()) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const r = await fetch(`${NOVIG_BASE}/catalog/markets?event=${id}&marketType=SPREAD&limit=200`, { headers: { "User-Agent": "ycpr" } });
            if (r.status === 429 || r.status >= 500) {
              await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)));
              continue;
            }
            if (r.ok) out[id] = ((await r.json()).items ?? []).filter((m: any) => m.eventId === id);
            break;
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ markets: out });
      return;
    }

    if (mode === "discover") {
      // Auto-discovers every NCAAF-prefixed series (conference championships
      // especially — Chris only had to hand us a handful of example links,
      // this finds the rest without needing every one individually).
      const allSeries: { ticker: string; title: string; category: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ limit: "200" });
        if (cursor) qs.set("cursor", cursor);
        const data = await kalshiFetch(`/series?${qs.toString()}`);
        const pageSeries: { ticker: string; title: string; category: string }[] = data.series ?? [];
        allSeries.push(...pageSeries);
        cursor = data.cursor || null;
        if (!cursor || pageSeries.length === 0) break;
      }
      const ncaaf = allSeries.filter((s) => s.ticker.startsWith("KXNCAAF"));
      res.status(200).json({ series: ncaaf });
      return;
    }

    const seriesTicker = typeof req.query?.series_ticker === "string" ? req.query.series_ticker : "KXNCAAFGAME";
    const allMarkets = await fetchAllMarketsForSeries(seriesTicker);

    if (mode === "futures") {
      // Group by event (e.g. one team's whole win-total ladder, or the
      // single "who wins it all" event with 130+ team outcomes) without
      // assuming how many outcomes belong to it.
      const byEvent = new Map<string, KalshiMarket[]>();
      for (const m of allMarkets) {
        const list = byEvent.get(m.event_ticker) ?? [];
        list.push(m);
        byEvent.set(m.event_ticker, list);
      }
      const events = Array.from(byEvent.entries()).map(([eventTicker, markets]) => ({
        eventTicker,
        outcomes: markets.map((m) => ({
          ticker: m.ticker,
          name: m.yes_sub_title,
          title: m.title ?? null,
          yesBid: Number(m.yes_bid_dollars) || 0,
          yesAsk: Number(m.yes_ask_dollars) || 0,
          volume: Number(m.volume_fp) || 0,
        })),
      }));
      res.status(200).json({ seriesTicker, events });
      return;
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
