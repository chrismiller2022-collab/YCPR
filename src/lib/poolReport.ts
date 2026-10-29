import { keyNumbersBetween, keyCrossLabel } from "./keyNumberCross";

// ---------------------------------------------------------------------
// Pool Report — ranks a pool's slate (Peay / CBS / Kelly) by how strongly
// everything already tracked on the site backs the side my line likes
// against the POOL line. Pure functions only (no fetching) so the scoring
// is unit-testable; usePoolReportContext.ts gathers the inputs.
//
// Lines are away-perspective throughout (negative = away favored), same as
// the pool pages. "Side" is always the team my line covers against the
// pool line; every factor scores in [-1, 1] for/against that side (edge
// and my-line key numbers can only be >= 0 by construction).
//
// Season records are season-to-date (weeks before the report's week),
// graded ATS against the Vegas closing line, every game — not placed bets.
// ---------------------------------------------------------------------

export type Side = "away" | "home";
export type CoverResult = Side | "push" | null;

export const POOL_REPORT_WEIGHTS = {
  edge: 25, // pool line vs my line
  vegas: 15, // pool line vs Vegas
  keysMine: 10, // key numbers between my line and the pool line
  keysVegas: 10, // key numbers between Vegas and the pool line
  role: 10, // my record projecting this role (home/away, fav/dog, combo)
  team: 10, // my record on this team
  named: 10, // McIllece, JP+, Consensus vs the pool line
  totals: 5, // my record on this fav/dog side in games I project the same O/U
  systems: 5, // every rating system vs the pool line
};
export type FactorKey = keyof typeof POOL_REPORT_WEIGHTS;

export const NAMED_SYSTEMS: { key: string; label: string }[] = [
  { key: "mcillece", label: "McIllece" },
  { key: "jpplus", label: "JP+" },
  { key: "consensus", label: "Consensus" },
];
// Excluded from the all-systems count: YC is my own line (already factor 1)
// and Consensus is an average of the others (already in the named factor).
const SYSTEM_COUNT_EXCLUDED = new Set(["yc", "consensus"]);

const EDGE_FULL_CREDIT = 7; // points of edge vs my line that earns the full edge score
const VEGAS_FULL_CREDIT = 3; // points the pool line is off Vegas for full credit
const KEY_VALUE: Record<number, number> = { 3: 0.6, 7: 0.4 };
const SHRINK_GAMES = 10; // pseudo-games at 50% added to every record so small samples can't swing a score
const RECORD_FULL_CREDIT = 0.15; // shrunk win% this far from 50% earns the full score

export interface Tally {
  w: number;
  l: number;
  p: number;
}

/** One completed game from earlier in the season, everything graded vs the Vegas closing line. */
export interface SeasonGame {
  week: number;
  away: string;
  home: string;
  myLine: number | null;
  vegasLine: number | null;
  actCover: CoverResult;
  myTotal: number | null;
  vegasTotal: number | null;
}

/** One game on this week's pool slate. */
export interface ReportGameInput {
  gameId: string;
  away: string;
  home: string;
  startDate: string | null;
  completed: boolean;
  poolLine: number | null;
  myLine: number | null;
  vegasLine: number | null;
  myTotal: number | null;
  vegasTotal: number | null;
  // Away-perspective projected spread per rating system key (null = no rating for one of the teams).
  systemLines: Record<string, number | null>;
}

export interface Factor {
  key: FactorKey;
  label: string;
  score: number | null; // [-1, 1]; null = no data, counts as 0
  short: string; // compact cell text for the ranked table
  detail: string; // one sentence for the game card
}

