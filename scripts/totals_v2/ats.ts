// Walk-forward over/under record of Totals v2 by strength of lean (top 5% / 10% / 25% / 50% / all), per season.
//   bun scripts/totals_v2/ats.ts
import { readFileSync } from "node:fs";
import { buildGames } from "../../src/lib/drogba/dataset";
import { DEFAULT_T2_CONFIG, buildMarkets, buildSideRows, buildT2Ratings, pairGames, walkForward } from "../../src/lib/totals2/model";
import { atsObs, topBuckets, type AtsMarket } from "../../src/lib/totals2/report";

const DIR = new URL("./data/", import.meta.url).pathname;
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8"));
const lines = load("lines");
const games = buildGames(load("games"), lines);
const rows = buildSideRows(games, buildT2Ratings({ games, adv: load("adv"), plays: load("plays"), preseason: load("preseason") }, DEFAULT_T2_CONFIG), buildMarkets(lines), new Map(Object.entries(load("weather"))));
const wf = walkForward(rows, DEFAULT_T2_CONFIG);
const MARKETS: AtsMarket[] = ["game-move", "game-open", "game-close", "team-move", "team-open", "team-close"];
for (const m of MARKETS) {
  console.log(`\n${m}`);
  for (const seasons of [[2023], [2024], [2025], [2026], [2023, 2024], [2025, 2026], [2023, 2024, 2025, 2026]]) {
    const preds = wf.preds.filter((p) => seasons.includes(p.row.g.season));
    const b = topBuckets(atsObs(m, pairGames(preds), preds));
    console.log(`  ${seasons.join("+").padEnd(20)} ` + b.map((x) => `top${String(Math.round(x.frac * 100)).padStart(3)}% ${x.w}-${x.l} ${x.winPct?.toFixed(1)}% ${x.units >= 0 ? "+" : ""}${x.units.toFixed(1)}u${x.clv != null ? ` clv ${x.clv.toFixed(2)}` : ""}`).join(" | "));
  }
}
