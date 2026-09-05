import { useEffect, useState } from "react";
import { TEAMS } from "../data/teams";
import { conferenceOptionsFor, teamsFilteredFor } from "../lib/ranks";
import TeamLogo from "./TeamLogo";

export default function TeamPicker({ side, label, division, conference, teamName, onDivision, onConference, onTeam }: any) {
  const confOptions = conferenceOptionsFor(division);
  const teamOptions = teamsFilteredFor(division, conference);
  const selectedTeam = teamName ? TEAMS.find((t) => t.team === teamName) : null;

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

      {selectedTeam && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.55rem 0.7rem",
            marginBottom: "0.6rem",
            borderRadius: "8px",
            background: "rgba(255, 193, 7, 0.12)",
            border: "1px solid rgba(255, 193, 7, 0.5)",
          }}
        >
          <TeamLogo team={selectedTeam.team} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedTeam.team}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
              {selectedTeam.div} · {selectedTeam.conf}
            </div>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            style={{
              background: "none",
              border: "1px solid var(--hash)",
              borderRadius: "6px",
              color: "var(--chalk-dim)",
              fontSize: "0.72rem",
              padding: "0.25rem 0.55rem",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Change
          </button>
        </div>
      )}

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
