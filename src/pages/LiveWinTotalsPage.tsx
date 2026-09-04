import { useMemo, useRef, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONFERENCES, TEAMS } from "../data/teams";
import { buildRankMap } from "../lib/ranks";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useLatestMonteCarloWinTotals } from "../lib/api/monteCarlo";

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
      <td className="wintotals-record-cell">{team.currentWins != null ? `${team.currentWins}-${team.currentLosses}` : "0-0"}</td>
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


export default function LiveWinTotalsPage({ defaultDivision, weekNum, subLabel, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const exportRef = useRef<HTMLDivElement>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const season = new Date().getFullYear();

  // "Live" = the most recently SAVED Monte Carlo run, same definition
  // Other Futures already uses (not a fresh on-the-fly simulation) —
  // meanWins/currentWins/currentLosses come from that run's actual
  // results, not the old static-formula fallback (which ran every
  // scheduled game, including ones already played, through the same
  // win-probability formula — a team already 3-0 was still treated as
  // 3 uncertain coin flips instead of 3 banked wins). Monte Carlo's own
  // engine already tracks decided vs. simulated games correctly, which
  // is exactly what was missing. Shared with HomePage/TeamPage/
  // ConferencePreviewPage via useLatestMonteCarloWinTotals, not
  // recomputed independently here.
  const { byTeam: winTotalsByTeam, loading: runsLoading, noRunYet } = useLatestMonteCarloWinTotals(season, weekNum ?? null);

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
      const sim = winTotalsByTeam[t.team];
      const winTotal = sim?.meanWins ?? live?.total_wins ?? 0;
      const vegasTotal = live?.season_win_line ?? null;
      return {
        ...t,
        rating: live?.rating ?? t.rating,
        rank: divisionRankByTeam ? divisionRankByTeam[t.team] : nationalRankByTeam[t.team],
        winTotal,
        currentWins: sim?.currentWins ?? null,
        currentLosses: sim?.currentLosses ?? null,
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
  }, [query, division, conference, sortKey, sortDir, liveByTeam, winTotalsByTeam, divisionRankByTeam, nationalRankByTeam]);

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
        <h1 className="title matchup-title">{subLabel ?? "LIVE"}</h1>
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

      {noRunYet && !runsLoading && (
        <p style={{ color: "#a15c00", padding: "0 1.5rem" }} data-export-exclude="true">
          {weekNum == null
            ? `No Monte Carlo run has been saved for ${season} yet`
            : `No Monte Carlo run has been saved for ${season} week ${weekNum} — a run saved for a different week won't show here`}{" "}
          — win totals below default to 0 for every team. Save a run from Admin → Monte Carlo first.
        </p>
      )}

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
        Win Total and Record come from the most recently saved Monte Carlo run — Win Total is that
        run's mean simulated wins (already-played games count as decided, not as another coin flip),
        Record is that run's actual current record. Vegas Win Total and the Difference column
        populate once a week's upload includes a Vegas win total line for that team.
      </div>
    </div>
  );
}
