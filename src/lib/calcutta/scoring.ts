import { espnTeamIdToName } from "../espnTeamId";
import { formatDef, propKind } from "./formats";
import { norm } from "./ratings";
import type { CalcuttaAuction, FieldTeam, FormatKey, PlayoffGame, PropEvent, TeamResult } from "./types";

// Works out results and the built-in side prizes from the game log, so the
// owners board updates itself as games go final (ESPN sync or typed in).
//
//   rounds cleared = bye (1) + wins; eliminated = lost a game
//   Biggest upset by seed: winner's seed − loser's seed (Super Bowl too),
//     tiebreak bigger margin, ties split; none → Super Bowl champ
//   Worst margin of defeat: biggest losing margin, ties split
//   Cinderella: furthest-advancing 5–7 seed, tiebreak lower seed, ties split
//   Best ATS: cover % vs the closing line (pushes don't count), tiebreak
//     most ATS wins, ties split
//
// Prizes only pay once they're settled (title game final; Cinderella can
// settle early once every 5–7 seed is out). Until then the leader is shown.

export interface PropStatus {
  winners: string[];
  final: boolean;
  /** Plain-English detail ("SF (6) over PHI (3) by 4"). */
  detail: string | null;
  /** Why it can't settle yet, if it can't. */
  blocker: string | null;
}

export interface Derived {
  results: Record<string, TeamResult>;
  props: Record<string, PropStatus>;
  championId: string | null;
  finalGames: number;
}

function totalRounds(a: CalcuttaAuction): number {
  return formatDef(a.format).rounds.length;
}

export function finalGames(a: CalcuttaAuction): PlayoffGame[] {
  return (a.games ?? []).filter((g) => g.final && g.homeScore != null && g.awayScore != null && g.homeScore !== g.awayScore);
}

