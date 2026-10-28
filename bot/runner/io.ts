// I/O for the bot runner: Supabase (service-role key, server-side only) and
// Kalshi public market data. Nothing here places exchange orders.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path: string, init: RequestInit = {}): Promise<any> {
  if (!SB_URL || !SB_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path.split("?")[0]}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Where this process runs, saved on every bot_runs row so the dashboard can tell the tower from the backups. */
export const RUN_HOST = process.env.BOT_HOST || (process.env.GITHUB_ACTIONS ? "github" : process.env.VERCEL ? "vercel" : "local");

export const db = {
  select: <T = any>(table: string, query = ""): Promise<T[]> => sb(`${table}?${query}`),
  /** Every matching row, paging past PostgREST's 1,000-row cap (query must include an order). */
  selectAll: async <T = any>(table: string, query: string): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const rows: T[] = await sb(`${table}?${query}`, { headers: { Range: `${from}-${from + 999}` } });
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  },
  insert: <T = any>(table: string, rows: object | object[]): Promise<T[]> => sb(table, { method: "POST", body: JSON.stringify(rows) }),
  /** Insert or update on the given conflict columns; returns nothing. */
  upsert: (table: string, rows: object[], onConflict: string): Promise<null> =>
    sb(`${table}?on_conflict=${onConflict}`, { method: "POST", headers: { Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows) }),
  update: <T = any>(table: string, filter: string, patch: object): Promise<T[]> => sb(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

const KALSHI = "https://external-api.kalshi.com/trade-api/v2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kalshi<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(KALSHI + path);
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Kalshi ${res.status} on ${path.split("?")[0]}`);
  }
}

export interface LiveMarket {
  ticker: string;
  yes_sub_title: string;
  floor_strike: number;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  result: string;
  status: string;
  volume_fp?: string;
}
export interface LiveEvent {
  event_ticker: string;
  title: string;
  markets: LiveMarket[];
}

export async function openSpreadEvents(series = "KXNCAAFSPREAD"): Promise<LiveEvent[]> {
  const out: LiveEvent[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const d = await kalshi<{ events: LiveEvent[]; cursor?: string }>(`/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`);
    out.push(...d.events);
    cursor = d.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

export async function eventMarkets(eventTicker: string): Promise<LiveMarket[]> {
  const d = await kalshi<{ markets: LiveMarket[] }>(`/markets?event_ticker=${eventTicker}&limit=200`);
  return d.markets;
}

export async function tradesSince(ticker: string, minTs: number): Promise<{ t: number; yesPrice: number }[]> {
  const out: { t: number; yesPrice: number }[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const d = await kalshi<{ trades: { created_time: string; yes_price_dollars: string }[]; cursor?: string }>(
      `/markets/trades?ticker=${ticker}&min_ts=${minTs}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`
    );
    for (const tr of d.trades) out.push({ t: Math.floor(new Date(tr.created_time).getTime() / 1000), yesPrice: Number(tr.yes_price_dollars) });
    cursor = d.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}
