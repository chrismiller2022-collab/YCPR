import { parseCsv } from "../csvImport";
import { matchSchoolMascotName, matchTeamName } from "../teamNameMatch";
import { fetchGamesWithLines, type GameWithLines } from "./gamesLines";

// Expected columns (case-insensitive, order doesn't matter): away_team,
// home_team, westgate_line. westgate_line is away-perspective, same
// convention as the rest of the site: negative = away favored. Convert
// the contest's own card (favorite has no number, underdog gets "+X")
// by giving the away team's number a "+" if they're the underdog or a
// "-" of the same size if they're favored.
export const WESTGATE_LINES_CSV_TEMPLATE = "away_team,home_team,westgate_line\nUmass,Rutgers,29.5\n";

export interface WestgateLineImportError {
  line: number;
  raw: Record<string, string>;
  reason: string;
}

export interface WestgateLineImportRow {
  game_id: string;
  away_team: string;
  home_team: string;
  westgate_line: number;
}

export interface WestgateLinesImportResult {
  resolved: WestgateLineImportRow[];
  errors: WestgateLineImportError[];
}

export async function parseWestgateLinesCsv(season: number, week: number, text: string): Promise<WestgateLinesImportResult> {
  const rows = parseCsv(text);
  const resolved: WestgateLineImportRow[] = [];
  const errors: WestgateLineImportError[] = [];

  const games = await fetchGamesWithLines(season, week);

  rows.forEach((row, i) => {
    const lineNum = i + 2;
    const get = (key: string) => (row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? "").trim();

    const awayRaw = get("away_team");
    const homeRaw = get("home_team");
    const awayCanonical = matchSchoolMascotName(awayRaw) ?? matchTeamName(awayRaw).matched;
    const homeCanonical = matchSchoolMascotName(homeRaw) ?? matchTeamName(homeRaw).matched;
    if (!awayCanonical || !homeCanonical) {
      errors.push({ line: lineNum, raw: row, reason: `Couldn't match team name(s): "${awayRaw}" / "${homeRaw}"` });
      return;
    }

    const game = games.find((g: GameWithLines) => g.away_team === awayCanonical && g.home_team === homeCanonical);
    if (!game) {
      errors.push({ line: lineNum, raw: row, reason: `No scheduled game found for ${awayCanonical} @ ${homeCanonical} in week ${week}` });
      return;
    }

    const lineRaw = get("westgate_line");
    const westgateLine = parseFloat(lineRaw);
    if (Number.isNaN(westgateLine)) {
      errors.push({ line: lineNum, raw: row, reason: `Couldn't read westgate_line "${lineRaw}"` });
      return;
    }

    resolved.push({ game_id: game.id, away_team: game.away_team, home_team: game.home_team, westgate_line: westgateLine });
  });

  return { resolved, errors };
}

async function westgateLinesSave(season: number, week: number, rows: WestgateLineImportRow[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password,
      pool: "westgate",
      action: "importLines",
      season,
      week,
      rows: rows.map((r) => ({ game_id: r.game_id, westgate_line: r.westgate_line })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Import failed");
  return data;
}

export async function importWestgateLines(season: number, week: number, rows: WestgateLineImportRow[]): Promise<{ imported: number }> {
  const data = await westgateLinesSave(season, week, rows);
  return { imported: data.saved ?? rows.length };
}
