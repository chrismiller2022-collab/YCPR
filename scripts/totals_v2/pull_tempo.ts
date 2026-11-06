// Per team-game offensive tempo for 2021-2026 from CFBD /plays (one request per regular-season week), aggregated with
// src/lib/totals2/tempo.ts → scripts/totals_v2/data/tempo.json. Needs CFBD access (here the session's network proxy
// adds the key; otherwise set CFBD_API_KEY).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { aggregateTempo, type TempoAgg } from "../../src/lib/totals2/tempo";

const OUT = new URL("./data/tempo.json", import.meta.url).pathname;
const done: Record<string, TempoAgg[]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const headers: Record<string, string> = process.env.CFBD_API_KEY ? { Authorization: `Bearer ${process.env.CFBD_API_KEY}` } : {};
for (let season = 2021; season <= 2026; season++) {
  for (let week = 1; week <= 16; week++) {
    const k = `${season}|${week}`;
    if (done[k]) continue;
    const r = await fetch(`https://api.collegefootballdata.com/plays?year=${season}&week=${week}&seasonType=regular&classification=fbs`, { headers });
    if (!r.ok) {
      console.log(k, r.status, (await r.text()).slice(0, 120));
      continue;
    }
    const plays = await r.json();
    if (!Array.isArray(plays) || plays.length === 0) continue;
    const agg = aggregateTempo(plays);
    done[k] = agg;
    const s = agg.reduce((a, x) => a + x.tempo_sec_sum, 0), m = agg.reduce((a, x) => a + x.tempo_n, 0);
    console.log(k, plays.length, "plays,", agg.length, "team-games, avg", (s / m).toFixed(1), "s/snap");
    writeFileSync(OUT, JSON.stringify(done));
  }
}
