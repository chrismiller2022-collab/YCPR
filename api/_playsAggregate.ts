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
}

export interface PlayDiagnostics {
  plays: number;
  scrimmage: number;
  garbage: number;
  withPpaScrimmage: number;
  withPpaSpecial: number;
  specialPlays: number;
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
  const diag: PlayDiagnostics = { plays: 0, scrimmage: 0, garbage: 0, withPpaScrimmage: 0, withPpaSpecial: 0, specialPlays: 0, byType: {} };

  for (const p of plays) {
    if (p.gameId == null || !p.offense) continue;
    diag.plays++;
    const type = String(p.playType ?? "");
    diag.byType[type] = (diag.byType[type] ?? 0) + 1;
    const text = String(p.playText ?? "");
    const gameId = String(p.gameId);
    const ppa = numOrNull(p.ppa);
    const agg = get(gameId, p.offense);

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
    if (/^punt/i.test(type) || /punt/i.test(type)) {
      if (/return/i.test(type) && !/^punt/i.test(type)) continue;
      agg.st_punt_n++;
      agg.st_punt_yds += numOrNull(p.yardsGained) ?? 0;
      if (ppa != null) {
        agg.st_punt_ppa += ppa;
        agg.st_ppa_sum += ppa;
        diag.withPpaSpecial++;
      }
      agg.st_n++;
      diag.specialPlays++;
      continue;
    }
    if (/kickoff/i.test(type)) {
      agg.st_ko_n++;
      agg.st_ko_yds += numOrNull(p.yardsGained) ?? 0;
      if (ppa != null) {
        agg.st_ko_ppa += ppa;
        agg.st_ppa_sum += ppa;
        diag.withPpaSpecial++;
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
  return { rows: Array.from(by.values()), diag };
}
