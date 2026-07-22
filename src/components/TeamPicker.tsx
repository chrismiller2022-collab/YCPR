import { useState } from "react";
import { TEAMS } from "../data/teams";
import { conferenceOptionsFor, teamsFilteredFor } from "../lib/ranks";

export default function TeamPicker({ side, label, division, conference, teamName, onDivision, onConference, onTeam }: any) {
  const confOptions = conferenceOptionsFor(division);
  const teamOptions = teamsFilteredFor(division, conference);

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const matches =
    query.trim().length > 0
      ? TEAMS.filter((t) =>
          t.team.toLowerCase().includes(query.trim().toLowerCase())
        ).slice(0, 6)
      : [];

  const selectTeam = (t) => {
    onDivision(t.div);
    onConference(t.conf);
    onTeam(t.team);
    setQuery("");
  };

  return (
    <div className="picker-card">
      <div className="picker-label">{label}</div>

      <div className="picker-search-wrap">
        <input
          className="search picker-search"
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
        />
        {focused && matches.length > 0 && (
          <div className="hero-suggest picker-suggest">
            {matches.map((t) => (
              <button
                key={t.team}
                className="hero-suggest-item"
                onClick={() => selectTeam(t)}
              >
                <span className="hero-suggest-name">{t.team}</span>
                <span className="hero-suggest-conf">{t.conf}</span>
              </button>
            ))}
          </div>
        )}
        {focused && query.trim().length > 0 && matches.length === 0 && (
          <div className="hero-suggest picker-suggest">
            <div className="hero-suggest-empty">No teams match "{query}"</div>
          </div>
        )}
      </div>

      <div className="picker-row">
        <select
          className="filter picker-select"
          value={division}
          onChange={(e) => onDivision(e.target.value)}
        >
          <option value="All">All divisions</option>
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
        <select
          className="filter picker-select"
          value={conference}
          onChange={(e) => onConference(e.target.value)}
        >
          <option value="All">All conferences</option>
          {confOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <select
        className="filter picker-team-select"
        value={teamName}
        onChange={(e) => onTeam(e.target.value)}
      >
        <option value="">Select a team…</option>
        {teamOptions.map((t) => (
          <option key={t.team} value={t.team}>
            {t.team} ({t.conf})
          </option>
        ))}
      </select>
    </div>
  );
}
