// Read-only Kalshi public market history, cached on disk so reruns are free.
// Uses only unauthenticated endpoints; never places or reads orders.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const CACHE_DIR = fileURLToPath(new URL("./.cache/", import.meta.url));

export interface KalshiMarket {
  ticker: string;
  yes_sub_title: string;
  floor_strike: number;
  result: string; // "yes" | "no" (anything else = void / unsettled)
  status: string;
  open_time: string;
  close_time: string;
  volume_fp: string;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string; // "Wake Forest vs California: Spread"
  markets: KalshiMarket[];
}

export interface Candle {
  end_period_ts: number;
  yes_bid: { close_dollars?: string | null };
  yes_ask: { close_dollars?: string | null };
  volume_fp: string;
}

export interface EventCandles {
  market_tickers: string[];
  market_candlesticks: Candle[][];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    // Stay well under the Basic read budget (~20/s).
    const wait = last + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(BASE + path);
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`${res.status} ${path}: ${await res.text()}`);
  }
}

function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const file = CACHE_DIR + name.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";
  if (existsSync(file)) return Promise.resolve(JSON.parse(readFileSync(file, "utf8")) as T);
  return load().then((v) => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(v));
    return v;
  });
}

/** Every settled event in a series, with its markets nested. */
export function settledEvents(series: string): Promise<KalshiEvent[]> {
  return cached(`events-${series}-settled`, async () => {
    const out: KalshiEvent[] = [];
    let cursor = "";
    do {
      const page = await getJson<{ events: KalshiEvent[]; cursor?: string }>(
        `/events?series_ticker=${series}&status=settled&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`
      );
      out.push(...page.events);
      cursor = page.cursor ?? "";
    } while (cursor);
    return out;
  });
}

/** Hourly candles for every market in an event between two unix-second timestamps. */
export function eventCandles(series: string, eventTicker: string, startTs: number, endTs: number): Promise<EventCandles> {
  return cached(`candles-${eventTicker}-${startTs}-${endTs}`, async () => {
    const merged = new Map<string, Candle[]>();
    let from = startTs;
    for (let guard = 0; guard < 50 && from < endTs; guard++) {
      const page = await getJson<EventCandles & { adjusted_end_ts?: number }>(
        `/series/${series}/events/${eventTicker}/candlesticks?start_ts=${from}&end_ts=${endTs}&period_interval=60`
      );
      page.market_tickers.forEach((t, i) => {
        const list = merged.get(t) ?? [];
        list.push(...(page.market_candlesticks[i] ?? []));
        merged.set(t, list);
      });
      const adjusted = page.adjusted_end_ts ?? endTs;
      if (adjusted >= endTs) break;
      from = adjusted;
    }
    const tickers = [...merged.keys()];
    return {
      market_tickers: tickers,
      market_candlesticks: tickers.map((t) => {
        const seen = new Set<number>();
        return merged.get(t)!.filter((c) => !seen.has(c.end_period_ts) && seen.add(c.end_period_ts)).sort((a, b) => a.end_period_ts - b.end_period_ts);
      }),
    };
  });
}