export function deriveFromGames(a: CalcuttaAuction): Derived {
  const field = new Map(a.field.map((t) => [t.id, t]));
  const seed = (id: string) => field.get(id)?.seed ?? 0;
  const abbr = (id: string) => field.get(id)?.abbr ?? id;
  const games = finalGames(a).filter((g) => field.has(g.homeId) && field.has(g.awayId));
  const results: Record<string, TeamResult> = {};
  for (const t of a.field) results[t.id] = { roundsCleared: t.bye ? 1 : 0, eliminated: false };
  const lastRound = totalRounds(a) - 1;
  let champ: string | null = null;
  const played: { g: PlayoffGame; w: string; l: string; margin: number }[] = [];
  for (const g of games) {
    const homeWon = (g.homeScore ?? 0) > (g.awayScore ?? 0);
    const w = homeWon ? g.homeId : g.awayId;
    const l = homeWon ? g.awayId : g.homeId;
    if (g.round < 0) {
      // First Four: decides who's in the bracket, not a paid round or a prize game.
      results[w].playIn = "won";
      results[l].playIn = "lost";
      results[l].eliminated = true;
      continue;
    }
    results[w].roundsCleared += 1;
    results[l].eliminated = true;
    if (g.round === lastRound) champ = w;
    played.push({ g, w, l, margin: Math.abs((g.homeScore ?? 0) - (g.awayScore ?? 0)) });
  }
  const titleDone = champ != null;

  const props: Record<string, PropStatus> = {};
  for (const p of a.payouts.props) {
    const kind = propKind(p);
    if (kind === "custom") continue;
    if (kind === "biggest_upset") {
      let best: typeof played = [];
      let bd = 0;
      let bm = -1;
      for (const x of played) {
        const d = seed(x.w) - seed(x.l);
        if (d <= 0) continue;
        if (d > bd || (d === bd && x.margin > bm)) {
          bd = d;
          bm = x.margin;
          best = [x];
        } else if (d === bd && x.margin === bm) best.push(x);
      }
      const winners = best.length ? [...new Set(best.map((x) => x.w))] : champ ? [champ] : [];
      props[p.id] = {
        winners,
        final: titleDone,
        detail: best.length ? best.map((x) => `${abbr(x.w)} (${seed(x.w)}) over ${abbr(x.l)} (${seed(x.l)}) by ${x.margin}`).join("; ") : played.length ? "No upsets yet — goes to the champion" : null,
        blocker: titleDone ? null : "Settles after the title game",
      };
    } else if (kind === "worst_loss") {
      const m = Math.max(0, ...played.map((x) => x.margin));
      const worst = played.filter((x) => x.margin === m && m > 0);
      props[p.id] = {
        winners: [...new Set(worst.map((x) => x.l))],
        final: titleDone,
        detail: worst.length ? worst.map((x) => `${abbr(x.l)} lost to ${abbr(x.w)} by ${x.margin}`).join("; ") : null,
        blocker: titleDone ? null : "Settles after the title game",
      };
    } else if (kind === "cinderella") {
      const minSeed = formatDef(a.format).cinderellaMinSeed;
      const low = a.field.filter((t) => (t.seed ?? 0) >= minSeed);
      let key = -1;
      let win: FieldTeam[] = [];
      for (const t of low) {
        const k = results[t.id].roundsCleared * 100 + (t.seed ?? 0);
        if (k > key) {
          key = k;
          win = [t];
        } else if (k === key) win.push(t);
      }
      const anyAlive = low.some((t) => !results[t.id].eliminated);
      const settled = titleDone || (played.length > 0 && !anyAlive);
      props[p.id] = {
        winners: played.length ? win.map((t) => t.id) : [],
        final: settled,
        detail: played.length && win.length ? win.map((t) => `${t.abbr} (${t.seed}) — ${results[t.id].roundsCleared} win${results[t.id].roundsCleared === 1 ? "" : "s"}`).join("; ") : null,
        blocker: settled ? null : `Settles once every ${minSeed}+ seed is out`,
      };
    } else if (kind === "lowest_f4_seed") {
      const R = totalRounds(a);
      const need = formatDef(a.format).rounds[R - 3]?.slots ?? 4;
      const four = a.field.filter((t) => results[t.id].roundsCleared >= R - 2);
      const lo = Math.max(0, ...four.map((t) => t.seed ?? 0));
      const win = four.filter((t) => (t.seed ?? 0) === lo);
      const settled = four.length >= need;
      props[p.id] = {
        winners: win.map((t) => t.id),
        final: settled,
        detail: four.length ? `${four.length === need ? "Final Four" : "So far"}: ${four.map((t) => `${t.abbr} (${t.seed})`).join(", ")}` : null,
        blocker: settled ? null : "Settles once the Final Four is set",
      };
    } else if (kind === "best_ats") {
      const w: Record<string, number> = {};
      const n: Record<string, number> = {};
      let missing = 0;
      for (const x of played) {
        if (x.g.homeSpread == null) {
          missing++;
          continue;
        }
        const cover = (x.g.homeScore ?? 0) + x.g.homeSpread - (x.g.awayScore ?? 0);
        if (cover === 0) continue;
        for (const id of [x.g.homeId, x.g.awayId]) n[id] = (n[id] ?? 0) + 1;
        const coverer = cover > 0 ? x.g.homeId : x.g.awayId;
        w[coverer] = (w[coverer] ?? 0) + 1;
      }
      let key = -1;
      let win: string[] = [];
      for (const id of Object.keys(n)) {
        const k = ((w[id] ?? 0) / n[id]) * 1000 + (w[id] ?? 0);
        if (k > key + 1e-9) {
          key = k;
          win = [id];
        } else if (Math.abs(k - key) <= 1e-9) win.push(id);
      }
      props[p.id] = {
        winners: win,
        final: titleDone && missing === 0,
        detail: win.length ? win.map((id) => `${abbr(id)} ${w[id] ?? 0}-${(n[id] ?? 0) - (w[id] ?? 0)} ATS`).join("; ") : null,
        blocker: missing ? `Missing closing line for ${missing} game${missing === 1 ? "" : "s"}` : titleDone ? null : "Settles after the title game",
      };
    }
  }
  return { results, props, championId: champ, finalGames: games.length };
}

const cache = new WeakMap<CalcuttaAuction, CalcuttaAuction>();

