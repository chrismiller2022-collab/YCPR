// Bet History — static data, no database. One record per graded game.
//
// Deliberately stores RAW components rather than pre-computed results:
// `ratingDiff` (the model's projected margin with NO home-field edge
// baked in) is kept separate from `teamSpecificHfa` (the actual
// team-specific HFA value used that week). This is what lets the Admin
// page recompute everything under a different HFA assumption (flat 2.4
// vs team-specific) after the fact, instead of only ever showing
// whatever was true at upload time.
//
// `awayConf`/`homeConf` are a SNAPSHOT of each team's conference at the
// time of the game, not a live lookup — conference realignment means a
// team's current conference (in data/teams.ts) may not match what it
// was in, say, 2024.

export interface BetHistoryRecord {
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  awayConf: string;
  homeConf: string;
  neutralSite: boolean;

  /** Projected margin, away-perspective (negative = away favored), WITHOUT home-field advantage added in. */
  ratingDiff: number;

  /** The home team's actual team-specific HFA value used that week (0 for neutral-site games). */
  teamSpecificHfa: number;

  /** Vegas closing line, away-perspective (negative = away favored) — same convention used everywhere on this site. */
  closingLine: number;

  /** awayScore - homeScore. Null only if a game somehow isn't graded yet. */
  actualAwayMargin: number | null;
}

export const BET_HISTORY: BetHistoryRecord[] = [
  // Populate this array later — one entry per graded game. Example shape:
  //
  // {
  //   season: 2024,
  //   week: 5,
  //   awayTeam: "Texas",
  //   homeTeam: "Oklahoma",
  //   awayConf: "SEC",
  //   homeConf: "SEC",
  //   neutralSite: true,
  //   ratingDiff: -3.2,       // model's margin before any HFA
  //   teamSpecificHfa: 0,     // neutral site, so 0 either way
  //   closingLine: -3.5,      // Vegas had Texas -3.5
  //   actualAwayMargin: 5,    // Texas won by 5
  // },
];
