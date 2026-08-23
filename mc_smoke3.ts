import { TEAMS } from "./src/data/teams";
import { runMonteCarloAsync, type SimGame } from "./src/lib/montecarlo/engine";

const fbs = TEAMS.filter((t) => t.div === "FBS");
const games: SimGame[] = [];
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

for (let i = 0; i < fbs.length; i++) {
  for (let g = 0; g < 12; g++) {
    const home = fbs[i];
    const away = pick(fbs.filter((t) => t.team !== home.team));
    const completed = g < 8;
    const homePts = completed ? Math.floor(Math.random() * 35) + 10 : null;
    const awayPts = completed ? Math.floor(Math.random() * 35) + 10 : null;
    games.push({
      week: g + 1, home_team: home.team, away_team: away.team, neutral_site: false,
      conference_game: home.conf === away.conf, completed, home_points: homePts, away_points: awayPts,
    });
  }
}

const liveByTeam: Record<string, any> = {};
const t0 = Date.now();
runMonteCarloAsync(games, liveByTeam, 100000, (c, tot) => {
  console.log(`progress ${c}/${tot} @ ${(Date.now()-t0)/1000}s`);
}).then((res) => {
  console.log(`total: ${(Date.now()-t0)/1000}s`);
  console.log("resumeComparisonTrials:", res.resumeComparisonTrials);
}).catch((e) => { console.error("ERROR", e); process.exit(1); });
