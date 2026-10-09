// Read-only "is everything in place" checks for the Sunday routine: last week's results and stats, this week's
// projections and openers, and whether the logged numbers have drifted from what the model says now.
import { isFbsGame, type DGame } from "./dataset";
import type { BookLine } from "./openers";
import { projectionGaps, type WeekRow, type WeekSplit } from "./weekPlan";
import type { DrogbaPickRow } from "../api/drogbaData";
import type { GameProjectionLockRow } from "../api/gameProjectionLocks";

export type Status = "ok" | "warn" | "bad" | "info";
export interface Check {
  id: string;
  group: "last" | "upcoming";
  label: string;
  status: Status;
  summary: string;
  items: string[]; // the games / reasons behind a warn or bad
}

export interface HealthInput {
  split: WeekSplit;
  games: DGame[];
  gameStats: Map<string, { adv: number; plays: number }>;
  hasPlays: boolean;
  hasSt: boolean;
  upcomingRows: WeekRow[];
  fanduel: Map<string, BookLine>;
  picks: DrogbaPickRow[];
  locks: Record<string, GameProjectionLockRow>;
  nowMs: number;
}

const name = (g: DGame) => `${g.away} @ ${g.home}`;
const MAX_ITEMS = 40;
const cap = (xs: string[]) => (xs.length > MAX_ITEMS ? [...xs.slice(0, MAX_ITEMS), `…and ${xs.length - MAX_ITEMS} more`] : xs);
const DRIFT_PTS = 0.5; // a logged number this far from today's counts as drifted
const etTime = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";

