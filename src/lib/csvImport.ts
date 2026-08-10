// Parses the CFBD exporter CSVs (season.csv, advanced.csv) directly in
// the browser — built for a one-time historical backtest import that
// never touches the live CFBD API, so there's no rate-limit or Vercel
// timeout risk. Column names here are copied verbatim from the actual
// uploaded files, not guessed.

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] ?? ""));
    return row;
  });
}

function toSeconds(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  if (!v.includes(":")) return Number(v) || null;
  const [m, s] = v.split(":").map(Number);
  return m * 60 + s;
}

// season.csv is long-format: {Season, Team, Conference, StatName,
// StatValue}, one row per stat. Only these stat names feed the engine.
const WANTED_STATS: Record<string, string> = {
  rushingAttempts: "rushing_attempts",
  rushingYards: "rushing_yards",
  rushingAttemptsOpponent: "rushing_attempts_opponent",
  rushingYardsOpponent: "rushing_yards_opponent",
  passAttempts: "pass_attempts",
  netPassingYards: "net_passing_yards",
  passAttemptsOpponent: "pass_attempts_opponent",
  netPassingYardsOpponent: "net_passing_yards_opponent",
  totalYards: "total_yards",
  totalYardsOpponent: "total_yards_opponent",
  games: "games",
  possessionTime: "possession_time",
  possessionTimeOpponent: "possession_time_opponent",
};

export function parseSeasonCsv(text: string): Record<string, any> {
  const rows = parseCsv(text);
  const byTeam: Record<string, any> = {};
  for (const row of rows) {
    const col = WANTED_STATS[row.StatName];
    if (!col) continue;
    const team = row.Team;
    const entry = byTeam[team] ?? { season: Number(row.Season), team, conference: row.Conference || null };
    entry[col] = col === "possession_time" || col === "possession_time_opponent" ? toSeconds(row.StatValue) : Number(row.StatValue);
    byTeam[team] = entry;
  }
  return byTeam;
}

// advanced.csv is wide-format, one row per team — only Plays/Drives feed
// the current engine (PPA/success-rate/etc. columns exist but aren't
// used yet). Column names copied exactly from the real file's header.
export function mergeAdvancedCsv(byTeam: Record<string, any>, text: string): Record<string, any> {
  const rows = parseCsv(text);
  for (const row of rows) {
    const team = row.Team;
    const entry = byTeam[team] ?? { season: Number(row.Season), team, conference: row.Conference || null };
    entry.offense_plays = Number(row["Offense Plays"]) || null;
    entry.offense_drives = Number(row["Offense Drives"]) || null;
    entry.defense_plays = Number(row["Defense Plays"]) || null;
    entry.defense_drives = Number(row["Defense Drives"]) || null;
    byTeam[team] = entry;
  }
  return byTeam;
}

export function mergedRowsToArray(byTeam: Record<string, any>): any[] {
  return Object.values(byTeam);
}