export interface ReportGame {
  input: ReportGameInput;
  side: Side | null;
  sideTeam: string | null;
  sideLine: number | null; // the pool line from the side team's perspective (e.g. +6.5)
  factors: Factor[];
  score: number | null; // 0..100, null when there's no side (no line, or my line equals the pool line)
  tier: "A" | "B" | "C" | "D" | null;
  rank: number | null;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const sideOf = (mine: number, line: number): Side | null => (mine < line ? "away" : mine > line ? "home" : null);
const forSide = (v: number, side: Side) => (side === "away" ? v : -v);
const fmtLine = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}`;

export function emptyTally(): Tally {
  return { w: 0, l: 0, p: 0 };
}

export function fmtTally(t: Tally): string {
  return t.p > 0 ? `${t.w}-${t.l}-${t.p}` : `${t.w}-${t.l}`;
}

function add(t: Tally, picked: Side, actual: CoverResult) {
  if (actual == null) return;
  if (actual === "push") t.p++;
  else if (actual === picked) t.w++;
  else t.l++;
}

/** Win% pulled toward 50% by SHRINK_GAMES pseudo-games, then scaled to [-1, 1]. Null with no decided games. */
export function recordScore(t: Tally): number | null {
  const decided = t.w + t.l;
  if (decided === 0) return null;
  const shrunk = (t.w + SHRINK_GAMES / 2) / (decided + SHRINK_GAMES);
  return clamp((shrunk - 0.5) / RECORD_FULL_CREDIT);
}

function keyValue(keys: number[]): number {
  return Math.min(1, keys.reduce((s, k) => s + (KEY_VALUE[Math.abs(k)] ?? 0), 0));
}

type Role = "home" | "away";
type FavDog = "fav" | "dog";

function favDogOf(teamSpread: number | null): FavDog | null {
  if (teamSpread == null || teamSpread === 0) return null;
  return teamSpread < 0 ? "fav" : "dog";
}

// ---------------------------------------------------------------------
// Season context — every record the factors need, indexed once per slate.
// ---------------------------------------------------------------------
export interface SeasonStats {
  // My model's pick vs Vegas, by the picked team's role.
  byRole: Record<string, Tally>; // "home" | "away" | "fav" | "dog" | "home-fav" | ...
  // Games where my model had this team covering Vegas: how that went.
  teamWhenProjected: Map<string, Tally>;
  // Every one of this team's games: was my cover call (either side) right?
  teamCallAccuracy: Map<string, Tally>;
  // My model's pick vs Vegas by the picked team's fav/dog role and my O/U call: "fav-Over", "dog-Under", ...
  byTotalCall: Record<string, Tally>;
}

export function buildSeasonStats(games: SeasonGame[]): SeasonStats {
  const byRole: Record<string, Tally> = {};
  const byTotalCall: Record<string, Tally> = {};
  const teamWhenProjected = new Map<string, Tally>();
  const teamCallAccuracy = new Map<string, Tally>();
  const bump = (rec: Record<string, Tally>, key: string, picked: Side, actual: CoverResult) => {
    add((rec[key] ??= emptyTally()), picked, actual);
  };
  const bumpMap = (m: Map<string, Tally>, team: string, picked: Side, actual: CoverResult) => {
    let t = m.get(team);
    if (!t) m.set(team, (t = emptyTally()));
    add(t, picked, actual);
  };

  for (const g of games) {
    if (g.myLine == null || g.vegasLine == null || g.actCover == null) continue;
    const picked = sideOf(g.myLine, g.vegasLine);
    if (picked == null) continue;
    const team = picked === "away" ? g.away : g.home;
    const fd = favDogOf(forSide(g.vegasLine, picked));

    bump(byRole, picked, picked, g.actCover);
    if (fd) {
      bump(byRole, fd, picked, g.actCover);
      bump(byRole, `${picked}-${fd}`, picked, g.actCover);
    }
    bumpMap(teamWhenProjected, team, picked, g.actCover);
    // Call accuracy counts for both teams in the game — it's how often my call in their games was right.
    bumpMap(teamCallAccuracy, g.away, picked, g.actCover);
    bumpMap(teamCallAccuracy, g.home, picked, g.actCover);

    if (fd && g.myTotal != null && g.vegasTotal != null && g.myTotal !== g.vegasTotal) {
      bump(byTotalCall, `${fd}-${g.myTotal > g.vegasTotal ? "Over" : "Under"}`, picked, g.actCover);
    }
  }
  return { byRole, teamWhenProjected, teamCallAccuracy, byTotalCall };
}

const ROLE_LABEL: Record<string, string> = {
  home: "Home",
  away: "Away",
  fav: "Fav",
  dog: "Dog",
  "home-fav": "Home Fav",
  "home-dog": "Home Dog",
  "away-fav": "Away Fav",
  "away-dog": "Away Dog",
};

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------
export function scoreGame(input: ReportGameInput, stats: SeasonStats, weights = POOL_REPORT_WEIGHTS): ReportGame {
  const { poolLine, myLine, vegasLine } = input;
  const side = poolLine != null && myLine != null ? sideOf(myLine, poolLine) : null;
  if (side == null || poolLine == null || myLine == null) {
    return { input, side: null, sideTeam: null, sideLine: null, factors: [], score: null, tier: null, rank: null };
  }
  const sideTeam = side === "away" ? input.away : input.home;
  const otherTeam = side === "away" ? input.home : input.away;
  const poolS = forSide(poolLine, side);
  const mineS = forSide(myLine, side);
  const vegasS = vegasLine != null ? forSide(vegasLine, side) : null;
  const factors: Factor[] = [];

  // 1. Pool vs my line.
  const edge = poolS - mineS;
  factors.push({
    key: "edge",
    label: "Pool vs my line",
    score: clamp(edge / EDGE_FULL_CREDIT, 0, 1),
    short: fmtPts(edge),
    detail: `${sideTeam} ${fmtLine(poolS)} in the pool vs my ${fmtLine(mineS)}: ${Math.round(edge * 10) / 10} points of edge.`,
  });

  // 2. Pool vs Vegas — positive when the pool gives my side more than Vegas does.
  if (vegasS != null) {
    const d = poolS - vegasS;
    factors.push({
      key: "vegas",
      label: "Pool vs Vegas",
      score: clamp(d / VEGAS_FULL_CREDIT),
      short: d === 0 ? "even" : fmtPts(d),
      detail:
        d === 0
          ? `Pool line matches Vegas (${fmtLine(vegasS)}).`
          : d > 0
          ? `Pool gives ${sideTeam} ${Math.abs(d)} more than Vegas (${fmtLine(vegasS)}) — the market is on my side of the pool number.`
          : `Pool gives ${sideTeam} ${Math.abs(d)} less than Vegas (${fmtLine(vegasS)}) — the market is against my side of the pool number.`,
    });
  } else {
    factors.push({ key: "vegas", label: "Pool vs Vegas", score: null, short: "–", detail: "No Vegas line." });
  }

  // 3. Key numbers between my line and the pool line (always in my side's favor).
  const keysMine = keyNumbersBetween(myLine, poolLine);
  factors.push({
    key: "keysMine",
    label: "Keys: mine ↔ pool",
    score: keyValue(keysMine),
    short: keysMine.length ? `🔑${keysMine.map(Math.abs).join(",")}` : "–",
    detail: keysMine.length ? `My line and the pool line are on opposite sides of ${keyCrossLabel(keysMine)}.` : "No key numbers between my line and the pool line.",
  });

  // 4. Key numbers between Vegas and the pool line — for me if Vegas is on my side of the pool number.
  if (vegasLine != null && vegasS != null) {
    const keysVegas = keyNumbersBetween(vegasLine, poolLine);
    const sign = poolS - vegasS > 0 ? 1 : -1;
    factors.push({
      key: "keysVegas",
      label: "Keys: Vegas ↔ pool",
      score: keysVegas.length ? sign * keyValue(keysVegas) : 0,
      short: keysVegas.length ? `${sign > 0 ? "🔑" : "⚠"}${keysVegas.map(Math.abs).join(",")}` : "–",
      detail: keysVegas.length
        ? `Vegas and the pool line are on opposite sides of ${keyCrossLabel(keysVegas)} — ${sign > 0 ? "in" : "against"} ${sideTeam}'s favor.`
        : "No key numbers between Vegas and the pool line.",
    });
  } else {
    factors.push({ key: "keysVegas", label: "Keys: Vegas ↔ pool", score: null, short: "–", detail: "No Vegas line." });
  }

  // 5. My record projecting this role. Fav/dog by Vegas, falling back to the pool line.
  const fd = favDogOf(vegasS ?? poolS);
  const roleKeys = [side, ...(fd ? [fd, `${side}-${fd}`] : [])];
  const roleScores = roleKeys.map((k) => recordScore(stats.byRole[k] ?? emptyTally())).filter((v): v is number => v != null);
  factors.push({
    key: "role",
    label: "My record: role",
    score: roleScores.length ? roleScores.reduce((a, b) => a + b, 0) / roleScores.length : null,
    short: fd ? `${ROLE_LABEL[`${side}-${fd}`]} ${fmtTally(stats.byRole[`${side}-${fd}`] ?? emptyTally())}` : `${ROLE_LABEL[side]} ${fmtTally(stats.byRole[side] ?? emptyTally())}`,
    detail:
      `${sideTeam} is the ${roleKeys.map((k) => ROLE_LABEL[k]).pop()}. My ATS record this season projecting: ` +
      roleKeys.map((k) => `${ROLE_LABEL[k]} ${fmtTally(stats.byRole[k] ?? emptyTally())}`).join(" · ") +
      ".",
  });

  // 6. My record on this team: (a) when I project them to cover, (b) my call accuracy in their games.
  const proj = stats.teamWhenProjected.get(sideTeam) ?? emptyTally();
  const acc = stats.teamCallAccuracy.get(sideTeam) ?? emptyTally();
  const teamScores = [recordScore(proj), recordScore(acc)].filter((v): v is number => v != null);
  factors.push({
    key: "team",
    label: "My record: team",
    score: teamScores.length ? teamScores.reduce((a, b) => a + b, 0) / teamScores.length : null,
    short: `${fmtTally(proj)} · ${fmtTally(acc)}`,
    detail: `When I project ${sideTeam} to cover: ${fmtTally(proj)} ATS. My cover calls in ${sideTeam} games: ${fmtTally(acc)}.`,
  });

  // 7. McIllece, JP+, Consensus vs the pool line.
  let namedScore = 0;
  let namedAny = false;
  const namedParts: string[] = [];
  const namedShort: string[] = [];
  for (const s of NAMED_SYSTEMS) {
    const line = input.systemLines[s.key];
    const sysSide = line != null ? sideOf(line, poolLine) : null;
    if (line == null) {
      namedParts.push(`${s.label} n/a`);
      namedShort.push(`${s.label}–`);
      continue;
    }
    namedAny = true;
    const agree = sysSide === side;
    if (sysSide != null) namedScore += agree ? 1 / NAMED_SYSTEMS.length : -1 / NAMED_SYSTEMS.length;
    const mark = sysSide == null ? "=" : agree ? "✓" : "✗";
    namedShort.push(`${s.label}${mark}`);
    namedParts.push(`${s.label} ${fmtLine(Math.round(forSide(line, side) * 10) / 10)} (${sysSide == null ? "on the number" : agree ? "with me" : "against me"})`);
  }
  factors.push({
    key: "named",
    label: "McIllece / JP+ / Consensus",
    score: namedAny ? namedScore : null,
    short: namedShort.join(" "),
    detail: `${sideTeam}'s line by system, vs pool ${fmtLine(poolS)}: ${namedParts.join(", ")}.`,
  });

  // 8. Totals — my record on this fav/dog side in games I projected the same O/U.
  const totalCall =
    input.myTotal != null && input.vegasTotal != null && input.myTotal !== input.vegasTotal ? (input.myTotal > input.vegasTotal ? "Over" : "Under") : null;
  if (totalCall && fd) {
    const t = stats.byTotalCall[`${fd}-${totalCall}`] ?? emptyTally();
    factors.push({
      key: "totals",
      label: "Totals",
      score: recordScore(t),
      short: `${totalCall === "Over" ? "O" : "U"} · ${ROLE_LABEL[fd]} ${fmtTally(t)}`,
      detail: `I project ${totalCall} (${Math.round(input.myTotal! * 10) / 10} vs ${input.vegasTotal}). My ATS record on the ${fd === "fav" ? "favorite" : "underdog"} in games I project ${totalCall}: ${fmtTally(t)}.`,
    });
  } else {
    factors.push({ key: "totals", label: "Totals", score: null, short: "–", detail: "No total projection or no fav/dog side." });
  }

  // 9. Every rating system vs the pool line.
  let withMe = 0;
  let against = 0;
  for (const [key, line] of Object.entries(input.systemLines)) {
    if (SYSTEM_COUNT_EXCLUDED.has(key) || line == null) continue;
    const s = sideOf(line, poolLine);
    if (s === side) withMe++;
    else if (s != null) against++;
  }
  const counted = withMe + against;
  factors.push({
    key: "systems",
    label: "All systems",
    score: counted ? (withMe - against) / counted : null,
    short: counted ? `${withMe}/${counted}` : "–",
    detail: counted ? `${withMe} of ${counted} rating systems have ${sideTeam} covering the pool line (${against} have ${otherTeam}).` : "No rating system snapshot.",
  });

  // Combine: weighted sum mapped onto 0..100 between the worst and best possible totals.
  let raw = 0;
  let max = 0;
  let min = 0;
  for (const f of factors) {
    const w = weights[f.key];
    raw += w * (f.score ?? 0);
    max += w;
    if (f.key !== "edge" && f.key !== "keysMine") min -= w;
  }
  const score = Math.round((100 * (raw - min)) / (max - min));
  const tier = score >= 70 ? "A" : score >= 60 ? "B" : score >= 50 ? "C" : "D";
  return { input, side, sideTeam, sideLine: poolS, factors, score, tier, rank: null };
}

