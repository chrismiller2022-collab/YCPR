// Performance buckets for DROGBA's graded picks: every game where the model disagrees with the open by at least a
// chosen number of points is treated as a bet on the model's side, then sliced by role (home/away × favorite/underdog),
// conference, matchup type, and the line the bet was made at. Each bucket shows its record, ATS, closing-line value and the
// same numbers for 2023-24 vs 2025-26, because with this many slices some will look good by luck and only the ones that
// hold in both halves are worth a second look.
import type { BetResult } from "./model";
import { gameTier, isPowerTeam, type Tier } from "./tiers";

export interface Bet {
  r: BetResult;
  season: number;
  betHome: boolean;
  line: number; // the line on the side bet: negative = laying points, positive = getting points
  fav: boolean;
  betTeam: string;
  oppTeam: string;
  betConf: string;
  oppConf: string;
  betPower: boolean;
  oppPower: boolean;
  tier: Tier;
}

export interface BucketStat {
  n: number; // decided bets (pushes excluded)
  w: number;
  l: number;
  atsPct: number;
  se: number; // standard error of the win rate, in percentage points
  z: number; // how many standard errors above the -110 break-even (52.4%) the win rate is
  clv: number | null; // average points the line moved toward the pick between open and close
  early: { n: number; pct: number | null }; // 2023-24
  late: { n: number; pct: number | null }; // 2025-26
}

export interface BucketRow extends BucketStat {
  label: string;
}
export interface BucketSection {
  key: string;
  title: string;
  note?: string;
  rows: BucketRow[];
}

export const BREAKEVEN = 0.5238;

export function toBets(results: BetResult[]): Bet[] {
  return results.map((r) => {
    const g = r.g;
    const betHome = r.side > 0;
    const line = betHome ? g.open! : -g.open!;
    const betTeam = betHome ? g.home : g.away;
    const oppTeam = betHome ? g.away : g.home;
    const betConf = (betHome ? g.homeConf : g.awayConf) ?? "?";
    const oppConf = (betHome ? g.awayConf : g.homeConf) ?? "?";
    return {
      r,
      season: g.season,
      betHome,
      line,
      fav: line < 0,
      betTeam,
      oppTeam,
      betConf,
      oppConf,
      betPower: isPowerTeam(betConf, betTeam, g.season),
      oppPower: isPowerTeam(oppConf, oppTeam, g.season),
      tier: gameTier(g),
    };
  });
}

function winPct(bets: Bet[]): { n: number; pct: number | null } {
  const w = bets.filter((b) => b.r.won === true).length;
  const l = bets.filter((b) => b.r.won === false).length;
  return { n: w + l, pct: w + l ? (100 * w) / (w + l) : null };
}

export function stat(bets: Bet[]): BucketStat {
  const w = bets.filter((b) => b.r.won === true).length;
  const l = bets.filter((b) => b.r.won === false).length;
  const n = w + l;
  const p = n ? w / n : 0;
  const se = n ? 100 * Math.sqrt(0.25 / n) : 0;
  const z = n ? (p - BREAKEVEN) / Math.sqrt(0.25 / n) : 0;
  const mv = bets.filter((b) => b.r.moveToUs != null);
  return {
    n,
    w,
    l,
    atsPct: 100 * p,
    se,
    z,
    clv: mv.length ? mv.reduce((a, b) => a + b.r.moveToUs!, 0) / mv.length : null,
    early: winPct(bets.filter((b) => b.season <= 2024)),
    late: winPct(bets.filter((b) => b.season >= 2025)),
  };
}

function groupRows(bets: Bet[], key: (b: Bet) => string | null, minBets = 1, order?: string[] | ((a: BucketRow, b: BucketRow) => number)): BucketRow[] {
  const m = new Map<string, Bet[]>();
  for (const b of bets) {
    const k = key(b);
    if (k == null) continue;
    const a = m.get(k);
    if (a) a.push(b);
    else m.set(k, [b]);
  }
  let rows = Array.from(m.entries()).map(([label, bs]) => ({ label, ...stat(bs) }));
  rows = rows.filter((r) => r.n >= minBets);
  if (Array.isArray(order)) rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  else if (order) rows.sort(order);
  else rows.sort((a, b) => b.n - a.n);
  return rows;
}

const LINE_BANDS: [string, (l: number) => boolean][] = [
  ["Laying 21+", (l) => l <= -21],
  ["Laying 14–21", (l) => l > -21 && l <= -14],
  ["Laying 10–14", (l) => l > -14 && l <= -10],
  ["Laying 7–10", (l) => l > -10 && l <= -7],
  ["Laying 3.5–7", (l) => l > -7 && l <= -3.5],
  ["Laying 0.5–3.5", (l) => l > -3.5 && l <= -0.5],
  ["Pick'em", (l) => l > -0.5 && l < 0.5],
  ["Getting 0.5–3.5", (l) => l >= 0.5 && l < 3.5],
  ["Getting 3.5–7", (l) => l >= 3.5 && l < 7],
  ["Getting 7–10", (l) => l >= 7 && l < 10],
  ["Getting 10–14", (l) => l >= 10 && l < 14],
  ["Getting 14–21", (l) => l >= 14 && l < 21],
  ["Getting 21+", (l) => l >= 21],
];
const KEYS = [3, 4, 6, 7, 10, 14, 17, 21];

