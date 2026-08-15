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

// advanced.csv is wide-format, one row per team. "Offense Plays" /
// "Offense Drives" / etc. are copied exactly from a real file's header —
// the PPA/success-rate/explosiveness/etc. column names below follow that
// same "Offense <Field Name>" / "Defense <Field Name>" pattern but
// haven't been checked against an actual advanced.csv export yet. numCol()
// tries a couple of plausible spellings per field (e.g. "Ppa" vs "PPA")
// so a near-miss still parses instead of silently landing null — but the
// exact headers should still get verified against the next real upload.
function numCol(row: Record<string, string>, ...candidates: string[]): number | null {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== "") {
      const n = Number(row[key]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function mergeAdvancedCsv(byTeam: Record<string, any>, text: string): Record<string, any> {
  const rows = parseCsv(text);
  for (const row of rows) {
    const team = row.Team;
    const entry = byTeam[team] ?? { season: Number(row.Season), team, conference: row.Conference || null };

    entry.offense_plays = Number(row["Offense Plays"]) || null;
    entry.offense_drives = Number(row["Offense Drives"]) || null;
    entry.defense_plays = Number(row["Defense Plays"]) || null;
    entry.defense_drives = Number(row["Defense Drives"]) || null;

    entry.off_ppa = numCol(row, "Offense Ppa", "Offense PPA");
    entry.off_success_rate = numCol(row, "Offense Success Rate");
    entry.off_explosiveness = numCol(row, "Offense Explosiveness");
    entry.off_points_per_opportunity = numCol(row, "Offense Points Per Opportunity");
    entry.off_power_success = numCol(row, "Offense Power Success");
    entry.off_stuff_rate = numCol(row, "Offense Stuff Rate");
    entry.off_line_yards = numCol(row, "Offense Line Yards");
    entry.off_standard_downs_ppa = numCol(row, "Offense Standard Downs Ppa", "Offense Standard Downs PPA");
    entry.off_standard_downs_success_rate = numCol(row, "Offense Standard Downs Success Rate");
    entry.off_standard_downs_explosiveness = numCol(row, "Offense Standard Downs Explosiveness");
    entry.off_passing_downs_ppa = numCol(row, "Offense Passing Downs Ppa", "Offense Passing Downs PPA");
    entry.off_passing_downs_success_rate = numCol(row, "Offense Passing Downs Success Rate");
    entry.off_passing_downs_explosiveness = numCol(row, "Offense Passing Downs Explosiveness");
    entry.off_rushing_plays_ppa = numCol(row, "Offense Rushing Plays Ppa", "Offense Rushing Plays PPA");
    entry.off_rushing_plays_success_rate = numCol(row, "Offense Rushing Plays Success Rate");
    entry.off_rushing_plays_explosiveness = numCol(row, "Offense Rushing Plays Explosiveness");
    entry.off_passing_plays_ppa = numCol(row, "Offense Passing Plays Ppa", "Offense Passing Plays PPA");
    entry.off_passing_plays_success_rate = numCol(row, "Offense Passing Plays Success Rate");
    entry.off_passing_plays_explosiveness = numCol(row, "Offense Passing Plays Explosiveness");
    entry.off_field_position_avg_start = numCol(row, "Offense Field Position Average Start");
    entry.off_field_position_avg_predicted_points = numCol(row, "Offense Field Position Average Predicted Points");
    entry.off_havoc_total = numCol(row, "Offense Havoc Total");
    entry.off_havoc_front_seven = numCol(row, "Offense Havoc Front Seven");
    entry.off_havoc_db = numCol(row, "Offense Havoc Db", "Offense Havoc DB");

    entry.def_ppa = numCol(row, "Defense Ppa", "Defense PPA");
    entry.def_success_rate = numCol(row, "Defense Success Rate");
    entry.def_explosiveness = numCol(row, "Defense Explosiveness");
    entry.def_points_per_opportunity = numCol(row, "Defense Points Per Opportunity");
    entry.def_power_success = numCol(row, "Defense Power Success");
    entry.def_stuff_rate = numCol(row, "Defense Stuff Rate");
    entry.def_line_yards = numCol(row, "Defense Line Yards");
    entry.def_standard_downs_ppa = numCol(row, "Defense Standard Downs Ppa", "Defense Standard Downs PPA");
    entry.def_standard_downs_success_rate = numCol(row, "Defense Standard Downs Success Rate");
    entry.def_standard_downs_explosiveness = numCol(row, "Defense Standard Downs Explosiveness");
    entry.def_passing_downs_ppa = numCol(row, "Defense Passing Downs Ppa", "Defense Passing Downs PPA");
    entry.def_passing_downs_success_rate = numCol(row, "Defense Passing Downs Success Rate");
    entry.def_passing_downs_explosiveness = numCol(row, "Defense Passing Downs Explosiveness");
    entry.def_rushing_plays_ppa = numCol(row, "Defense Rushing Plays Ppa", "Defense Rushing Plays PPA");
    entry.def_rushing_plays_success_rate = numCol(row, "Defense Rushing Plays Success Rate");
    entry.def_rushing_plays_explosiveness = numCol(row, "Defense Rushing Plays Explosiveness");
    entry.def_passing_plays_ppa = numCol(row, "Defense Passing Plays Ppa", "Defense Passing Plays PPA");
    entry.def_passing_plays_success_rate = numCol(row, "Defense Passing Plays Success Rate");
    entry.def_passing_plays_explosiveness = numCol(row, "Defense Passing Plays Explosiveness");
    entry.def_field_position_avg_start = numCol(row, "Defense Field Position Average Start");
    entry.def_field_position_avg_predicted_points = numCol(row, "Defense Field Position Average Predicted Points");
    entry.def_havoc_total = numCol(row, "Defense Havoc Total");
    entry.def_havoc_front_seven = numCol(row, "Defense Havoc Front Seven");
    entry.def_havoc_db = numCol(row, "Defense Havoc Db", "Defense Havoc DB");

    byTeam[team] = entry;
  }
  return byTeam;
}

export function mergedRowsToArray(byTeam: Record<string, any>): any[] {
  return Object.values(byTeam);
}
