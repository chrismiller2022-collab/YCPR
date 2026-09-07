import { matchSchoolMascotName, matchTeamName } from "../teamNameMatch";
import { fetchGamesWithLines } from "./gamesLines";

// CFBD's own Pick'em Workbench shows a per-game history table (Season,
// Week, Home Team, Home Score, Away Team, Away Score, Spread,
// Prediction, Actual) once a week's games have closed — at that point
// they've already dropped out of GET /api/picks (which only lists
// currently-open games), so cfbd-sync.ts's live sync can never retroactively
// capture them. This importer is the backfill path: paste that table
// (tab- or multi-space-separated, header row optional) and it resolves
// each row's game against our own `games` table, pulling "Prediction"
// straight through as predicted_margin — CFBD's own convention there is
// already the same as ours (negative = home favored), confirmed against
// a real row (Rutgers/Massachusetts: Prediction -29.92, home heavily
// favored, matches).
export const CFBD_HISTORY_PASTE_EXAMPLE =
  "Season\tWeek\tHome Team\tHome Score\tAway Team\tAway Score\tSpread\tPrediction\tActual\n" +
  "2026\t1\tRutgers\t21\tMassachusetts\t37\t-29\t-29.92\t16";

export interface CfbdHistoryImportError {
  line: number;
  raw: string;
  reason: string;
}

export interface CfbdHistoryImportResult {
  resolved: { game_id: string; predicted_margin: number }[];
  errors: CfbdHistoryImportError[];
}

function splitRow(line: string): string[] {
  const tabbed = line.split("\t").map((s) => s.trim());
  if (tabbed.length >= 9) return tabbed;
  return line.split(/\s{2,}/).map((s) => s.trim());
}

export async function parseCfbdHistoryPaste(text: string): Promise<CfbdHistoryImportResult> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const resolved: { game_id: string; predicted_margin: number }[] = [];
  const errors: CfbdHistoryImportError[] = [];
  if (lines.length === 0) return { resolved, errors };

  // Skip a header row — recognized by its first field not being a
  // 4-digit season number.
  const dataLines = /^\d{4}$/.test(splitRow(lines[0])[0] ?? "") ? lines : lines.slice(1);

  const seasonsNeeded = new Set<number>();
  const parsed = dataLines.map((line) => {
    const cols = splitRow(line);
    const season = parseInt(cols[0] ?? "", 10);
    if (!Number.isNaN(season)) seasonsNeeded.add(season);
    return cols;
  });

  const gamesBySeason = new Map<number, Awaited<ReturnType<typeof fetchGamesWithLines>>>();
  await Promise.all(
    Array.from(seasonsNeeded).map(async (season) => {
      gamesBySeason.set(season, await fetchGamesWithLines(season));
    })
  );

  parsed.forEach((cols, i) => {
    const lineNum = i + 1;
    const raw = dataLines[i];
    if (cols.length < 9) {
      errors.push({ line: lineNum, raw, reason: `Expected 9 columns, got ${cols.length}` });
      return;
    }
    const [seasonRaw, weekRaw, homeRaw, , awayRaw, , , predictionRaw] = cols;
    const season = parseInt(seasonRaw, 10);
    const week = parseInt(weekRaw, 10);
    const predicted_margin = parseFloat(predictionRaw);
    if (Number.isNaN(season) || Number.isNaN(week)) {
      errors.push({ line: lineNum, raw, reason: `Couldn't read season/week from "${seasonRaw}"/"${weekRaw}"` });
      return;
    }
    if (Number.isNaN(predicted_margin)) {
      errors.push({ line: lineNum, raw, reason: `Couldn't read Prediction "${predictionRaw}"` });
      return;
    }
    const homeCanonical = matchSchoolMascotName(homeRaw) ?? matchTeamName(homeRaw).matched;
    const awayCanonical = matchSchoolMascotName(awayRaw) ?? matchTeamName(awayRaw).matched;
    if (!homeCanonical || !awayCanonical) {
      errors.push({ line: lineNum, raw, reason: `Couldn't match team name(s): "${homeRaw}" / "${awayRaw}"` });
      return;
    }
    const games = gamesBySeason.get(season) ?? [];
    const game = games.find((g) => g.week === week && g.home_team === homeCanonical && g.away_team === awayCanonical);
    if (!game) {
      errors.push({ line: lineNum, raw, reason: `No scheduled game found for ${awayCanonical} @ ${homeCanonical} in ${season} week ${week}` });
      return;
    }
    resolved.push({ game_id: game.id, predicted_margin });
  });

  return { resolved, errors };
}
