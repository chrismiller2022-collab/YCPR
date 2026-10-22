import { matchTeamName } from "./teamNameMatch";

// Parses the text copied from a pool's pick page (CBS Pick'em, ESPN
// Spreads / Moneylines, the Reddit confidence sheet) into games, then
// matches each game to this week's schedule. In every pool the first team
// listed is the away team.

export type PasteFormat = "cbs" | "espnspread" | "espnml" | "reddit";

export interface PastedTeam {
  name: string;
  pct: number | null; // public pick %
  spread: number | null; // that team's line as the pool shows it
  ml: number | null;
}

export interface PastedGame {
  away: PastedTeam;
  home: PastedTeam;
}

export interface ParsedPaste {
  games: PastedGame[];
  /** Team-name pairs the pool marks as tiebreaker games. */
  tiebreakers: [string, string][];
}

const RECORD = /^\d{1,2}-\d{1,2}$/;
const PCT = /^(\d{1,3})%$/;
const SPREAD = /^[+-]\d+(\.\d+)?$|^(PK|EVEN)$/i;
const DAY = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/i;
const PICKED = /^(\d{1,3})% Picked$/i;

const clean = (s: string) => s.replace(/ /g, " ").trim();
const lines = (text: string) => text.split(/\r?\n/).map(clean).filter((l) => l.length > 0);
const spreadNum = (s: string) => (/^(PK|EVEN)$/i.test(s) ? 0 : parseFloat(s));
const stripRank = (s: string) => s.replace(/^#\d+\s*/, "").trim();

function team(name: string): PastedTeam {
  return { name, pct: null, spread: null, ml: null };
}

function pairUp(teams: PastedTeam[]): PastedGame[] {
  const games: PastedGame[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) games.push({ away: teams[i], home: teams[i + 1] });
  return games;
}

/** CBS: "Sat @ 12:00 PM • FS1", then per team: record, name, optional poll rank, pick %, spread. Tiebreaker block at the end. */
function parseCbs(text: string): ParsedPaste {
  const ls = lines(text);
  // Game cards start "Sat @ 12:00 PM"; the tiebreaker block starts "Sat 7:30 PM" (no @).
  const tbStart = ls.findIndex((l) => DAY.test(l) && !l.includes("@"));
  const body = tbStart >= 0 ? ls.slice(0, tbStart) : ls;
  const teams: PastedTeam[] = [];
  for (let i = 0; i < body.length; i++) {
    if (!RECORD.test(body[i]) || i + 1 >= body.length) continue;
    const t = team(body[i + 1]);
    for (let j = i + 2; j < body.length && !RECORD.test(body[j]) && !DAY.test(body[j]); j++) {
      const m = PCT.exec(body[j]);
      if (m) t.pct = Number(m[1]);
      else if (SPREAD.test(body[j])) t.spread = spreadNum(body[j]);
    }
    teams.push(t);
  }
  const tiebreakers: [string, string][] = [];
  if (tbStart >= 0) {
    const tb = ls.slice(tbStart);
    for (let i = 0; i < tb.length; i++) {
      // "Sat 7:30 PM" then the two team abbreviations.
      if (DAY.test(tb[i]) && i + 2 < tb.length) tiebreakers.push([tb[i + 1], tb[i + 2]]);
    }
  }
  return { games: pairUp(teams), tiebreakers };
}

/** ESPN Spreads / Moneylines: per team "name, [spread], record [(ml)], N% Picked"; tiebreaker question at the end. */
function parseEspn(text: string): ParsedPaste {
  const ls = lines(text);
  const teams: PastedTeam[] = [];
  for (let i = 0; i < ls.length; i++) {
    const m = PICKED.exec(ls[i]);
    if (!m) continue;
    let k = i - 1;
    let ml: number | null = null;
    const rec = /^(\d{1,2}-\d{1,2})(?:\s*\(([+-]\d+)\))?$/.exec(ls[k] ?? "");
    if (rec) {
      if (rec[2]) ml = parseInt(rec[2], 10);
      k--;
    }
    let spread: number | null = null;
    if (k >= 0 && SPREAD.test(ls[k])) {
      spread = spreadNum(ls[k]);
      k--;
    }
    if (k < 0) continue;
    teams.push({ name: stripRank(ls[k]), pct: Number(m[1]), spread, ml });
  }
  const tiebreakers: [string, string][] = [];
  const q = /scored in (.+?) v\.? (.+?)\?/i.exec(text);
  if (q) tiebreakers.push([q[1].trim(), q[2].trim()]);
  return { games: pairUp(teams), tiebreakers };
}

/** Reddit sheet: header, the 10…1 point slots, then team names in away/home pairs. */
function parseReddit(text: string): ParsedPaste {
  const names = lines(text).filter((l) => !/^\d+$/.test(l) && !/^Pts\b/i.test(l) && !/^Away\s*-\s*Home$/i.test(l));
  return { games: pairUp(names.map(team)), tiebreakers: [] };
}

export function parsePoolPaste(format: PasteFormat, text: string): ParsedPaste {
  if (format === "cbs") return parseCbs(text);
  if (format === "reddit") return parseReddit(text);
  return parseEspn(text);
}

// --- Matching to this week's games -----------------------------------

export interface WeekGameLite {
  id: string;
  away_team: string;
  home_team: string;
}

export interface MatchedPasteGame {
  pasted: PastedGame;
  game: WeekGameLite | null;
  /** True when the pool lists the teams the other way round from the schedule. */
  swapped: boolean;
  isKey: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, (m) => m.replace(/[()]/g, ""))
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\bst\b/g, "state")
    .replace(/\s+/g, " ")
    .trim();

