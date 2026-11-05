import { NFL_TEAMS, nflLogoUrl } from "../../data/nflTeams";
import type { FieldTeam, FormatKey, PayoutRules, PropEvent, PropKind } from "./types";

// Format registry. Every format shares the same auction core; a format only
// decides the team field, the payout rounds, and the default payout split.
// The Desk (model side) will add a probability engine per format later.

export interface RoundDef {
  key: string;
  label: string;
  /** How many teams clear this round in a full tournament (for the 100% check). */
  slots: number;
}

export interface FormatDef {
  key: FormatKey;
  label: string;
  available: boolean;
  blurb: string;
  rounds: RoundDef[];
  defaultPayouts: PayoutRules;
}

export const NFL_PLAYOFF_ROUNDS: RoundDef[] = [
  { key: "wc", label: "Wild Card win", slots: 6 },
  { key: "div", label: "Divisional win", slots: 4 },
  { key: "conf", label: "Conference title", slots: 2 },
  { key: "sb", label: "Super Bowl win", slots: 1 },
];

export const FORMATS: FormatDef[] = [
  {
    key: "nfl_playoffs",
    label: "NFL Playoffs",
    available: true,
    blurb: "14 teams (7 AFC, 7 NFC). #1 seeds get a bye. Paid per win, plus side prizes that keep the low seeds live.",
    rounds: NFL_PLAYOFF_ROUNDS,
    // Wins: 6 × 3 + 4 × 5 + 2 × 10 + 17 = 75%. Side prizes: 25%. The bye is
    // not paid as a win — it's already worth a lot (a free pass to the
    // Divisional round). Picked from a 100k-run playoff sim (docs/calcutta.md):
    // a #1 seed is worth ~2x a #7 seed here, vs ~8x with a 40% Super Bowl.
    defaultPayouts: {
      roundPct: { wc: 3, div: 5, conf: 10, sb: 17 },
      byeCountsAsWin: false,
      props: [
        { id: "biggest_upset", kind: "biggest_upset", label: "Biggest upset by seed", pct: 7, teamIds: [], rule: "Winner's seed minus loser's seed (7 over 2 = 5). Tiebreak: bigger margin. No upsets → Super Bowl champ." },
        { id: "worst_loss", kind: "worst_loss", label: "Worst margin of defeat", pct: 6, teamIds: [], rule: "Largest losing margin in any one game. Ties split." },
        { id: "cinderella", kind: "cinderella", label: "Cinderella (best 5–7 seed)", pct: 6, teamIds: [], rule: "Furthest-advancing 5, 6 or 7 seed. Tiebreak: lower seed (7 beats 5), then split." },
        { id: "best_ats", kind: "best_ats", label: "Best ATS record", pct: 6, teamIds: [], rule: "Cover % vs closing line, pushes don't count. Tiebreak: most ATS wins, then split." },
      ],
    },
  },
  { key: "march_madness", label: "March Madness", available: false, blurb: "68-team bracket.", rounds: [], defaultPayouts: { roundPct: {}, byeCountsAsWin: false, props: [] } },
  { key: "cfb_playoff24", label: "CFB 24-team Playoff", available: false, blurb: "Next season's expanded CFP.", rounds: [], defaultPayouts: { roundPct: {}, byeCountsAsWin: true, props: [] } },
  { key: "nfl_season", label: "NFL Regular Season", available: false, blurb: "Wins, divisions, seeds, playoffs.", rounds: [], defaultPayouts: { roundPct: {}, byeCountsAsWin: false, props: [] } },
  { key: "cfb_season", label: "CFB Regular Season", available: false, blurb: "Wins, conference titles, playoff berths.", rounds: [], defaultPayouts: { roundPct: {}, byeCountsAsWin: false, props: [] } },
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
    const byes = field.filter((t) => t.bye).length || (format === "nfl_playoffs" ? 2 : 0);
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