/**
 * The auction as scoring should see it: with autoScore on (and a game log),
 * results and settled built-in side prizes come from the games; otherwise
 * the hand-entered ones are used unchanged.
 */
export function scored(a: CalcuttaAuction): CalcuttaAuction {
  if (!a.autoScore || !(a.games ?? []).length) return a;
  const hit = cache.get(a);
  if (hit) return hit;
  const d = deriveFromGames(a);
  const props: PropEvent[] = a.payouts.props.map((p) => {
    const st = d.props[p.id];
    return st ? { ...p, teamId: null, teamIds: st.final ? st.winners : [] } : p;
  });
  const out = { ...a, results: d.results, payouts: { ...a.payouts, props } };
  cache.set(a, out);
  return out;
}

// ---- ESPN ------------------------------------------------------------------

/** ESPN postseason week → our round. Week 4 is the Pro Bowl. */
export const NFL_ESPN_WEEK_ROUND: Record<number, number> = { 1: 0, 2: 1, 3: 2, 5: 3 };

export interface EspnSide {
  espnId?: string | null;
  abbrev: string | null;
  name?: string | null;
  location?: string | null;
  displayName?: string | null;
  score: number | null;
  /** ESPN's curated rank — in the NCAA tournament feed, the team's seed. */
  rank?: number | null;
}

export interface EspnGameLite {
  id: string;
  start: string;
  state: "pre" | "in" | "post";
  note?: string | null;
  neutral?: boolean;
  home: EspnSide;
  away: EspnSide;
  odds?: { homeSpread: number | null } | null;
}

/** Field team id for an ESPN competitor: ESPN id first, then abbreviation (NFL) or name. */
export function espnTeamResolver(a: CalcuttaAuction): (side: EspnSide) => string | null {
  const ids = new Set(a.field.map((t) => t.id));
  const byEspn = new Map(a.field.filter((t) => t.espnId).map((t) => [String(t.espnId), t.id]));
  const byName = new Map<string, string>();
  for (const t of a.field) {
    byName.set(norm(t.name), t.id);
    if (a.format !== "nfl_playoffs" && t.abbr.length >= 3) byName.set(norm(t.abbr), t.id);
  }
  return (side) => {
    if (a.format === "nfl_playoffs") {
      const ab = side.abbrev === "WAS" ? "WSH" : side.abbrev ?? "";
      return ids.has(ab) ? ab : null;
    }
    if (side.espnId) {
      const hit = byEspn.get(String(side.espnId));
      if (hit) return hit;
      if (formatDef(a.format).sport === "cfb") {
        const name = espnTeamIdToName(String(side.espnId));
        if (name && ids.has(name)) return name;
      }
    }
    for (const n of [side.location, side.displayName, side.name, side.abbrev]) {
      if (!n) continue;
      const hit = byName.get(norm(n));
      if (hit) return hit;
    }
    return null;
  };
}

/** Round from ESPN's game note, when it says ("Sweet 16", "Quarterfinal"…). null = can't tell. */
export function roundFromNote(format: FormatKey, note: string | null | undefined): number | null {
  if (!note) return null;
  const n = note.toLowerCase();
  if (format === "march_madness") {
    if (n.includes("first four")) return -1;
    if (n.includes("1st round") || n.includes("first round")) return 0;
    if (n.includes("2nd round") || n.includes("second round")) return 1;
    if (n.includes("sweet 16") || n.includes("sweet sixteen")) return 2;
    if (n.includes("elite 8") || n.includes("elite eight")) return 3;
    if (n.includes("final four")) return 4;
    if (n.includes("national championship")) return 5;
    return null;
  }
  if (format === "cfb_playoff12" || format === "cfb_playoff24") {
    const off = format === "cfb_playoff24" ? 1 : 0;
    if (n.includes("first round")) return 0;
    if (n.includes("second round")) return format === "cfb_playoff24" ? 1 : null;
    if (n.includes("quarterfinal")) return 1 + off;
    if (n.includes("semifinal")) return 2 + off;
    if (n.includes("national championship")) return 3 + off;
  }
  return null;
}

