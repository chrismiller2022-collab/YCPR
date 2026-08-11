import { useMemo, useRef, useState } from "react";
import ChangeCell from "../components/ChangeCell";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { RESUME_BY_TEAM } from "../data/resume";
import { CONFERENCES, TEAMS } from "../data/teams";
import { useWeeklyChange, useWeeklyStats } from "../lib/api/weeklyStats";

function ResumeRatingsRow({ team, change, onNavigateTeam, onNavigateConference }: any) {
  const rating = team.rating;
  const resumeRank = team.resumeRank;
  const resumeRating = team.resumeRating;
  return (
    <tr>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
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
      <td className={`rating-cell ${rating < 0 ? "rating-good" : "rating-bad"}`}>
        {rating > 0 ? "+" : ""}
        {rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">{resumeRank != null ? resumeRank : "–"}</td>
      <td className="wintotals-total-cell">{resumeRating != null ? resumeRating.toFixed(2) : "–"}</td>
      <ChangeCell change={change} />
    </tr>
  );
}


export default function ResumeRatingsPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("resumeRank");
  const [sortDir, setSortDir] = useState("asc");
  const exportRef = useRef<HTMLDivElement>(null);
  const { byTeam: changeByTeam } = useWeeklyChange("resume_rating");
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const rows = useMemo(() => {
    let list = TEAMS.filter((t) => RESUME_BY_TEAM[t.team] || liveByTeam[t.team]?.resume_rating != null)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      })
      .map((t) => ({
        ...t,
        rating: liveByTeam[t.team]?.rating ?? t.rating,
        resumeRank: liveByTeam[t.team]?.resume_rank ?? RESUME_BY_TEAM[t.team]?.rank ?? null,
        resumeRating: liveByTeam[t.team]?.resume_rating ?? RESUME_BY_TEAM[t.team]?.rating ?? null,
      }));

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
  }, [query, division, conference, sortKey, sortDir, liveByTeam]);

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
        <div className="eyebrow">Resume Ratings</div>
        <h1 className="title matchup-title">LIVE</h1>
        <p className="subtitle team-subtitle">
          Resume ranking measures what a team has actually accomplished —
          results and quality of wins — separate from our predictive power
          rating.
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
        <ExportPngButton targetRef={exportRef} filename="resume-ratings" />
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Power Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Resume Ranking" sortKey="resumeRank" active={sortKey === "resumeRank"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Resume Rating" sortKey="resumeRating" active={sortKey === "resumeRating"} dir={sortDir} onClick={handleSort} align="right" />
                <th className="th th-right">Change from Last Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <ResumeRatingsRow
                  key={t.team}
                  team={t}
                  change={changeByTeam[t.team]?.change ?? null}
                  onNavigateTeam={onNavigateTeam}
                  onNavigateConference={onNavigateConference}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No teams match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
