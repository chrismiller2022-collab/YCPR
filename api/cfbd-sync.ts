import { createClient } from "@supabase/supabase-js";

// This runs on Vercel's servers, not in the browser — CFBD_API_KEY and the
// Supabase service role key never ship in the client bundle. Mirrors
// admin-save.ts's auth pattern: the password is re-checked here even
// though the Admin gate already confirmed it once client-side.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
// Separate from CFBD_API_KEY on purpose — CFBD's own docs are explicit
// that the Model Pick'em prediction token is a different credential
// from the main data-API key and the two "cannot be used
// interchangeably." This token also expires monthly (obtained from
// predictions.collegefootballdata.com/api/auth/token while logged in),
// so it'll periodically need updating in Vercel's env vars — there's no
// way to auto-refresh it from here.
const CFBD_PREDICTIONS_TOKEN = process.env.CFBD_PREDICTIONS_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------
// DROGBA play aggregation (inlined here on purpose: this project runs as ES modules, where an extensionless
// relative import fails at load time and would take every action in this endpoint down with it).
// ---------------------------------------------------------------------
// Turns one week of CFBD /plays rows into per team-game aggregates for the DROGBA model. Self-contained (the leading
// underscore keeps Vercel from treating it as a function, and it doesn't count toward the 12-function cap) so the
// sync endpoint and the local tests share one definition of "garbage time", "success" and "special-teams value".
//
// Definitions (the standard ones used by JP+ / SP+ / CFBD-based models):
//  - Scrimmage play: a rush, pass, sack, interception or fumble-recovery play on downs 1-4 — not kickoffs, punts, field
//    goals, extra points, penalties, timeouts, kneel-downs or spikes.
//  - Garbage time (those plays are dropped): scoring margin larger than 43 in the 1st quarter, 37 in the 2nd, 27 in the
//    3rd, 22 in the 4th. Overtime is never garbage time.
//  - Success: 1st down gains >= 50% of the distance, 2nd down >= 70%, 3rd/4th down >= 100%; any touchdown is a success;
//    a turnover is never one.
//  - Isolated explosiveness is the mean PPA of SUCCESSFUL plays only (so turnovers and failures can't dilute it).
//  - Special teams: field goals are measured against a fixed make-probability by distance; punts and kickoffs by the PPA
//    CFBD attaches to them, when it does.

export interface PlayLike {
  id?: number | string;
  driveNumber?: number | null;
  playNumber?: number | null;
  gameId?: number | string;
  offense?: string;
  defense?: string;
  period?: number;
  offenseScore?: number | null;
  defenseScore?: number | null;
  down?: number | null;
  distance?: number | null;
  yardsToGoal?: number | null;
  yardsGained?: number | null;
  scoring?: boolean | null;
  playType?: string | null;
  playText?: string | null;
  ppa?: number | string | null;
}

export interface PlayAgg {
  game_id: string;
  team: string;
  f_plays: number;
  f_success: number;
  f_ppa_success_sum: number;
  f_ppa_success_n: number;
  f_explosive: number;
  r_plays: number;
  r_success: number;
  r_ppa_success_sum: number;
  p_plays: number;
  p_success: number;
  p_ppa_success_sum: number;
  garbage_plays: number;
  turnovers: number;
  st_fg_att: number;
  st_fg_made: number;
  st_fg_pts_over: number;
  st_punt_n: number;
  st_punt_yds: number;
  st_punt_ppa: number;
  st_ko_n: number;
  st_ko_yds: number;
  st_ko_ppa: number;
  st_ppa_sum: number;
  st_n: number;
  st_punt_net_yds: number; // net field position gained by this team's punts: where the receiving offense started vs where the punt was kicked from
  st_punt_net_n: number;
  st_ko_net_yds: number;
  st_ko_net_n: number;
}

export interface PlayDiagnostics {
  plays: number;
  scrimmage: number;
  garbage: number;
  withPpaScrimmage: number;
  withPpaSpecial: number;
  specialPlays: number;
  puntNetAvg: number | null; // should land near 38-42
  puntNetCoverage: number | null; // share of punts whose next offensive snap was found
  koNetAvg: number | null; // should land near 38-42
  koNetCoverage: number | null;
  byType: Record<string, number>;
}

const NON_SCRIMMAGE = /kickoff|punt|field goal|extra point|two point|2pt|penalty|timeout|end of|end period|coin toss|uncategorized|blocked|safety|defensive 2|official/i;
const SCRIMMAGE = /rush|pass|sack|interception|fumble/i;
const TURNOVER = /interception|fumble recovery \(opponent\)|fumble return/i;

// Typical college field-goal make probability by kick distance (yardsToGoal + 17).
export function fgMakeProb(distance: number): number {
  if (distance < 30) return 0.95;
  if (distance < 40) return 0.87;
  if (distance < 45) return 0.78;
  if (distance < 50) return 0.68;
  if (distance < 55) return 0.52;
  return 0.35;
}

export function isGarbageTime(period: number, offenseScore: number, defenseScore: number): boolean {
  const m = Math.abs(offenseScore - defenseScore);
  if (period === 1) return m > 43;
  if (period === 2) return m > 37;
  if (period === 3) return m > 27;
  if (period === 4) return m > 22;
  return false; // overtime
}

export function isSuccess(down: number, distance: number, yards: number): boolean {
  if (down === 1) return yards >= 0.5 * distance;
  if (down === 2) return yards >= 0.7 * distance;
  return yards >= distance;
}

const blank = (game_id: string, team: string): PlayAgg => ({
  game_id,
  team,
  f_plays: 0,
  f_success: 0,
  f_ppa_success_sum: 0,
  f_ppa_success_n: 0,
  f_explosive: 0,
  r_plays: 0,
  r_success: 0,
  r_ppa_success_sum: 0,
  p_plays: 0,
  p_success: 0,
  p_ppa_success_sum: 0,
  garbage_plays: 0,
  turnovers: 0,
  st_fg_att: 0,
  st_fg_made: 0,
  st_fg_pts_over: 0,
  st_punt_n: 0,
  st_punt_yds: 0,
  st_punt_ppa: 0,
  st_ko_n: 0,
  st_ko_yds: 0,
  st_ko_ppa: 0,
  st_ppa_sum: 0,
  st_n: 0,
  st_punt_net_yds: 0,
  st_punt_net_n: 0,
  st_ko_net_yds: 0,
  st_ko_net_n: 0,
});

