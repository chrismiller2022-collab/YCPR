import { Fragment, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";
import { spreadColor } from "../lib/odds";
import { CONF_WIN_TOTAL_RANK_BY_TEAM, SOR_RANK_BY_TEAM, TEAM_WIN_TOTALS, WIN_TOTAL_RANK_BY_TEAM } from "../lib/ranks";

export default function HomePage({ onNavigateTeam, onNavigateConference }: any) {
  const [heroQuery, setHeroQuery] = useState("");
  const [heroFocused, setHeroFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");

  const filtered = useMemo(() => {
    let rows = TEAMS.filter((t) => {
      if (division !== "All" && t.div !== division) return false;
      if (conference !== "All" && t.conf !== conference) return false;
      if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    }).map((t) => ({
      ...t,
      winTotal: TEAM_WIN_TOTALS[t.team]?.total ?? 0,
      confWinTotal: TEAM_WIN_TOTALS[t.team]?.confTotal ?? 0,
      resumeRating: RESUME_BY_TEAM[t.team]?.rating ?? null,
      sos: SOS_BY_TEAM[t.team] ?? null,
    }));

    rows = [...rows].sort((a, b) => {
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

    return rows;
  }, [query, division, conference, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const fbsCount = TEAMS.filter((t) => t.div === "FBS").length;
  const top = TEAMS[0];
  const heroMatches =
    heroQuery.trim().length > 0
      ? TEAMS.filter((t) =>
          t.team.toLowerCase().includes(heroQuery.trim().toLowerCase())
        ).slice(0, 6)
      : [];
  const showCutlines =
    sortKey === "rank" &&
    sortDir === "asc" &&
    !query &&
    division === "All" &&
    conference === "All";

  return (
    <>
<div className="hero">
        <div className="eyebrow">Preseason · Power Ratings</div>
        <h1 className="title">
          YC <span>POWER</span> RATINGS
        </h1>
        <p className="subtitle">
          Power Ratings derived from stats, vibes and other stuff like that
        </p>

        <div className="hero-search-wrap">
          <input
            className="hero-search"
            placeholder="Jump to a team page…"
            value={heroQuery}
            onChange={(e) => setHeroQuery(e.target.value)}
            onFocus={() => setHeroFocused(true)}
            onBlur={() => setTimeout(() => setHeroFocused(false), 120)}
          />
          {heroFocused && heroMatches.length > 0 && (
            <div className="hero-suggest">
              {heroMatches.map((t) => (
                <button
                  key={t.team}
                  className="hero-suggest-item"
                  onClick={() => {
                    onNavigateTeam(t);
                    setHeroQuery("");
                  }}
                >
                  <span
                    className={`rank-flag ${
                      t.rank <= 4 ? "top4" : t.rank <= 12 ? "top12" : ""
                    }`}
                  >
                    {t.rank}
                  </span>
                  <span className="hero-suggest-name">{t.team}</span>
                  <span className="hero-suggest-conf">{t.conf}</span>
                </button>
              ))}
            </div>
          )}
          {heroFocused && heroQuery.trim().length > 0 && heroMatches.length === 0 && (
            <div className="hero-suggest">
              <div className="hero-suggest-empty">No teams match "{heroQuery}"</div>
            </div>
          )}
        </div>
      </div>

      <div className="controls">
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
        <table className="home-table">
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              <th className="th">Record</th>
              <SortHeader label="Power Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Proj. Win Total" sortKey="winTotal" active={sortKey === "winTotal"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Proj. Conf Win Total" sortKey="confWinTotal" active={sortKey === "confWinTotal"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="YC Resume Rating" sortKey="resumeRating" active={sortKey === "resumeRating"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="SOR" sortKey="sos" active={sortKey === "sos"} dir={sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <Fragment key={t.team}>
                <tr>
                  <td>
                    <button className="team-link" onClick={() => onNavigateTeam(t)}>
                      <TeamLogo team={t} />
                      {t.team}
                    </button>
                    <span className={`div-pill ${t.div === "FBS" ? "div-fbs" : "div-fcs"}`}>
                      {t.div}
                    </span>
                  </td>
                  <td className="conf-cell">
                    <ConfLink conf={t.conf} onNavigateConference={onNavigateConference} />
                  </td>
                  <td className="wintotals-record-cell">0-0</td>
                  <td className={`rating-cell ${t.rating < 0 ? "rating-good" : "rating-bad"}`}>
                    <span className="mini-rank-flag">{t.rank}</span>
                    {t.rating > 0 ? "+" : ""}
                    {t.rating.toFixed(2)}
                  </td>
                  <td className="wintotals-total-cell">
                    <span className="mini-rank-flag">{WIN_TOTAL_RANK_BY_TEAM[t.team]}</span>
                    {t.winTotal.toFixed(2)}
                  </td>
                  <td className="wintotals-total-cell">
                    <span className="mini-rank-flag">{CONF_WIN_TOTAL_RANK_BY_TEAM[t.team]}</span>
                    {t.confWinTotal.toFixed(2)}
                  </td>
                  <td className="wintotals-total-cell">
                    {RESUME_BY_TEAM[t.team] ? (
                      <>
                        <span className="mini-rank-flag">{RESUME_BY_TEAM[t.team].rank}</span>
                        {RESUME_BY_TEAM[t.team].rating.toFixed(2)}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td
                    className="wintotals-total-cell"
                    style={
                      SOS_BY_TEAM[t.team] != null
                        ? { color: spreadColor(SOS_BY_TEAM[t.team]) }
                        : undefined
                    }
                  >
                    {SOS_BY_TEAM[t.team] != null ? (
                      <>
                        <span className="mini-rank-flag">{SOR_RANK_BY_TEAM[t.team]}</span>
                        {(SOS_BY_TEAM[t.team] > 0 ? "+" : "") + SOS_BY_TEAM[t.team].toFixed(2)}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
                {showCutlines && t.rank === 4 && (
                  <tr>
                    <td colSpan={8} className="cutline">
                      ‒‒‒ Top 4 · Automatic Byes ‒‒‒
                    </td>
                  </tr>
                )}
                {showCutlines && t.rank === 12 && (
                  <tr>
                    <td colSpan={8} className="cutline">
                      ‒‒‒ Cutline · 12-Team Playoff Field ‒‒‒
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No teams match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="footer-note">
        This site is not a betting site and is purely for informational
        purposes.
      </div>
    </>
  );
}
