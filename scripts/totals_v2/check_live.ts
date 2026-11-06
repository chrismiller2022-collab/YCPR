// Runs the page's live pipeline (src/lib/totals2/live.ts) outside the browser and prints a sanity summary.
//   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… bun scripts/totals_v2/check_live.ts [season]
import { loadTotals2 } from "../../src/lib/totals2/live";
import { scoreGames, scoreTeams } from "../../src/lib/totals2/report";
import { buildTTSides, latestTeamLines, ttArmStat, TT_ARMS } from "../../src/lib/totals2/ttCompare";
import { projectedTotal, lineOf } from "../../src/lib/totals2/model";

const season = Number(process.argv[2] ?? new Date().getFullYear());
const t0 = Date.now();
const d = await loadTotals2(season);
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${d.games.length} games, ${d.gps.length} FBS pairs, weather ${d.weather.size}, locks ${Object.keys(d.locks).length}, picks ${d.picks.length}, tt lines ${d.ttLines.length}`);
if (d.weatherNote) console.log(d.weatherNote);
const g = scoreGames(d.gps, "close", [0, 1]);
const go = scoreGames(d.gps, "open", [0, 1]);
const t = scoreTeams(d.preds, "close", [0, 1]);
console.log("game close", g.n, (100 * (g.r2 ?? 0)).toFixed(2), g.buckets[0]?.winPct?.toFixed(1), "| open", go.n, (100 * (go.r2 ?? 0)).toFixed(2), "clv", go.buckets[0]?.clv?.toFixed(2), "| team close", t.n, (100 * (t.r2 ?? 0)).toFixed(2));
const sides = buildTTSides(d.gps, d.locks, latestTeamLines(d.ttLines));
for (const a of TT_ARMS) {
  const s1 = ttArmStat(sides, a, "derived");
  const s2 = ttArmStat(sides, a, "real");
  console.log(a.padEnd(7), "derived n", s1.n, "mae", s1.mae?.toFixed(2), "/", s1.lineMae?.toFixed(2), "1+", s1.bets[1].w + "-" + s1.bets[1].l, "| real n", s2.n, "mae", s2.mae?.toFixed(2), "/", s2.lineMae?.toFixed(2), "1+", s2.bets[1].w + "-" + s2.bets[1].l);
}
const upcoming = d.gps.filter((x) => !x.g.completed).slice(0, 6);
for (const x of upcoming) console.log(x.g.week, x.g.away, "@", x.g.home, "line", lineOf(x.mkt, "close")?.total, "v2", projectedTotal(x, "close")?.toFixed(1), "open-model", projectedTotal(x, "open")?.toFixed(1));
