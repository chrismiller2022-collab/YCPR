import { useMemo, useState } from "react";
import ChangeCell from "../components/ChangeCell";
import ConfLink from "../components/ConfLink";
import TeamLogo from "../components/TeamLogo";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS, conferencesForDivision } from "../data/teams";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats, useWeeklyChange } from "../lib/api/weeklyStats";

function SosRow({ rank, team, sos, change, onNavigateTeam, onNavigateConference }: any) {
  return (
    <tr>
      <td style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>{rank}</td>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
          <TeamLogo team={team} />
          {team.team}
        </button>
        <span className={`div-pill ${team.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{team.div}</span>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell" style={sos != null ? { color: spreadColor(sos) } : undefined}>
        {sos != null ? (sos > 0 ? "+" : "") + sos.toFixed(2) : "–"}
      </td>
      <ChangeCell change={change} />
    </tr>
  );
}

function SosTable({ title, rows, changeByTeam, onNavigateTeam, onNavigateConference, rankOffset }: any) {
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div className="section-label" style={{ textAlign: "center" }}>
        {title}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="th">#</th>
              <th className="th">Team</th>
              <th className="th">Conference</th>
              <th className="th th-right">Power Rating</th>
              <th className="th th-right">SOS</th>
              <th className="th th-right">Change from Last Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: any, i: number) => (
              <SosRow
                key={t.team}
                rank={rankOffset + i + 1}
                team={t}
                sos={t.sos}
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
  );
}

export default function StrengthOfSchedulePage({ forceDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(forceDivision ?? "All");
  const [conference, setConference] = useState("All");

  const { byTeam: liveByTeam, loading: liveLoading, error: liveError } = useWeeklyStats("latest");
  const { byTeam: changeByTeam } = useWeeklyChange("sor");

  function sosFor(teamName: string): number | null {
    const live = liveByTeam[teamName]?.sor;
    if (live != null) return live;
    return SOS_BY_TEAM[teamName] ?? null;
  }

  const filteredRows = useMemo(() => {
    return TEAMS.filter((t) => (forceDivision ? t.div === forceDivision : sosFor(t.team) != null))
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .map((t) => ({ ...t, sos: sosFor(t.team) }));
  }, [query, division, conference, liveByTeam, forceDivision]);

  const { leftRows, rightRows } = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      if (a.sos == null && b.sos == null) return 0;
      if (a.sos == null) return 1;
      if (b.sos == null) return -1;
      return b.sos - a.sos;
    });
    const half = Math.ceil(sorted.length / 2);
    return {
      leftRows: sorted.slice(0, half),
      rightRows: sorted.slice(half).reverse(),
    };
  }, [filteredRows]);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">{forceDivision === "FCS" ? "FCS · " : ""}Strength of Schedule</div>
        <h1 className="title matchup-title">{forceDivision === "FCS" ? "FCS SOS · LIVE" : "SOS · LIVE"}</h1>
        <p className="subtitle team-subtitle">
          SOS is Strength of Schedule, based on a number of things — including but not limited
          to average opponent power rating. This value is <strong>positive → harder</strong>,{" "}
          <strong>negative → easier</strong>, the opposite sign convention from power ratings.
        </p>
        {forceDivision === "FCS" ? (
          <p style={{ fontSize: "0.8rem", color: "#666" }}>
            FCS strength-of-schedule data isn't calculated yet — this page is wired up and will
            populate once it is.
          </p>
        ) : (
          <>
            {liveError && (
              <p style={{ fontSize: "0.8rem", color: "#a15c00" }}>
                Live data unavailable ({liveError}) — showing last static snapshot.
              </p>
            )}
            {!liveError && !liveLoading && Object.keys(liveByTeam).length === 0 && (
              <p style={{ fontSize: "0.8rem", color: "#666" }}>No weekly data saved yet — showing the preseason snapshot.</p>
            )}
          </>
        )}
      </div>

      <div className="controls matchups-controls">
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!forceDivision && (
          <select className="filter" value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="All">All divisions</option>
            <option value="FBS">FBS</option>
            <option value="FCS">FCS</option>
          </select>
        )}
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
          <option value="All">All conferences</option>
          {(forceDivision ? conferencesForDivision(forceDivision) : CONFERENCES).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap" style={{ maxWidth: 1400 }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <SosTable
            title="Hardest → Easiest"
            rows={leftRows}
            changeByTeam={changeByTeam}
            onNavigateTeam={onNavigateTeam}
            onNavigateConference={onNavigateConference}
            rankOffset={0}
          />
          <SosTable
            title="Easiest → Hardest"
            rows={rightRows}
            changeByTeam={changeByTeam}
            onNavigateTeam={onNavigateTeam}
            onNavigateConference={onNavigateConference}
            rankOffset={filteredRows.length - rightRows.length}
          />
        </div>
      </div>

      <div className="footer-note">
        SOS is Strength of Schedule, based on a number of things — including but not limited to
        average opponent power rating. Positive means a harder schedule, negative means an
        easier one — the opposite sign convention from power ratings, where negative is better.
      </div>
    </div>
  );
}
