// AUTO-TRANSCRIBED from Chris's Aug 2026 draft-pool data dump (schedule grid +
// Week 16 2025 composite power ratings table, screenshotted from
// twitter.com/SamHoppen). Hardcoded on purpose — Chris only needs to update this
// once a year (new preseason ratings), and will just ask for the numbers to be
// swapped in directly rather than building an admin editor for it.

export interface NflTeamRatings {
  team: string;
  name: string;
  composite: number;
  fpi: number;
  nfelo: number;
  inpredictable: number;
  unexpectedPoints: number;
  ftnDvoa: number;
  pff: number;
  poolGenius: number;
}

export const NFL_RATINGS: NflTeamRatings[] = [
  { team: "LAR", name: "Los Angeles Rams", composite: 8.4, fpi: 7.2, nfelo: 7.7, inpredictable: 7.4, unexpectedPoints: 8.3, ftnDvoa: 11.9, pff: 7.9, poolGenius: 8.3 },
  { team: "SEA", name: "Seattle Seahawks", composite: 6.4, fpi: 4.6, nfelo: 6.6, inpredictable: 5.1, unexpectedPoints: 5.0, ftnDvoa: 11.3, pff: 5.9, poolGenius: 6.5 },
  { team: "DET", name: "Detroit Lions", composite: 5.3, fpi: 4.9, nfelo: 4.8, inpredictable: 4.5, unexpectedPoints: 4.9, ftnDvoa: 7.9, pff: 4.7, poolGenius: 4.8 },
  { team: "GB", name: "Green Bay Packers", composite: 4.6, fpi: 4.8, nfelo: 4.4, inpredictable: 4.4, unexpectedPoints: 4.8, ftnDvoa: 3.5, pff: 6.0, poolGenius: 3.3 },
  { team: "BUF", name: "Buffalo Bills", composite: 4.5, fpi: 3.4, nfelo: 4.7, inpredictable: 5.3, unexpectedPoints: 5.2, ftnDvoa: 2.7, pff: 5.9, poolGenius: 5.4 },
  { team: "HOU", name: "Houston Texans", composite: 4.0, fpi: 3.8, nfelo: 2.9, inpredictable: 3.8, unexpectedPoints: 2.5, ftnDvoa: 4.9, pff: 5.8, poolGenius: 4.5 },
  { team: "PHI", name: "Philadelphia Eagles", composite: 3.9, fpi: 4.4, nfelo: 4.3, inpredictable: 4.2, unexpectedPoints: 4.4, ftnDvoa: 2.6, pff: 3.2, poolGenius: 4.5 },
  { team: "DEN", name: "Denver Broncos", composite: 3.8, fpi: 3.0, nfelo: 2.5, inpredictable: 2.9, unexpectedPoints: 3.9, ftnDvoa: 5.1, pff: 5.2, poolGenius: 3.2 },
  { team: "BAL", name: "Baltimore Ravens", composite: 2.8, fpi: 3.4, nfelo: 2.2, inpredictable: 3.6, unexpectedPoints: 3.0, ftnDvoa: 0.7, pff: 3.8, poolGenius: 3.0 },
  { team: "SF", name: "San Francisco 49ers", composite: 2.8, fpi: 3.2, nfelo: 2.5, inpredictable: 2.3, unexpectedPoints: 3.1, ftnDvoa: 2.4, pff: 3.2, poolGenius: 3.1 },
  { team: "JAX", name: "Jacksonville Jaguars", composite: 2.4, fpi: 1.7, nfelo: 1.5, inpredictable: 1.6, unexpectedPoints: 3.3, ftnDvoa: 4.1, pff: 2.2, poolGenius: 2.3 },
  { team: "NE", name: "New England Patriots", composite: 1.9, fpi: 0.9, nfelo: 1.8, inpredictable: 1.7, unexpectedPoints: 4.1, ftnDvoa: 1.1, pff: 1.6, poolGenius: 2.0 },
  { team: "LAC", name: "Los Angeles Chargers", composite: 1.2, fpi: 1.7, nfelo: 0.3, inpredictable: 0.9, unexpectedPoints: 0.8, ftnDvoa: 0.7, pff: 3.1, poolGenius: 1.0 },
  { team: "CHI", name: "Chicago Bears", composite: 1.2, fpi: 0.1, nfelo: 0.6, inpredictable: 0.6, unexpectedPoints: 2.4, ftnDvoa: 1.7, pff: 1.8, poolGenius: 0.5 },
  { team: "PIT", name: "Pittsburgh Steelers", composite: 0.3, fpi: -0.4, nfelo: 0.1, inpredictable: -0.8, unexpectedPoints: 0.4, ftnDvoa: 1.4, pff: 1.1, poolGenius: -0.1 },
  { team: "DAL", name: "Dallas Cowboys", composite: -0.1, fpi: -0.1, nfelo: -0.5, inpredictable: 0.5, unexpectedPoints: 0.8, ftnDvoa: -0.8, pff: -0.3, poolGenius: 0.7 },
  { team: "TB", name: "Tampa Bay Buccaneers", composite: -1.0, fpi: -0.9, nfelo: -2.5, inpredictable: 0.4, unexpectedPoints: -0.3, ftnDvoa: -1.6, pff: -0.9, poolGenius: 0.0 },
  { team: "CIN", name: "Cincinnati Bengals", composite: -1.3, fpi: 0.3, nfelo: -2.4, inpredictable: -1.0, unexpectedPoints: -0.4, ftnDvoa: -3.4, pff: -0.9, poolGenius: -0.8 },
  { team: "IND", name: "Indianapolis Colts", composite: -1.5, fpi: -2.2, nfelo: 1.9, inpredictable: -5.3, unexpectedPoints: -2.1, ftnDvoa: -0.7, pff: -0.5, poolGenius: -4.5 },
  { team: "MIN", name: "Minnesota Vikings", composite: -1.5, fpi: -2.4, nfelo: -2.4, inpredictable: -0.7, unexpectedPoints: -2.3, ftnDvoa: -1.2, pff: 0.1, poolGenius: -0.6 },
  { team: "KC", name: "Kansas City Chiefs", composite: -1.8, fpi: -0.3, nfelo: -0.1, inpredictable: -3.2, unexpectedPoints: -1.4, ftnDvoa: -3.7, pff: -1.8, poolGenius: -4.0 },
  { team: "ATL", name: "Atlanta Falcons", composite: -3.0, fpi: -3.9, nfelo: -2.6, inpredictable: -3.0, unexpectedPoints: -2.8, ftnDvoa: -2.6, pff: -3.1, poolGenius: -3.2 },
  { team: "NYG", name: "New York Giants", composite: -4.0, fpi: -1.6, nfelo: -4.7, inpredictable: -4.4, unexpectedPoints: -3.5, ftnDvoa: -4.8, pff: -5.3, poolGenius: -5.1 },
  { team: "ARI", name: "Arizona Cardinals", composite: -4.0, fpi: -4.3, nfelo: -4.9, inpredictable: -5.2, unexpectedPoints: -1.5, ftnDvoa: -4.1, pff: -4.2, poolGenius: -6.3 },
  { team: "CAR", name: "Carolina Panthers", composite: -4.0, fpi: -4.3, nfelo: -4.2, inpredictable: -3.8, unexpectedPoints: -3.0, ftnDvoa: -4.1, pff: -4.6, poolGenius: -4.0 },
  { team: "WSH", name: "Washington Commanders", composite: -4.1, fpi: -3.5, nfelo: -4.2, inpredictable: -3.8, unexpectedPoints: -4.2, ftnDvoa: -4.8, pff: -4.3, poolGenius: -3.6 },
  { team: "MIA", name: "Miami Dolphins", composite: -4.5, fpi: -8.9, nfelo: -3.3, inpredictable: -4.1, unexpectedPoints: -2.5, ftnDvoa: -3.9, pff: -4.3, poolGenius: -3.8 },
  { team: "NO", name: "New Orleans Saints", composite: -5.4, fpi: -5.0, nfelo: -6.1, inpredictable: -5.9, unexpectedPoints: -3.3, ftnDvoa: -5.5, pff: -6.4, poolGenius: -6.3 },
  { team: "CLE", name: "Cleveland Browns", composite: -7.8, fpi: -11.3, nfelo: -6.6, inpredictable: -6.2, unexpectedPoints: -5.4, ftnDvoa: -10.9, pff: -6.3, poolGenius: -6.0 },
  { team: "TEN", name: "Tennessee Titans", composite: -8.4, fpi: -8.6, nfelo: -7.7, inpredictable: -8.4, unexpectedPoints: -8.0, ftnDvoa: -8.1, pff: -9.7, poolGenius: -8.4 },
  { team: "LV", name: "Las Vegas Raiders", composite: -8.5, fpi: -8.2, nfelo: -7.1, inpredictable: -8.3, unexpectedPoints: -8.8, ftnDvoa: -9.8, pff: -8.6, poolGenius: -8.3 },
  { team: "NYJ", name: "New York Jets", composite: -8.8, fpi: -8.2, nfelo: -9.7, inpredictable: -9.3, unexpectedPoints: -7.4, ftnDvoa: -8.8, pff: -9.5, poolGenius: -8.9 },
];