/** Whether a round is played on a neutral field by the format's rules (null = ask ESPN). */
function formatNeutral(format: FormatKey, round: number): boolean | null {
  if (format === "march_madness") return true;
  if (format === "cfb_playoff12") return round >= 1;
  if (format === "cfb_playoff24") return round >= formatDef(format).rounds.length - 1;
  return null;
}

/** Round by how many games each team already has in the log before this one (plus a bye). */
function inferRound(a: CalcuttaAuction, games: PlayoffGame[], h: string, w: string, start: string | null): number {
  const field = new Map(a.field.map((t) => [t.id, t]));
  const th = field.get(h);
  const tw = field.get(w);
  if (a.format === "march_madness" && th && tw && th.group === tw.group && th.seed === tw.seed) return -1;
  const prior = (id: string) =>
    (field.get(id)?.bye ? 1 : 0) + games.filter((g) => g.round >= 0 && (g.homeId === id || g.awayId === id) && (g.start ?? "") < (start ?? "~")).length;
  return Math.max(prior(h), prior(w));
}

/**
 * Merge ESPN games into the log. Matches by ESPN id, else by the two teams.
 * Scores/final always refresh; the line refreshes only until kickoff (that's
 * the closing line) and never over a hand-typed one. `round` null = work it
 * out from ESPN's note, else from each team's earlier games.
 */
export function mergeEspnGames(a: CalcuttaAuction, round: number | null, list: EspnGameLite[], neutral: boolean | null): { games: PlayoffGame[]; added: number; updated: number; skipped: number } {
  const resolve = espnTeamResolver(a);
  const games = [...(a.games ?? [])];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const e of [...list].sort((x, y) => x.start.localeCompare(y.start))) {
    const h = resolve(e.home);
    const w = resolve(e.away);
    if (!h || !w) {
      skipped++;
      continue;
    }
    const i = games.findIndex((g) => g.espnId === e.id || (g.homeId === h && g.awayId === w) || (g.homeId === w && g.awayId === h));
    const r = round ?? roundFromNote(a.format, e.note) ?? inferRound(a, i >= 0 ? games.filter((_, j) => j !== i) : games, h, w, e.start);
    const preGame = e.state === "pre";
    const line = e.odds?.homeSpread ?? null;
    const isNeutral = neutral ?? formatNeutral(a.format, r) ?? !!e.neutral;
    if (i < 0) {
      games.push({ id: `g_${e.id}`, round: r, homeId: h, awayId: w, homeScore: e.home.score, awayScore: e.away.score, final: e.state === "post", homeSpread: line, neutral: isNeutral, start: e.start, espnId: e.id, lineManual: false });
      added++;
    } else {
      const g = games[i];
      const next: PlayoffGame = {
        ...g,
        espnId: e.id,
        round: r,
        homeId: h,
        awayId: w,
        start: e.start,
        neutral: isNeutral,
        homeScore: e.home.score ?? g.homeScore,
        awayScore: e.away.score ?? g.awayScore,
        final: e.state === "post",
        homeSpread: !g.lineManual && line != null && (preGame || g.homeSpread == null) ? line : g.homeSpread,
      };
      if (JSON.stringify(next) !== JSON.stringify(g)) updated++;
      games[i] = next;
    }
  }
  return { games, added, updated, skipped };
}

/** The NCAA tournament's game days from the First Four Tuesday: FF, R64, R32, S16, E8, Final Four, title. */
export function madnessGameDays(firstFour: Date): string[] {
  return [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 18, 20].map((off) => {
    const d = new Date(Date.UTC(firstFour.getUTCFullYear(), firstFour.getUTCMonth(), firstFour.getUTCDate() + off));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  });
}

/** First Four Tuesday guess for a tournament year: the Tuesday between March 15 and 21. */
export function guessFirstFour(year: number): Date {
  for (let d = 15; d <= 21; d++) {
    const x = new Date(Date.UTC(year, 2, d));
    if (x.getUTCDay() === 2) return x;
  }
  return new Date(Date.UTC(year, 2, 18));
}
