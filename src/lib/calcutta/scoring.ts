import { propKind } from "./formats";
import type { CalcuttaAuction, FieldTeam, PlayoffGame, PropEvent, TeamResult } from "./types";

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
  return a.format === "nfl_playoffs" ? 4 : 0;
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
  const played = games.map((g) => {
    const homeWon = (g.homeScore ?? 0) > (g.awayScore ?? 0);
    const w = homeWon ? g.homeId : g.awayId;
    const l = homeWon ? g.awayId : g.homeId;
    results[w].roundsCleared += 1;
    results[l].eliminated = true;
    if (g.round === lastRound) champ = w;
    return { g, w, l, margin: Math.abs((g.homeScore ?? 0) - (g.awayScore ?? 0)) };
  });
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
      const low = a.field.filter((t) => (t.seed ?? 0) >= 5);
      let key = -1;
      let win: FieldTeam[] = [];
      for (const t of low) {
        const k = results[t.id].roundsCleared * 10 + (t.seed ?? 0);
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
        blocker: settled ? null : "Settles once every 5–7 seed is out",
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

export interface EspnGameLite {
  id: string;
  start: string;
  state: "pre" | "in" | "post";
  home: { abbrev: string | null; score: number | null };
  away: { abbrev: string | null; score: number | null };
  odds?: { homeSpread: number | null } | null;
}

/**
 * Merge ESPN games for one round into the log. Matches by ESPN id, else by
 * the two teams. Scores/final always refresh; the line refreshes only until
 * kickoff (that's the closing line) and never over a hand-typed one.
 */
export function mergeEspnGames(a: CalcuttaAuction, round: number, list: EspnGameLite[], neutral: boolean): { games: PlayoffGame[]; added: number; updated: number } {
  const ids = new Set(a.field.map((t) => t.id));
  const norm = (x: string | null) => (x === "WAS" ? "WSH" : x ?? "");
  const games = [...(a.games ?? [])];
  let added = 0;
  let updated = 0;
  for (const e of list) {
    const h = norm(e.home.abbrev);
    const w = norm(e.away.abbrev);
    if (!ids.has(h) || !ids.has(w)) continue;
    const i = games.findIndex((g) => g.espnId === e.id || (g.homeId === h && g.awayId === w) || (g.homeId === w && g.awayId === h));
    const preGame = e.state === "pre";
    const line = e.odds?.homeSpread ?? null;
    if (i < 0) {
      games.push({
        id: `g_${e.id}`,
        round,
        homeId: h,
        awayId: w,
        homeScore: e.home.score,
        awayScore: e.away.score,
        final: e.state === "post",
        homeSpread: line,
        neutral,
        start: e.start,
        espnId: e.id,
        lineManual: false,
      });
      added++;
    } else {
      const g = games[i];
      const next: PlayoffGame = {
        ...g,
        espnId: e.id,
        round,
        homeId: h,
        awayId: w,
        start: e.start,
        homeScore: e.home.score ?? g.homeScore,
        awayScore: e.away.score ?? g.awayScore,
        final: e.state === "post",
        homeSpread: !g.lineManual && line != null && (preGame || g.homeSpread == null) ? line : g.homeSpread,
      };
      if (JSON.stringify(next) !== JSON.stringify(g)) updated++;
      games[i] = next;
    }
  }
  return { games, added, updated };
}
