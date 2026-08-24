import { gamesForTeam } from "../data/games";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS, TEAMS_BY_NAME, conferencesForDivision } from "../data/teams";
import { HFA, spreadToWinPct } from "./odds";

export const TEAM_WIN_TOTALS = Object.fromEntries(
  TEAMS.map((team) => {
    let total = 0;
    let confTotal = 0;
    gamesForTeam(team.team).forEach((g) => {
      const isHome = g.home === team.team;
      const oppName = isHome ? g.away : g.home;
      const opp = TEAMS_BY_NAME[oppName];
      if (!opp) return;
      const spread = isHome
        ? team.rating - opp.rating - HFA
        : team.rating - opp.rating + HFA;
      const wp = spreadToWinPct(spread);
      total += wp;
      if (opp.conf === team.conf) confTotal += wp;
    });
    return [team.team, { total, confTotal }];
  })
);

export function buildRankMap(entries, higherIsBetter) {
  const sorted = [...entries].sort((a, b) =>
    higherIsBetter ? b[1] - a[1] : a[1] - b[1]
  );
  const map = {};
  sorted.forEach(([team], i) => {
    map[team] = i + 1;
  });
  return map;
}

// SOS/SOR rank: higher (more positive) value = tougher schedule, matching
// the live SOS page's own convention (Hardest column = highest sos value,
// rank 1). Was previously ranked ascending here — the opposite direction —
// which meant a team with a genuinely brutal schedule (a high positive
// value) landed near the BOTTOM of this rank instead of the top.
export const SOR_RANK_BY_TEAM = buildRankMap(
  Object.entries(SOS_BY_TEAM),
  true
);
export const WIN_TOTAL_RANK_BY_TEAM = buildRankMap(
  TEAMS.map((t) => [t.team, TEAM_WIN_TOTALS[t.team].total]),
  true
);
export const CONF_WIN_TOTAL_RANK_BY_TEAM = buildRankMap(
  TEAMS.map((t) => [t.team, TEAM_WIN_TOTALS[t.team].confTotal]),
  true
);

export function conferenceOptionsFor(division) {
  return division === "All" ? CONFERENCES : conferencesForDivision(division);
}

export function teamsFilteredFor(division, conference) {
  return TEAMS.filter(
    (t) =>
      (division === "All" || t.div === division) &&
      (conference === "All" || t.conf === conference)
  ).sort((a, b) => a.team.localeCompare(b.team));
}
