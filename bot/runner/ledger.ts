// The paper cycle's own record of its fills, resting orders and last snapshot prices, kept on the machine it runs on
// (the tower). Every cycle used to download each watched game's full fill history and every resting order, and the last
// snapshots per venue, about 0.5 GB a day of data the cycle had written itself. Now:
//  - on load, only rows newer than the last ones seen are fetched (one small request each for fills and orders);
//  - the cycle's own changes (orders filled, cancelled or partly filled, fills graded, snapshots saved) are applied here;
//  - everything is re-read from the database every RESYNC_MS, and whenever the previous cycle didn't finish (the file is
//    marked dirty while a cycle runs), so a cycle cut off mid-way can't leave a stale order to be filled twice.
// The paper cycle is the only writer of these rows (the dashboard only reads them; markouts touch other columns).
import { db } from "./io";
import { readState, writeState } from "./localState";

const FILE = "paper-ledger.json";
const VERSION = 1;
const RESYNC_MS = 3 * 3600e3;

export interface LedgerFill {
  id: number | null; // null = written this cycle, id not known until the next load
  game_id: string;
  strategy_id: number | null;
  venue: string;
  ticker: string;
  side: string;
  strike: number;
  action: "buy" | "sell";
  price: number;
  count: number;
  fee: number | null;
  result: number | null;
  close_mid: number | null;
}

export interface LedgerOrder {
  id: number;
  game_id: string;
  strategy_id: number | null;
  venue: string;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  kind: string;
  fair: number | null;
  created_at: string;
}

interface Snap {
  bid: number | null;
  ask: number | null;
  fair: number | null;
}

interface LedgerFile {
  version: number;
  mode: string;
  syncedAt: number;
  dirty: boolean;
  maxFillId: number;
  maxOrderId: number;
  fills: LedgerFill[];
  orders: LedgerOrder[];
  snaps: Record<string, Snap>; // "<game>|<venue>|<ticker>"
  snapGames: string[]; // "<game>|<venue>" whose last snapshots have been read from the database
}

const FILL_COLS = "id,game_id,strategy_id,venue,ticker,side,strike,action,price,count,fee,result,close_mid";
const ORDER_COLS = "id,game_id,strategy_id,venue,ticker,action,price,count,kind,fair,created_at";
const n = (v: unknown) => (v == null ? null : Number(v));
const fillOf = (r: any): LedgerFill => ({
  id: Number(r.id), game_id: String(r.game_id), strategy_id: n(r.strategy_id), venue: r.venue ?? "kalshi", ticker: r.ticker, side: r.side, strike: Number(r.strike),
  action: r.action, price: Number(r.price), count: Number(r.count), fee: n(r.fee), result: n(r.result), close_mid: n(r.close_mid),
});
const orderOf = (r: any): LedgerOrder => ({
  id: Number(r.id), game_id: String(r.game_id), strategy_id: n(r.strategy_id), venue: r.venue ?? "kalshi", ticker: r.ticker, action: r.action,
  price: Number(r.price), count: Number(r.count), kind: r.kind, fair: n(r.fair), created_at: r.created_at,
});

export class PaperLedger {
  private fills: LedgerFill[];
  private pending: LedgerFill[] = []; // written this cycle (no id yet); picked up from the database next load
  private orders: Map<number, LedgerOrder>;
  private snaps: Record<string, Snap>;
  private snapGames: Set<string>;

  private constructor(private f: LedgerFile, readonly synced: "full" | "incremental") {
    this.fills = f.fills;
    this.orders = new Map(f.orders.map((o) => [o.id, o]));
    this.snaps = f.snaps;
    this.snapGames = new Set(f.snapGames);
  }

