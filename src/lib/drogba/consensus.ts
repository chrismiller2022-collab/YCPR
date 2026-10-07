// Chris's own historical projections, as a signal. 2024-25 come from the static Bet History file (the
// consensus power-rating projection made for each game), 2026 from game_projection_locks.
//
// DATA FIX applied here: in the Bet History file, 2025 weeks 10+ store `spread` AND `prediction` with the
// opposite sign (away-relation) from every other row — checked against the Bovada closing line, where
// 100% of weeks 10-16 are sign-flipped and 100% of the earlier weeks are not. Both are un-flipped here so
// the projections line up with the opening lines. (The file itself is untouched.)
import type { DGame } from "./dataset";

export interface BetHistoryLike {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  prediction: number; // home-relation, negative = home favored
}
export interface LockLike {
  game_id: string;
  my_away_spread: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// game id -> my projected HOME spread (negative = home favored)
export function consensusSpreadByGame(games: DGame[], history: BetHistoryLike[], locks: LockLike[]): Map<string, number> {
  const out = new Map<string, number>();
  const byKey = new Map<string, DGame>();
  for (const g of games) byKey.set(`${g.season}|${norm(g.home)}|${norm(g.away)}`, g);
  for (const b of history) {
    const g = byKey.get(`${b.season}|${norm(b.homeTeam)}|${norm(b.awayTeam)}`);
    if (!g) continue;
    const flip = b.season === 2025 && b.week >= 10 ? -1 : 1;
    out.set(g.id, flip * b.prediction);
  }
  for (const l of locks) if (l.my_away_spread != null) out.set(l.game_id, -l.my_away_spread);
  return out;
}
