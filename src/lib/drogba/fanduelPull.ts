// One FanDuel spread snapshot: pull, match the events to our games, save the rows and log the call. Shared by the Data & sync
// tab (test / backfill / live pulls) and the Sunday run.
import { fetchPulledTargets, pullBookSpreads, saveBookSnapshots, type SpreadPull } from "../api/bookSnapshots";
import { matchEvents, SNAPSHOT_SLOTS, slotTargetMs, weekAnchors } from "./openers";
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

export interface WeekOpenersResult {
  pulls: number;
  credits: number;
  remaining: string | null;
  games: number;
  covered: number; // games with a FanDuel line by the latest slot pulled (or the current pull)
  log: string[];
}

// FanDuel openers for one week, taken from what FanDuel showed at fixed times rather than whenever the button is
// clicked: the Sunday 6/8/10/11am ET slots (Odds API history, 10 credits each), then Monday/Tuesday 10am for games
// FanDuel posts late. A game counts as covered at a slot once a snapshot at or before that slot has it, so a line
// first seen mid-afternoon still gets its earlier slot pulled. Slots already pulled are skipped. If some games still
// have no line at all and the week hasn't started, FanDuel's current lines are pulled too (1 credit).
export async function pullWeekOpeners(
  games: DGame[],
  bovadaOpen: Map<string, number>,
  fanduel: Map<string, { openAt: number }>,
  season: number,
  week: number,
  nowMs: number = Date.now()
): Promise<WeekOpenersResult> {
  const weekGames = games.filter((g) => g.season === season && g.week === week && g.homeFbs && g.awayFbs);
  const anchor = weekAnchors(games).get(`${season}|${week}`);
  const log: string[] = [];
  const out: WeekOpenersResult = { pulls: 0, credits: 0, remaining: null, games: weekGames.length, covered: 0, log };
  if (anchor == null || weekGames.length === 0) return out;
  const firstSeen = new Map<string, number>();
  for (const g of weekGames) {
    const f = fanduel.get(g.id);
    if (f) firstSeen.set(g.id, f.openAt);
  }
  const done = await fetchPulledTargets(FD_BOOK);
  const coveredBy = (t: number) => weekGames.filter((g) => (firstSeen.get(g.id) ?? Infinity) <= t).length;
  const slotIds = ["sun-6", "sun-8", "sun-10", "sun-11", "mon-10", "tue-10"];
  for (const id of slotIds) {
    const slot = SNAPSHOT_SLOTS.find((s) => s.id === id)!;
    const t = slotTargetMs(anchor, slot);
    if (t > nowMs) break;
    // Monday/Tuesday only matter for games with no line at all yet.
    if (slot.day > -6 && weekGames.every((g) => firstSeen.has(g.id))) break;
    if (coveredBy(t) === weekGames.length) break;
    if (done.has(t)) continue;
    const r = await pullFanDuelSnapshot(games, bovadaOpen, t, season, week);
    out.pulls++;
    out.credits += Number(r.summary.last ?? 10) || 10;
    out.remaining = r.summary.remaining;
    for (const gid of r.matchedIds) if (!firstSeen.has(gid) || firstSeen.get(gid)! > r.snapMs) firstSeen.set(gid, r.snapMs);
    log.push(`${slot.label}: ${r.summary.matched} games matched, ${coveredBy(t)} of ${weekGames.length} covered`);
  }
  const firstKick = Math.min(...weekGames.map((g) => g.startMs ?? Infinity));
  if (weekGames.some((g) => !firstSeen.has(g.id)) && nowMs < firstKick) {
    const r = await pullFanDuelSnapshot(games, bovadaOpen, null, season, week);
    out.pulls++;
    out.credits += Number(r.summary.last ?? 1) || 1;
    out.remaining = r.summary.remaining;
    for (const gid of r.matchedIds) if (!firstSeen.has(gid)) firstSeen.set(gid, r.snapMs);
    log.push(`Current lines: ${r.summary.matched} games matched`);
  }
  out.covered = weekGames.filter((g) => firstSeen.has(g.id)).length;
  return out;
}
