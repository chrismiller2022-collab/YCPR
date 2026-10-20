import { useEffect, useMemo, useState } from "react";
import { fetchSeasonAvailableWeeks } from "../lib/api/seasonWeeklyRatings";
import { fetchTeamSosAvailableWeeks } from "../lib/api/ratingSystems";
import { fetchResumeRatingsAvailableWeeks, fetchFinishedResumeAvailableWeeks } from "../lib/api/resumeWeights";
import { fetchMonteCarloRuns } from "../lib/api/monteCarlo";
import { fetchGameLockCoverageByWeek, useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchPlacedBets, isPlaceholderBet, type PlacedBetRow } from "../lib/api/placedBets";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { computeRow } from "../lib/matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";

// Overview tiles for the admin week: what's published, and which bets are still to make.

function Chip({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: "0.72rem",
        fontWeight: 600,
        padding: "0.1rem 0.5rem",
        borderRadius: 99,
        border: `1px solid ${ok ? "var(--c-ok)" : "var(--hash)"}`,
        color: ok ? "var(--c-ok)" : "var(--chalk-dim)",
        whiteSpace: "nowrap",
      }}
    >
      {ok ? "✓ " : ""}
      {label}
    </span>
  );
}

/** Which of this week's public snapshots are saved: power ratings, SOS, both résumés, win totals and bracket (one sim), matchups. */
export function PublishStatusTile({ season, week, onOpen }: { season: number; week: number; onOpen: () => void }) {
  const [s, setS] = useState<null | { pr: boolean; sos: boolean; resume: boolean; resumeSoFar: boolean; mc: boolean; locks: { kickedOff: number; locked: number } | null }>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSeasonAvailableWeeks(season),
      fetchTeamSosAvailableWeeks(season),
      fetchResumeRatingsAvailableWeeks(season),
      fetchFinishedResumeAvailableWeeks(season).catch(() => []),
      fetchMonteCarloRuns(season),
      fetchGameLockCoverageByWeek(season),
    ])
      .then(([pr, sos, resume, soFar, mc, locks]) => {
        if (cancelled) return;
        setS({
          pr: pr.includes(week),
          sos: sos.includes(week),
          resume: resume.includes(week),
          resumeSoFar: soFar.includes(week),
          mc: mc.some((r) => r.week === week),
          locks: locks[week] ?? null,
        });
      })
      .catch(() => !cancelled && setS(null));
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  return (
    <div className="admin-stat" style={{ cursor: "pointer" }} onClick={onOpen} title="Open Publish">
      <div className="l">Published · week {week}</div>
      {s == null ? (
        <div className="v">…</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.35rem" }}>
          <Chip ok={s.pr} label="Power ratings" />
          <Chip ok={s.sos} label="SOS" />
          <Chip ok={s.resume && s.resumeSoFar} label="Résumés" title={`Projected finish ${s.resume ? "saved" : "not saved"} · Résumé so far ${s.resumeSoFar ? "saved" : "not saved"}`} />
          <Chip ok={s.mc} label="Win totals" />
          <Chip ok={s.mc} label="Bracket" />
          <Chip ok={s.pr} label="Matchups" title={s.locks ? `${s.locks.locked} of ${s.locks.kickedOff} kicked-off games locked` : undefined} />
        </div>
      )}
    </div>
  );
}

const sameGame = (b: { away_team: string; home_team: string | null; game_id?: string | null }, g: GameWithLines) =>
  b.game_id === g.id || (b.away_team === g.away_team && b.home_team === g.home_team);

/**
 * Spread bets this week: the bet signals Matchups shows (same model, same frozen locks), how many are already in
 * Placed Bets, how many are still to make before kickoff, and bets ticked in Matchups that never reached Placed Bets.
 */
export function BetsThisWeekTile({ season, week, onOpen }: { season: number; week: number; onOpen: () => void }) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [placed, setPlaced] = useState<PlacedBetRow[]>([]);
  const [ticked, setTicked] = useState<PlacedBetRow[]>([]);
  const { byWeek } = useWeekAccurateRatings(season, [week], season);
  const { locks } = useGameProjectionLocks(season, [week]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchGamesWithLines(season, week),
      fetchPlacedBets(season, { includePlaceholders: true }),
    ])
      .then(([g, p]) => {
        if (cancelled) return;
        setGames(g.filter((x) => x.home_classification === "fbs" && x.away_classification === "fbs"));
        const spread = p.filter((b) => b.week === week && b.bet_type === "spread");
        setPlaced(spread.filter((b) => !isPlaceholderBet(b)));
        // Ticked in Matchups and sent as placeholders, not yet confirmed by a CSV import.
        setTicked(spread.filter(isPlaceholderBet));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const counts = useMemo(() => {
    const ratings = byWeek[week] ?? {};
    let signals = 0;
    let made = 0;
    let toMake = 0;
    for (const g of games) {
      const lock = locks[g.id];
      const c = computeRow(g, ratings, "team", DEFAULT_CUSTOM_PARAMS, lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null);
      if (c.betTeam == null) continue;
      signals++;
      const team = c.betTeam === "away" ? g.away_team : g.home_team;
      const isMade = placed.some((b) => sameGame(b, g) && b.side === team);
      if (isMade) made++;
      else if (!g.completed && (!g.start_date || Date.parse(g.start_date) > Date.now())) toMake++;
    }
    const tickedNotPlaced = ticked.length;
    return { signals, made, toMake, tickedNotPlaced };
  }, [games, placed, ticked, byWeek, locks, week]);

  return (
    <div className="admin-stat" style={{ cursor: "pointer" }} onClick={onOpen} title="Open Matchups">
      <div className="l">Spread bets · week {week}</div>
      <div className="v">
        {counts.toMake} <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>still to make</span>
      </div>
      <div className="d">
        {counts.made} of {counts.signals} signals placed
        {counts.tickedNotPlaced > 0 && <span style={{ color: "var(--c-warn)" }}> · {counts.tickedNotPlaced} sent from Matchups, awaiting CSV</span>}
      </div>
    </div>
  );
}
