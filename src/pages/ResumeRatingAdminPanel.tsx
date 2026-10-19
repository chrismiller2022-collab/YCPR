import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLogo from "../components/TeamLogo";
import SortHeader from "../components/SortHeader";
import { TEAMS, conferencesForDivision } from "../data/teams";
import { conferenceFilterOptions, teamMatchesConferenceFilter } from "../lib/conferenceBuckets";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchResumeWeights, saveResumeRatingsToSite, saveFinishedResumeRatings, fetchResumeRatingsByWeeks } from "../lib/api/resumeWeights";
import { fetchMonteCarloRun, fetchMonteCarloRuns } from "../lib/api/monteCarlo";
import SavedWeekProgression from "../components/SavedWeekProgression";
import { fetchRatingPulls, fetchTeamSos } from "../lib/api/ratingSystems";
import { fetchTeamGameAdvanced } from "../lib/api/teamInfo";
import {
  computeRawResumeMetrics,
  normalizeMetric,
  computeBucketedScore,
  bucketMetrics,
  defaultResumeConfig,
  resumeConfigFrom,
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_HIGHER_IS_BETTER,
  RESUME_BUCKETS,
  type BucketKey,
  type RawResumeMetrics,
  type ResumeMode,
  type ResumeWeightConfig,
} from "../lib/resumeRating";

// Two résumés, side by side in one page:
//   Résumé so far     — completed games only. Saved to team_resume_ratings_finished.
//   Projected finish  — completed games plus the rest of the season from the latest Monte Carlo run. Saved to
//                       team_resume_ratings (what the public site has always shown).
// Each has its own bucket and per-metric weights; both are saved together in resume_rating_weights.

const MODES: { key: ResumeMode; label: string }[] = [
  { key: "sofar", label: "Résumé so far" },
  { key: "projected", label: "Projected finish" },
];

