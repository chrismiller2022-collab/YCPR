import { NFL_TEAMS, nflLogoUrl } from "../../data/nflTeams";
import type { FieldTeam, FormatKey, PayoutRules, PropEvent, PropKind } from "./types";

// Format registry. Every format shares the same auction core; a format only
// decides the team field, the payout rounds, and the default payout split.
// The Desk's bracket sim (bracketSim.ts) runs each format's bracket.

export interface RoundDef {
  key: string;
  label: string;
  /** How many teams clear this round in a full tournament (for the 100% check). */
  slots: number;
  /** The game itself, for result menus ("Wild Card", "Sweet 16"). */
  game: string;
  /** Column header on the Desk ("WC", "S16"). */
  short: string;
}

export type Sport = "nfl" | "cfb" | "cbb";

export interface FormatDef {
  key: FormatKey;
  label: string;
  available: boolean;
  blurb: string;
  sport: Sport;
  rounds: RoundDef[];
  defaultPayouts: PayoutRules;
  /** Teams in a full field (March Madness: 68 incl. First Four). */
  fieldSize: number;
  /** Seeds 1..byeCount skip the first round. */
  byeCount: number;
  /** Cinderella prize: furthest-advancing team seeded at least this. */
  cinderellaMinSeed: number;
  /** Desk sim defaults. */
  sim: { hfa: number; marginSd: number; ratingNoise: number };
}

const prop = (kind: PropKind, label: string, pct: number, rule: string): PropEvent => ({ id: kind, kind, label, pct, teamIds: [], rule });

export const NFL_PLAYOFF_ROUNDS: RoundDef[] = [
  { key: "wc", label: "Wild Card win", slots: 6, game: "Wild Card", short: "WC" },
  { key: "div", label: "Divisional win", slots: 4, game: "Divisional", short: "Div" },
  { key: "conf", label: "Conference title", slots: 2, game: "Conf. Championship", short: "Conf" },
  { key: "sb", label: "Super Bowl win", slots: 1, game: "Super Bowl", short: "SB" },
];

const NONE: Omit<FormatDef, "key" | "label" | "blurb"> = {
  available: false,
  sport: "nfl",
  rounds: [],
  defaultPayouts: { roundPct: {}, byeCountsAsWin: false, props: [] },
  fieldSize: 0,
  byeCount: 0,
  cinderellaMinSeed: 99,
  sim: { hfa: 0, marginSd: 13, ratingNoise: 1.5 },
};

