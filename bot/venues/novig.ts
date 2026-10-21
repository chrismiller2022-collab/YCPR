// Novig: production catalog, order books and trades are public (no key needed for paper).
// Prices are decimal probabilities; one contract pays $0.01, so we trade in $1
// units like Kalshi (100 Novig contracts) and only use prices, never sizes.
// Fees: taker-only 0.06·P(1−P), and game lines charge only while live, so
// pre-game fills are free (maker credit ignored: conservative).
//
// Novig labels spread outcomes with short codes ("CMU −2.5", "M-OH +2.5") and
// the participant lookup needs a signed key, so home/away is decided by which
// assignment makes the ladder agree with the sportsbook line, with the codes
// as a tie-breaker; games that can't be verified are skipped.

import { matchTeamName } from "../../src/lib/teamNameMatch";
import { impliedHomeMargin, type Rung } from "../ladder/engine";
import type { VenueAdapter, VenueGame, VenueTrade } from "./types";

const BASE = "https://api.novig.com/v3/public";

export interface NovigEvent {
  eventId: string;
  description: string; // "Miami Ohio @ Central Michigan"
  startsTs: number;
  status: string;
}
export interface NovigOutcome {
  outcomeId: string;
  name: string; // "CMU -2.5"
}
export interface NovigMarket {
  marketId: string;
  eventId: string;
  marketType: string;
  strike: string; // signed line of outcomes[0]
  status: string;
  outcomes: NovigOutcome[];
}
export interface NovigBook {
  orders: Record<string, { price: string; qty: number }[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, { headers: { "User-Agent": "ycpr-bot" } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new Error(`Novig ${res.status} on ${path.split("?")[0]}`);
  }
}

// Novig spellings the site's matcher doesn't know (checked against all NCAAF events, 2026-10-21).
const NOVIG_NAMES: Record<string, string> = {
  "Miami Ohio": "Miami (OH)",
  "Miami Florida": "Miami",
  "North Carolina State": "NC State",
  "St Thomas Minnesota": "St. Thomas (MN)",
  "Texas A&M Commerce": "East Texas A&M",
  "New Haven College": "New Haven",
  "Bethune Cookman": "Bethune-Cookman",
};

/** Exact or alias matches only: a fuzzy match could trade the wrong game. */
const canon = (s: string) => {
  const r = matchTeamName(NOVIG_NAMES[s.trim()] ?? s.trim());
  return r.confidence === "fuzzy" ? null : r.matched;
};

/** "Miami Ohio @ Central Michigan" → canonical [away, home], or null. */
export function novigTeams(description: string): [string, string] | null {
  const parts = description.split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [a, h] = parts.map(canon);
  return a && h ? [a, h] : null;
}

/** How well a short code like "CMU" or "M-OH" fits a team name (higher = better). */
export function codeScore(code: string, team: string): number {
  const letters = code.toUpperCase().replace(/[^A-Z]/g, "");
  const words = team.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  if (!letters || !words.length) return 0;
  let score = 0;
  if (letters[0] === words[0][0]) score += 3;
  if (words.some((w) => letters.length >= 3 && w.startsWith(letters))) score += 3;
  const initials = words.map((w) => w[0]).join("");
  let i = 0;
  for (const ch of letters) if (initials[i] === ch) i++;
  score += i;
  return score;
}

/**
 * Build engine rungs for one Novig event. `firstIsHome` says which team is
 * outcomes[0]'s code. Rung YES = outcomes[0] covers its line:
 * "A −2.5" → A wins by over 2.5; "A +1.5" → A wins by over −1.5.
 * Whole-number lines (pushes) are skipped for now.
 */
export function novigRungs(markets: NovigMarket[], books: Map<string, NovigBook>, firstIsHome: boolean): { rungs: Rung[]; yesOutcome: Map<string, string> } {
  const rungs: Rung[] = [];
  const yesOutcome = new Map<string, string>();
  for (const m of markets) {
    if (m.marketType !== "SPREAD" || m.status !== "OPEN" || m.outcomes.length !== 2) continue;
    const line = Number(m.strike);
    if (!Number.isFinite(line) || Number.isInteger(line)) continue;
    const [yes, no] = m.outcomes;
    const book = books.get(m.marketId);
    const best = (oid: string) => {
      const p = book?.orders?.[oid]?.[0]?.price;
      return p == null ? null : Number(p);
    };
    const yb = best(yes.outcomeId);
    const nb = best(no.outcomeId);
    const ticker = `NV:${m.marketId}`;
    yesOutcome.set(ticker, yes.outcomeId);
    rungs.push({
      ticker,
      side: firstIsHome ? "home" : "away",
      strike: -line,
      bid: yb != null && yb > 0 ? yb : null,
      ask: nb != null && nb > 0 && nb < 1 ? Math.round((1 - nb) * 1000) / 1000 : null,
    });
  }
  return { rungs, yesOutcome };
}

/**
 * Decide whether outcomes[0]'s team is home. Prefer agreement with the
 * sportsbook line; fall back to the short codes when the line can't tell
 * (near pick'em) — and refuse (null) when neither is convincing.
 */
export function resolveFirstIsHome(markets: NovigMarket[], books: Map<string, NovigBook>, game: VenueGame): boolean | null {
  const asHome = impliedHomeMargin(novigRungs(markets, books, true).rungs);
  const firstCode = markets.find((m) => m.outcomes.length === 2)?.outcomes[0].name.split(/\s+/)[0] ?? "";
  const otherCode = markets.find((m) => m.outcomes.length === 2)?.outcomes[1].name.split(/\s+/)[0] ?? "";
  const codeVote = codeScore(firstCode, game.home_team) + codeScore(otherCode, game.away_team) - (codeScore(firstCode, game.away_team) + codeScore(otherCode, game.home_team));
  const book = game.bookHomeMargin;
  if (asHome != null && book != null && Math.abs(book) >= 2.5) {
    const errHome = Math.abs(asHome - book);
    const errAway = Math.abs(-asHome - book); // swapping sides mirrors the implied margin
    if (Math.min(errHome, errAway) > 6) return null; // neither assignment looks like this game
    if (Math.abs(errHome - errAway) >= 3) return errHome < errAway;
  }
  if (codeVote >= 2) return true;
  if (codeVote <= -2) return false;
  return null;
}

export function novigAdapter(): VenueAdapter {
  let events: NovigEvent[] = [];
  const yesOutcome = new Map<string, string>(); // ticker → YES outcomeId, for trade normalization
  return {
    id: "novig",
    label: "Novig",
    tick: 0.005,
    available: () => true,
    async prepare() {
      events = (await get<{ items: NovigEvent[] }>("/catalog/events?league=NCAAF&limit=200")).items;
    },
    async ladder(game) {
      const ev = game.eventKey
        ? events.find((e) => e.eventId === game.eventKey)
        : events.find((e) => {
            const t = novigTeams(e.description);
            return t != null && t[0] === game.away_team && t[1] === game.home_team;
          });
      if (!ev) return null;
      const markets = (await get<{ items: NovigMarket[] }>(`/catalog/markets?event=${ev.eventId}&marketType=SPREAD&limit=200`)).items.filter((m) => m.eventId === ev.eventId);
      const books = new Map<string, NovigBook>();
      for (const m of markets) {
        if (m.status !== "OPEN" || Number.isInteger(Number(m.strike))) continue;
        books.set(m.marketId, await get<NovigBook>(`/catalog/markets/${m.marketId}/book?depth=1`));
      }
      const firstIsHome = resolveFirstIsHome(markets, books, game);
      if (firstIsHome == null) return null;
      const built = novigRungs(markets, books, firstIsHome);
      for (const [k, v] of built.yesOutcome) yesOutcome.set(k, v);
      return { eventKey: ev.eventId, rungs: built.rungs };
    },
    async trades(tickers, sinceTs) {
      const out: VenueTrade[] = [];
      for (const ticker of tickers) {
        const marketId = ticker.replace(/^NV:/, "");
        const yes = yesOutcome.get(ticker);
        const d = await get<{ items: { outcomeId: string; price: string; ts: number }[] }>(`/catalog/markets/${marketId}/trades?limit=100`);
        for (const tr of d.items) {
          const t = Math.floor(tr.ts / 1000);
          if (t <= sinceTs || !yes) continue;
          const p = Number(tr.price);
          out.push({ ticker, t, yesPrice: tr.outcomeId === yes ? p : 1 - p });
        }
      }
      return out;
    },
    // Pre-game game lines are fee-free on Novig; live fills pay the taker fee.
    fee: (hoursToKickoff) => (price, opts = {}) => (hoursToKickoff > 0 || opts.maker ? 0 : 0.06 * (opts.count ?? 1) * price * (1 - price)),
  };
}
