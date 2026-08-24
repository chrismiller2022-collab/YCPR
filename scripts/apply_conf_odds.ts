// One-off data-load script: reads scripts/conf_odds.csv (Conference,Team,Odds
// — American odds to WIN the conference), matches each row onto the site's
// canonical roster via the same matchTeamName() logic the rest of the site
// uses for external data, then rewrites CONF_FUTURES in
// src/data/confFutures.ts with updated odds / impliedPct / value for every
// matched team. Run with: npx tsx scripts/apply_conf_odds.ts
import { readFileSync, writeFileSync } from "fs";
import { matchTeamName } from "../src/lib/teamNameMatch";
import { CONF_FUTURES, type ConfFuture } from "../src/data/confFutures";

function americanToImpliedPct(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function parseCsv(text: string): { conference: string; team: string; odds: number }[] {
  const lines = text.trim().split("\n").slice(1); // drop header
  return lines.map((line) => {
    const [conference, team, oddsRaw] = line.split(",");
    return { conference: conference.trim(), team: team.trim(), odds: parseInt(oddsRaw.trim(), 10) };
  });
}

const csvText = readFileSync(new URL("./conf_odds.csv", import.meta.url), "utf-8");
const csvRows = parseCsv(csvText);

const byTeam = new Map(CONF_FUTURES.map((r) => [r.team, r]));
const updated: string[] = [];
const unmatched: string[] = [];

for (const row of csvRows) {
  // "Miami Florida" / "Miami Ohio" (space-separated, full word) don't hit
  // any existing alias key (which use hyphens or the "OH" abbreviation),
  // so disambiguate these two by hand before the general matcher.
  const teamNameForMatch =
    row.team === "Miami Florida" ? "Miami" : row.team === "Miami Ohio" ? "Miami (OH)" : row.team;
  const result = matchTeamName(teamNameForMatch);
  if (!result.matched) {
    unmatched.push(`${row.team} (${row.conference})`);
    continue;
  }
  const existing = byTeam.get(result.matched);
  const impliedPct = americanToImpliedPct(row.odds);
  const nextRow: ConfFuture = existing
    ? {
        ...existing,
        odds: row.odds,
        impliedPct,
        value: existing.confWinPct != null ? Math.round((existing.confWinPct - impliedPct) * 10000) / 10000 : null,
      }
    : {
        team: result.matched,
        totalWins: 0,
        confProjWins: 0,
        confLine: null,
        dif: null,
        abs: null,
        bet: null,
        edge: null,
        confWinPct: null,
        fairPrice: null,
        impliedPct,
        odds: row.odds,
        value: null,
      };
  byTeam.set(result.matched, nextRow);
  updated.push(`${row.team} -> ${result.matched} (${result.confidence})`);
}

const nextFutures = Array.from(byTeam.values());

const fileContents = `export interface ConfFuture {
  team: string;
  totalWins: number;
  confProjWins: number;
  confLine: number | null;
  dif: number | null;
  abs: number | null;
  bet: string | null;
  edge: number | null;
  confWinPct: number | null;
  fairPrice: number | null;
  impliedPct: number | null;
  odds: number | null;
  value: number | null;
}

export const CONF_FUTURES: ConfFuture[] = ${JSON.stringify(nextFutures)};

export const CONF_FUTURES_BY_TEAM: Record<string, ConfFuture> =
  Object.fromEntries(CONF_FUTURES.map((r) => [r.team, r]));
`;

writeFileSync(new URL("../src/data/confFutures.ts", import.meta.url), fileContents);

console.log(`Matched & updated: ${updated.length}`);
console.log(`Unmatched (left untouched, need manual review):`);
for (const u of unmatched) console.log(`  - ${u}`);
