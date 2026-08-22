import { useMemo, useRef, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONFERENCES, TEAMS } from "../data/teams";
import { TEAM_WIN_TOTALS, buildRankMap } from "../lib/ranks";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function LiveWinTotalsRow({ team, onNavigateTeam, onNavigateConference }: any) {
  const wt = { total: team.winTotal, vegasTotal: team.vegasTotal };
  const diff = team.diff;
  return (
    <tr>
      <td>
        <span
          className={`rank-flag ${
            team.rank <= 4 ? "top4" : team.rank <= 12 ? "top12" : ""
          }`}
        >
          {team.rank}
        </span>
      </td>
      <td>
        <button
          className="team-link"
          onClick={() => onNavigateTeam(team)}
        >
          <TeamLogo team={team} />
          {team.team}
        </button>
        <span className={`div-pill ${team.div === "FBS" ? "div-fbs" : "div-fcs"}`}>
          {team.div}
        </span>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className="wintotals-record-cell">0-0</td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">{wt.total.toFixed(2)}</td>
      <td className="wintotals-total-cell">{wt.vegasTotal != null ? wt.vegasTotal.toFixed(1) : "–"}</td>
      <td
        className="wintotals-total-cell"
        style={diff != null ? { color: diff > 0 ? "#8fd39a" : diff < 0 ? "#c45c52" : undefined } : undefined}
      >
        {diff != null ? `${diff > 0 ? "+" : ""}${diff.toFixed(2)}` : "–"}
      </td>
    </tr>
  );
}


export default function LiveWinTotalsPage({ defaultDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const exportRef = useRef<HTMLDivElement>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  // When viewing a single division, "rank" should mean rank within that
  // division (1-N), not the site-wide national rank FBS+FCS combined —
  // otherwise the FCS view shows rank numbers in the hundreds instead of
  // a clean 1-138. Computed from the full division roster (before the
  // conference/search filters below) so filtering never changes what a
  // team's rank number means. "All" keeps the national rank, same as the
  // Home Page.
  const divisionRankByTeam = useMemo(() => {
    if (division === "All") return null;
    const pool = TEAMS.filter((t) => t.div === division).map(
      (t) => [t.team, liveByTeam[t.team]?.rating ?? t.rating] as [string, number]
    );
    return buildRankMap(pool, false);
  }, [division, liveByTeam]);

  // National rank ("All" division view) is always derived from resolved
  // rating too, never trusted from a stored/pasted "rank" column — that
  // column turned out to be saved as a flat 1 for every team in every
  // saved week, which silently broke this exact rank badge.
  const nationalRankByTeam = useMemo(
    () => buildRankMap(TEAMS.map((t) => [t.team, liveByTeam[t.team]?.rating ?? t.rating]), false),
    [liveByTeam]
  );

  const rows = useMemo(() => {
    let list = TEAMS.filter((t) => {
      if (division !== "All" && t.div !== division) return false;
      if (conference !== "All" && t.conf !== conference) return false;
      if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    }).map((t) => {
      const live = liveByTeam[t.team];
      const winTotal = live?.total_wins ?? TEAM_WIN_TOTALS[t.team]?.total ?? 0;
      const vegasTotal = live?.season_win_line ?? null;
      return {
        ...t,
        rating: live?.rating ?? t.rating,
        rank: divisionRankByTeam ? divisionRankByTeam[t.team] : nationalRankByTeam[t.team],
        winTotal,
        vegasTotal,
        diff: vegasTotal != null ? winTotal - vegasTotal : null,
      };
    });

    list = [...list].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return list;
  }, [query, division, conference, sortKey, sortDir, liveByTeam, divisionRankByTeam, nationalRankByTeam]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Win Totals</div>
        <h1 className="title matchup-title">LIVE</h1>
        <p className="subtitle team-subtitle">
          Projected season win totals, calculated by summing each team's
          game-by-game win probability across their full schedule.
        </p>
      </div>

      <div className="controls matchups-controls" data-export-exclude="true">
        <input
          className="search"
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="filter"
          value={division}
          onChange={(e) => setDivision(e.target.value)}
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
          <option value="All">All conferences</option>
          {CONFERENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ExportPngButton targetRef={exportRef} filename={`win-totals-${division.toLowerCase()}`} />
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="Rank" sortKey="rank" active={sortKey === "rank"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                <th className="th">Record</th>
                <SortHeader label="Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Win Total" sortKey="winTotal" active={sortKey === "winTotal"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Vegas Win Total" sortKey="vegasTotal" active={sortKey === "vegasTotal"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Difference" sortKey="diff" active={sortKey === "diff"} dir={sortDir} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <LiveWinTotalsRow key={t.team} team={t} onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No teams match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer-note" data-export-exclude="true">
        Win totals are projections based on current power ratings, not actual
        results — records will update once games are played. Vegas Win Total
        and the Difference column populate once a week's upload includes a
        Vegas win total line for that team.
      </div>
    </div>
  );
}
