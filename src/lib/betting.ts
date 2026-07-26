import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor } from "./odds";

export function computeBettingStats(games, liveByTeam) {
  const su = { w: 0, l: 0 };
  const ats = { w: 0, l: 0 };
  const fb = { w: 0, l: 0 };

  games.forEach((g) => {
    const away = TEAMS_BY_NAME[g.away];
    const home = TEAMS_BY_NAME[g.home];
    if (!away || !home) return;

    // Straight-up grading needs actual final scores, which aren't
    // tracked yet — this will start populating once scores are added.
    if (g.awayScore != null && g.homeScore != null) {
      const awaySpread = away.rating - home.rating + hfaFor(g.home, liveByTeam);
      const projWinner =
        awaySpread < 0 ? "away" : awaySpread > 0 ? "home" : null;
      const actualWinner =
        g.awayScore > g.homeScore
          ? "away"
          : g.homeScore > g.awayScore
          ? "home"
          : null;
      if (projWinner && actualWinner) {
        if (projWinner === actualWinner) su.w += 1;
        else su.l += 1;
      }

      // ATS grading needs a Vegas line, which isn't tracked yet either.
      if (g.vegasLine != null) {
        const actualMargin = g.homeScore - g.awayScore;
        const coverMargin = actualMargin - g.vegasLine;
        const projSpread = awaySpread;
        const projCover =
          projSpread < 0 ? "away" : projSpread > 0 ? "home" : null;
        const actualCover =
          coverMargin > 0 ? "home" : coverMargin < 0 ? "away" : null;
        if (projCover && actualCover) {
          if (projCover === actualCover) ats.w += 1;
          else ats.l += 1;

          // Filtered bets are a curated subset (Filtered Bet column) —
          // graded the same way, only for games flagged as a filtered bet.
          if (g.filteredBet) {
            if (projCover === actualCover) fb.w += 1;
            else fb.l += 1;
          }
        }
      }
    }
  });

  return { su, ats, fb };
}

export function winPctLabel(rec) {
  const total = rec.w + rec.l;
  if (total === 0) return "–";
  return `${((rec.w / total) * 100).toFixed(1)}%`;
}
