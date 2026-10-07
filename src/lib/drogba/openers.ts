// FanDuel (or any single book) opening lines from The Odds API snapshots. Pure helpers: when to take
// snapshots, how to match Odds API events to our games, and how to turn stored snapshots into an
// "open" and a "close" per game.
import { matchSchoolMascotName } from "../teamNameMatch";
import type { DGame } from "./dataset";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ET_SHIFT = 5 * HOUR; // college games are mostly in US evenings; shifting by 5h keeps a Saturday-night game on Saturday

// The Saturday (UTC midnight of its Eastern-time date) that most of a week's games are played on.
export function weekAnchors(games: DGame[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const g of games) {
    if (g.startMs == null) continue;
    const day = Math.floor((g.startMs - ET_SHIFT) / DAY) * DAY;
    const key = `${g.season}|${g.week}`;
    const m = counts.get(key) ?? new Map<number, number>();
    m.set(day, (m.get(day) ?? 0) + 1);
    counts.set(key, m);
  }
  const out = new Map<string, number>();
  for (const [key, m] of counts) out.set(key, Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
  return out;
}

// UTC time of a US-Eastern wall-clock hour on the Eastern date whose midnight-UTC is `dayMs`. Handles daylight
// saving (EDT through the first Sunday of November, EST after), so "Sunday 8am ET" is the same real-world moment
// in September and in late November.
export function etWallToUtcMs(dayMs: number, hourEt: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false, day: "numeric" });
  const want = new Date(dayMs).getUTCDate();
  for (const offset of [4, 5]) {
    const t = dayMs + (hourEt + offset) * HOUR;
    const parts = fmt.formatToParts(new Date(t));
    const h = Number(parts.find((p) => p.type === "hour")?.value) % 24;
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (h === hourEt % 24 && d === want) return t;
  }
  return dayMs + (hourEt + 5) * HOUR;
}

export interface SnapshotSlot {
  id: string;
  label: string;
  day: number; // days from the week's Saturday (negative = before)
  hourEt: number; // Eastern wall-clock hour
  isClose: boolean;
}
// A Saturday slate's lines go up Sunday morning (FanDuel first, the other books copying later in the day) and are
// mostly all posted by about 11am ET. Sunday looks from 6 to 11am ET catch the open; the Friday-evening and
// Saturday-morning looks give FanDuel's own later number, to measure closing-line value against.
export const SNAPSHOT_SLOTS: SnapshotSlot[] = [
  { id: "sun-6", label: "Sunday 6:00am ET", day: -6, hourEt: 6, isClose: false },
  { id: "sun-8", label: "Sunday 8:00am ET", day: -6, hourEt: 8, isClose: false },
  { id: "sun-10", label: "Sunday 10:00am ET", day: -6, hourEt: 10, isClose: false },
  { id: "sun-11", label: "Sunday 11:00am ET", day: -6, hourEt: 11, isClose: false },
  { id: "fri-18", label: "Friday 6:00pm ET (later number)", day: -1, hourEt: 18, isClose: true },
  { id: "sat-10", label: "Saturday 10:00am ET (later number)", day: 0, hourEt: 10, isClose: true },
];
export const DEFAULT_SLOT_IDS = ["sun-8", "sun-10", "sun-11", "fri-18", "sat-10"];

export const slotTargetMs = (anchorMs: number, slot: SnapshotSlot) => etWallToUtcMs(anchorMs + slot.day * DAY, slot.hourEt);

export interface OddsEvent {
  id: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homePoint: number;
  homePrice: number | null;
  awayPrice: number | null;
}

export interface MatchedSnapshot {
  game: DGame;
  homeSpread: number; // in OUR game's home orientation (negative = our home team favored)
  homePrice: number | null;
  awayPrice: number | null;
}

// Matches Odds API events to our games by team pair AND kickoff time (a team pair can meet twice in a
// season, e.g. a rematch). The Odds API's home/away can differ from CFBD's at neutral sites; when the
// orientation is swapped the spread's sign is flipped so it always reads from OUR home team.
export function matchEvents(events: OddsEvent[], games: DGame[]): { matched: MatchedSnapshot[]; unmatched: OddsEvent[] } {
  const byPair = new Map<string, DGame[]>();
  for (const g of games) {
    const k = [g.home, g.away].sort().join("|");
    const a = byPair.get(k);
    if (a) a.push(g);
    else byPair.set(k, [g]);
  }
  const matched: MatchedSnapshot[] = [];
  const unmatched: OddsEvent[] = [];
  for (const e of events) {
    const h = matchSchoolMascotName(e.homeTeam);
    const a = matchSchoolMascotName(e.awayTeam);
    const cands = h && a ? byPair.get([h, a].sort().join("|")) : undefined;
    const t = Date.parse(e.commenceTime);
    const g = cands
      ?.filter((c) => c.startMs == null || Math.abs(c.startMs - t) <= 36 * HOUR)
      .sort((x, y) => Math.abs((x.startMs ?? t) - t) - Math.abs((y.startMs ?? t) - t))[0];
    if (!g) {
      unmatched.push(e);
      continue;
    }
    const sameOrientation = h === g.home;
    matched.push({
      game: g,
      homeSpread: sameOrientation ? e.homePoint : -e.homePoint,
      homePrice: sameOrientation ? e.homePrice : e.awayPrice,
      awayPrice: sameOrientation ? e.awayPrice : e.homePrice,
    });
  }
  return { matched, unmatched };
}

export interface SnapshotRow {
  game_id: string;
  snapshot_at: string;
  home_spread: number;
}
export interface BookLine {
  open: number;
  openAt: number;
  last: number; // latest snapshot at or before kickoff
  lastAt: number;
}

// Per game: the book's open = its EARLIEST snapshot from the start of that game's own week (the Sunday
// before) on — so a line posted weeks ahead as a "lookahead" is judged by what it showed that Sunday, the
// same moment for every game — and its last = the latest snapshot before kickoff.
export function buildBookLines(rows: SnapshotRow[], games: DGame[]): Map<string, BookLine> {
  const anchors = weekAnchors(games);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const by = new Map<string, { at: number; spread: number }[]>();
  for (const r of rows) {
    const a = by.get(r.game_id);
    const item = { at: Date.parse(r.snapshot_at), spread: Number(r.home_spread) };
    if (a) a.push(item);
    else by.set(r.game_id, [item]);
  }
  const out = new Map<string, BookLine>();
  for (const [id, list] of by) {
    const g = gameById.get(id);
    if (!g) continue;
    const anchor = anchors.get(`${g.season}|${g.week}`);
    const windowStart = anchor != null ? anchor - 6 * DAY : -Infinity;
    const kickoff = g.startMs ?? Infinity;
    const usable = list.filter((x) => x.at >= windowStart && x.at <= kickoff).sort((a, b) => a.at - b.at);
    if (usable.length === 0) continue;
    const first = usable[0];
    const last = usable[usable.length - 1];
    out.set(id, { open: first.spread, openAt: first.at, last: last.spread, lastAt: last.at });
  }
  return out;
}
