import { useMemo, useRef, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { CONFERENCES, TEAMS } from "../data/teams";
import { fmtOdds, fmtPct } from "../lib/format";
import { spreadColor } from "../lib/odds";

function ConferenceWinOddsRow({ team, onNavigateTeam, onNavigateConference }: any) {
  const f = CONF_FUTURES_BY_TEAM[team.team];
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
      <td className="wintotals-total-cell">{fmtPct(f?.confWinPct)}</td>
      <td className="wintotals-total-cell">{fmtOdds(f?.fairPrice)}</td>
      <td className="wintotals-total-cell">{fmtPct(f?.impliedPct)}</td>
      <td className="wintotals-total-cell">{fmtOdds(f?.odds)}</td>
      <td
        className="wintotals-total-cell"
        style={{ color: f?.value != null ? spreadColor(-f.value * 100) : undefined }}
      >
        {fmtPct(f?.value)}
      </td>
    </tr>
  );
}


export default function ConferenceWinOddsPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("value");
  const [sortDir, setSortDir] = useState("desc");
  const exportRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    let list = TEAMS.filter((t) => CONF_FUTURES_BY_TEAM[t.team])
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      })
      .map((t) => {
        const f: any = CONF_FUTURES_BY_TEAM[t.team] || {};
        return {
          ...t,
          confWinPct: f.confWinPct ?? null,
          fairPrice: f.fairPrice ?? null,
          impliedPct: f.impliedPct ?? null,
          odds: f.odds ?? null,
          value: f.value ?? null,
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
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Futures</div>
        <h1 className="title matchup-title">CONFERENCE WIN ODDS</h1>
        <p className="subtitle team-subtitle">
          Our fair, no-vig odds to win the conference compared against the
          market's price, with the resulting value edge.
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
        <ExportPngButton targetRef={exportRef} filename="conference-win-odds" />
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conf Win %" sortKey="confWinPct" active={sortKey === "confWinPct"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Fair Price" sortKey="fairPrice" active={sortKey === "fairPrice"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Implied %" sortKey="impliedPct" active={sortKey === "impliedPct"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Odds" sortKey="odds" active={sortKey === "odds"} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Value" sortKey="value" active={sortKey === "value"} dir={sortDir} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <ConferenceWinOddsRow key={t.team} team={t} onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No teams match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer-note" data-export-exclude="true">
        Fair Price/Conf Win % come from our model. Implied %/Odds are the
        market's price. Value is the edge between the two.
      </div>
    </div>
  );
}