function canonical(name: string): string {
  return matchTeamName(name).matched ?? name;
}

function sameTeam(pasted: string, scheduled: string): boolean {
  if (canonical(pasted) === scheduled) return true;
  const a = norm(pasted);
  const b = norm(scheduled);
  return a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));
}

/** Abbreviation like "WISC" read as letters appearing in order in the name. */
function abbrevFits(abbr: string, name: string): boolean {
  const a = abbr.toLowerCase().replace(/[^a-z]/g, "");
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  if (!a) return false;
  if (n.startsWith(a)) return true;
  let j = 0;
  for (const ch of n) if (ch === a[j]) j++;
  return j === a.length && n[0] === a[0];
}

export function matchPasteToWeek(parsed: ParsedPaste, weekGames: WeekGameLite[]): MatchedPasteGame[] {
  const used = new Set<string>();
  const out: MatchedPasteGame[] = parsed.games.map((pg) => {
    for (const g of weekGames) {
      if (used.has(g.id)) continue;
      if (sameTeam(pg.away.name, g.away_team) && sameTeam(pg.home.name, g.home_team)) {
        used.add(g.id);
        return { pasted: pg, game: g, swapped: false, isKey: false };
      }
      if (sameTeam(pg.away.name, g.home_team) && sameTeam(pg.home.name, g.away_team)) {
        used.add(g.id);
        return { pasted: pg, game: g, swapped: true, isKey: false };
      }
    }
    // One side matching is enough when the other name is unusual.
    for (const g of weekGames) {
      if (used.has(g.id)) continue;
      const hit =
        sameTeam(pg.away.name, g.away_team) || sameTeam(pg.home.name, g.home_team)
          ? false
          : sameTeam(pg.away.name, g.home_team) || sameTeam(pg.home.name, g.away_team)
            ? true
            : null;
      if (hit != null) {
        used.add(g.id);
        return { pasted: pg, game: g, swapped: hit, isKey: false };
      }
    }
    return { pasted: pg, game: null, swapped: false, isKey: false };
  });
  for (const [a, b] of parsed.tiebreakers) {
    const fits = (x: string, t: string) => sameTeam(x, t) || abbrevFits(x, t);
    const m = out.find((o) => {
      const names = [o.pasted.away.name, o.pasted.home.name];
      return (fits(a, names[0]) && fits(b, names[1])) || (fits(a, names[1]) && fits(b, names[0]));
    });
    if (m) m.isKey = true;
  }
  return out;
}

/** Payload row for the applyPaste save action, in the schedule's away/home orientation. */
export function toPasteRow(m: MatchedPasteGame, order: number) {
  const away = m.swapped ? m.pasted.home : m.pasted.away;
  const home = m.swapped ? m.pasted.away : m.pasted.home;
  return {
    gameId: m.game!.id,
    order,
    isKey: m.isKey,
    publicAwayPct: away.pct,
    publicHomePct: home.pct,
    line: away.spread ?? (home.spread != null ? -home.spread : null),
    awayMl: away.ml,
    homeMl: home.ml,
  };
}