const numOrNull = (x: unknown): number | null => {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isNaN(n) ? null : n;
};

export function aggregatePlays(plays: PlayLike[]): { rows: PlayAgg[]; diag: PlayDiagnostics } {
  const by = new Map<string, PlayAgg>();
  const get = (gameId: string, team: string) => {
    const k = `${gameId}|${team}`;
    let a = by.get(k);
    if (!a) {
      a = blank(gameId, team);
      by.set(k, a);
    }
    return a;
  };
  const diag: PlayDiagnostics = { plays: 0, scrimmage: 0, garbage: 0, withPpaScrimmage: 0, withPpaSpecial: 0, specialPlays: 0, puntNetAvg: null, puntNetCoverage: null, koNetAvg: null, koNetCoverage: null, byType: {} };

  // Plays in game order, so a punt or kickoff can be followed to the next offensive snap.
  const order = (p: PlayLike) => {
    const d = numOrNull(p.driveNumber);
    const n = numOrNull(p.playNumber);
    return d != null && n != null ? d * 1000 + n : Number(p.id ?? 0) % 1e9;
  };
  const byGame = new Map<string, PlayLike[]>();
  for (const p of plays) {
    if (p.gameId == null || !p.offense) continue;
    const k = String(p.gameId);
    const list = byGame.get(k);
    if (list) list.push(p);
    else byGame.set(k, [p]);
  }
  let puntN = 0, puntFound = 0, puntSum = 0, koN = 0, koFound = 0, koSum = 0;

  // Net field position of a kick: where the kicking team kicked from (its yards to goal) plus where the receiving team
  // started its next scrimmage drive (its yards to goal), minus the 100 yards of the field.
  const netKick = (list: PlayLike[], i: number): number | null => {
    const kicker = list[i].offense;
    const y = numOrNull(list[i].yardsToGoal);
    if (y == null) return null;
    for (let j = i + 1; j < Math.min(list.length, i + 9); j++) {
      const q = list[j];
      if (q.offense === kicker) {
        if (/punt|kickoff|field goal/i.test(String(q.playType ?? ""))) return null;
        continue;
      }
      const qType = String(q.playType ?? "");
      if (SCRIMMAGE.test(qType) && !NON_SCRIMMAGE.test(qType) && numOrNull(q.down) != null) {
        const z = numOrNull(q.yardsToGoal);
        return z == null ? null : y + z - 100;
      }
      if (/kickoff|punt/i.test(qType) && !/return/i.test(qType)) return null; // the receiver kicked: a score or turnover intervened
    }
    return null;
  };

  for (const list of byGame.values()) {
    list.sort((a, b) => order(a) - order(b));
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      diag.plays++;
      const type = String(p.playType ?? "");
      diag.byType[type] = (diag.byType[type] ?? 0) + 1;
      const text = String(p.playText ?? "");
      const gameId = String(p.gameId);
      const ppa = numOrNull(p.ppa);
      const agg = get(gameId, p.offense!);

      // ---- special teams (credited to the team whose kicking unit is on the field = the play's offense)
      if (/field goal/i.test(type) && !/return/i.test(type)) {
        const ytg = numOrNull(p.yardsToGoal);
        if (ytg != null) {
          const made = /good/i.test(type) || (p.scoring === true && !/missed|blocked/i.test(type));
          agg.st_fg_att++;
          if (made) agg.st_fg_made++;
          agg.st_fg_pts_over += (made ? 3 : 0) - 3 * fgMakeProb(ytg + 17);
          agg.st_n++;
          diag.specialPlays++;
        }
        continue;
      }
      // Punts and kickoffs by the kicking team only: "Kickoff Return (Offense)" and punt returns are the receiving
      // team's snap and must not count as a kick.
      if (/^(blocked )?punt$/i.test(type.trim())) {
        agg.st_punt_n++;
        agg.st_punt_yds += numOrNull(p.yardsGained) ?? 0;
        if (ppa != null) {
          agg.st_punt_ppa += ppa;
          agg.st_ppa_sum += ppa;
          diag.withPpaSpecial++;
        }
        const net = netKick(list, i);
        puntN++;
        if (net != null) {
          agg.st_punt_net_yds += net;
          agg.st_punt_net_n++;
          puntFound++;
          puntSum += net;
        }
        agg.st_n++;
        diag.specialPlays++;
        continue;
      }
      if (/^(kickoff|onside kick)$/i.test(type.trim())) {
        agg.st_ko_n++;
        agg.st_ko_yds += numOrNull(p.yardsGained) ?? 0;
        if (ppa != null) {
          agg.st_ko_ppa += ppa;
          agg.st_ppa_sum += ppa;
          diag.withPpaSpecial++;
        }
        const net = netKick(list, i);
        koN++;
        if (net != null) {
          agg.st_ko_net_yds += net;
          agg.st_ko_net_n++;
          koFound++;
          koSum += net;
        }
        agg.st_n++;
        diag.specialPlays++;
        continue;
      }

    // ---- scrimmage plays
    if (!SCRIMMAGE.test(type) || NON_SCRIMMAGE.test(type)) continue;
    if (/kneel|spike|victory formation/i.test(text)) continue;
    const down = numOrNull(p.down);
    const distance = numOrNull(p.distance);
    const yards = numOrNull(p.yardsGained);
    if (down == null || down < 1 || down > 4 || distance == null || yards == null) continue;
    diag.scrimmage++;
    if (ppa != null) diag.withPpaScrimmage++;

    const period = numOrNull(p.period) ?? 1;
    const os = numOrNull(p.offenseScore);
    const ds = numOrNull(p.defenseScore);
    if (os != null && ds != null && isGarbageTime(period, os, ds)) {
      agg.garbage_plays++;
      diag.garbage++;
      continue;
    }

    const turnover = TURNOVER.test(type);
    const td = p.scoring === true && /touchdown/i.test(type);
    const success = !turnover && (td || isSuccess(down, Math.max(distance, 1), yards));
    const isPass = /pass|sack|interception/i.test(type) || (/fumble/i.test(type) && /pass/i.test(text));
    agg.f_plays++;
    if (turnover) agg.turnovers++;
    if (yards >= 20 && !turnover) agg.f_explosive++;
    if (isPass) agg.p_plays++;
    else agg.r_plays++;
    if (success) {
      agg.f_success++;
      if (isPass) agg.p_success++;
      else agg.r_success++;
      if (ppa != null) {
        agg.f_ppa_success_sum += ppa;
        agg.f_ppa_success_n++;
        if (isPass) agg.p_ppa_success_sum += ppa;
        else agg.r_ppa_success_sum += ppa;
      }
    }
    }
  }
  diag.puntNetAvg = puntFound ? puntSum / puntFound : null;
  diag.puntNetCoverage = puntN ? puntFound / puntN : null;
  diag.koNetAvg = koFound ? koSum / koFound : null;
  diag.koNetCoverage = koN ? koFound / koN : null;
  return { rows: Array.from(by.values()), diag };
}