const panel: CSSProperties = { padding: "1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 };

interface Row {
  team: (typeof TEAMS)[number];
  raw: RawResumeMetrics;
  score: number | null;
  buckets: Record<BucketKey, number | null>;
}

/**
 * The 12-team field from a ranked résumé: the five highest-ranked conference champions get automatic bids, the next
 * seven best teams are at-large, and all twelve are seeded by résumé rank. Conference champion = the team the latest
 * sim most often has winning the league (projected), or the best résumé in the conference (so far).
 */
function buildField(ranked: Row[], mode: ResumeMode, confTitle: Record<string, number>) {
  const rankOf = new Map(ranked.map((r, i) => [r.team.team, i + 1]));
  const byConf = new Map<string, Row[]>();
  for (const r of ranked) {
    if (r.team.conf === "FBS Independents") continue;
    const list = byConf.get(r.team.conf) ?? [];
    list.push(r);
    byConf.set(r.team.conf, list);
  }
  const champs: Row[] = [];
  for (const list of byConf.values()) {
    const champ =
      mode === "projected" && list.some((r) => confTitle[r.team.team] != null)
        ? [...list].sort((a, b) => (confTitle[b.team.team] ?? 0) - (confTitle[a.team.team] ?? 0))[0]
        : list[0];
    champs.push(champ);
  }
  champs.sort((a, b) => rankOf.get(a.team.team)! - rankOf.get(b.team.team)!);
  const auto = champs.slice(0, 5);
  const autoSet = new Set(auto.map((r) => r.team.team));
  const atLarge = ranked.filter((r) => !autoSet.has(r.team.team)).slice(0, 7);
  const field = [...auto, ...atLarge].sort((a, b) => rankOf.get(a.team.team)! - rankOf.get(b.team.team)!);
  const inField = new Set(field.map((r) => r.team.team));
  const firstOut = ranked.filter((r) => !inField.has(r.team.team)).slice(0, 4);
  return { field: field.map((r) => ({ row: r, rank: rankOf.get(r.team.team)!, auto: autoSet.has(r.team.team) })), firstOut, rankOf };
}

export default function ResumeRatingAdminPanel({ onBack: _onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<ResumeMode>("sofar");
  const [division, setDivision] = useState<"FBS" | "FCS">("FBS");
  const [conference, setConference] = useState("All");
  const season = new Date().getFullYear();

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [srsByTeam, setSrsByTeam] = useState<Record<string, number | null>>({});
  const [vsrsByTeam, setVsrsByTeam] = useState<Record<string, number | null>>({});
  const [netSrByTeam, setNetSrByTeam] = useState<Record<string, number | null>>({});
  const [sosByTeam, setSosByTeam] = useState<Record<string, number | null>>({});
  const [mc, setMc] = useState<{ week: number; byTeam: Record<string, { meanWins: number | null; confTitlePct: number | null }> } | null>(null);

  const [configs, setConfigs] = useState<Record<ResumeMode, ResumeWeightConfig>>({ sofar: defaultResumeConfig("sofar"), projected: defaultResumeConfig("projected") });
  const [weightsLoaded, setWeightsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<BucketKey | null>(null);

  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetchGamesWithLines(season),
      fetchResumeWeights(season),
      fetchRatingPulls(),
      fetchTeamGameAdvanced(season).catch(() => []),
      fetchTeamSos(season).catch(() => ({})),
      fetchMonteCarloRuns(season)
        .then((list) => (list[0] ? fetchMonteCarloRun(list[0].id) : null))
        .catch(() => null),
    ])
      .then(([gamesData, savedWeights, pulls, advRows, sosRows, mcRun]) => {
        setGames(gamesData);
        setConfigs({ sofar: resumeConfigFrom(savedWeights, "sofar"), projected: resumeConfigFrom(savedWeights, "projected") });
        setWeightsLoaded(true);

        // Net success rate: mean over each team's played games, in points.
        const netAcc = new Map<string, number[]>();
        for (const r of advRows) {
          if (r.net_success_rate == null) continue;
          const list = netAcc.get(r.team) ?? [];
          list.push(r.net_success_rate * 100);
          netAcc.set(r.team, list);
        }
        const netMap: Record<string, number | null> = {};
        for (const [team, vals] of netAcc) netMap[team] = vals.reduce((a, b) => a + b, 0) / vals.length;
        setNetSrByTeam(netMap);

        // SOS: the blend from the SOS admin page's last Save to Site (weeks saved before the blend existed fall back
        // to SOS via SRS).
        const sosMap: Record<string, number | null> = {};
        for (const [team, row] of Object.entries(sosRows as Record<string, any>)) sosMap[team] = row.blend_score ?? row.sos_srs_total ?? null;
        setSosByTeam(sosMap);

        const srsMap: Record<string, number | null> = {};
        const vsrsMap: Record<string, number | null> = {};
        for (const p of pulls) {
          if (p.system_key === "yc_srs") srsMap[p.team] = p.value;
          else if (p.system_key === "yc_vsrs") vsrsMap[p.team] = p.value;
        }
        setSrsByTeam(srsMap);
        setVsrsByTeam(vsrsMap);

        if (mcRun) {
          const byTeam: Record<string, { meanWins: number | null; confTitlePct: number | null }> = {};
          for (const r of mcRun.results) byTeam[r.team] = { meanWins: r.meanWins ?? null, confTitlePct: r.confTitlePct ?? null };
          setMc({ week: mcRun.week, byTeam });
        }
      })
      .catch((err) => setLoadError(err.message ?? "Failed to load data"))
      .finally(() => setLoading(false));
  }, [season]);

  // Scores are normalized across the whole division; the conference filter only narrows what's shown.
  const divisionTeams = useMemo(() => TEAMS.filter((t) => t.div === division), [division]);

  // Bubble team for Wins Above Bubble: the 12th-best FBS power rating (negative = better).
  const bubbleRating = useMemo(() => {
    const ratings = TEAMS.filter((t) => t.div === "FBS")
      .map((t) => liveByTeam[t.team]?.rating ?? t.rating)
      .sort((a, b) => a - b);
    return ratings[11] ?? null;
  }, [liveByTeam]);

  const rawByTeam = useMemo(() => {
    const map = new Map<string, RawResumeMetrics>();
    const extra = { bubbleRating, mc: mode === "projected" ? mc?.byTeam : undefined };
    for (const t of divisionTeams) {
      map.set(t.team, computeRawResumeMetrics(t, games, liveByTeam, srsByTeam, vsrsByTeam, mode === "sofar", netSrByTeam, sosByTeam, extra));
    }
    return map;
  }, [divisionTeams, games, liveByTeam, srsByTeam, vsrsByTeam, mode, netSrByTeam, sosByTeam, bubbleRating, mc]);

  const config = configs[mode];

  const allRows = useMemo<Row[]>(() => {
    const pools: Partial<Record<keyof RawResumeMetrics, (number | null)[]>> = {};
    for (const key of METRIC_KEYS) pools[key] = divisionTeams.map((t) => rawByTeam.get(t.team)?.[key] ?? null);
    return divisionTeams.map((t) => {
      const raw = rawByTeam.get(t.team)!;
      const norm: Partial<Record<keyof RawResumeMetrics, number | null>> = {};
      for (const key of METRIC_KEYS) norm[key] = normalizeMetric(key, raw?.[key] ?? null, pools[key]!, METRIC_HIGHER_IS_BETTER[key]);
      const { score, buckets } = computeBucketedScore(norm, config, mode);
      return { team: t, raw, score, buckets };
    });
  }, [divisionTeams, rawByTeam, config, mode]);

  const ranked = useMemo(() => [...allRows].filter((r) => r.score != null).sort((a, b) => b.score! - a.score!), [allRows]);
  const rankOf = useMemo(() => new Map(ranked.map((r, i) => [r.team.team, i + 1])), [ranked]);

  const confTitle = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [t, v] of Object.entries(mc?.byTeam ?? {})) if (v.confTitlePct != null) out[t] = v.confTitlePct;
    return out;
  }, [mc]);
  const playoff = useMemo(() => (division === "FBS" ? buildField(ranked, mode, confTitle) : null), [ranked, mode, confTitle, division]);

  const shownRows = useMemo(() => {
    const filtered = allRows.filter((r) => teamMatchesConferenceFilter(r.team.team, r.team.conf, conference));
    const valueOf = (r: Row): number | string | null =>
      sortKey === "score"
        ? r.score
        : sortKey === "team"
          ? r.team.team
          : sortKey.startsWith("b:")
            ? r.buckets[sortKey.slice(2) as BucketKey]
            : (r.raw[sortKey as keyof RawResumeMetrics] as number | null);
    return filtered.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [allRows, conference, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" ? "asc" : "desc");
    }
  }

  function setBucketWeight(key: BucketKey, value: number) {
    setConfigs((prev) => ({ ...prev, [mode]: { ...prev[mode], buckets: { ...prev[mode].buckets, [key]: value } } }));
  }
  function setMetricWeight(key: string, value: number) {
    setConfigs((prev) => ({ ...prev, [mode]: { ...prev[mode], metrics: { ...prev[mode].metrics, [key]: value } } }));
  }

  async function handleSaveWeights() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin-bets-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: sessionStorage.getItem("admin_password") ?? "",
          action: "saveResumeWeights",
          season,
          weights: { v: 2, sofar: configs.sofar, projected: configs.projected },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaveMessage("Weights saved for both résumés.");
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message ?? "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  const [saveWeek, setSaveWeek] = useState(1);
  useDefaultToAdminWeek(setSaveWeek);
  const [savingToSite, setSavingToSite] = useState(false);
  const [saveToSiteMsg, setSaveToSiteMsg] = useState<string | null>(null);
  const [progressionRefresh, setProgressionRefresh] = useState(0);

  async function handleSaveWeek() {
    setSavingToSite(true);
    setSaveToSiteMsg(null);
    try {
      const saveRows = allRows.map((r) => ({ team: r.team.team, score: r.score, actWins: r.raw.actWins, losses: r.raw.losses }));
      if (mode === "projected") await saveResumeRatingsToSite(season, saveWeek, saveRows);
      else await saveFinishedResumeRatings(season, saveWeek, saveRows);
      setSaveToSiteMsg(`Saved ${MODES.find((m) => m.key === mode)!.label} for ${saveRows.length} ${division} teams as week ${saveWeek}.`);
      setProgressionRefresh((n) => n + 1);
    } catch (err: any) {
      setSaveToSiteMsg(`Error: ${err.message ?? "Save failed"}`);
    } finally {
      setSavingToSite(false);
    }
  }

  const fmtRaw = (v: number | null) => (v == null ? "–" : v.toFixed(2));
  const bucketTotal = RESUME_BUCKETS.reduce((n, b) => n + (config.buckets[b.key] ?? 0), 0);
  const shownMetrics = METRIC_KEYS.filter((k) => RESUME_BUCKETS.some((b) => bucketMetrics(b.key, mode).includes(k)));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Resume Rating</h2>
      <nav className="admin-tabs" aria-label="Résumé" style={{ marginBottom: "0.75rem" }}>
        {MODES.map((m) => (
          <button key={m.key} className={mode === m.key ? "on" : undefined} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </nav>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0, maxWidth: "80ch" }}>
        {mode === "sofar"
          ? "Completed games only: what each team has accomplished. Rest-of-season metrics are left out."
          : `Every completed game plus the rest of the season from the latest Monte Carlo run${mc ? ` (Week ${mc.week} sim)` : " (no sim saved yet, so remaining games use each game's win probability)"}.`}{" "}
        Each metric is scored 1–10 across {division}, averaged inside its bucket using the metric weights, then the buckets are combined with the
        bucket weights. Final score runs 10–100. Wins Above Bubble compares the record to what the 12th-best FBS team would expect against the same
        schedule.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        {(["FBS", "FCS"] as const).map((d) => (
          <button
            key={d}
            className={`mode-btn ${division === d ? "mode-btn-active" : ""}`}
            onClick={() => {
              setDivision(d);
              setConference("All");
            }}
          >
            {d}
          </button>
        ))}
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
          <option value="All">All conferences</option>
          {conferenceFilterOptions(division, conferencesForDivision("FBS"), conferencesForDivision("FCS")).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loadError && <p style={{ color: "var(--c-err)" }}>{loadError}</p>}

      <div style={{ ...panel, marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ fontWeight: 700 }}>
          {MODES.find((m) => m.key === mode)!.label} weights{" "}
          <span style={{ fontWeight: 400, fontSize: "0.8rem", color: bucketTotal === 100 ? "var(--chalk-dim)" : "var(--c-warn)" }}>
            buckets total {bucketTotal}
            {bucketTotal === 100 ? "" : " (they're used as proportions, so any total works)"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.6rem" }}>
          {RESUME_BUCKETS.map((b) => (
            <div key={b.key} style={{ border: "1px solid var(--hash)", borderRadius: 6, padding: "0.5rem 0.6rem", background: "var(--turf)" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 700, display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                {b.label}
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={config.buckets[b.key] ?? 0}
                  onChange={(e) => setBucketWeight(b.key, parseFloat(e.target.value) || 0)}
                  style={{ width: 64 }}
                  aria-label={`${b.label} bucket weight`}
                />
              </label>
              <button className="admin-link" style={{ fontSize: "0.74rem", marginTop: "0.3rem" }} onClick={() => setOpenBucket(openBucket === b.key ? null : b.key)}>
                {openBucket === b.key ? "▾" : "▸"} {bucketMetrics(b.key, mode).length} metrics
              </button>
              {openBucket === b.key && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.35rem" }}>
                  {bucketMetrics(b.key, mode).map((m) => (
                    <label key={m} style={{ fontSize: "0.74rem", display: "flex", justifyContent: "space-between", gap: "0.4rem", alignItems: "center", color: "var(--chalk-dim)" }}>
                      {METRIC_LABELS[m]}
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={config.metrics[m] ?? 0}
                        onChange={(e) => setMetricWeight(m, parseFloat(e.target.value) || 0)}
                        style={{ width: 56 }}
                        aria-label={`${METRIC_LABELS[m]} weight`}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="menu-btn" onClick={handleSaveWeights} disabled={saving || !weightsLoaded}>
            {saving ? "Saving…" : "Save weights (both résumés)"}
          </button>
          <button className="menu-btn" onClick={() => setConfigs((prev) => ({ ...prev, [mode]: defaultResumeConfig(mode) }))} disabled={saving}>
            Reset this résumé to defaults
          </button>
          {saveMessage && <span style={{ color: saveMessage.startsWith("Error") ? "var(--c-err)" : "var(--c-ok)" }}>{saveMessage}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Save as week <input type="number" value={saveWeek} onChange={(e) => setSaveWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} min={0} />
        </label>
        <button className="primary" onClick={handleSaveWeek} disabled={savingToSite || allRows.length === 0}>
          {savingToSite ? "Saving…" : `Save ${MODES.find((m) => m.key === mode)!.label} to week ${saveWeek}`}
        </button>
        <span style={{ fontSize: "0.78rem", color: saveToSiteMsg?.startsWith("Error") ? "var(--c-err)" : "var(--chalk-dim)" }}>
          {saveToSiteMsg ?? "Each résumé saves to its own weekly snapshot; both show as tabs on the public Resume page."}
        </span>
      </div>

      {playoff && ranked.length > 0 && (
        <div style={{ ...panel, marginBottom: "1.25rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>12-team playoff by {MODES.find((m) => m.key === mode)!.label.toLowerCase()}</div>
          <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.5rem" }}>
            Five highest-ranked conference champions get automatic bids
            {mode === "projected" ? " (champion = the team the latest sim most often has winning the league)" : " (champion = best résumé so far in the conference)"}, the
            next seven are at-large, and all twelve are seeded by résumé rank.
          </p>
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  {["Seed", "Team", "Bid", "Résumé rank", "Score", "Record"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.25rem 0.6rem", color: "var(--chalk-dim)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playoff.field.map(({ row, rank, auto }, i) => (
                  <tr key={row.team.team} style={{ borderTop: "1px solid var(--hash)" }}>
                    <td style={{ padding: "0.25rem 0.6rem", fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: "0.25rem 0.6rem", whiteSpace: "nowrap" }}>
                      <TeamLogo team={row.team} /> {row.team.team}
                    </td>
                    <td style={{ padding: "0.25rem 0.6rem", color: auto ? "var(--c-ok)" : undefined }}>{auto ? `Auto · ${row.team.conf}` : "At-large"}</td>
                    <td style={{ padding: "0.25rem 0.6rem" }}>{rank}</td>
                    <td style={{ padding: "0.25rem 0.6rem" }}>{row.score?.toFixed(2)}</td>
                    <td style={{ padding: "0.25rem 0.6rem" }}>
                      {row.raw.actWins}-{row.raw.losses}
                      {mode === "projected" && <span style={{ color: "var(--chalk-dim)" }}> (proj {row.raw.totalProjWins.toFixed(1)}-{row.raw.totalProjLosses.toFixed(1)})</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} style={{ padding: "0.4rem 0.6rem", fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
                    First four out: {playoff.firstOut.map((r) => `${r.team.team} (#${playoff.rankOf.get(r.team.team)})`).join(", ")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty matchups-empty">Loading…</div>
      ) : (
        <div className="table-scroll">
          <table className="matchups-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Score" sortKey="score" active={sortKey === "score"} dir={sortDir} onClick={handleSort} align="right" />
                {RESUME_BUCKETS.map((b) => (
                  <SortHeader key={b.key} label={b.label} sortKey={`b:${b.key}`} active={sortKey === `b:${b.key}`} dir={sortDir} onClick={handleSort} align="right" />
                ))}
                {shownMetrics.map((key) => (
                  <SortHeader key={key} label={METRIC_LABELS[key]} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align="right" />
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) => (
                <tr key={r.team.team}>
                  <td className="matchup-team-cell">
                    <span style={{ color: "var(--chalk-dim)", marginRight: "0.4rem" }}>{rankOf.get(r.team.team) ?? "–"}</span>
                    <TeamLogo team={r.team} />
                    {r.team.team}
                  </td>
                  <td className="matchups-projected-cell">{r.score != null ? r.score.toFixed(2) : "–"}</td>
                  {RESUME_BUCKETS.map((b) => (
                    <td key={b.key} className="matchups-empty-cell">
                      {r.buckets[b.key] != null ? r.buckets[b.key]!.toFixed(1) : "–"}
                    </td>
                  ))}
                  {shownMetrics.map((key) => (
                    <Fragment key={key}>
                      <td className="matchups-empty-cell">{fmtRaw(r.raw[key] as number | null)}</td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SavedWeekProgression
        title="Projected finish: saved weeks"
        description="Every saved week's Projected finish score per team (what the public Resume page has always shown)."
        fetchByWeeks={fetchResumeRatingsByWeeks}
        refreshKey={progressionRefresh}
        digits={2}
        higherIsBetter={true}
      />

      <div className="footer-note">
        Strength of Schedule is your SOS blend from the last Save to Site on the Strength of Schedule page (SOS via SRS for a week saved before the
        blend existed). Margin of victory is the real average margin of played games; the projected résumé adds each remaining game's projected
        margin. Best Win / Best Loss / Worst Loss use real results in Résumé so far and include projected results in Projected finish. Exp. Wins
        (PGWE) and Net Success Rate come from the weekly CFBD pull. SRS/VSRS come from the "YC SRS" snapshot (Monte Carlo SRS tab → Send to Rating
        Systems).
      </div>
    </div>
  );
}