const role = (b: Bet) => `${b.betHome ? "Home" : "Away"} ${b.fav ? "favorite" : "underdog"}`;
const matchup = (b: Bet) => `${b.betPower ? "Power team" : "Other team"} vs ${b.oppPower ? "power team" : "other team"}`;
const lineSize = (b: Bet) => {
  const a = Math.abs(b.line);
  return a < 3.5 ? "0–3.5" : a < 7 ? "3.5–7" : a < 14 ? "7–14" : "14+";
};
const fmtLine = (l: number) => (l > 0 ? `+${l}` : `${l}`);

export interface BucketOptions {
  minEdge: number;
  seasons: number[] | null; // null = every season
  tier: Tier | "all";
}

export function filterBets(bets: Bet[], o: BucketOptions): Bet[] {
  return bets.filter((b) => Math.abs(b.r.edge) >= o.minEdge && (o.seasons == null || o.seasons.includes(b.season)) && (o.tier === "all" || b.tier === o.tier));
}

export function buildSections(all: Bet[], o: BucketOptions): { overall: BucketStat; sections: BucketSection[] } {
  const bets = filterBets(all, o);
  const sections: BucketSection[] = [];

  sections.push({
    key: "role",
    title: "Home / away × favorite / underdog",
    rows: groupRows(bets, role, 1, ["Away underdog", "Away favorite", "Home underdog", "Home favorite"]),
  });
  sections.push({
    key: "simple",
    title: "Home vs away, favorite vs underdog",
    rows: [
      ...groupRows(bets, (b) => (b.betHome ? "Bet home" : "Bet away"), 1, ["Bet home", "Bet away"]),
      ...groupRows(bets, (b) => (b.fav ? "Bet favorite" : "Bet underdog"), 1, ["Bet favorite", "Bet underdog"]),
    ],
  });
  sections.push({
    key: "matchup",
    title: "Matchup type (power = SEC / Big Ten / Big 12 / ACC / Notre Dame; Pac-12 in 2023)",
    rows: groupRows(bets, matchup, 1, ["Power team vs power team", "Power team vs other team", "Other team vs power team", "Other team vs other team"]),
  });
  sections.push({
    key: "conf",
    title: "Conference of the team bet on",
    rows: groupRows(bets, (b) => b.betConf, 1),
  });
  sections.push({
    key: "confpair",
    title: "Conference matchups (15+ bets)",
    note: "Team bet on (first) against its opponent's conference.",
    rows: groupRows(bets, (b) => `${b.betConf} vs ${b.oppConf}`, 15),
  });
  sections.push({
    key: "bands",
    title: "Line value of the side bet",
    note: "Negative = laying points, positive = getting points, at the open used for the comparison.",
    rows: groupRows(bets, (b) => LINE_BANDS.find(([, f]) => f(b.line))?.[0] ?? null, 1, LINE_BANDS.map(([l]) => l)),
  });
  const keyRows: BucketRow[] = [];
  for (const k of KEYS) {
    for (const [dir, sign] of [["Laying", -1], ["Getting", 1]] as const) {
      for (const [kind, f] of [
        ["", (l: number) => l === sign * k],
        [" (hook: ½ either side)", (l: number) => Math.abs(l - sign * k) === 0.5],
      ] as const) {
        const bs = bets.filter((b) => f(b.line));
        if (bs.length >= 8) keyRows.push({ label: `${dir} ${k}${kind}`, ...stat(bs) });
      }
    }
  }
  sections.push({ key: "keys", title: "Key numbers (8+ bets)", note: "Bets whose line is exactly a key number, or half a point either side of it.", rows: keyRows });
  sections.push({
    key: "exact",
    title: "Every line from −25 to +25 (8+ bets)",
    note: "Most lines have too few bets to say anything; the bands above are the readable view.",
    rows: groupRows(bets.filter((b) => b.line >= -25 && b.line <= 25), (b) => fmtLine(b.line), 8, (a, b) => Number(a.label) - Number(b.label)),
  });
  sections.push({
    key: "rolesize",
    title: "Role × size of the line (15+ bets)",
    rows: groupRows(bets, (b) => `${role(b)} · ${lineSize(b)}`, 15, (a, b) => a.label.localeCompare(b.label)),
  });
  sections.push({
    key: "rolematch",
    title: "Role × power-vs-power (15+ bets)",
    rows: groupRows(bets, (b) => `${role(b)} · ${b.tier === "power" ? "power vs power" : "other matchup"}`, 15, (a, b) => a.label.localeCompare(b.label)),
  });
  return { overall: stat(bets), sections };
}
