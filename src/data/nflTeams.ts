// All 32 NFL teams with conference/division, keyed by ESPN's abbreviation
// (which is also what ESPN's logo CDN uses, lowercased). Used by the
// Calcutta tool's NFL formats; NFL_RATINGS in nflDraftPoolData.ts uses
// "WAS" for Washington where ESPN uses "WSH" — nflTeamByAbbr accepts both.

export interface NflTeam {
  abbr: string;
  name: string;
  conf: "AFC" | "NFC";
  div: "East" | "North" | "South" | "West";
}

export const NFL_TEAMS: NflTeam[] = [
  { abbr: "BUF", name: "Buffalo Bills", conf: "AFC", div: "East" },
  { abbr: "MIA", name: "Miami Dolphins", conf: "AFC", div: "East" },
  { abbr: "NE", name: "New England Patriots", conf: "AFC", div: "East" },
  { abbr: "NYJ", name: "New York Jets", conf: "AFC", div: "East" },
  { abbr: "BAL", name: "Baltimore Ravens", conf: "AFC", div: "North" },
  { abbr: "CIN", name: "Cincinnati Bengals", conf: "AFC", div: "North" },
  { abbr: "CLE", name: "Cleveland Browns", conf: "AFC", div: "North" },
  { abbr: "PIT", name: "Pittsburgh Steelers", conf: "AFC", div: "North" },
  { abbr: "HOU", name: "Houston Texans", conf: "AFC", div: "South" },
  { abbr: "IND", name: "Indianapolis Colts", conf: "AFC", div: "South" },
  { abbr: "JAX", name: "Jacksonville Jaguars", conf: "AFC", div: "South" },
  { abbr: "TEN", name: "Tennessee Titans", conf: "AFC", div: "South" },
  { abbr: "DEN", name: "Denver Broncos", conf: "AFC", div: "West" },
  { abbr: "KC", name: "Kansas City Chiefs", conf: "AFC", div: "West" },
  { abbr: "LV", name: "Las Vegas Raiders", conf: "AFC", div: "West" },
  { abbr: "LAC", name: "Los Angeles Chargers", conf: "AFC", div: "West" },
  { abbr: "DAL", name: "Dallas Cowboys", conf: "NFC", div: "East" },
  { abbr: "NYG", name: "New York Giants", conf: "NFC", div: "East" },
  { abbr: "PHI", name: "Philadelphia Eagles", conf: "NFC", div: "East" },
  { abbr: "WSH", name: "Washington Commanders", conf: "NFC", div: "East" },
  { abbr: "CHI", name: "Chicago Bears", conf: "NFC", div: "North" },
  { abbr: "DET", name: "Detroit Lions", conf: "NFC", div: "North" },
  { abbr: "GB", name: "Green Bay Packers", conf: "NFC", div: "North" },
  { abbr: "MIN", name: "Minnesota Vikings", conf: "NFC", div: "North" },
  { abbr: "ATL", name: "Atlanta Falcons", conf: "NFC", div: "South" },
  { abbr: "CAR", name: "Carolina Panthers", conf: "NFC", div: "South" },
  { abbr: "NO", name: "New Orleans Saints", conf: "NFC", div: "South" },
  { abbr: "TB", name: "Tampa Bay Buccaneers", conf: "NFC", div: "South" },
  { abbr: "ARI", name: "Arizona Cardinals", conf: "NFC", div: "West" },
  { abbr: "LAR", name: "Los Angeles Rams", conf: "NFC", div: "West" },
  { abbr: "SF", name: "San Francisco 49ers", conf: "NFC", div: "West" },
  { abbr: "SEA", name: "Seattle Seahawks", conf: "NFC", div: "West" },
];

export function nflTeamByAbbr(abbr: string): NflTeam | undefined {
  const a = abbr === "WAS" ? "WSH" : abbr;
  return NFL_TEAMS.find((t) => t.abbr === a);
}

export function nflLogoUrl(abbr: string): string {
  const a = abbr === "WAS" ? "WSH" : abbr;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${a.toLowerCase()}.png`;
}
