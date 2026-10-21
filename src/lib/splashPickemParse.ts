import { matchTeamName } from "./teamNameMatch";

// Parses the text you get from select-all + copy on a Splash Sports
// team pick'em picks page (Peay runs on Splash). Each game reads:
//
//   Away Team
//   Home Team
//   Preview
//   Sat 3:30pm
//   [#10ranked #10]
//   Away Team
//   5-0
//   -14.5
//   [#10ranked #10]
//   Home Team
//   3-2
//   +14.5
//
// "Preview" is the anchor: the two lines right before it are the teams,
// and the first signed number after it (before the next game starts) is
// the first-listed team's spread. Everything else on the page (lock time,
// "2 points" must-pick markers, day headers, pick counters) is ignored.

export interface SplashParsedGame {
  rawTeamA: string; // first-listed team, as written on Splash
  rawTeamB: string;
  teamA: string | null; // canonical site names, null if unmatched
  teamB: string | null;
  teamALine: number; // spread for teamA (negative = teamA favored)
}

const SPREAD_RE = /^[+-]\d+(\.\d+)?$/;
const PICKEM_RE = /^(pk|pick|pick'em|even|ev)$/i;

export function parseSplashPickemText(text: string): SplashParsedGame[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const previewIdx: number[] = [];
  lines.forEach((l, i) => {
    if (l === "Preview" && i >= 2) previewIdx.push(i);
  });

  const games: SplashParsedGame[] = [];
  previewIdx.forEach((p, n) => {
    const rawTeamA = lines[p - 2];
    const rawTeamB = lines[p - 1];
    // This game's block runs until the next game's two team-name lines.
    const end = n + 1 < previewIdx.length ? previewIdx[n + 1] - 2 : lines.length;
    let teamALine: number | null = null;
    for (let i = p + 1; i < end; i++) {
      if (SPREAD_RE.test(lines[i])) {
        teamALine = Number(lines[i]);
        break;
      }
      if (PICKEM_RE.test(lines[i])) {
        teamALine = 0;
        break;
      }
    }
    if (teamALine == null) return; // no line posted for this game
    games.push({
      rawTeamA,
      rawTeamB,
      teamA: matchTeamName(rawTeamA).matched,
      teamB: matchTeamName(rawTeamB).matched,
      teamALine,
    });
  });
  return games;
}

// The CBS/Kelly picks page uses a different layout, and its lines can't
// be selected, so the text comes from a console snippet that dumps the
// page's text nodes one per line. Each game reads:
//
//   Sat, Oct 17 • 3:30 PM
//   Preview
//   Arizona State
//   (+12.5)
//   (
//   3-2-0
//   )
//   (
//   10          <- ranking, only when ranked
//   )
//   Texas Tech
//   (-12.5)
//   ...
//
// Within each block (one "Preview" to the next), the line right before
// the first "(±n.n)" is the first-listed team and that number is its spread.
const PAREN_SPREAD_RE = /^\(([+-]\d+(\.\d+)?|pk|pick|even|ev)\)$/i;

export function parseSplashCbsText(text: string): SplashParsedGame[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const previewIdx: number[] = [];
  lines.forEach((l, i) => {
    if (l === "Preview") previewIdx.push(i);
  });

  const games: SplashParsedGame[] = [];
  previewIdx.forEach((p, n) => {
    const end = n + 1 < previewIdx.length ? previewIdx[n + 1] : lines.length;
    const spreads: { team: string; line: number }[] = [];
    for (let i = p + 2; i < end && spreads.length < 2; i++) {
      const m = lines[i].match(PAREN_SPREAD_RE);
      if (m) spreads.push({ team: lines[i - 1], line: /^[+-]/.test(m[1]) ? Number(m[1]) : 0 });
    }
    if (spreads.length < 2) return; // no line posted for this game
    games.push({
      rawTeamA: spreads[0].team,
      rawTeamB: spreads[1].team,
      teamA: matchTeamName(spreads[0].team).matched,
      teamB: matchTeamName(spreads[1].team).matched,
      teamALine: spreads[0].line,
    });
  });
  return games;
}

export interface SplashLineMatch {
  gameId: string;
  awayLine: number; // away-perspective, the site's convention
}

/**
 * Lines up parsed Splash games with the week's games by team pair (either
 * order — the sign flips if Splash listed the home team first), returning
 * each game's away-perspective line plus the pasted games that didn't
 * match any game in the list.
 */
export function matchSplashLines(
  parsed: SplashParsedGame[],
  games: { id: string; away_team: string; home_team: string }[]
): { matches: SplashLineMatch[]; unmatched: SplashParsedGame[] } {
  const matches: SplashLineMatch[] = [];
  const unmatched: SplashParsedGame[] = [];
  for (const pg of parsed) {
    const asListed = games.find((g) => g.away_team === pg.teamA && g.home_team === pg.teamB);
    const flipped = asListed ? null : games.find((g) => g.away_team === pg.teamB && g.home_team === pg.teamA);
    if (asListed) matches.push({ gameId: asListed.id, awayLine: pg.teamALine });
    else if (flipped) matches.push({ gameId: flipped.id, awayLine: -pg.teamALine });
    else unmatched.push(pg);
  }
  return { matches, unmatched };
}
