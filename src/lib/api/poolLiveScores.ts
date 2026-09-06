import { fetchGamesWithLines } from "./gamesLines";
import { computeCurrentWeek } from "./survivorPoolPublic";
import { fetchCbsSplashWeek, gradeCbsPick, gradeKellyPick } from "./cbsSplashPool";
import { fetchPeayWeek, gradePeayPick } from "./peayPool";
import { fetchWestgateWeek, gradeWestgatePick } from "./westgatePool";
import { fetchBritPicksForWeek, summarizeWeekRecord } from "./britPool";
import { fetchEspnMlPicksForWeek, gradeEspnMlPick } from "./espnMlPool";
import { fetchEspnSpreadPicksForWeek, gradeEspnSpreadPick } from "./espnSpreadPool";
import { fetchCbsPickemPicksForWeek, gradeCbsPickemPick } from "./cbsPickemPool";

export interface LiveRecord {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  total: number;
}

function emptyLiveRecord(): LiveRecord {
  return { wins: 0, losses: 0, pushes: 0, pending: 0, total: 0 };
}

function tally(rec: LiveRecord, grade: "win" | "loss" | "push" | "pending") {
  rec.total++;
  if (grade === "win") rec.wins++;
  else if (grade === "loss") rec.losses++;
  else if (grade === "push") rec.pushes++;
  else rec.pending++;
}

export interface PoolLiveScores {
  season: number;
  week: number;
  cbs: LiveRecord;
  kelly: LiveRecord;
  peay: LiveRecord;
  westgate: LiveRecord;
  brit: LiveRecord;
  espnml: LiveRecord;
  espnspread: LiveRecord;
  cbspickem: LiveRecord;
}

/**
 * This week's live record for every DB-backed pick pool, computed
 * straight from already-saved picks + whatever's currently synced in
 * `games` — no new state, just re-grading with each pool's own existing
 * grade function so this can never drift from what that pool's own page
 * shows. "This week" is resolved automatically (the week right after
 * the last one where every game finished), so it tracks a live Saturday
 * without the admin picking a week by hand.
 *
 * Confidence pools (ESPN/Reddit Confidence) aren't included — Chris
 * doesn't reliably save picks for those, so there's nothing to grade.
 * Survivor/Splash Survivor aren't included either — their "current
 * pick" lives in browser localStorage, not a game_id-bearing Supabase
 * row, so they need their own resolution path (see SurvivorPanel.tsx).
 */
export async function fetchPoolLiveScores(season: number, liveByTeam: Record<string, any> = {}): Promise<PoolLiveScores> {
  const seasonGames = await fetchGamesWithLines(season);
  const week = computeCurrentWeek(seasonGames.map((g) => ({ week: g.week, completed: g.completed })));

  const [cbsSplashRows, peayRows, westgateRows, britPicks, espnMlRows, espnSpreadRows, cbsPickemRows] = await Promise.all([
    fetchCbsSplashWeek(season, week, liveByTeam),
    fetchPeayWeek(season, week, liveByTeam),
    fetchWestgateWeek(season, week, liveByTeam),
    fetchBritPicksForWeek(season, week),
    fetchEspnMlPicksForWeek(season, week, liveByTeam),
    fetchEspnSpreadPicksForWeek(season, week, liveByTeam),
    fetchCbsPickemPicksForWeek(season, week, liveByTeam),
  ]);

  const cbs = emptyLiveRecord();
  const kelly = emptyLiveRecord();
  cbsSplashRows.filter((r) => r.cbsSelected).forEach((r) => tally(cbs, gradeCbsPick(r)));
  cbsSplashRows.filter((r) => r.kellySelected).forEach((r) => tally(kelly, gradeKellyPick(r)));

  const peay = emptyLiveRecord();
  peayRows.filter((r) => r.picked_side != null).forEach((r) => tally(peay, gradePeayPick(r)));

  const westgate = emptyLiveRecord();
  westgateRows.filter((r) => r.picked_side != null).forEach((r) => tally(westgate, gradeWestgatePick(r)));

  const britSummary = summarizeWeekRecord(britPicks);
  const brit: LiveRecord = { wins: britSummary.wins, losses: britSummary.losses, pushes: britSummary.pushes, pending: britSummary.pending, total: britSummary.total };

  const espnml = emptyLiveRecord();
  espnMlRows.forEach((r) => tally(espnml, gradeEspnMlPick(r)));

  const espnspread = emptyLiveRecord();
  espnSpreadRows.forEach((r) => tally(espnspread, gradeEspnSpreadPick(r)));

  const cbspickem = emptyLiveRecord();
  cbsPickemRows.forEach((r) => tally(cbspickem, gradeCbsPickemPick(r)));

  return { season, week, cbs, kelly, peay, westgate, brit, espnml, espnspread, cbspickem };
}
