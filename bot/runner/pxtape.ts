// ProphetX trade tape: listens to the public trade_execution broadcast (Pusher
// protocol, tournament channel) for most of a cycle and records every print on a
// game-spread line we know into bot_mkt_trades, as the YES price of our rung.
// Paper fills and Hypotheticals then see ProphetX trades like Kalshi's and Novig's.
// Started by /api/cycle each cycle (runs ~4¾ min, then the next one takes over).
// Read-only market data; never places orders. Logs counts only.

import { oddsToProb, prophetxAdapter, prophetxClient } from "../venues/prophetx";
import { db } from "./io";

const MODE = "pxtape";
const iso = () => new Date().toISOString();

export interface TapeTotals {
  trades: number;
  unmatched: number;
  frames: number;
  channels: number;
  tournaments: number;
  strikes: number;
  overlapped?: boolean;
  error?: string;
  /** First few raw frames (truncated), to check the wire format. */
  samples?: string[];
  bindings?: string[];
}

/** Every JSON object inside a frame, decoding stringified and base64 layers (the docs leave the framing open). */
export function unwrap(x: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || x == null) return [];
  if (typeof x === "string") {
    const t = x.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return unwrap(JSON.parse(t), depth + 1);
      } catch {
        return [];
      }
    }
    if (/^[A-Za-z0-9+/=]{16,}$/.test(t)) {
      try {
        return unwrap(Buffer.from(t, "base64").toString("utf8"), depth + 1);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (Array.isArray(x)) return x.flatMap((v) => unwrap(v, depth + 1));
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    return [o, ...Object.values(o).flatMap((v) => (typeof v === "object" || typeof v === "string" ? unwrap(v, depth + 1) : []))];
  }
  return [];
}

/** A trade print from any object carrying a strike id and a fill price (CFTC or legacy vocabulary). */
export function asPrint(o: Record<string, unknown>): { strikeId: string; odds: number; qty: number; t: number } | null {
  const strikeId = (o.strike_id ?? o.line_id) as string | undefined;
  const odds = Number(o.fill_price ?? o.matched_odds ?? o.price ?? o.odds);
  if (!strikeId || !Number.isFinite(odds) || odds === 0) return null;
  const seq = Number(o.sequence_number);
  // sequence_number looks like epoch nanoseconds; fall back to now.
  const t = seq > 1e18 ? Math.floor(seq / 1e9) : Math.floor(Date.now() / 1000);
  return { strikeId: String(strikeId), odds, qty: Number(o.filled_quantity ?? o.matched_stake ?? 0), t };
}

