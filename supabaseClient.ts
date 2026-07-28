import { TEAMS } from "../data/teams";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { NATTY_BY_TEAM } from "../data/nattyOdds";
import { TEAM_WIN_TOTALS } from "./ranks";

export interface RadarMetric {
  key: string;
  label: string;
  percentile: number | null; // 0-100, null if this team has no data for it
}

// Inverted on purpose: rank 1 (the best team) should land near the 100th
// percentile, not the 1st. E.g. rank 5 of ~137 FBS teams is the 97th
// percentile, not the 5th.
function percentileFromRank(rank: number, n: number): number {
  if (n <= 1) return 100;
  return (100 * (n - rank)) / (n - 1);
}

function rankWithinDivision(
  divisionTeams: any[],
  valueFor: (t: any) => number | null | undefined,
  higherIsBetter: boolean
) {
  const entries = divisionTeams
    .map((t) => ({ team: t.team, value: valueFor(t) }))
    .filter((e): e is { team: string; value: number } => e.value != null);

  entries.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));

  const rankMap: Record<string, number> = {};
  entries.forEach((e, i) => {
    rankMap[e.team] = i + 1;
  });
  return { rankMap, n: entries.length };
}

/**
 * Six-axis percentile profile for the radar chart, all relative to the
 * team's own division (FBS teams compared only against other FBS teams,
 * same for FCS) so a strong FCS team doesn't look artificially weak next
 * to the much larger FBS-scale numbers.
 */
export function computeRadarMetrics(team: any, liveByTeam: Record<string, any> = {}): RadarMetric[] {
  const divisionTeams = TEAMS.filter((t) => t.div === team.div);

  // Lower rating = better, same convention as the rest of the site.
  const powerRank = rankWithinDivision(divisionTeams, (t) => t.rating, false);
  const resumeRank = rankWithinDivision(
    divisionTeams,
    (t) => RESUME_BY_TEAM[t.team]?.rating ?? null,
    true
  );
  const winsRank = rankWithinDivision(
    divisionTeams,
    (t) => liveByTeam[t.team]?.total_wins ?? TEAM_WIN_TOTALS[t.team]?.total ?? null,
    true
  );
  // SOS/SOR: lower (more negative) = tougher schedule = better, same
  // convention as power rating.
  const sosRank = rankWithinDivision(
    divisionTeams,
    (t) => liveByTeam[t.team]?.sor ?? SOS_BY_TEAM[t.team] ?? null,
    false
  );
  const confOddsRank = rankWithinDivision(
    divisionTeams,
    (t) => liveByTeam[t.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[t.team]?.confWinPct ?? null,
    true
  );
  const nattyRank = rankWithinDivision(
    divisionTeams,
    (t) => liveByTeam[t.team]?.natty_odds ?? NATTY_BY_TEAM[t.team] ?? null,
    true
  );

  function metric(key: string, label: string, rankInfo: { rankMap: Record<string, number>; n: number }): RadarMetric {
    const r = rankInfo.rankMap[team.team];
    return {
      key,
      label,
      percentile: r != null ? percentileFromRank(r, rankInfo.n) : null,
    };
  }

  return [
    metric("rating", "Power Rating", powerRank),
    metric("resume", "Resume Rating", resumeRank),
    metric("wins", "Proj Wins", winsRank),
    metric("sos", "SOS", sosRank),
    metric("confOdds", "Proj Conf Odds", confOddsRank),
    metric("natty", "Proj Natty Odds", nattyRank),
  ];
}