const CFBD_BASE = "https://api.collegefootballdata.com";
const PREDICTIONS_BASE = "https://predictionsapi.collegefootballdata.com/api";

const TRACKED_CLASSIFICATIONS = new Set(["fbs", "fcs"]);

function isTrackedGame(g: any): boolean {
  const home = String(g.homeClassification ?? "").toLowerCase();
  const away = String(g.awayClassification ?? "").toLowerCase();
  return TRACKED_CLASSIFICATIONS.has(home) || TRACKED_CLASSIFICATIONS.has(away);
}

// Confirmed against a real response (CFBD's "Copy API Submission
// Payload" button turned out to show a submission TEMPLATE, not this
// GET shape — it uses "gameId" while the actual GET response below uses
// "id", and "pick" is a number, not the empty-string placeholder that
// template showed for an unfilled game).
interface PredictionsPick {
  id: number;
  season: number;
  homeTeam: string;
  awayTeam: string;
  pick: number | null;
}

const DEFAULT_HFA = 2.4;

// Auto-fills and submits a prediction for every game CFBD's Model
// Pick'em contest currently has open, using this site's own live power
// ratings — same formula/sign convention as CfbdPickemPanel.tsx's
// manual paste tool (negative = home favored), just without the
// copy/paste round trip. GET /api/picks already includes homeTeam/
// awayTeam/season directly, so no lookup against our own `games` table
// is needed. Submitted in one batched POST (POST /api/picks still takes
// { picks: [{ gameId, pick }] }, per CFBD's submission-payload example —
// gameId there is this response's "id" field). Also mirrors every
// submitted prediction into cfbd_pickem_predictions so
// CfbdPickemPanel's SU/ATS/MAE/MSE stats pick it up automatically,
// without a separate manual save step.
//
// Re-derives hfaFor()'s tiny lookup inline rather than importing
// src/lib/odds.ts — every other api/*.ts file in this repo is
// self-contained (Vercel bundles this directory in isolation from the
// Vite client build), so this follows the same convention instead of
// introducing a cross-directory import.
async function syncPredictions(res: any) {
  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const picksRes = await fetch(`${PREDICTIONS_BASE}/picks`, { headers: { authorization: `Bearer ${CFBD_PREDICTIONS_TOKEN}` } });
  if (!picksRes.ok) {
    const text = await picksRes.text().catch(() => "");
    throw new Error(`CFBD predictions API request failed (${picksRes.status}): ${text || picksRes.statusText}`);
  }
  const picksData = await picksRes.json();
  const picks: PredictionsPick[] = Array.isArray(picksData) ? picksData : picksData.picks ?? [];
  const rawSample = picks[0] ?? (Array.isArray(picksData) ? null : picksData);
  if (picks.length === 0) {
    res.status(200).json({ ok: true, totalGames: 0, submitted: 0, unmatchedTeams: [], gamesNotFound: [], failedSubmits: [], rawSample });
    return;
  }

  // "latest" isn't a real week label in weekly_team_stats — resolve the
  // actual most-recent week first, same as the rest of the site does.
  const { data: weeks } = await supabaseAdmin
    .from("weekly_team_stats")
    .select("week, week_number")
    .order("week_number", { ascending: false })
    .limit(1);
  const latestWeek = weeks?.[0]?.week;
  if (!latestWeek) throw new Error("No weekly_team_stats rows found to resolve the latest week");

  const { data: ratingRows, error: ratingsError } = await supabaseAdmin
    .from("weekly_team_stats")
    .select("team, rating, hfa")
    .eq("week", latestWeek);
  if (ratingsError) throw ratingsError;

  const ratingByTeam = new Map<string, { rating: number; hfa: number | null }>();
  for (const r of ratingRows ?? []) ratingByTeam.set(r.team, { rating: r.rating, hfa: r.hfa });

  const submissions: { gameId: number; pick: number }[] = [];
  const predictionRows: { game_id: string; season: number; predicted_margin: number }[] = [];
  const unmatched: string[] = [];
  const gamesNotFound: string[] = [];

  for (const p of picks) {
    const home = ratingByTeam.get(p.homeTeam);
    const away = ratingByTeam.get(p.awayTeam);
    if (!home || !away) {
      if (!home) unmatched.push(p.homeTeam);
      if (!away) unmatched.push(p.awayTeam);
      continue;
    }
    const hfa = home.hfa ?? DEFAULT_HFA;
    const predicted = Math.round((home.rating - away.rating - hfa) * 100) / 100;
    submissions.push({ gameId: p.id, pick: predicted });
    predictionRows.push({ game_id: String(p.id), season: p.season, predicted_margin: predicted });
  }

  if (submissions.length > 0) {
    const submitRes = await fetch(`${PREDICTIONS_BASE}/picks`, {
      method: "POST",
      headers: { authorization: `Bearer ${CFBD_PREDICTIONS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ picks: submissions }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      throw new Error(`CFBD picks submission failed (${submitRes.status}): ${text || submitRes.statusText}`);
    }

    const { error: predError } = await supabaseAdmin
      .from("cfbd_pickem_predictions")
      .upsert(predictionRows, { onConflict: "game_id" });
    if (predError) throw predError;
  }

  res.status(200).json({
    ok: true,
    totalGames: picks.length,
    submitted: submissions.length,
    unmatchedTeams: Array.from(new Set(unmatched)),
    gamesNotFound: Array.from(new Set(gamesNotFound)),
    failedSubmits: [],
    rawSample: submissions.length === 0 ? rawSample : undefined,
  });
}

async function cfbdFetch(path: string) {
  const res = await fetch(`${CFBD_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${CFBD_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CFBD request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}


// Team Info pull (admin Team Info page): three independent CFBD pulls, each
// one request — postgame win expectancy (PGWE, the postgame win probability
// CFBD attaches to every /games row), per-game advanced stats (net success
// rate = a team's offensive success rate minus the success rate its defense
// allowed), and head coaches with tenure at their school. `parts` picks
// which to run so a pull costs only what was asked for.
async function syncTeamInfo(res: any, year: number, week: number | null, parts: string[]) {
  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
  const weekParam = week != null ? `&week=${week}` : "";
  const out: any = { ok: true, year, week: week ?? "all", parts };
  const warnings: string[] = [];

  if (parts.includes("pgwe")) {
    const cfbdGames = await cfbdFetch(`/games?year=${year}${weekParam}&seasonType=regular`);
    const now = new Date().toISOString();
    const rows = (cfbdGames ?? []).filter(isTrackedGame).map((g: any) => ({
      id: String(g.id),
      season: g.season,
      week: g.week,
      season_type: g.seasonType ?? "regular",
      home_team: g.homeTeam,
      away_team: g.awayTeam,
      completed: !!g.completed,
      home_points: g.homePoints ?? null,
      away_points: g.awayPoints ?? null,
      home_postgame_win_probability: g.homePostgameWinProbability ?? null,
      away_postgame_win_probability: g.awayPostgameWinProbability ?? null,
      home_line_scores: g.homeLineScores ?? null,
      away_line_scores: g.awayLineScores ?? null,
      updated_at: now,
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("games").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`Saving PGWE failed: ${error.message}`);
    }
    out.pgwe = {
      games: rows.length,
      withPgwe: rows.filter((r: any) => r.home_postgame_win_probability != null).length,
    };
  }

  if (parts.includes("netsr")) {
    const adv = await cfbdFetch(`/stats/game/advanced?year=${year}${weekParam}&seasonType=regular`);
    const now = new Date().toISOString();
    const round = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000);
    const rows: any[] = [];
    for (const r of adv ?? []) {
      const off = r.offense?.successRate;
      const def = r.defense?.successRate;
      if (r.gameId == null || !r.team) continue;
      rows.push({
        game_id: String(r.gameId),
        team: r.team,
        season: r.season ?? year,
        week: r.week ?? null,
        season_type: r.seasonType ?? "regular",
        opponent: r.opponent ?? null,
        off_success_rate: round(off ?? null),
        def_success_rate: round(def ?? null),
        net_success_rate: off != null && def != null ? round(off - def) : null,
        updated_at: now,
      });
    }
    let saved = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error, count } = await supabaseAdmin
        .from("team_game_advanced")
        .upsert(rows.slice(i, i + 500), { onConflict: "game_id,team", count: "exact" });
      if (error) throw new Error(`Saving net success rate failed: ${error.message}`);
      saved += count ?? 0;
    }
    out.netSr = { fetched: (adv ?? []).length, saved, sample: rows[0] ?? null };
    if (rows.length === 0) warnings.push("CFBD returned no advanced game stats for that year/week (games may not have been played yet).");
  }

  if (parts.includes("coaches")) {
    // One request: every coach with a season in the window; tenure is derived
    // by counting the coach's consecutive seasons at the school.
    const coaches = await cfbdFetch(`/coaches?minYear=${year - 30}&maxYear=${year}`);
    // team -> year -> candidates
    const byTeam = new Map<string, Map<number, { key: string; name: string; games: number; hireDate: string | null }[]>>();
    const yearsByCoachTeam = new Map<string, Set<number>>();
    // Every coach-season in the window, kept as-is for the admin coach-history table.
    const seasonRows = new Map<string, any>();
    const nowIso = new Date().toISOString();
    for (const c of coaches ?? []) {
      const key = String(c.id ?? `${c.firstName}|${c.lastName}`);
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
      for (const cs of c.seasons ?? []) {
        if (!cs.school || cs.year == null) continue;
        seasonRows.set(`${cs.school}|${cs.year}|${key}`, {
          team: cs.school,
          year: cs.year,
          coach_id: key,
          coach_name: name,
          hire_date: c.hireDate ?? null,
          games: cs.games ?? null,
          wins: cs.wins ?? null,
          losses: cs.losses ?? null,
          ties: cs.ties ?? null,
          srs: cs.srs ?? null,
          sp_overall: cs.spOverall ?? null,
          preseason_rank: cs.preseasonRank ?? null,
          postseason_rank: cs.postseasonRank ?? null,
          updated_at: nowIso,
        });
        const ty = byTeam.get(cs.school) ?? new Map();
        const list = ty.get(cs.year) ?? [];
        list.push({ key, name, games: cs.games ?? 0, hireDate: c.hireDate ?? null });
        ty.set(cs.year, list);
        byTeam.set(cs.school, ty);
        const ck = `${key}|${cs.school}`;
        const ys = yearsByCoachTeam.get(ck) ?? new Set();
        ys.add(cs.year);
        yearsByCoachTeam.set(ck, ys);
      }
    }
    const now = new Date().toISOString();
    const rows: any[] = [];
    for (const [team, ty] of byTeam) {
      const years = Array.from(ty.keys()).filter((y) => y <= year);
      if (years.length === 0) continue;
      const latest = Math.max(...years);
      if (latest < year - 1) continue; // program not active recently
      const head = [...(ty.get(latest) ?? [])].sort((a, b) => b.games - a.games)[0];
      if (!head) continue;
      const ys = yearsByCoachTeam.get(`${head.key}|${team}`) ?? new Set<number>();
      let tenure = 0;
      let first = latest;
      for (let y = latest; ys.has(y); y--) {
        tenure += 1;
        first = y;
      }
      rows.push({
        season: year,
        team,
        coach_name: head.name,
        hire_date: head.hireDate,
        tenure_seasons: tenure,
        first_year_at_school: first,
        latest_year_with_data: latest,
        updated_at: now,
      });
    }
    let saved = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error, count } = await supabaseAdmin
        .from("team_coaches")
        .upsert(rows.slice(i, i + 500), { onConflict: "season,team", count: "exact" });
      if (error) throw new Error(`Saving coaches failed: ${error.message}`);
      saved += count ?? 0;
    }
    const historyRows = Array.from(seasonRows.values());
    let historySaved = 0;
    for (let i = 0; i < historyRows.length; i += 500) {
      const { error, count } = await supabaseAdmin
        .from("team_coach_seasons")
        .upsert(historyRows.slice(i, i + 500), { onConflict: "team,year,coach_id", count: "exact" });
      if (error) throw new Error(`Saving coach history failed: ${error.message}`);
      historySaved += count ?? 0;
    }
    out.coaches = {
      fetched: (coaches ?? []).length,
      historySeasons: historySaved,
      teams: saved,
      staleTeams: rows.filter((r) => r.latest_year_with_data < year).length,
      sample: rows[0] ?? null,
    };
    if (rows.length === 0) warnings.push("CFBD returned no coach seasons — check the response shape.");
  }

  if (warnings.length) out.warnings = warnings;
  res.status(200).json(out);
}

// DROGBA (admin spread-model page) backfill. Two independent parts, each safe to re-run:
//  - "gameadv": one week of /stats/game/advanced → team_game_advanced (PPA, success rate,
//    explosiveness, etc. for BOTH sides of every game). The page loops season × week so each
//    request stays small.
//  - "preseason": one season of returning production, talent, recruiting class and transfer portal
//    → team_preseason_inputs. These are the priors that carry a team into week 1.
// Response shapes for the preseason endpoints follow CFBD's published schema but were NOT checked
// against a live response from here — every field is optional-chained, a `sample` row comes back
// so the first run can be eyeballed, and an empty result adds a warning rather than throwing.
async function syncDrogba(res: any, year: number, week: number | null, part: string) {
  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
  const out: any = { ok: true, year, week: week ?? "all", part };
  const warnings: string[] = [];
  const r5 = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100000) / 100000);

  if (part === "gameadv") {
    const weekParam = week != null ? `&week=${week}` : "";
    const adv = await cfbdFetch(`/stats/game/advanced?year=${year}${weekParam}&seasonType=regular`);
    const now = new Date().toISOString();
    const rows: any[] = [];
    for (const r of adv ?? []) {
      if (r.gameId == null || !r.team) continue;
      const o = r.offense ?? {};
      const d = r.defense ?? {};
      const off = o.successRate;
      const def = d.successRate;
      rows.push({
        game_id: String(r.gameId),
        team: r.team,
        season: r.season ?? year,
        week: r.week ?? week ?? null,
        season_type: r.seasonType ?? "regular",
        opponent: r.opponent ?? null,
        off_success_rate: r5(off),
        def_success_rate: r5(def),
        net_success_rate: off != null && def != null ? r5(off - def) : null,
        off_plays: r5(o.plays), def_plays: r5(d.plays),
        off_drives: r5(o.drives), def_drives: r5(d.drives),
        off_ppa: r5(o.ppa), def_ppa: r5(d.ppa),
        off_explosiveness: r5(o.explosiveness), def_explosiveness: r5(d.explosiveness),
        off_power_success: r5(o.powerSuccess), def_power_success: r5(d.powerSuccess),
        off_stuff_rate: r5(o.stuffRate), def_stuff_rate: r5(d.stuffRate),
        off_line_yards: r5(o.lineYards), def_line_yards: r5(d.lineYards),
        off_havoc_total: r5(o.havoc?.total), def_havoc_total: r5(d.havoc?.total),
        off_rush_ppa: r5(o.rushingPlays?.ppa), def_rush_ppa: r5(d.rushingPlays?.ppa),
        off_rush_success_rate: r5(o.rushingPlays?.successRate), def_rush_success_rate: r5(d.rushingPlays?.successRate),
        off_pass_ppa: r5(o.passingPlays?.ppa), def_pass_ppa: r5(d.passingPlays?.ppa),
        off_pass_success_rate: r5(o.passingPlays?.successRate), def_pass_success_rate: r5(d.passingPlays?.successRate),
        off_standard_downs_ppa: r5(o.standardDowns?.ppa), def_standard_downs_ppa: r5(d.standardDowns?.ppa),
        off_passing_downs_ppa: r5(o.passingDowns?.ppa), def_passing_downs_ppa: r5(d.passingDowns?.ppa),
        updated_at: now,
      });
    }
    let saved = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const { error, count } = await supabaseAdmin
        .from("team_game_advanced")
        .upsert(rows.slice(i, i + 400), { onConflict: "game_id,team", count: "exact" });
      if (error) throw new Error(`Saving per-game advanced stats failed: ${error.message}`);
      saved += count ?? 0;
    }
    out.gameAdv = { fetched: (adv ?? []).length, saved, withPpa: rows.filter((r) => r.off_ppa != null).length, sample: rows[0] ?? null };
    if (rows.length === 0) warnings.push("CFBD returned no advanced game stats for that year/week.");
  }

  if (part === "plays") {
    if (week == null) throw new Error("'week' is required for the plays part");
    // One request = one week of every FBS offense's plays (roughly 20k plays). They are aggregated here into per
    // team-game numbers and only those are stored. Falls back to an unfiltered request if the classification filter
    // is rejected.
    const base = `/plays?year=${year}&week=${week}&seasonType=regular`;
    let plays: any[];
    try {
      plays = await cfbdFetch(`${base}&classification=fbs`);
    } catch (e: any) {
      if (!/\(400\)|\(422\)/.test(String(e?.message))) throw e;
      warnings.push(`classification filter rejected (${e.message}); pulled every classification`);
      plays = await cfbdFetch(base);
    }
    const { rows: aggRows, diag } = aggregatePlays(plays ?? []);
    const now = new Date().toISOString();
    const rows = aggRows.map((r) => ({ ...r, season: year, week, updated_at: now }));
    let saved = 0;
    for (let i = 0; i < rows.length; i += 300) {
      const { error, count } = await supabaseAdmin
        .from("team_game_play_agg")
        .upsert(rows.slice(i, i + 300), { onConflict: "game_id,team", count: "exact" });
      if (error) throw new Error(`Saving play aggregates failed: ${error.message}`);
      saved += count ?? 0;
    }
    const topTypes = Object.entries(diag.byType).sort((a, b) => b[1] - a[1]).slice(0, 25);
    out.plays = {
      fetched: (plays ?? []).length,
      teamGames: rows.length,
      saved,
      scrimmage: diag.scrimmage,
      garbageDropped: diag.garbage,
      ppaCoverage: { scrimmage: diag.scrimmage ? diag.withPpaScrimmage / diag.scrimmage : null, specialTeams: diag.specialPlays ? diag.withPpaSpecial / diag.specialPlays : null },
      kicks: { puntNetAvg: diag.puntNetAvg, puntNetCoverage: diag.puntNetCoverage, koNetAvg: diag.koNetAvg, koNetCoverage: diag.koNetCoverage },
      topPlayTypes: topTypes,
      sample: rows[0] ?? null,
    };
    if (rows.length === 0) warnings.push("CFBD returned no plays for that year/week.");
  }

  if (part === "preseason") {
    const byTeam = new Map<string, any>();
    const entry = (team: string) => {
      let e = byTeam.get(team);
      if (!e) {
        e = { season: year, team };
        byTeam.set(team, e);
      }
      return e;
    };
    const counts: Record<string, number> = {};

    const returning = await cfbdFetch(`/player/returning?year=${year}`).catch((e: any) => {
      warnings.push(`returning production: ${e.message}`);
      return [];
    });
    for (const r of returning ?? []) {
      if (!r.team) continue;
      const e = entry(r.team);
      e.returning_ppa_pct = r5(r.percentPPA);
      e.returning_pass_ppa_pct = r5(r.percentPassingPPA);
      e.returning_rush_ppa_pct = r5(r.percentRushingPPA);
      e.returning_rec_ppa_pct = r5(r.percentReceivingPPA);
      e.returning_usage = r5(r.usage);
      e.returning_total_ppa = r5(r.totalPPA);
      counts.returning = (counts.returning ?? 0) + 1;
    }

    const talent = await cfbdFetch(`/talent?year=${year}`).catch((e: any) => {
      warnings.push(`talent: ${e.message}`);
      return [];
    });
    for (const t of talent ?? []) {
      const team = t.team ?? t.school;
      if (!team) continue;
      entry(team).talent = r5(t.talent);
      counts.talent = (counts.talent ?? 0) + 1;
    }

    const recruiting = await cfbdFetch(`/recruiting/teams?year=${year}`).catch((e: any) => {
      warnings.push(`recruiting: ${e.message}`);
      return [];
    });
    for (const t of recruiting ?? []) {
      if (!t.team) continue;
      const e = entry(t.team);
      e.recruiting_rank = t.rank ?? null;
      e.recruiting_points = r5(t.points);
      counts.recruiting = (counts.recruiting ?? 0) + 1;
    }

    const portal = await cfbdFetch(`/player/portal?year=${year}`).catch((e: any) => {
      warnings.push(`portal: ${e.message}`);
      return [];
    });
    const agg = new Map<string, { inN: number; inR: number; outN: number; outR: number }>();
    const bump = (team: string, dir: "in" | "out", rating: number) => {
      const a = agg.get(team) ?? { inN: 0, inR: 0, outN: 0, outR: 0 };
      if (dir === "in") {
        a.inN += 1;
        a.inR += rating;
      } else {
        a.outN += 1;
        a.outR += rating;
      }
      agg.set(team, a);
    };
    for (const p of portal ?? []) {
      const rating = Number(p.rating ?? 0.7) || 0.7; // unrated transfer ≈ a generic 3-star
      if (p.destination) bump(p.destination, "in", rating);
      if (p.origin) bump(p.origin, "out", rating);
    }
    for (const [team, a] of agg) {
      const e = entry(team);
      e.portal_in_count = a.inN;
      e.portal_in_rating_sum = r5(a.inR);
      e.portal_out_count = a.outN;
      e.portal_out_rating_sum = r5(a.outR);
    }
    counts.portalPlayers = (portal ?? []).length;

    const now = new Date().toISOString();
    const rows = Array.from(byTeam.values()).map((e) => ({ ...e, updated_at: now }));
    let saved = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const { error, count } = await supabaseAdmin
        .from("team_preseason_inputs")
        .upsert(rows.slice(i, i + 400), { onConflict: "season,team", count: "exact" });
      if (error) throw new Error(`Saving preseason inputs failed: ${error.message}`);
      saved += count ?? 0;
    }
    out.preseason = { teams: rows.length, saved, counts, sample: rows[0] ?? null };
    if (rows.length === 0) warnings.push("CFBD returned nothing for returning production / talent / recruiting / portal.");
  }

  if (warnings.length) out.warnings = warnings;
  res.status(200).json(out);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  if (req.body?.mode === "predictions") {
    const { password } = req.body ?? {};
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    if (!CFBD_PREDICTIONS_TOKEN) {
      res.status(500).json({ error: "CFBD_PREDICTIONS_TOKEN is not configured on the server" });
      return;
    }
    try {
      await syncPredictions(res);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Predictions sync failed" });
    }
    return;
  }

  if (req.body?.mode === "drogba") {
    const { password, year, week, part } = req.body ?? {};
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    if (!CFBD_API_KEY) {
      res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
      return;
    }
    if (!year || typeof year !== "number") {
      res.status(400).json({ error: "Missing or invalid 'year'" });
      return;
    }
    if (part !== "gameadv" && part !== "preseason" && part !== "plays") {
      res.status(400).json({ error: "'part' must be 'gameadv', 'preseason' or 'plays'" });
      return;
    }
    try {
      await syncDrogba(res, year, typeof week === "number" ? week : null, part);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "DROGBA sync failed" });
    }
    return;
  }

  if (req.body?.mode === "teaminfo") {
    const { password, year, week, parts } = req.body ?? {};
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    if (!CFBD_API_KEY) {
      res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
      return;
    }
    if (!year || typeof year !== "number") {
      res.status(400).json({ error: "Missing or invalid 'year'" });
      return;
    }
    const wanted = (Array.isArray(parts) ? parts : ["pgwe", "netsr", "coaches"]).filter((p: string) => ["pgwe", "netsr", "coaches"].includes(p));
    try {
      await syncTeamInfo(res, year, typeof week === "number" ? week : null, wanted);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Team info pull failed" });
    }
    return;
  }

  if (!CFBD_API_KEY) {
    res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
    return;
  }

  const { password, year, week, seasonType, syncStats } = req.body ?? {};

  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!year || typeof year !== "number") {
    res.status(400).json({ error: "Missing or invalid 'year'" });
    return;
  }
  if (week != null && typeof week !== "number") {
    res.status(400).json({ error: "'week', if provided, must be a number" });
    return;
  }

  const stype = seasonType === "postseason" ? "postseason" : "regular";
  const weekParam = week != null ? `&week=${week}` : "";
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // --- Games ---
    const cfbdGames = await cfbdFetch(`/games?year=${year}${weekParam}&seasonType=${stype}`);
    const trackedGames = (cfbdGames ?? []).filter(isTrackedGame);
    const trackedGameIds = new Set(trackedGames.map((g: any) => String(g.id)));

    // TV/radio/streaming outlet per game — best-effort merge by game id;
    // a game with no media entry yet (announced late) just has null
    // tv_outlet/media_type until the next sync.
    const cfbdMedia = await cfbdFetch(`/games/media?year=${year}${weekParam}&seasonType=${stype}`).catch(() => []);
    const mediaByGameId = new Map<string, { outlet: string | null; mediaType: string | null }>();
    for (const m of cfbdMedia ?? []) {
      // Prefer a "tv" entry over radio/web/etc if a game has more than
      // one outlet listed; otherwise take whatever's first.
      const existing = mediaByGameId.get(String(m.id));
      if (!existing || (m.mediaType === "tv" && existing.mediaType !== "tv")) {
        mediaByGameId.set(String(m.id), { outlet: m.outlet ?? null, mediaType: m.mediaType ?? null });
      }
    }

    const gameRows = trackedGames.map((g: any) => {
      const media = mediaByGameId.get(String(g.id));
      return {
        id: String(g.id),
        season: g.season,
        week: g.week,
        season_type: g.seasonType ?? stype,
        start_date: g.startDate ?? null,
        neutral_site: !!g.neutralSite,
        conference_game: !!g.conferenceGame,
        completed: !!g.completed,
        home_team: g.homeTeam,
        home_classification: g.homeClassification ?? null,
        home_conference: g.homeConference ?? null,
        home_points: g.homePoints ?? null,
        home_postgame_win_probability: g.homePostgameWinProbability ?? null,
        // Per-quarter (and OT) scores — CFBD returns these on the same
        // /games payload already being synced, no extra request. Feeds
        // the period (1H/2H/quarter) projection work; null for games
        // CFBD hasn't backfilled line scores for.
        home_line_scores: g.homeLineScores ?? null,
        away_line_scores: g.awayLineScores ?? null,
        away_team: g.awayTeam,
        away_classification: g.awayClassification ?? null,
        away_conference: g.awayConference ?? null,
        away_points: g.awayPoints ?? null,
        away_postgame_win_probability: g.awayPostgameWinProbability ?? null,
        tv_outlet: media?.outlet ?? null,
        media_type: media?.mediaType ?? null,
        updated_at: new Date().toISOString(),
      };
    });

    let gamesUpserted = 0;
    if (gameRows.length > 0) {
      const { error: gamesError, count } = await supabaseAdmin
        .from("games")
        .upsert(gameRows, { onConflict: "id", count: "exact" });
      if (gamesError) {
        res.status(500).json({ error: `Saving games failed: ${gamesError.message}` });
        return;
      }
      gamesUpserted = count ?? gameRows.length;
    }

    // --- Betting lines ---
    const cfbdLines = await cfbdFetch(`/lines?year=${year}${weekParam}&seasonType=${stype}`);

    const lineRows: any[] = [];
    for (const entry of cfbdLines ?? []) {
      const gameId = String(entry.id);
      if (!trackedGameIds.has(gameId)) continue;
      for (const line of entry.lines ?? []) {
        lineRows.push({
          game_id: gameId,
          season: entry.season ?? year,
          week: entry.week ?? week ?? null,
          provider: line.provider ?? "unknown",
          spread: line.spread != null ? Number(line.spread) : null,
          over_under: line.overUnder != null ? Number(line.overUnder) : null,
          // Opening lines — NOT previously captured at all. CFBD's field
          // names here are inferred as "spreadOpen"/"overUnderOpen"
          // (camelCase "Open" suffix, matching their convention
          // elsewhere) but haven't been confirmed against a live
          // response — worth checking the first real sync's stored
          // values against collegefootballdata.com's own game page to
          // make sure these landed correctly, since a silent null here
          // would just make Composite 3-6 fall back to "live" forever
          // without an obvious error.
          opening_spread: line.spreadOpen != null ? Number(line.spreadOpen) : null,
          opening_over_under: line.overUnderOpen != null ? Number(line.overUnderOpen) : null,
          // Confirmed against CFBD's OpenAPI spec: homeMoneyline/awayMoneyline
          // (camelCase). The betting_lines columns for these already existed
          // and are read elsewhere (matchupsCompute.ts, espnMlPool.ts), but
          // nothing ever actually wrote them — this was a silent gap, not a
          // wrong field name.
          home_moneyline: line.homeMoneyline != null ? Number(line.homeMoneyline) : null,
          away_moneyline: line.awayMoneyline != null ? Number(line.awayMoneyline) : null,
          pulled_at: new Date().toISOString(),
        });
      }
    }

    let linesUpserted = 0;
    if (lineRows.length > 0) {
      const { error: linesError, count } = await supabaseAdmin
        .from("betting_lines")
        .upsert(lineRows, { onConflict: "game_id,provider", count: "exact" });
      if (linesError) {
        res.status(500).json({ error: `Saving betting lines failed: ${linesError.message}` });
        return;
      }
      linesUpserted = count ?? lineRows.length;
    }

    // --- Team season stats (only when explicitly requested — separate
    // concern from games/lines, and a much bigger payload) ---
    let statsTeamsUpserted = 0;
    if (syncStats) {
      // /stats/season is long-format: one row per {team, statName,
      // statValue}. Pivot into one wide row per team, keeping only the
      // fields the Game Totals engine actually uses.
      const basicStats = await cfbdFetch(`/stats/season?year=${year}`);
      const WANTED_STATS: Record<string, string> = {
        rushingAttempts: "rushing_attempts",
        rushingYards: "rushing_yards",
        rushingAttemptsOpponent: "rushing_attempts_opponent",
        rushingYardsOpponent: "rushing_yards_opponent",
        passAttempts: "pass_attempts",
        netPassingYards: "net_passing_yards",
        passAttemptsOpponent: "pass_attempts_opponent",
        netPassingYardsOpponent: "net_passing_yards_opponent",
        totalYards: "total_yards",
        totalYardsOpponent: "total_yards_opponent",
        games: "games",
        possessionTime: "possession_time",
        possessionTimeOpponent: "possession_time_opponent",
      };

      // CFBD returns possessionTime as MM:SS — converted to seconds so
      // it's a plain number to do math on later.
      function toSeconds(v: any): number | null {
        if (v == null) return null;
        if (typeof v === "number") return v;
        const parts = String(v).split(":");
        if (parts.length !== 2) return Number(v) || null;
        const [m, s] = parts.map(Number);
        return m * 60 + s;
      }

      const byTeam = new Map<string, any>();
      for (const row of basicStats ?? []) {
        const col = WANTED_STATS[row.statName];
        if (!col) continue;
        const key = row.team;
        const entry = byTeam.get(key) ?? { season: row.season ?? year, team: row.team, conference: row.conference ?? null };
        entry[col] = col === "possession_time" || col === "possession_time_opponent" ? toSeconds(row.statValue) : Number(row.statValue);
        byTeam.set(key, entry);
      }

      // /stats/season/advanced — nested offense/defense objects, per
      // established CFBD API convention (matches how the CSV exporter's
      // "Offense Plays"/"Defense Plays" columns are flattened from
      // offense.plays/defense.plays). NOT verified against a live
      // response yet — every field below is read with optional chaining
      // so a wrong nesting assumption produces nulls, not a thrown error;
      // worth checking a real synced row against CFBD's docs/an actual
      // response the first time this runs. This used to only keep
      // plays/drives — the Game Totals engine now runs on the full
      // efficiency set (PPA/success rate/explosiveness/points-per-
      // opportunity/havoc/etc.), so everything CFBD gives us here gets
      // stored instead of discarded.
      const advancedStats = await cfbdFetch(`/stats/season/advanced?year=${year}`);
      for (const row of advancedStats ?? []) {
        const entry = byTeam.get(row.team) ?? { season: row.season ?? year, team: row.team, conference: row.conference ?? null };
        const off = row.offense ?? {};
        const def = row.defense ?? {};

        entry.offense_plays = off.plays ?? null;
        entry.offense_drives = off.drives ?? null;
        entry.defense_plays = def.plays ?? null;
        entry.defense_drives = def.drives ?? null;

        entry.off_ppa = off.ppa ?? null;
        entry.off_success_rate = off.successRate ?? null;
        entry.off_explosiveness = off.explosiveness ?? null;
        entry.off_points_per_opportunity = off.pointsPerOpportunity ?? null;
        entry.off_power_success = off.powerSuccess ?? null;
        entry.off_stuff_rate = off.stuffRate ?? null;
        entry.off_line_yards = off.lineYards ?? null;
        entry.off_standard_downs_ppa = off.standardDowns?.ppa ?? null;
        entry.off_standard_downs_success_rate = off.standardDowns?.successRate ?? null;
        entry.off_standard_downs_explosiveness = off.standardDowns?.explosiveness ?? null;
        entry.off_passing_downs_ppa = off.passingDowns?.ppa ?? null;
        entry.off_passing_downs_success_rate = off.passingDowns?.successRate ?? null;
        entry.off_passing_downs_explosiveness = off.passingDowns?.explosiveness ?? null;
        entry.off_rushing_plays_ppa = off.rushingPlays?.ppa ?? null;
        entry.off_rushing_plays_success_rate = off.rushingPlays?.successRate ?? null;
        entry.off_rushing_plays_explosiveness = off.rushingPlays?.explosiveness ?? null;
        entry.off_passing_plays_ppa = off.passingPlays?.ppa ?? null;
        entry.off_passing_plays_success_rate = off.passingPlays?.successRate ?? null;
        entry.off_passing_plays_explosiveness = off.passingPlays?.explosiveness ?? null;
        entry.off_field_position_avg_start = off.fieldPosition?.averageStart ?? null;
        entry.off_field_position_avg_predicted_points = off.fieldPosition?.averagePredictedPoints ?? null;
        entry.off_havoc_total = off.havoc?.total ?? null;
        entry.off_havoc_front_seven = off.havoc?.frontSeven ?? null;
        entry.off_havoc_db = off.havoc?.db ?? null;

        entry.def_ppa = def.ppa ?? null;
        entry.def_success_rate = def.successRate ?? null;
        entry.def_explosiveness = def.explosiveness ?? null;
        entry.def_points_per_opportunity = def.pointsPerOpportunity ?? null;
        entry.def_power_success = def.powerSuccess ?? null;
        entry.def_stuff_rate = def.stuffRate ?? null;
        entry.def_line_yards = def.lineYards ?? null;
        entry.def_standard_downs_ppa = def.standardDowns?.ppa ?? null;
        entry.def_standard_downs_success_rate = def.standardDowns?.successRate ?? null;
        entry.def_standard_downs_explosiveness = def.standardDowns?.explosiveness ?? null;
        entry.def_passing_downs_ppa = def.passingDowns?.ppa ?? null;
        entry.def_passing_downs_success_rate = def.passingDowns?.successRate ?? null;
        entry.def_passing_downs_explosiveness = def.passingDowns?.explosiveness ?? null;
        entry.def_rushing_plays_ppa = def.rushingPlays?.ppa ?? null;
        entry.def_rushing_plays_success_rate = def.rushingPlays?.successRate ?? null;
        entry.def_rushing_plays_explosiveness = def.rushingPlays?.explosiveness ?? null;
        entry.def_passing_plays_ppa = def.passingPlays?.ppa ?? null;
        entry.def_passing_plays_success_rate = def.passingPlays?.successRate ?? null;
        entry.def_passing_plays_explosiveness = def.passingPlays?.explosiveness ?? null;
        entry.def_field_position_avg_start = def.fieldPosition?.averageStart ?? null;
        entry.def_field_position_avg_predicted_points = def.fieldPosition?.averagePredictedPoints ?? null;
        entry.def_havoc_total = def.havoc?.total ?? null;
        entry.def_havoc_front_seven = def.havoc?.frontSeven ?? null;
        entry.def_havoc_db = def.havoc?.db ?? null;

        byTeam.set(row.team, entry);
      }

      const statRows = Array.from(byTeam.values()).map((e) => ({ ...e, updated_at: new Date().toISOString() }));

      if (statRows.length > 0) {
        const { error: statsError, count } = await supabaseAdmin
          .from("team_season_stats")
          .upsert(statRows, { onConflict: "season,team", count: "exact" });
        if (statsError) {
          res.status(500).json({ error: `Saving team season stats failed: ${statsError.message}` });
          return;
        }
        statsTeamsUpserted = count ?? statRows.length;
      }
    }

    res.status(200).json({
      ok: true,
      year,
      week: week ?? "all",
      seasonType: stype,
      gamesFetched: (cfbdGames ?? []).length,
      gamesSkippedByDivision: (cfbdGames ?? []).length - trackedGames.length,
      gamesUpserted,
      linesUpserted,
      statsTeamsUpserted,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "CFBD sync failed" });
  }
}