export async function runPxTape(budgetMs = 280e3): Promise<TapeTotals> {
  const totals: TapeTotals = { trades: 0, unmatched: 0, frames: 0, channels: 0, tournaments: 0, strikes: 0, samples: [] };
  const client = prophetxClient();
  if (!client.available()) return totals;
  const recent = await db.select("bot_runs", `select=id&mode=eq.${MODE}&finished_at=is.null&started_at=gte.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  await db.update("bot_runs", `mode=eq.${MODE}&finished_at=is.null&started_at=lt.${new Date(Date.now() - 6 * 60e3).toISOString()}`, { finished_at: iso(), error: "timed out" });
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: MODE });
  const started = Date.now();
  let ws: WebSocket | null = null;
  try {
    // Map every recorded game's spread strike ids to (game, rung ticker, YES side).
    const adapter = prophetxAdapter();
    await adapter.prepare();
    const games = await db.select<{ game_id: string; home_team: string; away_team: string; venue_events: { prophetx?: string } }>(
      "bot_mkt_games",
      `select=game_id,home_team,away_team,venue_events&kickoff=gte.${new Date(Date.now() - 6 * 3600e3).toISOString()}`
    );
    const strikeGame = new Map<string, string>();
    for (const g of games) {
      if (!g.venue_events?.prophetx) continue;
      const before = new Set(adapter.strikes.keys());
      await adapter.ladder({ home_team: g.home_team, away_team: g.away_team, bookHomeMargin: null, eventKey: g.venue_events.prophetx }).catch(() => null);
      for (const k of adapter.strikes.keys()) if (!before.has(k)) strikeGame.set(k, g.game_id);
    }
    totals.strikes = strikeGame.size;
    const tournaments = adapter.tournaments();
    totals.tournaments = tournaments.length;
    if (!tournaments.length || !strikeGame.size) return totals;

    const cfg = await client.call<any>("/websocket/connection-config");
    const c = cfg?.data ?? cfg;
    const host = c.ws_host || `ws-${c.cluster}.pusher.com`;
    const url = `${/^wss?:\/\//.test(host) ? host : `wss://${host}`}/app/${c.key}?protocol=7&client=js&version=8.4.0&flash=false`;

    const pending: object[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const rows = pending.splice(0);
      await db.insert("bot_mkt_trades", rows);
      totals.trades += rows.length;
    };
    const flusher = setInterval(() => flush().catch(() => {}), 15e3);
    const bindings = new Set<string>();

    await new Promise<void>((resolve, reject) => {
      const stop = setTimeout(() => resolve(), Math.max(10e3, budgetMs - (Date.now() - started)));
      ws = new WebSocket(url);
      const send = (event: string, data: unknown) => ws!.send(JSON.stringify({ event, data }));
      ws.onerror = () => {
        clearTimeout(stop);
        reject(new Error("ProphetX websocket error"));
      };
      ws.onclose = () => {
        clearTimeout(stop);
        resolve();
      };
      ws.onmessage = async (msg) => {
        totals.frames++;
        const text = typeof msg.data === "string" ? msg.data : "";
        let frame: { event?: string; data?: unknown; channel?: string };
        try {
          frame = JSON.parse(text);
        } catch {
          return;
        }
        const ev = frame.event ?? "";
        if (ev === "pusher:ping") return send("pusher:pong", {});
        if (ev === "pusher:connection_established") {
          try {
            const socketId = (unwrap(frame.data).find((o) => o.socket_id)?.socket_id ?? "") as string;
            const reg = await client.call<any>("/v4/mm/websocket", {
              method: "POST",
              headers: { "X-CFTC-Terminology": "true" },
              body: JSON.stringify({ socket_id: socketId, service: "pusher", subscriptions: [{ type: "tournament", ids: tournaments }] }),
            });
            const r = reg?.data ?? reg;
            if (r?.authenticated?.auth) send("pusher:signin", { auth: r.authenticated.auth, user_data: r.authenticated.user_data });
            for (const ch of r?.authorized_channel ?? []) {
              for (const b of ch.binding_events ?? []) bindings.add(typeof b === "string" ? b : b?.name ?? JSON.stringify(b));
              send("pusher:subscribe", { auth: ch.auth, channel: ch.channel_name });
              totals.channels++;
            }
          } catch (e) {
            clearTimeout(stop);
            reject(e);
          }
          return;
        }
        if (ev.startsWith("pusher")) return;
        // Keep a few raw non-protocol frames so the wire format can be checked.
        if (totals.samples!.length < 4 && /tournament|trade|matched/i.test(ev)) totals.samples!.push(text.slice(0, 600));
        if (!/tournament|trade_execution|matched_bet/i.test(ev)) return;
        const objs = unwrap(frame.data);
        // The tournament binding may carry other change types; only trade prints count.
        const kind = objs.map((o) => o.change_type).find((x) => typeof x === "string") as string | undefined;
        if (kind && !/trade|match/i.test(kind)) return;
        for (const o of objs) {
          const p = asPrint(o);
          if (!p) continue;
          const gameId = strikeGame.get(p.strikeId);
          const hit = adapter.strikes.get(p.strikeId);
          const prob = oddsToProb(p.odds);
          if (!gameId || !hit || prob == null) {
            totals.unmatched++;
            continue;
          }
          pending.push({ game_id: gameId, venue: "prophetx", ticker: hit.ticker, t: new Date(p.t * 1000).toISOString(), yes_price: Math.round((hit.isYes ? prob : 1 - prob) * 1000) / 1000 });
        }
      };
    }).finally(() => clearInterval(flusher));
    totals.bindings = [...bindings].slice(0, 20);
    await flush();
  } catch (e) {
    totals.error = String(e instanceof Error ? e.message : e).slice(0, 300);
  } finally {
    try {
      (ws as WebSocket | null)?.close();
    } catch {}
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), games: totals.strikes ? 1 : 0, fills: totals.trades, error: totals.error ?? null, summary: totals }).catch(() => {});
    console.log(`pxtape: trades ${totals.trades}, unmatched ${totals.unmatched}, frames ${totals.frames}, channels ${totals.channels}`);
  }
  return totals;
}

if (process.argv[1]?.endsWith("pxtape.ts")) runPxTape(Number(process.env.BOT_TAPE_BUDGET_MS) || 280e3).catch((e) => {
  console.error(e instanceof Error ? e.message.split(":")[0] : "tape failed");
  process.exit(1);
});