// Each team's 18-week schedule, 1-indexed by week. An entry is the opponent's
// abbreviation, prefixed with "@" for an away game, or "BYE".
export const NFL_SCHEDULE: Record<string, string[]> = {
  ARI: ["@LAC", "SEA", "@SF", "@NYG", "DET", "@LAR", "DEN", "@DAL", "@SEA", "LAR", "@KC", "WSH", "PHI", "BYE", "NYJ", "@NO", "LV", "SF"],
  ATL: ["@PIT", "CAR", "@GB", "@NO", "BAL", "CHI", "SF", "@TB", "CIN", "KC", "BYE", "@MIN", "DET", "@CLE", "@WSH", "TB", "NO", "@CAR"],
  BAL: ["@IND", "NO", "@DAL", "TEN", "@ATL", "@CLE", "CIN", "@BUF", "JAX", "LAC", "@CAR", "@HOU", "BYE", "TB", "@PIT", "CLE", "@CIN", "PIT"],
  BUF: ["@HOU", "DET", "LAC", "NE", "@LAR", "@LV", "BYE", "BAL", "@MIN", "@NYJ", "MIA", "KC", "@NE", "@GB", "CHI", "@DEN", "@MIA", "NYJ"],
  CAR: ["CHI", "@ATL", "@CLE", "DET", "BYE", "@PHI", "TB", "@GB", "DEN", "@NO", "BAL", "@TB", "@MIN", "NO", "CIN", "@PIT", "SEA", "ATL"],
  CHI: ["@CAR", "MIN", "PHI", "NYJ", "@GB", "@ATL", "NE", "@SEA", "TB", "BYE", "NO", "@DET", "JAX", "@MIA", "@BUF", "GB", "DET", "@MIN"],
  CIN: ["TB", "@HOU", "@PIT", "JAX", "@MIA", "BYE", "@BAL", "TEN", "@ATL", "PIT", "@WSH", "NO", "@CLE", "KC", "@CAR", "@IND", "BAL", "CLE"],
  CLE: ["@JAX", "@TB", "CAR", "PIT", "@NYJ", "BAL", "@TEN", "@PIT", "@NO", "HOU", "BYE", "LV", "CIN", "ATL", "@NYG", "@BAL", "IND", "@CIN"],
  DAL: ["@NYG", "WSH", "BAL", "@HOU", "TB", "@GB", "@PHI", "ARI", "@IND", "SF", "TEN", "PHI", "@SEA", "BYE", "@LAR", "JAX", "NYG", "@WSH"],
  DEN: ["@KC", "JAX", "LAR", "@SF", "@LAC", "SEA", "@ARI", "KC", "@CAR", "BYE", "LV", "@PIT", "MIA", "@NYJ", "@LV", "BUF", "@NE", "LAC"],
  DET: ["NO", "@BUF", "NYJ", "@CAR", "@ARI", "BYE", "GB", "MIN", "@MIA", "NE", "TB", "CHI", "@ATL", "TEN", "@MIN", "NYG", "@CHI", "@GB"],
  GB: ["@MIN", "@NYJ", "ATL", "@TB", "CHI", "DAL", "@DET", "CAR", "@NE", "MIN", "BYE", "@LAR", "@NO", "BUF", "MIA", "@CHI", "HOU", "DET"],
  HOU: ["BUF", "CIN", "@IND", "DAL", "@TEN", "@JAX", "NYG", "BYE", "@LAC", "@CLE", "IND", "BAL", "@PIT", "@WSH", "JAX", "@PHI", "@GB", "TEN"],
  IND: ["BAL", "@KC", "HOU", "@WSH", "@PIT", "TEN", "@MIN", "@JAX", "DAL", "MIA", "@HOU", "NYG", "BYE", "@PHI", "@TEN", "CIN", "@CLE", "JAX"],
  JAX: ["CLE", "@DEN", "NE", "@CIN", "PHI", "HOU", "BYE", "IND", "@BAL", "@TEN", "@NYG", "TEN", "@CHI", "PIT", "@HOU", "@DAL", "WSH", "@IND"],
  KC: ["DEN", "IND", "@MIA", "@LV", "BYE", "LAC", "@SEA", "@DEN", "NYJ", "@ATL", "ARI", "@BUF", "@LAR", "@CIN", "NE", "SF", "@LAC", "LV"],
  LV: ["MIA", "@LAC", "@NO", "KC", "@NE", "BUF", "LAR", "@NYJ", "@SF", "SEA", "@DEN", "@CLE", "BYE", "LAC", "DEN", "TEN", "@ARI", "@KC"],
  LAR: ["SF", "NYG", "@DEN", "@PHI", "BUF", "ARI", "@LV", "LAC", "@WSH", "@ARI", "BYE", "GB", "KC", "@SF", "DAL", "@SEA", "@TB", "SEA"],
  LAC: ["ARI", "LV", "@BUF", "@SEA", "DEN", "@KC", "BYE", "@LAR", "HOU", "@BAL", "NYJ", "NE", "@TB", "@LV", "SF", "@MIA", "KC", "@DEN"],
  MIA: ["@LV", "@SF", "KC", "@MIN", "CIN", "BYE", "@NYJ", "NE", "DET", "@IND", "@BUF", "NYJ", "@DEN", "CHI", "@GB", "LAC", "BUF", "@NE"],
  MIN: ["GB", "@CHI", "@TB", "MIA", "@NO", "BYE", "IND", "@DET", "BUF", "@GB", "@SF", "ATL", "CAR", "@NE", "DET", "WSH", "@NYJ", "CHI"],
  NE: ["@SEA", "PIT", "@JAX", "@BUF", "LV", "NYJ", "@CHI", "@MIA", "GB", "@DET", "BYE", "@LAC", "BUF", "MIN", "@KC", "@NYJ", "DEN", "MIA"],
  NO: ["@DET", "@BAL", "LV", "ATL", "MIN", "@NYG", "PIT", "BYE", "CLE", "CAR", "@CHI", "@CIN", "GB", "@CAR", "@TB", "ARI", "@ATL", "TB"],
  NYG: ["DAL", "@LAR", "TEN", "ARI", "@WSH", "NO", "@HOU", "BYE", "@PHI", "WSH", "JAX", "@IND", "SF", "@SEA", "CLE", "@DET", "@DAL", "PHI"],
  NYJ: ["@TEN", "GB", "@DET", "@CHI", "CLE", "@NE", "MIA", "LV", "@KC", "BUF", "@LAC", "@MIA", "BYE", "DEN", "@ARI", "NE", "MIN", "@BUF"],
  PHI: ["WSH", "@TEN", "@CHI", "LAR", "@JAX", "CAR", "DAL", "@WSH", "NYG", "BYE", "PIT", "@DAL", "@ARI", "IND", "SEA", "HOU", "@SF", "@NYG"],
  PIT: ["ATL", "@NE", "CIN", "@CLE", "IND", "@TB", "@NO", "CLE", "BYE", "@CIN", "@PHI", "DEN", "HOU", "@JAX", "BAL", "CAR", "@TEN", "@BAL"],
  SF: ["@LAR", "MIA", "ARI", "DEN", "@SEA", "WSH", "@ATL", "BYE", "LV", "@DAL", "MIN", "SEA", "@NYG", "LAR", "@LAC", "@KC", "PHI", "@ARI"],
  SEA: ["NE", "@ARI", "@WSH", "LAC", "SF", "@DEN", "KC", "CHI", "ARI", "@LV", "BYE", "@SF", "DAL", "NYG", "@PHI", "LAR", "@CAR", "@LAR"],
  TB: ["@CIN", "CLE", "MIN", "GB", "@DAL", "PIT", "@CAR", "ATL", "@CHI", "BYE", "@DET", "CAR", "LAC", "@BAL", "NO", "@ATL", "LAR", "@NO"],
  TEN: ["NYJ", "PHI", "@NYG", "@BAL", "HOU", "@IND", "CLE", "@CIN", "BYE", "JAX", "@DAL", "@JAX", "WSH", "@DET", "IND", "@LV", "PIT", "@HOU"],
  WSH: ["@PHI", "@DAL", "SEA", "IND", "NYG", "@SF", "BYE", "PHI", "LAR", "@NYG", "CIN", "@ARI", "@TEN", "HOU", "ATL", "@MIN", "@JAX", "DAL"],
};

