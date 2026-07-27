import { useEffect, useState } from "react";
import { TEAMS } from "../data/teams";
import { conferenceOptionsFor, teamsFilteredFor } from "../lib/ranks";

export default function TeamPicker({ side, label, division, conference, teamName, onDivision, onConference, onTeam }: any) {
  const confOptions = conferenceOptionsFor(division);
  const teamOptions = teamsFilteredFor(division, conference);

  const [query, setQuery] = useState(teamName || "");
  const [focused, setFocused] = useState(false);

  // Keep the search box in sync whenever the selection changes from
  // somewhere else (the dropdown below, or a parent resetting things) —
  // but not while the person is actively typing a new search.
  useEffect(() => {
    setQuery(teamName || "");
  }, [teamName]);

  const matches =
    query.trim().length > 0 && query !== teamName
      ? TEAMS.filter((t) =>
          t.team.toLowerCase().includes(query.trim().toLowerCase())
        ).slice(0, 6)
      : [];

  const selectTeam = (t) => {
    onDivision(t.div);
    onConference(t.conf);
    onTeam(t.team);
    setQuery(t.team);
  };

  const clearSelection = () => {
    onTeam("");
    setQuery("");
  };

  return (
    <div className="picker-card">
      <div className="picker-label">{label}</div>

      <div className="picker-search-wrap">
        <input
          className={`search picker-search ${teamName && query === teamName ? "picker-search-selected" : ""}`}
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Give a suggestion-item click a moment to register before we
            // decide the edit was "abandoned" and snap back to the real
            // selection.
            setTimeout(() => {
              setFocused(false);
              setQuery(teamName || "");
            }, 120);
          }}
        />
        {teamName && query === teamName && (
          <span className="picker-selected-check" aria-hidden="true">
            ✓
          </span>
        )}
        {query.length > 0 && (
          <button
            type="button"
            className="picker-clear-btn"
            aria-label="Clear selected team"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearSelection}
          >
            ×
          </button>
        )}
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
        {focused && query.trim().length > 0 && query !== teamName && matches.length === 0 && (
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