export const FORMATS: FormatDef[] = [
  {
    key: "nfl_playoffs",
    label: "NFL Playoffs",
    available: true,
    blurb: "14 teams (7 AFC, 7 NFC). #1 seeds get a bye. Paid per win, plus side prizes that keep the low seeds live.",
    sport: "nfl",
    rounds: NFL_PLAYOFF_ROUNDS,
    fieldSize: 14,
    byeCount: 1,
    cinderellaMinSeed: 5,
    sim: { hfa: 1.5, marginSd: 13.5, ratingNoise: 1.5 },
    // Wins: 6 × 3 + 4 × 5 + 2 × 10 + 17 = 75%. Side prizes: 25%. The bye is
    // not paid as a win — it's already worth a lot (a free pass to the
    // Divisional round). Picked from a 100k-run playoff sim (docs/calcutta.md):
    // a #1 seed is worth ~2x a #7 seed here, vs ~8x with a 40% Super Bowl.
    defaultPayouts: {
      roundPct: { wc: 3, div: 5, conf: 10, sb: 17 },
      byeCountsAsWin: false,
      props: [
        prop("biggest_upset", "Biggest upset by seed", 7, "Winner's seed minus loser's seed (7 over 2 = 5). Tiebreak: bigger margin. No upsets → Super Bowl champ."),
        prop("worst_loss", "Worst margin of defeat", 6, "Largest losing margin in any one game. Ties split."),
        prop("cinderella", "Cinderella (best 5–7 seed)", 6, "Furthest-advancing 5, 6 or 7 seed. Tiebreak: lower seed (7 beats 5), then split."),
        prop("best_ats", "Best ATS record", 6, "Cover % vs closing line, pushes don't count. Tiebreak: most ATS wins, then split."),
      ],
    },
  },
  {
    key: "march_madness",
    label: "March Madness",
    available: true,
    blurb: "68 teams, 4 regions. First Four pairs sell as one lot. Paid per win from the Round of 64, plus side prizes.",
    sport: "cbb",
    rounds: [
      { key: "r64", label: "Round of 64 win", slots: 32, game: "Round of 64", short: "R64" },
      { key: "r32", label: "Round of 32 win", slots: 16, game: "Round of 32", short: "R32" },
      { key: "s16", label: "Sweet 16 win", slots: 8, game: "Sweet 16", short: "S16" },
      { key: "e8", label: "Elite 8 win", slots: 4, game: "Elite 8", short: "E8" },
      { key: "f4", label: "Final Four win", slots: 2, game: "Final Four", short: "F4" },
      { key: "title", label: "National title", slots: 1, game: "Title game", short: "Title" },
    ],
    fieldSize: 68,
    byeCount: 0,
    cinderellaMinSeed: 11,
    sim: { hfa: 0, marginSd: 11, ratingNoise: 1.5 },
    // Wins: 32 × 0.5 + 16 × 1 + 8 × 2 + 4 × 3 + 2 × 5 + 10 = 80%. Side prizes 20%.
    defaultPayouts: {
      roundPct: { r64: 0.5, r32: 1, s16: 2, e8: 3, f4: 5, title: 10 },
      byeCountsAsWin: false,
      props: [
        prop("biggest_upset", "Biggest upset by seed", 6, "Winner's seed minus loser's seed (15 over 2 = 13). Tiebreak: bigger margin. No upsets → champion. First Four doesn't count."),
        prop("worst_loss", "Worst margin of defeat", 4, "Largest losing margin in any one game (First Four excluded). Ties split."),
        prop("cinderella", "Cinderella (best 11+ seed)", 6, "Furthest-advancing seed 11–16. Tiebreak: lower seed, then split."),
        prop("best_ats", "Best ATS record", 4, "Cover % vs closing line, pushes don't count. Tiebreak: most ATS wins, then split."),
      ],
    },
  },
  {
    key: "cfb_playoff12",
    label: "CFB 12-team Playoff",
    available: true,
    blurb: "12 teams. Seeds 1–4 get byes. First round on campus, then bowls. Paid per win, plus side prizes.",
    sport: "cfb",
    rounds: [
      { key: "r1", label: "First-round win", slots: 4, game: "First round", short: "R1" },
      { key: "qf", label: "Quarterfinal win", slots: 4, game: "Quarterfinal", short: "QF" },
      { key: "sf", label: "Semifinal win", slots: 2, game: "Semifinal", short: "SF" },
      { key: "title", label: "National title", slots: 1, game: "Title game", short: "Title" },
    ],
    fieldSize: 12,
    byeCount: 4,
    cinderellaMinSeed: 9,
    sim: { hfa: 2.5, marginSd: 15, ratingNoise: 2 },
    // Wins: 4 × 4 + 4 × 6 + 2 × 10 + 15 = 75%. Side prizes 25%. Byes not paid.
    defaultPayouts: {
      roundPct: { r1: 4, qf: 6, sf: 10, title: 15 },
      byeCountsAsWin: false,
      props: [
        prop("biggest_upset", "Biggest upset by seed", 7, "Winner's seed minus loser's seed (9 over 1 = 8). Tiebreak: bigger margin. No upsets → champion."),
        prop("worst_loss", "Worst margin of defeat", 6, "Largest losing margin in any one game. Ties split."),
        prop("cinderella", "Cinderella (best 9–12 seed)", 6, "Furthest-advancing 9–12 seed. Tiebreak: lower seed, then split."),
        prop("best_ats", "Best ATS record", 6, "Cover % vs closing line, pushes don't count. Tiebreak: most ATS wins, then split."),
      ],
    },
  },
  {
    key: "cfb_playoff24",
    label: "CFB 24-team Playoff",
    available: true,
    blurb: "24 teams. Seeds 1–8 get byes; reseeded every round, higher seed hosts until a neutral title game.",
    sport: "cfb",
    rounds: [
      { key: "r1", label: "First-round win", slots: 8, game: "First round", short: "R1" },
      { key: "r2", label: "Second-round win", slots: 8, game: "Second round", short: "R2" },
      { key: "qf", label: "Quarterfinal win", slots: 4, game: "Quarterfinal", short: "QF" },
      { key: "sf", label: "Semifinal win", slots: 2, game: "Semifinal", short: "SF" },
      { key: "title", label: "National title", slots: 1, game: "Title game", short: "Title" },
    ],
    fieldSize: 24,
    byeCount: 8,
    cinderellaMinSeed: 17,
    sim: { hfa: 2.5, marginSd: 15, ratingNoise: 2 },
    // Wins: 8 × 2 + 8 × 3 + 4 × 5 + 2 × 6 + 8 = 80%. Side prizes 20%. Byes not paid.
    defaultPayouts: {
      roundPct: { r1: 2, r2: 3, qf: 5, sf: 6, title: 8 },
      byeCountsAsWin: false,
      props: [
        prop("biggest_upset", "Biggest upset by seed", 6, "Winner's seed minus loser's seed. Tiebreak: bigger margin. No upsets → champion."),
        prop("worst_loss", "Worst margin of defeat", 4, "Largest losing margin in any one game. Ties split."),
        prop("cinderella", "Cinderella (best 17–24 seed)", 5, "Furthest-advancing 17–24 seed. Tiebreak: lower seed, then split."),
        prop("best_ats", "Best ATS record", 5, "Cover % vs closing line, pushes don't count. Tiebreak: most ATS wins, then split."),
      ],
    },
  },
  { ...NONE, key: "nfl_season", label: "NFL Regular Season", blurb: "Wins, divisions, seeds, playoffs." },
  { ...NONE, key: "cfb_season", label: "CFB Regular Season", blurb: "Wins, conference titles, playoff berths." },
];

