import { useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import TeamLogo from "../components/TeamLogo";
import { gamesForTeam } from "../data/games";
import { CONFERENCES, TEAMS, TEAMS_BY_NAME, conferencesForDivision } from "../data/teams";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { bucketFor } from "../lib/conferenceBuckets";

const GAME_COUNTS = [2, 3, 4];
const CONF_FILTER_OPTIONS = ["All", "P4", "G6"];

interface StretchEntry {
  game: ReturnType<typeof gamesForTeam>[number];
  opp: any;
  liveOppRating: number;
  isHome: boolean;
  spread: number;
  winPct: number;
  expLoss: number;
}

interface StretchResult {
  team: any;
  window: StretchEntry[];
  totalExpLoss: number;
  startWeek: number;
  endWeek: number;
}

/**
 * Top-25 average rating, computed separately for FBS and FCS, using live
 * ratings where available. This is the "average elite team" stand-in used
 * in place of each subject team's own rating (see computeToughestWindow).
 */
function computeTop25Avg(div: "FBS" | "FCS", liveByTeam: Record<string, any>): number {
  const ratings = TEAMS.filter((t) => t.div === div)
    .map((t) => liveByTeam[t.team]?.rating ?? t.rating)
    .sort((a, b) => a - b) // ascending — most negative (best) first
    .slice(0, 25);
  if (ratings.length === 0) return 0;
  return ratings.reduce((s, v) => s + v, 0) / ratings.length;
}

/**
 * For a single team's SCHEDULE, walks its full (chronological,
 * bye-tolerant) games and returns whichever N-consecutive-game window is
 * toughest — but "toughest" is measured for a hypothetical AVERAGE TOP-25
 * TEAM playing that same opponent stretch, not for this team itself.
 *
 * This is the fix for the "toughest stretches are just the worst teams"
 * problem: the subject team's own rating is replaced with a constant (the
 * top-25 average for their division), while the opponent's actual rating
 * is left untouched. That isolates how hard the OPPONENTS are, independent
 * of whether the team on this specific schedule happens to be good or bad.
 */
function computeToughestWindow(
  team: any,
  n: number,
  liveByTeam: Record<string, any>,
  top25AvgByDiv: { FBS: number; FCS: number }
): StretchResult | null {
  const normalizedRating = top25AvgByDiv[team.div as "FBS" | "FCS"] ?? top25AvgByDiv.FBS;
  const liveOppRatingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;

  const entries: StretchEntry[] = gamesForTeam(team.team)
    .map((game) => {
      const isHome = game.home === team.team;
      const oppName = isHome ? game.away : game.home;
      const opp = TEAMS_BY_NAME[oppName];
      if (!opp) return null;

      const liveOppRating = liveOppRatingFor(oppName, opp.rating);
      const spread = isHome
        ? normalizedRating - liveOppRating - hfaFor(team.team, liveByTeam)
        : normalizedRating - liveOppRating + hfaFor(oppName, liveByTeam);
      const winPct = spreadToWinPct(spread);

      return { game, opp, liveOppRating, isHome, spread, winPct, expLoss: 1 - winPct };
    })
    .filter((e): e is StretchEntry => e !== null);

  if (entries.length < n) return null;

  let best: StretchResult | null = null;
  for (let i = 0; i <= entries.length - n; i++) {
    const window = entries.slice(i, i + n);
    const totalExpLoss = window.reduce((s, e) => s + e.expLoss, 0);
    if (!best || totalExpLoss > best.totalExpLoss) {
      best = {
        team,
        window,
        totalExpLoss,
        startWeek: window[0].game.week,
        endWeek: window[window.length - 1].game.week,
      };
    }
  }
  return best;
}

function StretchGameBox({ entry, onNavigateTeam }: any) {
  const result = entry.spread < 0 ? "Win" : entry.spread > 0 ? "Loss" : "Even";
  return (
    <div className="stretch-game-box" style={{ borderColor: spreadColor(entry.spread) }}>
      <div className="stretch-game-loc">{entry.isHome ? "vs" : "@"}</div>
      <button className="team-link stretch-game-team" onClick={() => onNavigateTeam(entry.opp)}>
        <TeamLogo team={entry.opp} />
        {entry.opp.team}
      </button>
      <div className="stretch-game-rating">
        {entry.liveOppRating > 0 ? "+" : ""}
        {entry.liveOppRating.toFixed(2)}
      </div>
      <div className="stretch-game-spread" style={{ color: spreadColor(entry.spread) }}>
        {entry.spread > 0 ? "+" : ""}
        {entry.spread.toFixed(1)}
      </div>
      <div className="stretch-game-winpct" style={{ color: spreadColor(entry.spread) }}>
        {(entry.winPct * 100).toFixed(1)}% · {result}
      </div>
    </div>
  );
}

function StretchCard({ rank, data, gameCount, onNavigateTeam, onNavigateConference }: any) {
  const { team, window, totalExpLoss, startWeek, endWeek } = data;
  const roadCount = window.filter((e: StretchEntry) => !e.isHome).length;

  return (
    <div className="stretch-card">
      <div className="stretch-card-head">
        <div className={`stretch-rank ${rank === 1 ? "stretch-rank-1" : rank <= 5 ? "stretch-rank-top5" : ""}`}>
          {rank}
        </div>
        <div className="stretch-team-block">
          <button className="team-link stretch-team-link" onClick={() => onNavigateTeam(team)}>
            <TeamLogo team={team} size={30} />
            {team.team}
          </button>
          <div className="stretch-team-meta">
            <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
            {" · "}
            {startWeek === endWeek ? `Week ${startWeek}` : `Weeks ${startWeek}–${endWeek}`}
            {roadCount > 0 && ` · ${roadCount} road`}
          </div>
        </div>
        <div className="stretch-explosses">
          <div className="stretch-explosses-value">{totalExpLoss.toFixed(2)}</div>
          <div className="stretch-explosses-label">Expected Losses</div>
        </div>
      </div>
      <div className="stretch-games" style={{ gridTemplateColumns: `repeat(${gameCount}, 1fr)` }}>
        {window.map((entry: StretchEntry) => (
          <StretchGameBox key={entry.game.id} entry={entry} onNavigateTeam={onNavigateTeam} />
        ))}
      </div>
    </div>
  );
}

export default function ToughestStretchPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const [gameCount, setGameCount] = useState(4);
  const [division, setDivision] = useState("FBS");
  const [conference, setConference] = useState("All");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const top25AvgByDiv = useMemo(
    () => ({
      FBS: computeTop25Avg("FBS", liveByTeam),
      FCS: computeTop25Avg("FCS", liveByTeam),
    }),
    [liveByTeam]
  );

  const rows = useMemo(() => {
    const pool = TEAMS.filter((t) => {
      if (division !== "All" && t.div !== division) return false;
      if (conference === "P4" && bucketFor(t.team, t.conf) !== "P4") return false;
      if (conference === "G6" && bucketFor(t.team, t.conf) !== "G6") return false;
      if (conference !== "All" && conference !== "P4" && conference !== "G6" && t.conf !== conference) return false;
      return true;
    });

    const results = pool
      .map((t) => computeToughestWindow(t, gameCount, liveByTeam, top25AvgByDiv))
      .filter((r): r is StretchResult => r !== null);

    results.sort((a, b) => b.totalExpLoss - a.totalExpLoss);
    return results;
  }, [gameCount, division, conference, liveByTeam, top25AvgByDiv]);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Tools · Strength of Schedule</div>
        <h1 className="title matchup-title">TOUGHEST GAME STRETCH</h1>
        <p className="subtitle team-subtitle">
          For every team's actual schedule, this finds the toughest run of consecutive
          opponents (bye weeks don't break the streak) — measured as how many expected
          losses an <em>average top-25 team</em> would take against that same stretch of
          opponents, not how many this specific team would take. That isolates how hard the
          opponents are, independent of whether the team on that schedule happens to be good
          or bad.
        </p>
      </div>

      <div className="mode-toggle">
        {GAME_COUNTS.map((n) => (
          <button
            key={n}
            className={`mode-btn ${gameCount === n ? "mode-btn-active" : ""}`}
            onClick={() => setGameCount(n)}
          >
            {n}-Game
          </button>
        ))}
      </div>

      <div className="controls matchups-controls">
        <select
          className="filter"
          value={division}
          onChange={(e) => {
            setDivision(e.target.value);
            setConference("All");
          }}
        >
          <option value="All">All divisions</option>
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
        <select
          className="filter"
          value={conference}
          onChange={(e) => setConference(e.target.value)}
        >
          {CONF_FILTER_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c === "All" ? "All conferences" : c === "P4" ? "Power 4 (+ Notre Dame)" : "Group of 6 (+ UConn)"}
            </option>
          ))}
          {(division === "All" ? CONFERENCES : conferencesForDivision(division)).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="stretch-list">
        {rows.length === 0 && (
          <div className="empty">
            No teams have a full {gameCount}-game schedule yet for this filter.
          </div>
        )}
        {rows.map((r, i) => (
          <StretchCard
            key={r.team.team}
            rank={i + 1}
            data={r}
            gameCount={gameCount}
            onNavigateTeam={onNavigateTeam}
            onNavigateConference={onNavigateConference}
          />
        ))}
      </div>

      <div className="footer-note">
        Expected losses = {gameCount} games minus the sum of an average top-25 team's win
        probability in each of those games, using each team's real opponents, sites, and
        home-field edges — a stretch where a top-25 team would be favored in every game shows
        close to 0.00; a stretch where a top-25 team would be a total underdog in all of them
        shows close to {gameCount.toFixed(2)}. Each opponent's own rating is their live rating
        where available. Idea and format credit to{" "}
        <a
          className="footer-link"
          href="https://www.puntandrally.com/toughest_stretches.php"
          target="_blank"
          rel="noopener noreferrer"
        >
          Punt &amp; Rally's "The Gauntlet"
        </a>
        — this version uses our own power ratings and win probabilities rather than theirs,
        and normalizes the subject team to a top-25-average rating rather than using their own.
      </div>
    </div>
  );
}
