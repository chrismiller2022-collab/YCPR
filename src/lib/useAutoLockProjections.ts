import { useEffect, useRef } from "react";
import type { GameWithLines } from "./api/gamesLines";
import type { MatchupComputed } from "./matchupsCompute";
import { lockGameProjections, type GameProjectionLockRow } from "./api/gameProjectionLocks";

/**
 * Self-healing lock mechanism, no cron job needed — whenever this runs
 * (any page that renders games via computeRow, public or admin), it
 * checks for any game that has kicked off but has no lock yet, and
 * locks it using whatever computeRow just computed. Safe to call from
 * anywhere: lockGameProjections is append-only server-side (INSERT ...
 * ON CONFLICT DO NOTHING), so this can never overwrite an existing
 * lock, and calling it repeatedly across many page views is harmless.
 *
 * This is deliberately best-effort, not a guarantee of catching every
 * game within seconds of kickoff — it only fires when someone is
 * actually viewing a page that renders that game. In practice, given
 * how often this site's own pages get viewed, that's close enough to
 * catch drift before it compounds; a true zero-latency guarantee would
 * need a scheduled job, which isn't available within Vercel Hobby's
 * serverless function cap without displacing something else.
 */
export function useAutoLockProjections(
  computedRows: { game: GameWithLines; computed: MatchupComputed }[],
  existingLocks: Record<string, GameProjectionLockRow>,
  myTotalByGame?: Map<string, number>
) {
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    const now = Date.now();
    const candidates: Parameters<typeof lockGameProjections>[0] = [];
    for (const { game, computed } of computedRows) {
      if (existingLocks[game.id]) continue;
      if (attempted.current.has(game.id)) continue;
      const kickoff = game.start_date ? new Date(game.start_date).getTime() : null;
      if (kickoff == null || kickoff > now) continue; // hasn't kicked off yet — nothing to lock
      attempted.current.add(game.id);
      candidates.push({
        game_id: game.id,
        season: game.season,
        week: game.week,
        home_team: game.home_team,
        away_team: game.away_team,
        my_away_spread: computed.projAwaySpread,
        my_total: myTotalByGame?.get(`${game.week}|${game.home_team}|${game.away_team}`) ?? null,
        my_away_win_pct: computed.projWinPct,
      });
    }
    if (candidates.length > 0) {
      lockGameProjections(candidates).catch(() => {
        // Best-effort — if this fails, the attempted-set above still
        // prevents hammering the endpoint for the rest of this page
        // view; a later page view (with a fresh attempted-set) will
        // retry naturally.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedRows, existingLocks, myTotalByGame]);
}
