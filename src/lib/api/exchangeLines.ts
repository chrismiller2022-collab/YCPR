// Exchange-implied lines for games the sportsbook feed (The Odds API) doesn't carry — mostly FCS vs FCS. Part of
// "Refresh Vegas lines": after the sportsbook median, every not-yet-final game still without a line gets one from
// the same public exchange data the bot trades on:
//   - Kalshi KXNCAAFSPREAD ladder ("<team> wins by over X") and Novig SPREAD ladder for the game
//   - each ladder becomes one implied home margin with the bot's own fit (bot/ladder/engine.ts impliedHomeMargin)
//   - both venues' margins are averaged when both list the game; the spread is snapped to the half point
//   - moneylines come from Kalshi's game-winner market (KXNCAAFGAME) mid price, no-vig
// Saved as betting_lines provider "exchange_implied" (pregame line, like market_median; see linePick.ts).
//
// Sides: Kalshi names the team on every market, so its ladder is unambiguous. Novig only shows short codes, so a
// Novig ladder is used only when the bot's side check (resolveFirstIsHome) is confident — checked against the
// Kalshi margin when there is one.

import { impliedHomeMargin, type Rung } from "../../../bot/ladder/engine";
import { novigRungs, novigTeams, resolveFirstIsHome, type NovigMarket } from "../../../bot/venues/novig";
import { matchTeamName } from "../teamNameMatch";
import type { GameWithLines } from "./gamesLines";

export const EXCHANGE_PROVIDER = "exchange_implied";

const toHalf = (v: number) => Math.round(v * 2) / 2;

/** Exact or alias matches only — a fuzzy match could price the wrong game. */
function canon(name: string): string | null {
  const r = matchTeamName(name.trim());
  return r.confidence === "fuzzy" ? null : r.matched;
}

interface KalshiSpreadEvent {
  event_ticker: string;
  title: string;
  markets: { ticker: string; yes_sub_title: string; floor_strike: number | string; yes_bid_dollars: string; yes_ask_dollars: string; status: string }[];
}

function kalshiTeamsOf(e: KalshiSpreadEvent): Set<string> {
  const out = new Set<string>();
  for (const m of e.markets) {
    const t = canon(m.yes_sub_title.replace(/\s+wins by over.*$/i, ""));
    if (t) out.add(t);
  }
  return out;
}

function kalshiRungsFor(g: GameWithLines, e: KalshiSpreadEvent): Rung[] {
  const rungs: Rung[] = [];
  for (const m of e.markets) {
    if (m.status !== "active") continue;
    const team = canon(m.yes_sub_title.replace(/\s+wins by over.*$/i, ""));
    const side = team === g.home_team ? "home" : team === g.away_team ? "away" : null;
    if (!side) continue;
    const bid = Number(m.yes_bid_dollars);
    const ask = Number(m.yes_ask_dollars);
    rungs.push({ ticker: m.ticker, side, strike: Number(m.floor_strike), bid: bid > 0 ? bid : null, ask: ask > 0 && ask < 1 ? ask : null });
  }
  return rungs;
}

/** A ladder is usable when at least two rungs have a real two-sided quote. */
function usable(rungs: Rung[]): boolean {
  return rungs.filter((r) => r.bid != null && r.ask != null && r.ask > r.bid).length >= 2;
}

function probToAmerican(p: number): number {
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as any).error ?? `${url.split("?")[0]} failed (${r.status})`);
  return d as T;
}

export interface ExchangeLineRow {
  game_id: string;
  season: number;
  week: number;
  spread: number | null; // home spread (negative = home favored), half points
  over_under: null;
  home_moneyline: number | null;
  away_moneyline: number | null;
}

export interface ExchangeLinesResult {
  rows: ExchangeLineRow[];
  /** Games that needed a line, and how many each venue priced. */
  needed: number;
  fromKalshi: number;
  fromNovig: number;
  /** Venue errors (the refresh carries on without that venue). */
  errors: string[];
}