export function formatDef(key: FormatKey): FormatDef {
  return FORMATS.find((f) => f.key === key) ?? FORMATS[0];
}

/** Payout slots for one round, accounting for byes that count as a first-round win. */
export function roundSlots(format: FormatKey, roundKey: string, payouts: PayoutRules, field: FieldTeam[]): number {
  const r = formatDef(format).rounds.find((x) => x.key === roundKey);
  if (!r) return 0;
  const isFirst = formatDef(format).rounds[0]?.key === roundKey;
  if (isFirst && payouts.byeCountsAsWin) {
    const byes = field.filter((t) => t.bye).length || formatDef(format).byeCount * (format === "nfl_playoffs" ? 2 : 1);
    return r.slots + byes;
  }
  return r.slots;
}

/** Sum of every payout % across a full tournament — should be 100. */
export function payoutTotalPct(format: FormatKey, payouts: PayoutRules, field: FieldTeam[]): number {
  let total = 0;
  for (const r of formatDef(format).rounds) total += (payouts.roundPct[r.key] ?? 0) * roundSlots(format, r.key, payouts, field);
  for (const p of payouts.props) total += p.pct;
  return Math.round(total * 1000) / 1000;
}

// ---- NFL playoff field helpers -------------------------------------------

export interface NflSeedSlot {
  conf: "AFC" | "NFC";
  seed: number;
  abbr: string | null;
}

export function emptyNflSeedSlots(): NflSeedSlot[] {
  const out: NflSeedSlot[] = [];
  for (const conf of ["AFC", "NFC"] as const) for (let seed = 1; seed <= 7; seed++) out.push({ conf, seed, abbr: null });
  return out;
}

export function nflFieldFromSlots(slots: NflSeedSlot[]): FieldTeam[] {
  return slots
    .filter((s) => s.abbr)
    .map((s) => {
      const t = NFL_TEAMS.find((x) => x.abbr === s.abbr)!;
      return { id: t.abbr, name: t.name, abbr: t.abbr, group: s.conf, seed: s.seed, bye: s.seed === 1, logo: nflLogoUrl(t.abbr) };
    });
}

/** The built-in prize a side prize is, from its kind or (older docs) its label. */
export function propKind(p: PropEvent): PropKind {
  if (p.kind) return p.kind;
  const l = p.label.toLowerCase();
  if (l.includes("upset")) return "biggest_upset";
  if (l.includes("cinderella")) return "cinderella";
  if (l.includes("ats") || l.includes("spread")) return "best_ats";
  if (l.includes("margin of defeat") || l.includes("worst loss") || l.includes("biggest loss") || l.includes("blowout")) return "worst_loss";
  return "custom";
}
