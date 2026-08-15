import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import SortHeader from "../components/SortHeader";
import { TEAMS, TEAMS_BY_NAME, conferencesForDivision } from "../data/teams";
import { conferenceFilterOptions, teamMatchesConferenceFilter } from "../lib/conferenceBuckets";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchResumeWeights } from "../lib/api/resumeWeights";
import { fetchRatingPulls } from "../lib/api/ratingSystems";
import {
  computeRawResumeMetrics,
  normalizeMetric,
  computeConglomerateScore,
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_HIGHER_IS_BETTER,
  STUBBED_METRICS,
  DEFAULT_RESUME_WEIGHTS,
  type RawResumeMetrics,
  type ResumeWeights,
} from "../lib/resumeRating";

export default function ResumeRatingAdminPanel({ onBack }: { onBack: () => void }) {
  const [division, setDivision] = useState<"FBS" | "FCS">("FBS");
  const [conference, setConference] = useState("All");
  const season = new Date().getFullYear();

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [srsByTeam, setSrsByTeam] = useState<Record<string, number | null>>({});
  const [vsrsByTeam, setVsrsByTeam] = useState<Record<string, number | null>>({});

  const [weights, setWeights] = useState<ResumeWeights>({ ...DEFAULT_RESUME_WEIGHTS });
  const [weightsLoaded, setWeightsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchGamesWithLines(season), fetchResumeWeights(season), fetchRatingPulls()])
      .then(([gamesData, savedWeights, pulls]) => {
        setGames(gamesData);
        if (savedWeights) setWeights({ ...DEFAULT_RESUME_WEIGHTS, ...savedWeights });
        setWeightsLoaded(true);

        const srsMap: Record<string, number | null> = {};
        const vsrsMap: Record<string, number | null> = {};
        for (const p of pulls) {
          if (p.system_key === "yc_srs") srsMap[p.team] = p.value;
          else if (p.system_key === "yc_vsrs") vsrsMap[p.team] = p.value;
        }
        setSrsByTeam(srsMap);
        setVsrsByTeam(vsrsMap);
      })
      .catch((err) => setLoadError(err.message ?? "Failed to load data"))
      .finally(() => setLoading(false));
  }, [season]);

  const teams = useMemo(
    () => TEAMS.filter((t) => t.div === division && teamMatchesConferenceFilter(t.team, t.conf, conference)),
    [division, conference]
  );

  const rawByTeam = useMemo(() => {
    const map = new Map<string, RawResumeMetrics>();
    for (const t of teams) {
      map.set(t.team, computeRawResumeMetrics(t, games, liveByTeam, srsByTeam, vsrsByTeam));
    }
    return map;
  }, [teams, games, liveByTeam, srsByTeam, vsrsByTeam]);

  const normalizedByTeam = useMemo(() => {
    const pools: Partial<Record<keyof RawResumeMetrics, (number | null)[]>> = {};
    for (const key of METRIC_KEYS) {
      pools[key] = teams.map((t) => rawByTeam.get(t.team)?.[key] ?? null);
    }

    const result = new Map<string, Partial<Record<keyof RawResumeMetrics, number | null>>>();
    for (const t of teams) {
      const raw = rawByTeam.get(t.team);
      const norm: Partial<Record<keyof RawResumeMetrics, number | null>> = {};
      for (const key of METRIC_KEYS) {
        norm[key] = normalizeMetric(key, raw?.[key] ?? null, pools[key]!, METRIC_HIGHER_IS_BETTER[key]);
      }
      result.set(t.team, norm);
    }
    return result;
  }, [teams, rawByTeam]);

  const rows = useMemo(() => {
    return teams.map((t) => {
      const norm = normalizedByTeam.get(t.team) ?? {};
      const score = computeConglomerateScore(norm, weights);
      return { team: t, raw: rawByTeam.get(t.team)!, norm, score };
    });
  }, [teams, normalizedByTeam, rawByTeam, weights]);

  const sortedRows = useMemo(() => {
    const withValue = rows.map((r) => ({
      r,
      value: sortKey === "score" ? r.score : sortKey === "team" ? r.team.team : r.raw[sortKey as keyof RawResumeMetrics],
    }));
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      if (typeof a.value === "number" && typeof b.value === "number") {
        return sortDir === "asc" ? a.value - b.value : b.value - a.value;
      }
      const as = String(a.value);
      const bs = String(b.value);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return withValue.map((w) => w.r);
  }, [rows, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "team" ? "asc" : "desc");
    }
  }

  function setWeight(key: string, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveWeights() {
    const password = window.prompt("Admin password:");
    if (!password) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin-bets-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action: "saveResumeWeights", season, weights }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaveMessage("Weights saved.");
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message ?? "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  function fmtRaw(v: number | null) {
    return v == null ? "–" : v.toFixed(2);
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Resume Rating</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Each metric is normalized 1-10 within {division} (min-max, direction-aware — for metrics
        where a lower raw value is actually better, the scale flips so 10 always means "best").
        The conglomerate score is a weighted average of whichever normalized metrics have a
        non-zero weight, times 10 — so the final score runs roughly 10-100, not 1-10. Set a
        weight to 0 to drop a metric entirely. Metrics marked{" "}
        <span style={{ color: "var(--chalk-dim)" }}>(pending)</span> have no data source wired up
        yet and always show "–" until they do.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.25rem" }}>
        <button
          className={`mode-btn ${division === "FBS" ? "mode-btn-active" : ""}`}
          onClick={() => {
            setDivision("FBS");
            setConference("All");
          }}
        >
          FBS
        </button>
        <button
          className={`mode-btn ${division === "FCS" ? "mode-btn-active" : ""}`}
          onClick={() => {
            setDivision("FCS");
            setConference("All");
          }}
        >
          FCS
        </button>
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
          <option value="All">All conferences</option>
          {conferenceFilterOptions(division, conferencesForDivision("FBS"), conferencesForDivision("FCS")).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
          padding: "1rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
        }}
      >
        {METRIC_KEYS.map((key) => (
          <label key={key} style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
            {METRIC_LABELS[key]}
            {STUBBED_METRICS.includes(key) && <span style={{ color: "var(--chalk-dim)" }}> (pending)</span>}
            <br />
            <input
              type="number"
              step="0.5"
              min="0"
              value={weights[key] ?? 0}
              onChange={(e) => setWeight(key, parseFloat(e.target.value) || 0)}
              style={{ width: "100%", marginTop: "0.2rem" }}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1.5rem" }}>
        <button className="menu-btn" onClick={handleSaveWeights} disabled={saving || !weightsLoaded}>
          {saving ? "Saving…" : "Save Weights"}
        </button>
        <button className="menu-btn" onClick={() => setWeights({ ...DEFAULT_RESUME_WEIGHTS })} disabled={saving}>
          Reset to 1x Each
        </button>
        {saveMessage && <span style={{ color: saveMessage.startsWith("Error") ? "#c45c52" : "#8fd39a" }}>{saveMessage}</span>}
      </div>

      {loading ? (
        <div className="empty matchups-empty">Loading…</div>
      ) : (
        <div className="table-scroll">
          <table className="matchups-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Score" sortKey="score" active={sortKey === "score"} dir={sortDir} onClick={handleSort} align="right" />
                {METRIC_KEYS.map((key) => (
                  <SortHeader
                    key={key}
                    label={METRIC_LABELS[key]}
                    sortKey={key}
                    active={sortKey === key}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={r.team.team}>
                  <td className="matchup-team-cell">
                    <span style={{ color: "var(--chalk-dim)", marginRight: "0.4rem" }}>{i + 1}</span>
                    <TeamLogo team={r.team} />
                    {r.team.team}
                  </td>
                  <td className="matchups-projected-cell">{r.score != null ? r.score.toFixed(2) : "–"}</td>
                  {METRIC_KEYS.map((key) => (
                    <td key={key} className="matchups-empty-cell">
                      {fmtRaw(r.raw[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="footer-note">
        Best Win/Best Loss/Worst Loss use PROJECTED results (not actual) for now — opponent's
        current rating, same computation as the Team Page. Avg. Projected Line and Avg.
        Opponent PR are season-wide (every game, played or not); everything else that needs a
        real result (Actual Wins, Losses, MOV, Avg. Actual Line, ATS Margin) is completed games
        only. Lower opponent rating (a better team) always scores higher for Best/Best/Worst
        Loss — beating or nearly-losing-respectably-to a good team is the better outcome either
        way. SOS pulls from the site's existing Strength of Schedule field. SRS/VSRS pull from
        the "YC SRS" snapshot in Rating Systems — hit "Send to Rating Systems (YC SRS)" on the
        Monte Carlo SRS tab to refresh both; they won't change on their own between refreshes.
        Weights persist to Supabase per season, ready for a future public Resume Ratings page to
        read the same numbers.
      </div>
    </div>
  );
}
