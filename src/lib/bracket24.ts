import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { RESUME_BY_TEAM } from "../data/resume";
import { TEAMS } from "../data/teams";
import { HFA } from "./odds";

export const PLAYOFF24_AUTO_CONFERENCES = [
  "Big Ten",
  "SEC",
  "Big 12",
  "ACC",
  "Sun Belt",
  "American Athletic",
  "Mountain West",
  "Mid-American",
  "Conference USA",
  "Pac-12",
];

export function computeAutoBidChampion(conf) {
  const candidates = TEAMS.filter(
    (t) => t.div === "FBS" && t.conf === conf && CONF_FUTURES_BY_TEAM[t.team]
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, t) => {
    const p = CONF_FUTURES_BY_TEAM[t.team]?.confWinPct ?? 0;
    const bestP = best ? CONF_FUTURES_BY_TEAM[best.team]?.confWinPct ?? 0 : -1;
    return p > bestP ? t : best;
  }, null);
}

export function buildPlayoff24Field() {
  const autoBids = PLAYOFF24_AUTO_CONFERENCES.map((conf) => ({
    conf,
    team: computeAutoBidChampion(conf),
  })).filter((x) => x.team);

  const autoNames = new Set(autoBids.map((x) => x.team.team));

  const atLargePool = TEAMS.filter(
    (t) => t.div === "FBS" && !autoNames.has(t.team) && RESUME_BY_TEAM[t.team]
  ).sort(
    (a, b) => RESUME_BY_TEAM[a.team].rank - RESUME_BY_TEAM[b.team].rank
  );

  const atLarge = atLargePool.slice(0, 14);

  const field = [
    ...autoBids.map((x) => ({ team: x.team, bidConf: x.conf, bid: "Auto" })),
    ...atLarge.map((t) => ({ team: t, bidConf: t.conf, bid: "At-Large" })),
  ];

  field.sort(
    (a, b) =>
      (RESUME_BY_TEAM[a.team.team]?.rank ?? 999) -
      (RESUME_BY_TEAM[b.team.team]?.rank ?? 999)
  );

  return field.map((f, i) => ({ ...f, seed: i + 1 }));
}

export function pairFirstRoundNoConfConflict(sixteen) {
  // sixteen: seeds 9-24, sorted ascending by seed.
  const hosts = sixteen.slice(0, 8);
  const aways = sixteen.slice(8, 16).slice().reverse();

  for (let pass = 0; pass < 4; pass++) {
    let conflict = false;
    for (let i = 0; i < hosts.length; i++) {
      if (hosts[i].team.conf === aways[i].team.conf) {
        conflict = true;
        for (let j = 0; j < aways.length; j++) {
          if (j === i) continue;
          const swapOk =
            hosts[i].team.conf !== aways[j].team.conf &&
            hosts[j].team.conf !== aways[i].team.conf;
          if (swapOk) {
            const tmp = aways[i];
            aways[i] = aways[j];
            aways[j] = tmp;
            break;
          }
        }
      }
    }
    if (!conflict) break;
  }

  return hosts.map((h, i) => ({ host: h, away: aways[i] }));
}

export function playGame(entryA, entryB, neutral) {
  const spreadA = neutral
    ? entryA.team.rating - entryB.team.rating
    : entryA.team.rating - entryB.team.rating - HFA;
  return spreadA <= 0 ? entryA : entryB;
}

export function reseedAndPair(entries) {
  // entries: array of {team, seed, ...}, any length. Sort by seed asc,
  // pair best remaining vs worst remaining.
  const sorted = [...entries].sort((a, b) => a.seed - b.seed);
  const pairs = [];
  for (let i = 0; i < sorted.length / 2; i++) {
    pairs.push({ host: sorted[i], away: sorted[sorted.length - 1 - i] });
  }
  return pairs;
}

// FCS doesn't have conference-championship or resume-rating data yet, so
// the field here is simpler than the FBS 24-team field: just the top 24
// FCS teams by Power Rating, seeded 1-24 in order. Once FCS resume ratings
// and conference futures exist, this can grow auto-bid/at-large logic to
// match buildPlayoff24Field above.
export function buildFCS24Field() {
  const fcsTeams = [...TEAMS]
    .filter((t) => t.div === "FCS")
    .sort((a, b) => a.rating - b.rating);

  return fcsTeams.slice(0, 24).map((team, i) => ({
    team,
    bidConf: team.conf,
    bid: i < 8 ? "Top Seed" : "At-Large",
    seed: i + 1,
  }));
}
