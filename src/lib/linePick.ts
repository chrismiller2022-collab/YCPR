import type { BettingLineRow } from "./api/gamesLines";

// One order for choosing a game's "Vegas" line, used by every line picker on the site.
//   market_median  the median across sportsbooks from Refresh Vegas lines (The Odds API), for games not yet final
//   consensus      CFBD's consensus line, the closing line once a game is final
//   then DraftKings, Bovada, ESPN Bet as fallbacks.
// fetchGamesWithLines drops the market_median row from a completed game whenever CFBD has a spread for it, so final
// games grade against CFBD's closing line, not whenever the button was last pressed.
export const LINE_PROVIDER_ORDER = ["market_median", "consensus", "DraftKings", "Bovada", "ESPN Bet"];

export const MARKET_MEDIAN = "market_median";

/** Removes the median row from completed games that have a CFBD spread, so grading uses CFBD's closing line. */
export function preferClosingForFinal<T extends { completed: boolean; lines: BettingLineRow[] }>(game: T): T {
  if (!game.completed) return game;
  const hasCfbd = game.lines.some((l) => l.provider !== MARKET_MEDIAN && l.spread != null);
  return hasCfbd ? { ...game, lines: game.lines.filter((l) => l.provider !== MARKET_MEDIAN) } : game;
}

/**
 * The game's Vegas line row by LINE_PROVIDER_ORDER (first preferred provider present, else the first row). Pass
 * `completed` when the lines didn't come through fetchGamesWithLines so a final game still uses CFBD's close.
 */
export function pickVegasLine<T extends { provider: string; spread: number | null }>(lines: T[], completed?: boolean): T | null {
  let pool = lines;
  if (completed && lines.some((l) => l.provider !== MARKET_MEDIAN && l.spread != null)) pool = lines.filter((l) => l.provider !== MARKET_MEDIAN);
  if (pool.length === 0) return null;
  for (const p of LINE_PROVIDER_ORDER) {
    const match = pool.find((l) => l.provider === p);
    if (match) return match;
  }
  return pool[0];
}