/** Score every game and rank them best to worst. Completed games and games with no side are left unranked, at the bottom. */
export function buildPoolReport(inputs: ReportGameInput[], stats: SeasonStats, weights = POOL_REPORT_WEIGHTS): ReportGame[] {
  const scored = inputs.map((i) => scoreGame(i, stats, weights));
  const rankable = scored.filter((g) => g.score != null && !g.input.completed);
  rankable.sort((a, b) => b.score! - a.score! || (b.factors[0]?.score ?? 0) - (a.factors[0]?.score ?? 0));
  rankable.forEach((g, i) => (g.rank = i + 1));
  const rest = scored.filter((g) => g.rank == null);
  return [...rankable, ...rest];
}

export interface PoolPickRules {
  picks: number; // how many games the report picks
  keyPicks: number; // how many of those (from the top) become key picks
  eligible: (g: ReportGame) => boolean;
}

/** The report's suggested picks: the top `picks` eligible ranked games; the first `keyPicks` of them are key picks. */
export function suggestPicks(report: ReportGame[], rules: PoolPickRules): { gameId: string; side: Side; key: boolean }[] {
  return report
    .filter((g) => g.rank != null && g.side != null && rules.eligible(g))
    .slice(0, rules.picks)
    .map((g, i) => ({ gameId: g.input.gameId, side: g.side!, key: i < rules.keyPicks }));
}