  static async load(mode: string, nowMs: number = Date.now()): Promise<PaperLedger> {
    const prev = readState<LedgerFile>(FILE);
    const usable = prev && prev.version === VERSION && prev.mode === mode && !prev.dirty && nowMs - prev.syncedAt < RESYNC_MS;
    let file: LedgerFile;
    if (!usable) {
      const fills = (await db.selectAll<any>("bot_fills", `select=${FILL_COLS}&mode=eq.${mode}&order=id`)).map(fillOf);
      const orders = (await db.selectAll<any>("bot_orders", `select=${ORDER_COLS}&mode=eq.${mode}&status=eq.resting&order=id`)).map(orderOf);
      file = {
        version: VERSION, mode, syncedAt: nowMs, dirty: true, fills, orders, snaps: {}, snapGames: [],
        maxFillId: Math.max(0, ...fills.map((x) => x.id ?? 0)), maxOrderId: Math.max(0, ...orders.map((x) => x.id)),
      };
    } else {
      const newFills = (await db.selectAll<any>("bot_fills", `select=${FILL_COLS}&mode=eq.${mode}&id=gt.${prev.maxFillId}&order=id`)).map(fillOf);
      const newOrders = (await db.selectAll<any>("bot_orders", `select=${ORDER_COLS}&mode=eq.${mode}&status=eq.resting&id=gt.${prev.maxOrderId}&order=id`)).map(orderOf);
      file = {
        ...prev,
        dirty: true,
        fills: [...prev.fills, ...newFills],
        orders: [...prev.orders, ...newOrders],
        maxFillId: Math.max(prev.maxFillId, ...newFills.map((x) => x.id ?? 0)),
        maxOrderId: Math.max(prev.maxOrderId, ...newOrders.map((x) => x.id)),
      };
    }
    // Marked dirty until this cycle saves: a cycle that's cut off makes the next one re-read everything.
    writeState(FILE, file);
    return new PaperLedger(file, usable ? "incremental" : "full");
  }

  /** Every fill on a game (including ones written this cycle). */
  fillsFor(gameId: string): LedgerFill[] {
    return [...this.fills, ...this.pending].filter((f) => f.game_id === String(gameId));
  }

  allFills(): LedgerFill[] {
    return [...this.fills, ...this.pending];
  }

  /** Which of these games have a fill without a result or a closing mid. */
  gamesWithOpenFills(gameIds: string[]): Set<string> {
    const want = new Set(gameIds.map(String));
    return new Set(this.fills.filter((f) => want.has(f.game_id) && (f.result == null || f.close_mid == null)).map((f) => f.game_id));
  }

  restingFor(gameId: string): LedgerOrder[] {
    return [...this.orders.values()].filter((o) => o.game_id === String(gameId));
  }

  /** Fills written this cycle. */
  addFills(rows: Omit<LedgerFill, "id" | "result" | "close_mid">[]): void {
    for (const r of rows) this.pending.push({ ...fillOf({ ...r, id: 0 }), id: null });
  }

  /** A fill graded (result and/or closing mid). */
  patchFill(id: number, patch: { result?: number; close_mid?: number }): void {
    const f = this.fills.find((x) => x.id === id);
    if (f) Object.assign(f, patch);
  }

  /** Orders that stopped resting (filled or cancelled). */
  removeOrders(ids: number[]): void {
    for (const id of ids) this.orders.delete(id);
  }

  /** Resting orders placed this cycle (ids from the insert). */
  addOrders(rows: any[]): void {
    for (const r of rows) {
      const o = orderOf(r);
      this.orders.set(o.id, o);
      this.f.maxOrderId = Math.max(this.f.maxOrderId, o.id);
    }
  }

  setOrderCount(id: number, count: number): void {
    const o = this.orders.get(id);
    if (o) o.count = count;
  }

  /** Every resting order (optionally on one game) cancelled. */
  clearOrders(gameId?: string): void {
    for (const o of [...this.orders.values()]) if (gameId == null || o.game_id === String(gameId)) this.orders.delete(o.id);
  }

  /** The last saved snapshot per ticker for a game on a venue, or null if they haven't been read from the database yet. */
  lastSnaps(gameId: string, venue: string): Map<string, Snap> | null {
    const key = `${gameId}|${venue}`;
    if (!this.snapGames.has(key)) return null;
    const out = new Map<string, Snap>();
    const prefix = `${key}|`;
    for (const [k, v] of Object.entries(this.snaps)) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
    return out;
  }

  setSnaps(gameId: string, venue: string, rows: { ticker: string; bid: number | null; ask: number | null; fair: number | null }[], loaded = false): void {
    const key = `${gameId}|${venue}`;
    if (loaded) this.snapGames.add(key);
    for (const r of rows) this.snaps[`${key}|${r.ticker}`] = { bid: n(r.bid), ask: n(r.ask), fair: n(r.fair) };
  }

  /** Saved at the end of every cycle that ran to completion (and at the end of any cycle that threw, which still wrote consistently). */
  save(): void {
    writeState(FILE, {
      ...this.f,
      dirty: false,
      fills: this.fills, // pending fills come back from the database next load, with their ids
      orders: [...this.orders.values()],
      snaps: this.snaps,
      snapGames: [...this.snapGames],
    });
  }
}
