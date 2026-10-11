import { useEffect, useMemo, useState } from "react";
import { useScoreboard } from "./overlay";

// ---------------------------------------------------------------------
// Sleeper fantasy for the TV score bug. Sleeper's API is public and
// read-only (no login, CORS open), so the TV calls it directly; the one
// exception is the ~15 MB player list, which odds-feed.ts trims to
// ~100 KB and edge-caches for a day (mode=sleeper-players).
// Matchup points are live during games; polled every 90s while shown.
// ---------------------------------------------------------------------

const API = "https://api.sleeper.app/v1";
const POLL_MS = 90_000;

export interface FantasyPlayer {
  id: string;
  name: string;
  team: string | null; // ESPN-style abbreviation, to match the NFL scoreboard
  pos: string | null;
  slot: string; // lineup slot (QB, RB, FLEX, SUPER_FLEX, …)
  pts: number;
  injury: string | null;
}

export interface FantasySide {
  teamName: string;
  points: number;
  record: string;
  starters: FantasyPlayer[];
}

export interface FantasyLeague {
  id: string;
  name: string;
  me: FantasySide;
  opp: FantasySide | null; // null on a bye / out of the playoffs
}

export interface SleeperLeagueInfo {
  id: string;
  name: string;
}

type PlayerMap = Record<string, [string, string | null, string | null, string | null]>;

// Sleeper and ESPN agree on every NFL abbreviation except Washington.
const toEspn = (team: string | null) => (team === "WAS" ? "WSH" : team);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sleeper request failed (${r.status})`);
  return r.json();
}

let playersPromise: Promise<PlayerMap> | null = null;
function loadPlayers(): Promise<PlayerMap> {
  playersPromise ??= getJson<{ players: PlayerMap }>("/api/odds-feed?mode=sleeper-players")
    .then((b) => b.players)
    .catch((e) => {
      playersPromise = null;
      throw e;
    });
  return playersPromise;
}

async function nflState(): Promise<{ season: string; week: number }> {
  const s = await getJson<any>(`${API}/state/nfl`);
  return { season: s.league_season ?? s.season, week: s.display_week ?? s.week };
}

/** All of a user's NFL leagues this season — for the control page's checklist. */
export async function fetchSleeperLeagues(username: string): Promise<SleeperLeagueInfo[]> {
  const user = await getJson<any>(`${API}/user/${encodeURIComponent(username)}`);
  if (!user?.user_id) throw new Error(`No Sleeper user "${username}"`);
  const { season } = await nflState();
  const leagues = (await getJson<any[]>(`${API}/user/${user.user_id}/leagues/nfl/${season}`)) ?? [];
  return leagues.map((l) => ({ id: l.league_id, name: l.name }));
}

async function loadLeague(leagueId: string, userId: string, week: number, players: PlayerMap): Promise<FantasyLeague | null> {
  const [league, users, rosters, matchups] = await Promise.all([
    getJson<any>(`${API}/league/${leagueId}`),
    getJson<any[]>(`${API}/league/${leagueId}/users`),
    getJson<any[]>(`${API}/league/${leagueId}/rosters`),
    getJson<any[]>(`${API}/league/${leagueId}/matchups/${week}`),
  ]);
  const mine = rosters.find((r) => r.owner_id === userId || (r.co_owners ?? []).includes(userId));
  if (!mine) return null;
  const slots: string[] = (league.roster_positions ?? []).filter((p: string) => !["BN", "IR", "TAXI"].includes(p));

  const side = (rosterId: number): FantasySide | null => {
    const roster = rosters.find((r) => r.roster_id === rosterId);
    const m = (matchups ?? []).find((x) => x.roster_id === rosterId);
    if (!roster) return null;
    const user = users.find((u) => u.user_id === roster.owner_id);
    const st = roster.settings ?? {};
    return {
      teamName: user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`,
      points: m?.points ?? 0,
      record: `${st.wins ?? 0}-${st.losses ?? 0}${st.ties ? `-${st.ties}` : ""}`,
      starters: ((m?.starters ?? roster.starters ?? []) as string[]).map((id, i) => {
        const p = players[id];
        return {
          id,
          name: id === "0" ? "Empty" : p?.[0] ?? id,
          team: toEspn(p?.[1] ?? null),
          pos: p?.[2] ?? null,
          slot: slots[i] ?? "",
          pts: m?.players_points?.[id] ?? 0,
          injury: p?.[3] ?? null,
        };
      }),
    };
  };

  const meSide = side(mine.roster_id)!;
  const myMatch = (matchups ?? []).find((x) => x.roster_id === mine.roster_id);
  const oppMatch = myMatch?.matchup_id != null ? (matchups ?? []).find((x) => x.matchup_id === myMatch.matchup_id && x.roster_id !== mine.roster_id) : null;
  return { id: leagueId, name: league.name, me: meSide, opp: oppMatch ? side(oppMatch.roster_id) : null };
}

/**
 * Live fantasy data for a Sleeper user. `leagueIds` empty = every league.
 * Inactive (no username, or nothing on screen uses it) = no requests.
 */
export function useSleeper(username: string | null, leagueIds: string[], active: boolean) {
  const [leagues, setLeagues] = useState<FantasyLeague[]>([]);
  const [error, setError] = useState<string | null>(null);
  const idsKey = leagueIds.join(",");

  useEffect(() => {
    if (!active || !username) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const [user, state, players] = await Promise.all([getJson<any>(`${API}/user/${encodeURIComponent(username)}`), nflState(), loadPlayers()]);
        if (!user?.user_id) throw new Error(`No Sleeper user "${username}"`);
        const all = (await getJson<any[]>(`${API}/user/${user.user_id}/leagues/nfl/${state.season}`)) ?? [];
        const chosen = all.filter((l) => !leagueIds.length || leagueIds.includes(l.league_id));
        const loaded = await Promise.all(chosen.map((l) => loadLeague(l.league_id, user.user_id, state.week, players).catch(() => null)));
        if (cancelled) return;
        setLeagues(loaded.filter((l): l is FantasyLeague => l != null));
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Couldn't load Sleeper");
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, idsKey, active]);

  // NFL game state per team (for "playing now" dots), from the same free ESPN scoreboard.
  const { games } = useScoreboard(active && username ? "league=nfl" : null, []);
  const teamState = useMemo(() => {
    const m: Record<string, "pre" | "in" | "post"> = {};
    for (const g of Object.values(games)) {
      if (g.home.abbrev) m[g.home.abbrev] = g.state;
      if (g.away.abbrev) m[g.away.abbrev] = g.state;
    }
    return m;
  }, [games]);

  return { leagues, error, teamState };
}

export interface CardFantasyPlayer {
  name: string;
  pts: number;
  mine: boolean;
}

/** My starters (and my opponents') grouped by NFL team, for the NFL game cards. Same player in several leagues shows once. */
export function playersByTeam(leagues: FantasyLeague[]): Record<string, CardFantasyPlayer[]> {
  const out: Record<string, CardFantasyPlayer[]> = {};
  const seen = new Set<string>();
  const add = (p: FantasyPlayer, mine: boolean) => {
    const key = `${mine ? "m" : "o"}|${p.id}`;
    if (!p.team || p.id === "0" || seen.has(key)) return;
    seen.add(key);
    (out[p.team] ??= []).push({ name: p.name, pts: p.pts, mine });
  };
  for (const l of leagues) {
    l.me.starters.forEach((p) => add(p, true));
    l.opp?.starters.forEach((p) => add(p, false));
  }
  return out;
}
