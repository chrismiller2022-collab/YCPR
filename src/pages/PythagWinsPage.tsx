import { useEffect, useMemo, useRef, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { TEAMS, conferencesForDivision } from "../data/teams";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { conferenceFilterOptions, teamMatchesConferenceFilter } from "../lib/conferenceBuckets";
import { computeOverUnderRecord } from "../lib/ouRecord";
import { pythagWinPct, PYTHAG_EXPONENT } from "../lib/pythag";

interface PythagRow {
  team: any;
  div: "FBS" | "FCS";
  conf: string;
  rating: number;
  gamesCompleted: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  gamesOver: number;
  gamesUnder: number;
  pythagPct: number | null;
  pythagWins: number | null;
}

function sortValue(r: PythagRow, key: string): string | number | null {
  switch (key) {
    case "team":
      return r.team.team;
    case "conf":
      return r.conf;
    case "rating":
      return r.rating;
    case "pointsFor":
      return r.pointsFor;
    case "pointsAgainst":
      return r.pointsAgainst;
    case "pointDiff":
      return r.pointDiff;
    case "gamesOver":
      return r.gamesOver;
    case "gamesUnder":
      return r.gamesUnder;
    case "pythagWins":
      return r.pythagWins;
    default:
      return null;
  }
}

export default function PythagWinsPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const season = new Date().getFullYear();
  const { byTeam: liveByTeam, loading: liveLoading } = useWeeklyStats("latest");

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState<"All" | "FBS" | "FCS">("FBS");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("pythagWins");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setGamesLoading(true);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setGamesLoading(false));
  }, [season]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" || key === "conf" ? "asc" : "desc");
    }
  }

  const rows: PythagRow[] = useMemo(() => {
    if (games.length === 0) return [];
    return TEAMS.map((t) => {
      const rating = liveByTeam[t.team]?.rating ?? t.rating;
      const teamGames = games.filter(
        (g) => (g.home_team === t.team || g.away_team === t.team) && g.completed && g.home_points != null && g.away_points != null
      );

      let pointsFor = 0;
      let pointsAgainst = 0;
      for (const g of teamGames) {
        const isHome = g.home_team === t.team;
        pointsFor += (isHome ? g.home_points : g.away_points) ?? 0;
        pointsAgainst += (isHome ? g.away_points : g.home_points) ?? 0;
      }

      const ou = computeOverUnderRecord(t.team, games);
      const pythagPct = teamGames.length > 0 ? pythagWinPct(pointsFor, pointsAgainst) : null;

      return {
        team: t,
        div: t.div,
        conf: t.conf,
        rating,
        gamesCompleted: teamGames.length,
        pointsFor,
        pointsAgainst,
        pointDiff: pointsFor - pointsAgainst,
        gamesOver: ou.overs,
        gamesUnder: ou.unders,
        pythagPct,
        pythagWins: pythagPct != null ? pythagPct * teamGames.length : null,
      };
    });
  }, [games, liveByTeam]);

  const filtered = rows.filter((r) => {
    if (division !== "All" && r.div !== division) return false;
    if (conference !== "All" && !teamMatchesConferenceFilter(r.team.team, r.conf, conference)) return false;
    if (query && !r.team.team.toLowerCase().includes(query.toLowerCase())) return false;
    if (r.gamesCompleted === 0) return false;
    return true;
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const loading = gamesLoading || liveLoading;

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Futures</div>
        <h1 className="title matchup-title">Pythag Wins</h1>
        <p className="subtitle team-subtitle">
          Points scored/allowed, Over/Under record, and a Pythagorean win total for every team.
        </p>
      </div>

      <div className="controls matchups-controls" data-export-exclude="true">
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select
          className="filter"
          value={division}
          onChange={(e) => {
            setDivision(e.target.value as any);
            setConference("All");
          }}
        >
          <option value="All">All divisions</option>
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
          <option value="All">All conferences</option>
          {conferenceFilterOptions(division, conferencesForDivision("FBS"), conferencesForDivision("FCS")).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ExportPngButton targetRef={exportRef} filename="pythag-wins" />
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty matchups-empty">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="empty matchups-empty">No completed games yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Power Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Points Scored" sortKey="pointsFor" active={sortKey === "pointsFor"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Points Allowed" sortKey="pointsAgainst" active={sortKey === "pointsAgainst"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Point Diff" sortKey="pointDiff" active={sortKey === "pointDiff"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Games Over" sortKey="gamesOver" active={sortKey === "gamesOver"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Games Under" sortKey="gamesUnder" active={sortKey === "gamesUnder"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Pythag Wins" sortKey="pythagWins" active={sortKey === "pythagWins"} dir={sortDir} onClick={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.team.team}>
                    <td>
                      <button className="team-link" onClick={() => onNavigateTeam(r.team)}>
                        <TeamLogo team={r.team} />
                        {r.team.team}
                      </button>
                      <span className={`div-pill ${r.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{r.div}</span>
                    </td>
                    <td className="conf-cell">
                      <ConfLink conf={r.conf} onNavigateConference={onNavigateConference} />
                    </td>
                    <td className={`rating-cell ${r.rating < 0 ? "rating-good" : "rating-bad"}`}>
                      {r.rating > 0 ? "+" : ""}
                      {r.rating.toFixed(2)}
                    </td>
                    <td className="wintotals-total-cell">{r.pointsFor}</td>
                    <td className="wintotals-total-cell">{r.pointsAgainst}</td>
                    <td className="wintotals-total-cell">
                      {r.pointDiff > 0 ? "+" : ""}
                      {r.pointDiff}
                    </td>
                    <td className="wintotals-total-cell">{r.gamesOver}</td>
                    <td className="wintotals-total-cell">{r.gamesUnder}</td>
                    <td className="wintotals-total-cell">{r.pythagWins != null ? r.pythagWins.toFixed(2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note" data-export-exclude="true">
        Pythagorean wins is a points-only estimate of a team's "expected" win total — win% ≈ Points Scored^{PYTHAG_EXPONENT} /
        (Points Scored^{PYTHAG_EXPONENT} + Points Allowed^{PYTHAG_EXPONENT}), the same shape of formula Bill James devised
        for baseball, adapted here with a football exponent ({PYTHAG_EXPONENT}). It's a descriptive stat, not a
        prediction — it ignores opponent strength, injuries, and matchups, and a team that's outperformed or
        underperformed it has usually just run hot or cold in close games. See{" "}
        <a href="https://en.wikipedia.org/wiki/Pythagorean_expectation" target="_blank" rel="noreferrer">
          Pythagorean expectation
        </a>{" "}
        for more. Games Over/Under use the same Vegas-total grading as the Team Page's Betting tab — both teams in a
        game get credited when it goes over or under, since there's no "favorite" side to a total.
      </div>
    </div>
  );
}
