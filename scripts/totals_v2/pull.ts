// Pulls everything the Totals v2 training run needs into scripts/totals_v2/data/*.json (git-ignored), using the
// public read key the site itself ships.
//   bun scripts/totals_v2/pull.ts
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "https://uyxnmtsntiaxqqmwsteq.supabase.co/rest/v1";
const KEY = "sb_publishable_6yizAfXG0dIvxcvik8ajFg_z1tf9f3j";
const DIR = new globalThis.URL("./data/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });

async function get(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Range-Unit": "items", Range: `${off}-${off + 999}` } });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const save = (name: string, rows: unknown) => writeFileSync(`${DIR}${name}.json`, JSON.stringify(rows));

const pulls: [string, string][] = [
  ["games", "games?select=id,season,week,season_type,start_date,start_time_tbd,neutral_site,venue_id,home_team,away_team,home_classification,away_classification,home_conference,away_conference,home_points,away_points,completed&season=gte.2021&order=id"],
  ["lines", "betting_lines?select=game_id,season,provider,spread,over_under,opening_spread,opening_over_under&season=gte.2021&order=id"],
  ["adv", "team_game_advanced?select=game_id,team,season,week,off_success_rate,off_explosiveness,off_ppa,off_plays,off_drives&season=gte.2021&order=game_id,team"],
  ["plays", "team_game_play_agg?select=game_id,team,season,week,f_plays,f_success,f_ppa_success_sum,f_ppa_success_n,garbage_plays,turnovers,st_fg_att,st_fg_pts_over,st_ppa_sum,st_n,st_punt_net_yds,st_punt_net_n,st_ko_net_yds,st_ko_net_n&season=gte.2021&order=game_id,team"],
  ["preseason", "team_preseason_inputs?select=season,team,returning_ppa_pct,talent,recruiting_points,portal_in_rating_sum,portal_out_rating_sum&order=season,team"],
  ["coaches", "team_coach_seasons?select=team,year,coach_id,games&order=team,year"],
  ["team_venues", "team_venues?select=team,venue_id,latitude,longitude,dome&order=team"],
  ["venues", "venues?select=id,latitude,longitude,dome&order=id"],
  ["tt_lines", "team_total_lines?select=game_id,season,week,team,provider,point,over_price,under_price,pulled_at&order=game_id"],
];

for (const [name, path] of pulls) {
  const rows = await get(path);
  save(name, rows);
  console.log(name.padEnd(12), rows.length);
}

// Historical weather for training comes from scripts/totals_v2/weather_meteostat.ts (observed station data). The
// live page uses Open-Meteo forecasts through src/lib/weather.ts; both feed weatherFeatureVector().