export function buildHealth(inp: HealthInput): Check[] {
  const { split, games, gameStats, picks, locks, nowMs } = inp;
  const checks: Check[] = [];
  const weekGames = (w: number) => games.filter((g) => g.season === split.season && g.week === w && isFbsGame(g));

  // -------- last week
  if (split.last >= 1) {
    const w = split.last;
    const all = weekGames(w);
    const done = all.filter((g) => g.completed);
    const notDone = all.filter((g) => !g.completed);
    // A game that kicked off more than 6 hours ago and still has no final score is a data problem, not a schedule one.
    const stale = notDone.filter((g) => g.startMs != null && nowMs - g.startMs > 6 * 3600_000);
    checks.push({
      id: "results",
      group: "last",
      label: `Week ${w} results`,
      status: stale.length ? "bad" : notDone.length ? "warn" : "ok",
      summary: `${done.length} of ${all.length} FBS games have a final score${notDone.length ? `; ${notDone.length} not final` : ""}.`,
      items: cap(notDone.map((g) => `${name(g)}${stale.includes(g) ? " — kicked off more than 6 hours ago with no final score (re-run the game pull)" : g.startMs != null && g.startMs > nowMs ? ` — not played yet (${etTime(g.startMs)})` : " — in progress or not updated"}`)),
    });

    const missAdv = done.filter((g) => (gameStats.get(g.id)?.adv ?? 0) < 2);
    checks.push({
      id: "adv",
      group: "last",
      label: `Week ${w} advanced stats`,
      status: missAdv.length ? "bad" : "ok",
      summary: `${done.length - missAdv.length} of ${done.length} finished games have both teams' per-game advanced stats${missAdv.length ? " — these games aren't in the ratings until pulled" : ""}.`,
      items: cap(missAdv.map(name)),
    });

    if (inp.hasPlays) {
      const missPlays = done.filter((g) => (gameStats.get(g.id)?.plays ?? 0) < 2);
      checks.push({
        id: "plays",
        group: "last",
        label: `Week ${w} play-by-play`,
        status: missPlays.length ? "bad" : "ok",
        summary: `${done.length - missPlays.length} of ${done.length} finished games have both teams' play-level aggregates${missPlays.length ? " — the play-level and special-teams ratings skip these games until pulled" : ""}.`,
        items: cap(missPlays.map(name)),
      });
    }

    const lastPicks = picks.filter((p) => p.season === split.season && p.week === w);
    const withClose = done.filter((g) => g.close != null && g.open != null);
    checks.push({
      id: "graded",
      group: "last",
      label: `Week ${w} picks log`,
      status: lastPicks.length === 0 ? "warn" : "ok",
      summary: lastPicks.length === 0 ? `No picks were saved for week ${w}, so there is nothing to grade.` : `${lastPicks.length} picks saved (${lastPicks.filter((p) => p.filtered).length} past the filter); ${withClose.length} of ${done.length} finished games have an open and a close to grade against.`,
      items: [],
    });

    const unlocked = done.filter((g) => !locks[g.id]);
    checks.push({
      id: "ycLocks",
      group: "last",
      label: `Week ${w} frozen (YC) projections`,
      status: unlocked.length ? "warn" : "ok",
      summary: `${done.length - unlocked.length} of ${done.length} finished games have a frozen YC projection${unlocked.length ? ` — ${unlocked.length} do not, so their YC numbers can still change with ratings` : ""}.`,
      items: cap(unlocked.map(name)),
    });
  }

  // -------- upcoming week
  const w = split.upcoming;
  const up = weekGames(w);
  const rows = inp.upcomingRows;
  const unplayed = up.filter((g) => !g.completed);
  checks.push({
    id: "schedule",
    group: "upcoming",
    label: `Week ${w} schedule`,
    status: up.length === 0 ? "bad" : "info",
    summary: `${up.length} FBS-vs-FBS games, ${unplayed.length} still to play.`,
    items: [],
  });

  const blocked: string[] = [];
  const degraded: string[] = [];
  for (const r of rows) {
    const gaps = projectionGaps(r.s, inp.hasPlays, inp.hasSt);
    if (r.modelSpread == null) blocked.push(`${name(r.g)} — ${gaps.blocking.join("; ") || "no model number"}`);
    else if (gaps.degraded.length) degraded.push(`${name(r.g)} — ${gaps.degraded.join("; ")}`);
  }
  const projected = rows.length - blocked.length;
  checks.push({
    id: "projected",
    group: "upcoming",
    label: `Week ${w} projections`,
    status: blocked.length ? "bad" : degraded.length ? "warn" : "ok",
    summary: `${projected} of ${rows.length} unplayed games have a DROGBA number${blocked.length ? `; ${blocked.length} can't be projected` : ""}${degraded.length ? `; ${degraded.length} use a reduced set of inputs` : ""}.`,
    items: cap([...blocked, ...degraded]),
  });

  const noOpen = rows.filter((r) => r.g.open == null);
  const fdMissing = rows.filter((r) => !inp.fanduel.has(r.g.id));
  const times = rows.map((r) => inp.fanduel.get(r.g.id)?.openAt).filter((t): t is number => t != null);
  checks.push({
    id: "openers",
    group: "upcoming",
    label: `Week ${w} FanDuel openers`,
    status: noOpen.length ? "bad" : fdMissing.length ? "warn" : "ok",
    summary: `${rows.length - fdMissing.length} of ${rows.length} games have a FanDuel opener on file${times.length ? ` (first seen ${etTime(Math.min(...times))} – ${etTime(Math.max(...times))})` : ""}${noOpen.length ? `; ${noOpen.length} have no line at all` : fdMissing.length ? `; ${fdMissing.length} are on another book's open until FanDuel's is pulled` : ""}.`,
    items: cap([...noOpen.map((r) => `${name(r.g)} — no opening line from any book`), ...fdMissing.filter((r) => r.g.open != null).map((r) => `${name(r.g)} — using ${r.g.openProvider ?? "another book"}'s open`)]),
  });

  const saved = picks.filter((p) => p.season === split.season && p.week === w);
  const savedById = new Map(saved.map((p) => [p.game_id, p]));
  const drifted: string[] = [];
  for (const r of rows) {
    const p = savedById.get(r.g.id);
    if (!p || r.modelSpread == null) continue;
    const d = r.modelSpread - p.model_home_spread;
    const moved = r.open != null && p.open_spread != null && r.open !== p.open_spread;
    if (Math.abs(d) >= DRIFT_PTS || moved) drifted.push(`${name(r.g)} — logged ${p.model_home_spread.toFixed(1)} at ${p.open_spread?.toFixed(1)}, now ${r.modelSpread.toFixed(1)}${moved ? ` at ${r.open?.toFixed(1)}` : ""} (${d > 0 ? "+" : ""}${d.toFixed(1)})`);
  }
  const unsaved = rows.filter((r) => r.pred && !savedById.has(r.g.id)).length;
  checks.push({
    id: "drift",
    group: "upcoming",
    label: `Week ${w} logged vs current`,
    status: saved.length === 0 ? "info" : drifted.length ? "warn" : "ok",
    summary:
      saved.length === 0
        ? "Nothing is logged for this week yet."
        : `${saved.length} logged; ${drifted.length} differ from the current model number by ${DRIFT_PTS}+ points or sit on a different opening line${unsaved ? `; ${unsaved} projected games not logged yet` : ""}. The log keeps the first save, so these differences show what changed since.`,
    items: cap(drifted),
  });

  const lockedUp = up.filter((g) => locks[g.id]).length;
  checks.push({
    id: "ycLocksUp",
    group: "upcoming",
    label: `Week ${w} frozen (YC) projections`,
    status: "info",
    summary: `${lockedUp} of ${up.length} games frozen. Freeze the week (Lock Games) once YC picks are made and before kickoffs.`,
    items: [],
  });

  return checks;
}
