import { useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";
import { spreadColor } from "../lib/odds";

function StrengthOfScheduleRow({ team, onNavigateTeam, onNavigateConference }: any) {
  const sos = SOS_BY_TEAM[team.team];
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
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td
        className="wintotals-total-cell"
        style={sos != null ? { color: spreadColor(sos) } : undefined}
      >
        {sos != null ? (sos > 0 ? "+" : "") + sos.toFixed(2) : "–"}
      </td>
    </tr>
  );
}


export default function StrengthOfSchedulePage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("sos");
  const [sortDir, setSortDir] = useState("asc");

  const rows = useMemo(() => {
    let list = TEAMS.filter((t) => SOS_BY_TEAM[t.team] != null)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      })
      .map((t) => ({
        ...t,
        sos: SOS_BY_TEAM[t.team] ?? null,
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
  }, [query, division, conference, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Strength of Schedule</div>
        <h1 className="title matchup-title">SOR · LIVE</h1>
        <p className="subtitle team-subtitle">
          SOR is similar to Strength of Schedule, and is based on Average
          Opponent Power Rating — lower (more negative) means a tougher
          schedule, same convention as power ratings.
        </p>
      </div>

      <div className="controls matchups-controls">
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
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Power Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="SOR" sortKey="sos" active={sortKey === "sos"} dir={sortDir} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <StrengthOfScheduleRow key={t.team} team={t} onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    No teams match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer-note">
        SOR is similar to Strength of Schedule, and is based on Average
        Opponent Power Rating.
      </div>
    </div>
  );
}
