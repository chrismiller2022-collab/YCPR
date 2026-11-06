// Scheduled Totals v2 job (.github/workflows/totals-v2.yml, every few hours; also runnable by hand):
//  1. Recomputes the current season with the page's own pipeline (src/lib/totals2/live.ts).
//  2. totals2_projections: refreshes every game that hasn't kicked off; a played game is only written once (backfill),
//     so its row stays the last pre-kickoff number.
//  3. totals2_picks (the log): every game in the next week to be played is logged the first time it has a line —
//     first save wins, same rule as the page's Save button — but only once last week's per-game stats are in, so a
//     logged number is never built on stale ratings.
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (writes), read through the site's own client:
//   VITE_SUPABASE_URL=$SUPABASE_URL VITE_SUPABASE_ANON_KEY=$SUPABASE_SERVICE_ROLE_KEY bun scripts/totals_v2/project.ts [--dry]
import { loadTotals2 } from "../../src/lib/totals2/live";
import { impliedPoints, lineOf, predictedMove, projectedTotal } from "../../src/lib/totals2/model";
import { T2_MOVE_CUT_TOP10, T2_VERSION } from "../../src/lib/totals2/frozen";

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dry = process.argv.includes("--dry") || !KEY;
const season = Number(process.env.SEASON ?? new Date().getFullYear());
const now = Date.now();

async function rest(path: string, method: string, body: unknown, prefer: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
}
async function existingIds(table: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=game_id&season=eq.${season}&order=game_id`, {
      headers: { apikey: KEY ?? process.env.VITE_SUPABASE_ANON_KEY!, Authorization: `Bearer ${KEY ?? process.env.VITE_SUPABASE_ANON_KEY}`, Range: `${off}-${off + 999}` },
    });
    const rows = await r.json();
    for (const x of rows) out.add(x.game_id);
    if (rows.length < 1000) break;
  }
  return out;
}

const t0 = Date.now();
const d = await loadTotals2(season, { weatherSinceMs: now - 6 * 3600 * 1000 });
console.log(`loaded ${d.gps.length} FBS games in ${((Date.now() - t0) / 1000).toFixed(1)}s; ${d.weatherNote ?? "weather ok"}; ${d.tempoNote ?? "tempo ok"}`);

const ycHome = (id: string) => {
  const l = d.locks[id];
  return l?.my_away_spread != null ? -Number(l.my_away_spread) : null;
};
const projections: any[] = [];
for (const gp of d.gps) {
  const g = gp.g;
  const line = lineOf(gp.mkt, "close");
  const tot = projectedTotal(gp, "close");
  if (!line || tot == null) continue;
  const mv = predictedMove(gp);
  projections.push({
    game_id: g.id,
    season,
    week: g.week,
    start_date: g.startMs ? new Date(g.startMs).toISOString() : null,
    home_team: g.home,
    away_team: g.away,
    model_version: T2_VERSION,
    market_provider: gp.mkt.provider,
    open_total: gp.mkt.openTotal,
    open_spread: gp.mkt.openSpread,
    line_total: line.total,
    line_spread: line.spread,
    resid_total: tot - line.total,
    proj_total: tot,
    proj_home_pts: impliedPoints(line.total, line.spread, "home") + (gp.home.resid.close ?? 0),
    proj_away_pts: impliedPoints(line.total, line.spread, "away") + (gp.away.resid.close ?? 0),
    open_proj_total: projectedTotal(gp, "open"),
    move: mv,
    star: mv != null && Math.abs(mv) >= T2_MOVE_CUT_TOP10,
    stats_home_pts: gp.home.l1,
    stats_away_pts: gp.away.l1,
    weather: d.weather.get(g.id) ?? null,
    computed_at: new Date().toISOString(),
    _started: g.completed || (g.startMs != null && g.startMs <= now),
  });
}
const have = await existingIds("totals2_projections");
const strip = ({ _started, ...r }: any) => r;
const upcoming = projections.filter((p) => !p._started).map(strip);
const backfill = projections.filter((p) => p._started && !have.has(p.game_id)).map(strip);

// The log: the next week to be played, once last week's stats are pulled.
const nextWeek = Math.min(...projections.filter((p) => !p._started).map((p) => p.week));
const fresh = (d.freshness?.advCoverage ?? 0) >= 0.9;
const logged = await existingIds("totals2_picks");
const toLog = fresh
  ? projections
      .filter((p) => !p._started && p.week === nextWeek && !logged.has(p.game_id))
      .map((p) => ({
        game_id: p.game_id,
        season,
        week: p.week,
        home_team: p.home_team,
        away_team: p.away_team,
        model_version: T2_VERSION,
        market_total: p.line_total,
        market_home_spread: p.line_spread,
        market_provider: p.market_provider,
        proj_total: p.proj_total,
        proj_home_pts: p.proj_home_pts,
        proj_away_pts: p.proj_away_pts,
        stats_home_pts: p.stats_home_pts,
        stats_away_pts: p.stats_away_pts,
        yc_home_spread: ycHome(p.game_id),
        open_total: p.open_total,
        proj_move: p.move,
        weather: p.weather,
      }))
  : [];
console.log(
  `upcoming ${upcoming.length} (refresh), played backfill ${backfill.length}, log week ${nextWeek}: ${toLog.length} new` +
    (fresh ? "" : ` (waiting: only ${Math.round(100 * (d.freshness?.advCoverage ?? 0))}% of week ${d.freshness?.lastCompletedWeek} stats pulled)`)
);
if (dry) {
  console.log("dry run — nothing written", KEY ? "" : "(no SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(0);
}
for (let i = 0; i < upcoming.length; i += 300) await rest("totals2_projections?on_conflict=game_id", "POST", upcoming.slice(i, i + 300), "resolution=merge-duplicates,return=minimal");
for (let i = 0; i < backfill.length; i += 300) await rest("totals2_projections?on_conflict=game_id", "POST", backfill.slice(i, i + 300), "resolution=ignore-duplicates,return=minimal");
for (let i = 0; i < toLog.length; i += 300) await rest("totals2_picks?on_conflict=game_id", "POST", toLog.slice(i, i + 300), "resolution=ignore-duplicates,return=minimal");
console.log("written");
