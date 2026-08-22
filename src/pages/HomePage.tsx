import { Fragment, useMemo, useRef, useState } from "react";
import ChangeCell from "../components/ChangeCell";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";
import { spreadColor } from "../lib/odds";
import { TEAM_WIN_TOTALS, buildRankMap } from "../lib/ranks";
import { useWeeklyChange, useWeeklyStats, weekLabel } from "../lib/api/weeklyStats";

export default function HomePage({ onNavigateTeam, onNavigateConference }: any) {
  const [heroQuery, setHeroQuery] = useState("");
  const [heroFocused, setHeroFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const exportRef = useRef<HTMLDivElement>(null);
  const { byTeam: changeByTeam } = useWeeklyChange("rating");
  const { byTeam: liveByTeam, resolvedWeek } = useWeeklyStats("latest");

  // Resolve every team's live-preferred values ONCE, from the full
  // unfiltered roster. Everything downstream (rank maps, the filtered/
  // searched table, the hero search) reads from this same resolved list —
  // that way filtering to one division/conference can never change what a
  // team's rank number means, and live data (once a week is uploaded)
  // takes over from the static preseason snapshot automatically.
  const resolvedAll = useMemo(() => {
    const withRating = TEAMS.map((t) => {
      const live = liveByTeam[t.team];
      return {
        ...t,
        rating: live?.rating ?? t.rating,
        winTotal: live?.total_wins ?? TEAM_WIN_TOTALS[t.team]?.total ?? 0,
        confWinTotal: live?.conf_proj_wins ?? TEAM_WIN_TOTALS[t.team]?.confTotal ?? 0,
        sos: live?.sor ?? SOS_BY_TEAM[t.team] ?? null,
        resumeRating: live?.resume_rating ?? RESUME_BY_TEAM[t.team]?.rating ?? null,
        resumeRank: live?.resume_rank ?? RESUME_BY_TEAM[t.team]?.rank ?? null,
      };
    });
    // rank is always derived from resolved rating here, never trusted from
    // a stored/pasted "rank" column — that column turned out to be saved
    // as a flat 1 for every team in every saved week (confirmed directly
    // in weekly_team_stats), which silently broke every rank badge on the
    // site once a week's data was uploaded. Rank is fully determined by
    // rating anyway (lower rating = better team, same convention as
    // winTotalRankByTeam/sorRankByTeam below), so there's no reason to
    // trust a separately-pasted value that can drift or come in wrong.
    const ratingRankByTeam = buildRankMap(withRating.map((t) => [t.team, t.rating]), false);
    return withRating.map((t) => ({ ...t, rank: ratingRankByTeam[t.team] }));
  }, [liveByTeam]);

  // Rank badges for Win Total / Conf Win Total / SOR, computed from the
  // FULL resolved roster (every division, every conference) — not from
  // whatever subset happens to be visible after filtering/searching.
  // Building these from a filtered list was tried and reverted: it would
  // have silently shown ranks like 1-16 instead of real national ranks
  // the moment someone filtered down to a single conference.
  const winTotalRankByTeam = useMemo(
    () => buildRankMap(resolvedAll.map((t) => [t.team, t.winTotal]), true),
    [resolvedAll]
  );
  const confWinTotalRankByTeam = useMemo(
    () => buildRankMap(resolvedAll.map((t) => [t.team, t.confWinTotal]), true),
    [resolvedAll]
  );
  const sorRankByTeam = useMemo(
    () =>
      buildRankMap(
        resolvedAll.filter((t) => t.sos != null).map((t) => [t.team, t.sos]),
        false
      ),
    [resolvedAll]
  );

  const filtered = useMemo(() => {
    let rows = resolvedAll.filter((t) => {
      if (division !== "All" && t.div !== division) return false;
      if (conference !== "All" && t.conf !== conference) return false;
      if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });

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
  }, [resolvedAll, query, division, conference, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const fbsCount = TEAMS.filter((t) => t.div === "FBS").length;
  const heroMatches =
    heroQuery.trim().length > 0
      ? resolvedAll
          .filter((t) =>
            t.team.toLowerCase().includes(heroQuery.trim().toLowerCase())
          )
          .slice(0, 6)
      : [];
  const showCutlines =
    sortKey === "rank" &&
    sortDir === "asc" &&
    !query &&
    division === "All" &&
    conference === "All";

  const weekEyebrow = weekLabel(resolvedWeek);

  return (
    <div ref={exportRef}>
<div className="hero">
        <div className="eyebrow">{weekEyebrow} · Power Ratings</div>
        <h1 className="title">
          YC <span>POWER</span> RATINGS
        </h1>
        <p className="subtitle">
          Power Ratings derived from stats, vibes and other stuff like that
        </p>

        <div className="hero-search-wrap" data-export-exclude="true">
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

      <div className="controls" data-export-exclude="true">
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
        {/* No Tweet button here on purpose: this page mixes FBS and FCS
            together, and the compact tweet graphic needs to be one division
            at a time. Export PNG (full detailed table) still works. */}
        <ExportPngButton targetRef={exportRef} filename="yc-power-ratings" showTweet={false} />
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
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
              <th className="th th-right">Change from Last Week</th>
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
                    <span className="mini-rank-flag">{winTotalRankByTeam[t.team]}</span>
                    {t.winTotal.toFixed(2)}
                  </td>
                  <td className="wintotals-total-cell">
                    <span className="mini-rank-flag">{confWinTotalRankByTeam[t.team]}</span>
                    {t.confWinTotal.toFixed(2)}
                  </td>
                  <td className="wintotals-total-cell">
                    {t.resumeRating != null ? (
                      <>
                        <span className="mini-rank-flag">{t.resumeRank}</span>
                        {t.resumeRating.toFixed(2)}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td
                    className="wintotals-total-cell"
                    style={
                      t.sos != null
                        ? { color: spreadColor(t.sos) }
                        : undefined
                    }
                  >
                    {t.sos != null ? (
                      <>
                        <span className="mini-rank-flag">{sorRankByTeam[t.team]}</span>
                        {(t.sos > 0 ? "+" : "") + t.sos.toFixed(2)}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <ChangeCell change={changeByTeam[t.team]?.change ?? null} />
                </tr>
                {showCutlines && t.rank === 4 && (
                  <tr>
                    <td colSpan={9} className="cutline">
                      ‒‒‒ Top 4 · Automatic Byes ‒‒‒
                    </td>
                  </tr>
                )}
                {showCutlines && t.rank === 12 && (
                  <tr>
                    <td colSpan={9} className="cutline">
                      ‒‒‒ Cutline · 12-Team Playoff Field ‒‒‒
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No teams match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="footer-note" data-export-exclude="true">
        This site is not a betting site and is purely for informational
        purposes.
      </div>
    </div>
  );
}
