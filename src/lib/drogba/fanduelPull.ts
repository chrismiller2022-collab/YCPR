// One FanDuel spread snapshot: pull, match the events to our games, save the rows and log the call. Shared by the Data & sync
// tab (test / backfill / live pulls) and the Sunday run.
import { pullBookSpreads, saveBookSnapshots, type SpreadPull } from "../api/bookSnapshots";
import { matchEvents } from "./openers";
import type { DGame } from "./dataset";

export const FD_BOOK = "fanduel";
const DAY = 86_400_000;

export interface PullSummary {
  events: number;
  withLine: number;
  matched: number;
  unmatched: number;
  snapshotAt: string | null;
  remaining: string | null;
  last: string | null;
  compare: { game: string; fd: number; bov: number | null }[];
}

// targetMs null = FanDuel's current lines. `season` limits matching to that season's games; `week` only narrows the comparison list.
export async function pullFanDuelSnapshot(
  games: DGame[],
  bovadaOpen: Map<string, number>,
  targetMs: number | null,
  season: number | null,
  week: number | null
): Promise<{ pull: SpreadPull; summary: PullSummary; matchedIds: string[]; snapMs: number }> {
  const pull = await pullBookSpreads(FD_BOOK, targetMs == null ? null : new Date(targetMs).toISOString());
  const snapAt = pull.timestamp ?? new Date().toISOString();
  const snapMs = Date.parse(snapAt);
  const candidates = games.filter((g) => g.startMs != null && g.startMs >= snapMs - DAY && g.startMs <= snapMs + 21 * DAY && (season == null || g.season === season));
  const { matched, unmatched } = matchEvents(pull.events, candidates);
  const rows = matched.map((m) => ({
    game_id: m.game.id,
    book: FD_BOOK,
    snapshot_at: snapAt,
    season: m.game.season,
    week: m.game.week,
    home_spread: m.homeSpread,
    home_price: m.homePrice,
    away_price: m.awayPrice,
    is_historical: targetMs != null,
  }));
  await saveBookSnapshots(rows, {
    book: FD_BOOK,
    target_at: new Date(targetMs ?? snapMs).toISOString(),
    snapshot_at: snapAt,
    season,
    week,
    events: pull.totalEvents,
    matched: matched.length,
    credits_last: pull.quota.last,
    credits_remaining: pull.quota.remaining,
  });
  const compare = matched
    .filter((m) => week == null || m.game.week === week)
    .map((m) => ({ game: `${m.game.away} @ ${m.game.home}`, fd: m.homeSpread, bov: bovadaOpen.get(m.game.id) ?? null }));
  return {
    pull,
    matchedIds: matched.map((m) => m.game.id),
    snapMs,
    summary: { events: pull.totalEvents, withLine: pull.events.length, matched: matched.length, unmatched: unmatched.length, snapshotAt: snapAt, remaining: pull.quota.remaining, last: pull.quota.last, compare },
  };
}