/** Implied lines for `targets` (not-final games with no sportsbook line). Never throws for one venue failing. */
export async function fetchExchangeLines(targets: GameWithLines[]): Promise<ExchangeLinesResult> {
  const errors: string[] = [];
  if (targets.length === 0) return { rows: [], needed: 0, fromKalshi: 0, fromNovig: 0, errors };

  const [kSpreads, kGames, nEvents] = await Promise.all([
    getJson<{ events: KalshiSpreadEvent[] }>("/api/kalshi-markets?mode=spreads").catch((e) => (errors.push(`Kalshi spreads: ${e.message}`), { events: [] })),
    getJson<{ games: { teamA: { name: string; yesBid: number; yesAsk: number }; teamB: { name: string; yesBid: number; yesAsk: number } }[] }>(
      "/api/kalshi-markets"
    ).catch((e) => (errors.push(`Kalshi moneylines: ${e.message}`), { games: [] })),
    getJson<{ events: { eventId: string; description: string }[] }>("/api/kalshi-markets?mode=novig-events").catch(
      (e) => (errors.push(`Novig: ${e.message}`), { events: [] })
    ),
  ]);

  const kalshiByPair = new Map<string, KalshiSpreadEvent>();
  for (const e of kSpreads.events) {
    const t = [...kalshiTeamsOf(e)];
    if (t.length === 2) kalshiByPair.set([...t].sort().join("|"), e);
  }
  const kalshiWinByTeam = new Map<string, { opp: string; p: number }>();
  for (const g of kGames.games ?? []) {
    const a = canon(g.teamA.name);
    const b = canon(g.teamB.name);
    if (!a || !b || !(g.teamA.yesAsk > g.teamA.yesBid) || !(g.teamB.yesAsk > g.teamB.yesBid)) continue;
    const pa = (g.teamA.yesBid + g.teamA.yesAsk) / 2;
    const pb = (g.teamB.yesBid + g.teamB.yesAsk) / 2;
    const p = pa / (pa + pb); // strip the vig
    kalshiWinByTeam.set(a, { opp: b, p });
    kalshiWinByTeam.set(b, { opp: a, p: 1 - p });
  }
  const novigEventByPair = new Map<string, string>();
  for (const e of nEvents.events) {
    const t = novigTeams(e.description); // [away, home]
    if (t) novigEventByPair.set(`${t[0]}@${t[1]}`, e.eventId);
  }

  // Novig ladders for just the games we need (batches of 40 per call).
  const novigIds = targets.map((g) => novigEventByPair.get(`${g.away_team}@${g.home_team}`)).filter((x): x is string => !!x);
  const novigMarkets: Record<string, NovigMarket[]> = {};
  for (let i = 0; i < novigIds.length; i += 40) {
    try {
      const d = await getJson<{ markets: Record<string, NovigMarket[]> }>(`/api/kalshi-markets?mode=novig-markets&events=${novigIds.slice(i, i + 40).join(",")}`);
      Object.assign(novigMarkets, d.markets);
    } catch (e: any) {
      errors.push(`Novig markets: ${e.message}`);
      break;
    }
  }

  const rows: ExchangeLineRow[] = [];
  let fromKalshi = 0;
  let fromNovig = 0;
  for (const g of targets) {
    const margins: number[] = [];
    let kalshiMargin: number | null = null;
    const ke = kalshiByPair.get([g.home_team, g.away_team].sort().join("|"));
    if (ke) {
      const rungs = kalshiRungsFor(g, ke);
      if (usable(rungs)) kalshiMargin = impliedHomeMargin(rungs);
      if (kalshiMargin != null) {
        margins.push(kalshiMargin);
        fromKalshi++;
      }
    }
    const nid = novigEventByPair.get(`${g.away_team}@${g.home_team}`);
    const nm = nid ? novigMarkets[nid] : undefined;
    if (nm?.length) {
      const firstIsHome = resolveFirstIsHome(nm, null, { home_team: g.home_team, away_team: g.away_team, bookHomeMargin: kalshiMargin, eventKey: nid ?? null });
      if (firstIsHome != null) {
        const { rungs } = novigRungs(nm, null, firstIsHome);
        const m = usable(rungs) ? impliedHomeMargin(rungs) : null;
        // Guard against a side mix-up: with a Kalshi margin to compare, the two venues must roughly agree.
        if (m != null && (kalshiMargin == null || Math.abs(m - kalshiMargin) <= 7)) {
          margins.push(m);
          fromNovig++;
        }
      }
    }
    const win = kalshiWinByTeam.get(g.home_team);
    const homeP = win && win.opp === g.away_team ? win.p : null;
    if (margins.length === 0 && homeP == null) continue;
    const margin = margins.length ? margins.reduce((s, v) => s + v, 0) / margins.length : null;
    rows.push({
      game_id: g.id,
      season: g.season,
      week: g.week,
      spread: margin == null ? null : toHalf(-margin) || 0,
      over_under: null,
      home_moneyline: homeP != null && homeP > 0.01 && homeP < 0.99 ? probToAmerican(homeP) : null,
      away_moneyline: homeP != null && homeP > 0.01 && homeP < 0.99 ? probToAmerican(1 - homeP) : null,
    });
  }
  return { rows, needed: targets.length, fromKalshi, fromNovig, errors };
}
