import { useEffect, useMemo, useState } from "react";
import { useAdminWeek } from "../lib/adminWeek";
import type { CSSProperties } from "react";
import SortHeader from "../components/SortHeader";
import TeamLink from "../components/TeamLink";
import { CONFERENCES } from "../data/teams";
import { RATING_SYSTEMS, RATING_SYSTEMS_BY_KEY, CONSENSUS_INPUT_SYSTEMS, YC_INPUT_SYSTEMS, consensusMemberKey, isInConsensus } from "../lib/ratingSystems";
import type { WeeklyPowerRatingRow } from "../lib/api/ratingSystems";
import { matchTeamRows } from "../lib/teamNameMatch";
import { SP_CSV_TEMPLATE, spFreshness, spValuesFromSheet, type SpValue } from "../lib/spPlusPull";
import { TEAMS_BY_NAME } from "../data/teams";
import { parseSheetCsv, parseMcilleceCsv, parseSpPlusCsv, parseMasseyCsv, normalizeMasseyRows, parseJpPlusPaste } from "../lib/ratingsCsv";
import { computeConglomeratedTable, conglomeratedRowsToSaveFormat, teamDivConf, type ConglomeratedRow } from "../lib/ratingConglomerate";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import { buildRatingsByTeam, computeMultiSystemRow, aggregateSystemPerformance, winPct } from "../lib/multiRatingMatchups";
import {
  fetchRatingPulls,
  fetchRatingWeights,
  fetchMcilleceRatings,
  fetchJpPlusRatings,
  fetchTeamRankingsRatings,
  fetchTeamRankingsHfaPage,
  saveTeamHfa,
  fetchSpPlusSheet,
  fetchRecentPullRuns,
  fetchSavedRatingsAtOrBefore,
  logManualPullRun,
  type PullRunRow,
  saveRatingWeights,
  syncCfbdRatings,
  fetchPublishedSheetCsv,
  fetchSagarinRatings,
  fetchFeiFplusRatings,
  saveRatingRows,
  saveRatingWeek,
  fetchSavedRatingWeeks,
  fetchWeeklyPowerRatings,
  pushYcToLiveRatings,
  frozenSkipNote,
  type RatingPullRow,
  type RatingSaveRow,
} from "../lib/api/ratingSystems";
import { fetchAvailableWeeks } from "../lib/api/weeklyStats";
import { WEEK_OPTIONS } from "../lib/weekOptions";

function fmtNum(v: number | null, digits = 2) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

// ---------------------------------------------------------------------
// Weight editor.
// ---------------------------------------------------------------------
function WeightsEditor({
  weights,
  onSave,
}: {
  weights: Record<string, number>;
  onSave: (w: Record<string, number>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(weights);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setDraft(weights), [weights]);

  const editableKeys = [...YC_INPUT_SYSTEMS]; // includes "consensus"

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await onSave(draft);
      setMsg("Weights saved.");
    } catch (err: any) {
      setMsg(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        YC weights (weighted average across every system below, including Consensus)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
        {editableKeys.map((key) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem", gap: "0.2rem" }}>
            {RATING_SYSTEMS_BY_KEY[key]?.label ?? key}
            <input
              type="number"
              step="0.05"
              value={draft[key] ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: parseFloat(e.target.value) || 0 }))}
              style={{ width: 70 }}
            />
          </label>
        ))}
      </div>
      <div className="section-label" style={{ margin: "0.9rem 0 0.6rem" }}>
        Systems in Consensus (a plain, unweighted average of the checked systems)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 1rem" }}>
        {CONSENSUS_INPUT_SYSTEMS.map((key) => {
          const wk = consensusMemberKey(key);
          return (
            <label key={wk} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem" }}>
              <input
                type="checkbox"
                checked={isInConsensus(key, draft)}
                onChange={(e) => setDraft((d) => ({ ...d, [wk]: e.target.checked ? 1 : 0 }))}
              />
              {RATING_SYSTEMS_BY_KEY[key]?.label ?? key}
            </label>
          );
        })}
      </div>
      <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.75rem" }}>
        {saving ? "Saving…" : "Save weights"}
      </button>
      {msg && <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{msg}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Rating sources. Sync All runs every one of them; Fill gaps re-runs only the
// ones with no successful run since this week started (Sunday 12am). Every
// run is logged to rating_pull_runs (trigger "manual"), which is what Fill
// gaps and the status chips read.
// ---------------------------------------------------------------------
type SourceKey = "cfbd" | "spplus" | "sheet" | "sagarin" | "mcillece" | "jpplus" | "tr";
const SOURCE_LABELS: Record<SourceKey, string> = {
  cfbd: "CFBD",
  spplus: "SP+",
  sheet: "Sheet",
  sagarin: "Sagarin/FEI/F+",
  mcillece: "McIllece",
  jpplus: "JP+",
  tr: "TeamRankings",
};
const SOURCE_ORDER = Object.keys(SOURCE_LABELS) as SourceKey[];

function weekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

type SourceResult = { summary: string; unmatchedNames?: string[]; label?: string | null };

function SyncControls({ onDataChanged }: { onDataChanged: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  // HFA pulled alongside Massey / TeamRankings is saved as the HFA going into the admin week (Teams → HFA).
  const { week: hfaWeek } = useAdminWeek();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<{ source: string; names: string[] } | null>(null);
  const [running, setRunning] = useState<SourceKey | null>(null);
  // JP+ paste box: opens when the JP+ pull fails (or from the Paste JP+ button).
  const [jpPasteOpen, setJpPasteOpen] = useState(false);
  const [jpPasteText, setJpPasteText] = useState("");
  const [jpPasteMsg, setJpPasteMsg] = useState<string | null>(null);
  const jpParsed = useMemo(() => parseJpPlusPaste(jpPasteText), [jpPasteText]);

  async function saveJpPaste() {
    const { matched, unmatched: um } = matchTeamRows(jpParsed, (r) => r.team);
    if (matched.length === 0) {
      setJpPasteMsg("Couldn't read any teams from that — paste the JP+ table as copied from jpplusratings.com.");
      return;
    }
    try {
      const result = await saveRatingRows(matched.map((m) => ({ team: m.team, values: { jpplus: m.row.value } })));
      const summary = `JP+ (pasted) — read ${jpParsed.length}, matched ${matched.length}, saved ${result.saved} teams.${formatDiffNote(result.bySystem)}`;
      await logManualPullRun({ source: "jpplus", ok: true, label: "pasted", detail: summary.slice(0, 500) }).catch(() => {});
      setJpPasteMsg(summary + (um.length ? ` Unmatched: ${um.map((u) => u.team).join(", ")}` : ""));
      setJpPasteText("");
      loadRuns();
      onDataChanged();
    } catch (e: any) {
      setJpPasteMsg(e.message ?? "Save failed");
    }
  }
  const [runs, setRuns] = useState<PullRunRow[] | null>(null);
  function loadRuns() {
    fetchRecentPullRuns(10)
      .then(setRuns)
      .catch(() => setRuns([]));
  }
  useEffect(loadRuns, []);

  // "Core" versions return a summary string (and optional unmatched-name
  // list) instead of touching busy/log/unmatched state directly, so
  // handleSyncAll below can run all three back to back and show one
  // combined result instead of the last one silently overwriting the
  // others.

  // Shared "X/X updated, N unchanged" note for every non-CFBD sync path —
  // the "save" action now returns the same before/after diff per
  // system_key that the CFBD "sync" action already computed, so a
  // stale/no-op pull (values fetched and "saved" but identical to what
  // was already stored) is visible here too instead of only for CFBD.
  function formatDiffNote(bySystem?: Record<string, { total: number; changed: number; unchanged: number; newTeams: number }>): string {
    if (!bySystem) return "";
    const parts = Object.entries(bySystem).map(([key, s]) => {
      const label = RATING_SYSTEMS_BY_KEY[key]?.label ?? key;
      const updated = s.changed + s.newTeams;
      return `${label} ${updated}/${s.total} updated (${s.unchanged} unchanged)`;
    });
    return parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  }

  async function syncCfbdCore(): Promise<SourceResult> {
    // SP+ has its own source (CFBD first, then the SP+ sheet), so the general CFBD pull skips it.
    const data = await syncCfbdRatings(year, { skip: ["sp"] });
    const parts = Object.entries(data.results).map(([key, r]: [string, any]) => {
      const label = RATING_SYSTEMS_BY_KEY[key]?.label ?? key;
      if (r.error) return `${label}: error (${r.error})`;
      // yearUsed differs from the requested year whenever the primary
      // year came back empty and the server fell back to year-1 (e.g.
      // this year's ratings aren't published by CFBD yet) — surface that
      // so a stale/wrong-year pull is obvious instead of silent.
      const yearNote = r.yearUsed != null && r.yearUsed !== year ? ` [fell back to ${r.yearUsed}]` : ` [${r.yearUsed ?? year}]`;
      // changed/unchanged/newTeams — a pull can "succeed" (fetched N,
      // saved N, no error) yet be a silent no-op if CFBD served a
      // cached/stale response. Comparing against what was already
      // stored, right before this upsert overwrote it, catches that:
      // 0 changed across a real weekly sync is the loud signal that
      // nothing actually moved.
      const diffNote =
        r.changed != null
          ? ` — ${r.changed} changed, ${r.unchanged} unchanged${r.newTeams ? `, ${r.newTeams} new` : ""}${
              r.changed > 0 ? ` (avg Δ${r.avgAbsDelta.toFixed(2)}, max Δ${r.maxAbsDelta.toFixed(2)})` : ""
            }`
          : "";
      return `${label}: ${r.saved}/${r.fetched}${yearNote}${diffNote}`;
    });
    return { summary: `CFBD sync — ${parts.join("; ")}` };
  }

  async function syncSheetCore(): Promise<SourceResult> {
    const csv = await fetchPublishedSheetCsv();
    const parsed = parseSheetCsv(csv);
    if (parsed.length === 0) {
      return { summary: "Sheet pull — parsed 0 rows; check that it still has Team/Division columns with the expected headers." };
    }
    const { matched, unmatched: um } = matchTeamRows(parsed, (r) => r.team);
    const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: m.row.values }));
    const result = await saveRatingRows(rows);
    return {
      summary: `Sheet pull — parsed ${parsed.length}, matched ${matched.length}, saved ${result.saved} values.${formatDiffNote(result.bySystem)}`,
      unmatchedNames: um.length > 0 ? um.map((r) => r.team) : undefined,
    };
  }

  // Sagarin has no year param (always "current"); FEI/F+ are year-scoped
  // (bcftoys.com/{year}-fei, {year}-fplus). Both merged into one button
  // since they're both "scraped, no manual step" sources now, same as
  // Chris asked for.
  async function syncSagarinFeiCore(): Promise<SourceResult> {
    const [sagarinRows, feiFplusRows] = await Promise.all([fetchSagarinRatings(), fetchFeiFplusRatings(year)]);
    // Merge by team name — Sagarin and bcftoys.com are two different
    // sources, so a team present in one but not the other is normal
    // (e.g. an FCS team Sagarin rates that bcftoys doesn't), not a
    // mismatch to report.
    const byTeam = new Map<string, Record<string, number>>();
    for (const r of [...sagarinRows, ...feiFplusRows]) {
      const existing = byTeam.get(r.team) ?? {};
      byTeam.set(r.team, { ...existing, ...r.values });
    }
    const merged = Array.from(byTeam.entries()).map(([team, values]) => ({ team, values }));
    if (merged.length === 0) {
      return { summary: "Sagarin/FEI/F+ — parsed 0 rows from either source." };
    }
    const { matched, unmatched: um } = matchTeamRows(merged, (r) => r.team);
    const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: m.row.values }));
    const result = await saveRatingRows(rows);
    return {
      summary: `Sagarin/FEI/F+ — Sagarin ${sagarinRows.length} teams, FEI/F+ ${feiFplusRows.length} teams, matched ${matched.length}, saved ${result.saved} values.${formatDiffNote(result.bySystem)}`,
      unmatchedNames: um.length > 0 ? um.map((r) => r.team) : undefined,
    };
  }

  async function scrapeCore(
    label: string,
    fetchRows: () => Promise<{ rows: { team: string; values: Record<string, number> }[]; note: string | null }>,
  ): Promise<SourceResult> {
    const { rows: scraped, note } = await fetchRows();
    const { matched, unmatched: um } = matchTeamRows(scraped, (r) => r.team);
    const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: m.row.values }));
    const result = await saveRatingRows(rows);
    return {
      summary: `${label}${note ? ` (${note})` : ""} — scraped ${scraped.length}, matched ${matched.length}, saved ${result.saved} teams.${formatDiffNote(result.bySystem)}`,
      unmatchedNames: um.length > 0 ? um.map((r) => r.team) : undefined,
      label: note,
    };
  }

  // SP+: CFBD (FBS only) when it has new numbers for this season; the SP+ sheet for the admin week otherwise, and
  // always for FCS. Ends by comparing against last week's saved SP+ so a stale pull can't pass as new.
  async function syncSpPlusCore(): Promise<SourceResult> {
    const lines: string[] = [];
    let fbsFromCfbd = false;
    try {
      const data = await syncCfbdRatings(year, { systems: ["sp"] });
      const r = data.results?.sp;
      if (r?.error) lines.push(`CFBD SP+ failed (${r.error}) — using the sheet for FBS.`);
      else if (!r || r.fetched === 0) lines.push("CFBD has no SP+ — using the sheet for FBS.");
      else if (r.yearUsed !== year) lines.push(`CFBD only has ${r.yearUsed} SP+ — using the sheet for FBS.`);
      else if (!r.changed) lines.push(`CFBD SP+ is unchanged since the last pull (${r.fetched} teams) — using the sheet for FBS.`);
      else {
        fbsFromCfbd = true;
        lines.push(`CFBD SP+: ${r.saved} FBS teams, ${r.changed} changed.`);
      }
    } catch (e: any) {
      lines.push(`CFBD SP+ failed (${e.message ?? e}) — using the sheet for FBS.`);
    }

    let values: SpValue[] = [];
    let unmatchedNames: string[] = [];
    try {
      const sheet = await fetchSpPlusSheet(hfaWeek);
      const parsed = spValuesFromSheet(sheet);
      values = parsed.values.filter((v) => v.division === "FCS" || !fbsFromCfbd);
      unmatchedNames = parsed.unmatched;
      if (sheet.mode === "none" || parsed.values.length === 0) lines.push(`SP+ sheet: nothing for week ${hfaWeek} (${(sheet.notes ?? []).join("; ")}).`);
      else
        lines.push(
          `SP+ sheet (${sheet.tabs.join(" + ")}): ${parsed.values.filter((v) => v.division === "FBS").length} FBS, ${parsed.values.filter((v) => v.division === "FCS").length} FCS${fbsFromCfbd ? " (FBS kept from CFBD)" : ""}.`
        );
    } catch (e: any) {
      lines.push(`SP+ sheet failed: ${e.message ?? e}.`);
    }

    const haveFbs = fbsFromCfbd || values.some((v) => v.division === "FBS");
    const haveFcs = values.some((v) => v.division === "FCS");
    if (values.length > 0) {
      const result = await saveRatingRows(values.map((v) => ({ team: v.team, division: v.division, conference: TEAMS_BY_NAME[v.team]?.conf ?? null, values: { sp: v.value } })));
      lines.push(`Saved ${result.saved} sheet values.${formatDiffNote(result.bySystem)}`);
    }

    // New-week check against the last saved week (CFBD's FBS values are read back from the live table).
    try {
      const prev = await fetchSavedRatingsAtOrBefore(year, hfaWeek - 1);
      let compare: { team: string; division: "FBS" | "FCS"; value: number }[] = values;
      if (fbsFromCfbd) {
        const live = (await fetchRatingPulls()).filter((r) => r.system_key === "sp" && TEAMS_BY_NAME[r.team]?.div === "FBS");
        compare = [...live.map((r) => ({ team: r.team, division: "FBS" as const, value: Number(r.value) })), ...values];
      }
      lines.push(spFreshness(compare, prev.rows, prev.week));
    } catch {
      /* comparison is informational */
    }

    if (!haveFbs || !haveFcs) {
      throw new Error(
        `${lines.join(" ")} Missing ${[!haveFbs && "FBS", !haveFcs && "FCS"].filter(Boolean).join(" and ")} SP+ for week ${hfaWeek}: upload an SP+ CSV (Download SP+ template).`
      );
    }
    return { summary: lines.join(" "), unmatchedNames: unmatchedNames.length ? unmatchedNames : undefined, label: `week ${hfaWeek}` };
  }

  const CORES: Record<SourceKey, () => Promise<SourceResult>> = {
    cfbd: syncCfbdCore,
    spplus: syncSpPlusCore,
    sheet: syncSheetCore,
    sagarin: syncSagarinFeiCore,
    mcillece: () =>
      scrapeCore("McIllece", async () => {
        const r = await fetchMcilleceRatings();
        return { rows: r.rows, note: r.year };
      }),
    jpplus: () =>
      scrapeCore("JP+", async () => {
        const r = await fetchJpPlusRatings();
        return { rows: r.rows, note: r.label };
      }),
    tr: async () => {
      const result = await scrapeCore("TeamRankings", async () => ({ rows: await fetchTeamRankingsRatings(), note: null }));
      // Then TeamRankings' Home Advantage page (÷10, in points) — a second request, after the site's 10s crawl delay.
      try {
        await new Promise((r) => setTimeout(r, 10_000));
        const hfaRows = await fetchTeamRankingsHfaPage("home-adv");
        const { matched } = matchTeamRows(hfaRows, (r) => r.team);
        const saved = await saveTeamHfa(year, hfaWeek, "tr", matched.map((m) => ({ team: m.team, value: m.row.value })));
        result.summary += ` TR Home Advantage saved as the TR input on Teams → HFA (${saved.saved} teams, week ${hfaWeek}).`;
      } catch (e: any) {
        result.summary += ` TR HFA pull failed: ${e.message ?? e}.`;
      }
      return result;
    },
  };

  // Runs the given sources one after another (a failed source doesn't stop the rest), logs each run and shows one
  // combined result. Syncing only updates the live table below; nothing is saved to a week until Save as Week.
  async function runSources(keys: SourceKey[], busyKey: string) {
    if (keys.length === 0) {
      setLog("Nothing to fill — every source has a successful pull since Sunday.");
      return;
    }
    setBusy(busyKey);
    setLog(null);
    setUnmatched(null);
    const summaries: string[] = [];
    const allUnmatched: string[] = [];
    for (const key of keys) {
      setRunning(key);
      try {
        const result = await CORES[key]();
        summaries.push(result.summary);
        for (const n of result.unmatchedNames ?? []) allUnmatched.push(`${SOURCE_LABELS[key]}: ${n}`);
        await logManualPullRun({ source: key, ok: true, label: result.label ?? null, detail: result.summary.slice(0, 500) }).catch(() => {});
      } catch (err: any) {
        const msg = err.message ?? "unknown error";
        summaries.push(`${SOURCE_LABELS[key]} failed: ${msg}${key === "jpplus" ? " — paste the JP+ table below instead." : ""}`);
        if (key === "jpplus") setJpPasteOpen(true);
        await logManualPullRun({ source: key, ok: false, error: msg }).catch(() => {});
      }
    }
    setRunning(null);
    setLog(summaries.join("\n"));
    if (allUnmatched.length > 0) setUnmatched({ source: "Sync", names: allUnmatched });
    loadRuns();
    onDataChanged();
    setBusy(null);
  }

  function gapSources(): SourceKey[] {
    const since = weekStart().getTime();
    return SOURCE_ORDER.filter((k) => !(runs ?? []).some((r) => r.source === k && r.ok && new Date(r.ran_at).getTime() >= since));
  }

  // Fills JP+ into the weekly snapshots you've already saved (Save as week), from
  // JP+'s own week-by-week archive, so JP+ has history, week-to-week change and
  // per-week matchup columns. Only writes the jpplus values — every other
  // system in those saved weeks is left alone — and is safe to re-run.
  async function handleJpPlusBackfill() {
    setBusy("jpbackfill");
    setLog(null);
    setUnmatched(null);
    try {
      const jp = await fetchJpPlusRatings();
      const savedWeeks = await fetchSavedRatingWeeks(jp.season);
      if (savedWeeks.length === 0) {
        setLog(`No saved weeks for ${jp.season} to backfill.`);
        return;
      }
      const lines: string[] = [];
      const unmatchedNames = new Set<string>();
      for (const week of savedWeeks) {
        const snap = jp.seasonSnapshots[`${jp.season}-w${week}`] ?? (week === 1 ? jp.seasonSnapshots[`${jp.season}-preseason`] : undefined);
        if (!snap) {
          lines.push(`Week ${week}: no JP+ snapshot for that week — skipped`);
          continue;
        }
        const { matched, unmatched: um } = matchTeamRows(snap.rows, (r) => r.team);
        const rows: RatingSaveRow[] = matched.map((m) => {
          const dc = teamDivConf(m.team);
          return { team: m.team, division: dc?.div ?? null, conference: dc?.conf ?? null, values: { jpplus: m.row.value } };
        });
        const result = await saveRatingWeek(jp.season, week, rows);
        lines.push(`Week ${week} (${snap.label}): matched ${matched.length}/${snap.rows.length}, saved ${result.saved} JP+ values`);
        for (const r of um) unmatchedNames.add(r.team);
      }
      setLog(lines.join("\n"));
      if (unmatchedNames.size > 0) setUnmatched({ source: "JP+ backfill", names: Array.from(unmatchedNames) });
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "JP+ backfill failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleMcilleceUpload(file: File) {
    setBusy("mcillece");
    setLog(null);
    try {
      const text = await file.text();
      const parsed = parseMcilleceCsv(text);
      if (parsed.length === 0) {
        setLog("Parsed 0 rows from this file — check that it still has \"Team\" and \"Power\" columns with those exact headers.");
        return;
      }
      const { matched, unmatched: um } = matchTeamRows(parsed, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: { mcillece: m.row.value } }));
      const result = await saveRatingRows(rows);
      setLog(`McIllece upload — parsed ${parsed.length}, matched ${matched.length}, saved ${result.saved} teams.${formatDiffNote(result.bySystem)}`);
      if (um.length > 0) setUnmatched({ source: "McIllece CSV", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "McIllece upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSpPlusUpload(file: File) {
    setBusy("spplus");
    setLog(null);
    try {
      const text = await file.text();
      const parsed = parseSpPlusCsv(text);
      if (parsed.length === 0) {
        setLog("Parsed 0 rows from this file — expected a \"Team\" column (O) and an \"SP+\" column (R).");
        return;
      }
      const { matched, unmatched: um } = matchTeamRows(parsed, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: { sp: m.row.value } }));
      const result = await saveRatingRows(rows);
      setLog(`SP+ upload — parsed ${parsed.length}, matched ${matched.length}, saved ${result.saved} teams (sign-flipped).${formatDiffNote(result.bySystem)}`);
      if (um.length > 0) setUnmatched({ source: "SP+ CSV", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "SP+ upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleMasseyUpload(file: File) {
    setBusy("massey");
    setLog(null);
    try {
      const text = await file.text();
      const raw = parseMasseyCsv(text);
      if (raw.length === 0) {
        setLog("Parsed 0 rows from this file — check that it still has \"Team\" and \"Pwr\" columns with those exact headers.");
        return;
      }
      const normalized = normalizeMasseyRows(raw);
      const { matched, unmatched: um } = matchTeamRows(normalized, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: { massey: m.row.value } }));
      const result = await saveRatingRows(rows);
      // The same file's HFA column, saved as the HFA going into the admin week.
      const hfaRows = matched.flatMap((m) => {
        const hfa = raw.find((r) => r.team === m.row.team)?.hfa;
        return hfa != null ? [{ team: m.team, value: hfa }] : [];
      });
      let hfaNote = " No HFA column found, so HFA wasn't updated.";
      if (hfaRows.length > 0) {
        try {
          const saved = await saveTeamHfa(year, hfaWeek, "massey", hfaRows);
          hfaNote = ` Massey HFA column saved as the Massey input on Teams → HFA (${saved.saved} teams, week ${hfaWeek}); it isn't the team's HFA on its own, the Team HFA blend there is.`;
        } catch (e: any) {
          hfaNote = ` HFA save failed: ${e.message ?? e}.`;
        }
      }
      setLog(
        `Massey upload — parsed ${raw.length}, matched ${matched.length}, saved ${result.saved} teams (min-max normalized to [-55, +30], sign-flipped).${formatDiffNote(result.bySystem)}${hfaNote}`
      );
      if (um.length > 0) setUnmatched({ source: "Massey CSV", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "Massey upload failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Pull ratings
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Syncing updates the live table below. Review the changes, then Save as Week. Nothing is saved to a week automatically.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <button
          className="primary"
          onClick={() => runSources(SOURCE_ORDER, "all")}
          disabled={busy != null}
          style={{ fontSize: "1rem", fontWeight: 700, padding: "0.65rem 1.4rem" }}
          title="CFBD, Sheet, Sagarin/FEI/F+, McIllece, JP+ and TeamRankings, in that order"
        >
          {busy === "all" ? `Syncing ${running ? SOURCE_LABELS[running] : ""}…` : "Sync All"}
        </button>
        <button
          onClick={() => runSources(gapSources(), "gaps")}
          disabled={busy != null || runs == null}
          style={{ fontSize: "0.95rem", fontWeight: 600, padding: "0.6rem 1.1rem" }}
          title="Re-runs only the sources that failed or haven't been pulled since Sunday"
        >
          {busy === "gaps" ? `Filling ${running ? SOURCE_LABELS[running] : ""}…` : `Fill gaps${runs ? ` (${gapSources().length})` : ""}`}
        </button>
        <label style={{ fontSize: "0.8rem" }}>
          Year <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} style={{ width: 70 }} />
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
        {SOURCE_ORDER.map((k) => {
          const since = weekStart().getTime();
          const last = (runs ?? []).find((r) => r.source === k && new Date(r.ran_at).getTime() >= since);
          const color = running === k ? "var(--c-info)" : last ? (last.ok ? "var(--c-ok)" : "var(--c-err)") : "var(--chalk-dim)";
          return (
            <span
              key={k}
              title={last ? (last.ok ? `Pulled ${fmtWhen(last.ran_at)}` : `Failed ${fmtWhen(last.ran_at)}: ${last.error ?? ""}`) : "Not pulled since Sunday"}
              style={{ fontSize: "0.72rem", fontWeight: 600, padding: "0.15rem 0.55rem", borderRadius: 99, border: `1px solid ${color}`, color }}
            >
              {SOURCE_LABELS[k]} · {running === k ? "running" : last ? (last.ok ? fmtWhen(last.ran_at) : "failed") : "not pulled"}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center", fontSize: "0.75rem" }}>
        <span style={{ color: "var(--chalk-dim)" }}>One source:</span>
        {SOURCE_ORDER.map((k) => (
          <button key={k} onClick={() => runSources([k], k)} disabled={busy != null} style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
            {busy === k ? "…" : SOURCE_LABELS[k]}
          </button>
        ))}
        <button
          onClick={handleJpPlusBackfill}
          disabled={busy != null}
          style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}
          title="Writes JP+'s own week-by-week ratings into every week you've already saved (JP+ values only; nothing else is touched)"
        >
          {busy === "jpbackfill" ? "Backfilling…" : "Backfill JP+ into saved weeks"}
        </button>
        <label className="menu-btn" style={{ cursor: "pointer", fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
          {busy === "mcillece" ? "Uploading…" : "Upload McIllece CSV"}
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMcilleceUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        <label className="menu-btn" style={{ cursor: "pointer", fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
          {busy === "spplus" ? "Uploading…" : "Upload SP+ CSV"}
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSpPlusUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="menu-btn"
          style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}
          title="Team, Division (FBS/FCS), SP+ — FBS on the FBS scale, FCS on the FCS scale (as in the sheet's FBS and FCS week tabs)"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([SP_CSV_TEMPLATE], { type: "text/csv" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "sp-plus-template.csv";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download SP+ template
        </button>
        <label className="menu-btn" style={{ cursor: "pointer", fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
          {busy === "massey" ? "Uploading…" : "Upload Massey CSV"}
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMasseyUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {log && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginBottom: 0, whiteSpace: "pre-line" }}>{log}</p>}
      <div style={{ marginTop: "0.5rem" }}>
        {!jpPasteOpen ? (
          <button className="menu-btn" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} onClick={() => setJpPasteOpen(true)}>
            Paste JP+
          </button>
        ) : (
          <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.6rem", background: "var(--turf-panel)", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>Paste JP+</div>
            <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>
              Select the whole table on jpplusratings.com (from "Team" down to the last team), copy, and paste here. The team name and the JP+ rating are
              read from each row; offense, defense and special teams are ignored.
            </div>
            <textarea
              value={jpPasteText}
              onChange={(e) => {
                setJpPasteText(e.target.value);
                setJpPasteMsg(null);
              }}
              rows={8}
              placeholder={"Team\n1\n▲2\nLSU\n+28.2\t37.7 (10)\t9.1 (1)\t-0.4 (117)\n…"}
              style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.78rem" }}>
              <button className="menu-btn" onClick={saveJpPaste} disabled={jpParsed.length === 0}>
                Save {jpParsed.length > 0 ? `${jpParsed.length} teams` : ""}
              </button>
              <button className="admin-link" onClick={() => setJpPasteOpen(false)}>
                Close
              </button>
              {jpParsed.length > 0 && (
                <span style={{ color: "var(--chalk-dim)" }}>
                  Read {jpParsed.length}: {jpParsed[0].team} {(-jpParsed[0].value).toFixed(1)} … {jpParsed[jpParsed.length - 1].team} {(-jpParsed[jpParsed.length - 1].value).toFixed(1)}
                </span>
              )}
              {jpPasteMsg && <span style={{ color: "var(--chalk-dim)" }}>{jpPasteMsg}</span>}
            </div>
          </div>
        )}
      </div>
      {unmatched && (
        <p style={{ fontSize: "0.78rem", color: "var(--c-warn)", marginTop: "0.5rem" }}>
          {unmatched.source}: {unmatched.names.length} team name(s) couldn't be matched and were skipped —{" "}
          {unmatched.names.join(", ")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Per-system win % — same grading engine as the Rating Systems Matchups
// page's Results tab (Every Bet / Filtered Bet / NWFB), season-to-date.
// Shown here too, right next to the weight editor, since seeing each
// system's live win % is exactly what's useful for deciding weights —
// legitimately 0-0 (0%) until a week gets saved and games complete.
// ---------------------------------------------------------------------
function SystemPerformanceSummary({ season }: { season: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{
    games: Awaited<ReturnType<typeof fetchGamesWithLines>>;
    weekly: Awaited<ReturnType<typeof fetchWeeklyPowerRatings>>;
  } | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  // Fetch depends only on `season` — NOT on liveByTeam. useWeeklyStats'
  // byTeam is a plain object rebuilt every render (not memoized), so
  // putting it in this effect's dependency array meant every unrelated
  // re-render of this page (e.g. typing in the YC weight boxes above)
  // re-fired the fetch and cancelled the in-flight one before it could
  // ever resolve — this is what got it stuck on "Loading…" indefinitely.
  // Same bug/fix already applied to useMultiSeasonGameTotalsEngine
  // earlier — grading itself (which does need liveByTeam) happens in a
  // separate, cheap useMemo below instead.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchGamesWithLines(season), fetchWeeklyPowerRatings(season)])
      .then(([games, weekly]) => {
        if (!cancelled) setRaw({ games, weekly });
      })
      .catch((err) => !cancelled && setError(err.message ?? "Failed to load performance"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const perf = useMemo(() => {
    if (!raw) return null;
    const { games, weekly } = raw;
    const byWeek = new Map<number, typeof weekly>();
    for (const r of weekly) {
      const list = byWeek.get(r.week) ?? [];
      list.push(r);
      byWeek.set(r.week, list);
    }
    const ratingsByWeek = new Map<number, Record<string, Record<string, number>>>();
    for (const [wk, rowsForWeek] of byWeek) ratingsByWeek.set(wk, buildRatingsByTeam(rowsForWeek));

    const graded = [];
    for (const g of games) {
      const ratingsByTeam = ratingsByWeek.get(g.week);
      if (!ratingsByTeam) continue; // no saved snapshot for this game's week yet
      graded.push(computeMultiSystemRow(g, ratingsByTeam, liveByTeam));
    }
    return aggregateSystemPerformance(graded);
  }, [raw, liveByTeam]);

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Win % by system ({season} season-to-date)
      </div>
      {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}
      {loading ? (
        <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th className="th">System</th>
                <th className="th th-right">Every Bet</th>
                <th className="th th-right">Filtered</th>
                <th className="th th-right">NWFB</th>
              </tr>
            </thead>
            <tbody>
              {RATING_SYSTEMS.map((s) => {
                const p = perf?.[s.key];
                const fmtRec = (r?: { w: number; l: number; push: number }) =>
                  r ? `${r.w}-${r.l}${r.push ? `-${r.push}` : ""} (${winPct(r).toFixed(1)}%)` : "0-0 (0.0%)";
                return (
                  <tr key={s.key}>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{s.label}</td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.everyBet)}
                    </td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.filteredBet)}
                    </td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.nwfb)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.5rem", marginBottom: 0 }}>
        Only weeks with a saved snapshot (Save As Week, below) count toward these records — everything reads 0-0
        until at least one week is saved and its games complete.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Save As Week.
// ---------------------------------------------------------------------
function SaveAsWeekControl({ rows, season }: { rows: ConglomeratedRow[]; season: number }) {
  const [week, setWeek] = useState(1);
  const [savedWeeks, setSavedWeeks] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchSavedRatingWeeks(season)
      .then(setSavedWeeks)
      .catch(() => {});
  }, [season, msg]);

  const willOverwrite = savedWeeks.includes(week);

  async function handleSave() {
    if (willOverwrite && !window.confirm(`Week ${week} is already saved for ${season}. Overwrite it with the current ratings? (Teams whose game this week is frozen are left alone.)`)) return;
    setSaving(true);
    setMsg(null);
    try {
      const saveRows = conglomeratedRowsToSaveFormat(rows);
      const result = await saveRatingWeek(season, week, saveRows);
      setMsg(`Saved ${result.saved} values for ${season} week ${week}.${frozenSkipNote(result)}`);
    } catch (err: any) {
      setMsg(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Save as week
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Week{" "}
          <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 70 }} />
        </label>
        <button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : willOverwrite ? `Overwrite week ${week}` : `Save as week ${week}`}
        </button>
        {savedWeeks.length > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
            Weeks already saved for {season}: {savedWeeks.join(", ")}
          </span>
        )}
      </div>
      {willOverwrite && !saving && (
        <p style={{ fontSize: "0.78rem", color: "var(--c-warn)", marginTop: "0.4rem" }}>
          Week {week} already has a saved snapshot — saving again will overwrite it.
        </p>
      )}
      {msg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Push YC to Live Ratings — writes YC into weekly_team_stats.rating (the
// same table/column Data Upload writes, and what every other page's
// "live rating" reads), for a chosen week. Only touches the rating (and
// recomputed rank) column on each row — every other field Data Upload
// populates (resume metrics, win totals, etc.) is left exactly as-is.
// Teams YC has no value for (mostly small FCS schools the CFBD systems
// don't cover) keep whatever rating they already had.
// ---------------------------------------------------------------------
function PushYcControl({ rows }: { rows: ConglomeratedRow[] }) {
  const [week, setWeek] = useState<string>("preseason");
  const [pushing, setPushing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchAvailableWeeks()
      .then((weeks) => {
        if (weeks.length > 0) setWeek(weeks[0]); // most recent by week_number
      })
      .catch(() => {});
  }, []);

  const ycCount = rows.filter((r) => r.yc != null).length;

  async function handlePush() {
    setPushing(true);
    setMsg(null);
    try {
      const teamRatings = rows.filter((r) => r.yc != null).map((r) => ({ team: r.team, rating: r.yc as number }));
      const result = await pushYcToLiveRatings(week, teamRatings);
      setMsg(`Pushed YC for ${result.matched} teams into "${week}" live ratings (${result.saved} rows saved).${frozenSkipNote(result)}`);
    } catch (err: any) {
      setMsg(err.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Push YC to live ratings
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: 0, marginBottom: "0.6rem" }}>
        Writes YC's current values into the same "rating" field Data Upload writes, for every site page that shows a
        live power rating (Team Pages, Matchups, Survivor, Monte Carlo, etc.) — nothing else about that week's saved
        stats changes. {ycCount} of {rows.length} teams currently have a YC value.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <select value={week} onChange={(e) => setWeek(e.target.value)}>
          {WEEK_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button onClick={handlePush} disabled={pushing || ycCount === 0}>
          {pushing ? "Pushing…" : `Push YC → ${week}`}
        </button>
      </div>
      {msg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Conglomerated table.
// ---------------------------------------------------------------------
const DELTA_EPS = 0.005;

function ConglomeratedTable({
  rows,
  prev,
  prevWeek,
}: {
  rows: ConglomeratedRow[];
  prev: Map<string, Record<string, number>>;
  prevWeek: number | null;
}) {
  const [changedOnly, setChangedOnly] = useState(false);
  const valueOf = (r: ConglomeratedRow, key: string): number | null =>
    key === "yc" ? r.yc : key === "consensus" ? r.consensus : (r.values[key] ?? null);
  const deltaOf = (r: ConglomeratedRow, key: string): number | null => {
    const now = valueOf(r, key);
    const before = prev.get(r.team)?.[key];
    if (now == null || before == null) return null;
    const d = now - before;
    return Math.abs(d) < DELTA_EPS ? 0 : d;
  };
  const deltaCell = (r: ConglomeratedRow, key: string) => {
    const d = deltaOf(r, key);
    if (d == null || d === 0) return null;
    return (
      <span style={{ marginLeft: "0.3rem", fontSize: "0.66rem", fontWeight: 600, color: d < 0 ? "var(--c-ok)" : "var(--c-err)" }}>
        {d < 0 ? "▲" : "▼"}
        {Math.abs(d).toFixed(1)}
      </span>
    );
  };
  const [sortKey, setSortKey] = useState("yc");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // negative-is-better -> ascending shows best first
  const [divFilter, setDivFilter] = useState<"all" | "FBS" | "FCS">("FBS");
  const [confFilter, setConfFilter] = useState("");

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const systemCols = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus");
  const allKeys = ["yc", "consensus", ...systemCols.map((s) => s.key)];
  const teamChanged = (r: ConglomeratedRow) => allKeys.some((k) => (deltaOf(r, k) ?? 0) !== 0);

  const filtered = rows.filter((r) => {
    if (divFilter !== "all" && r.div !== divFilter) return false;
    if (confFilter && r.conf !== confFilter) return false;
    if (changedOnly && !teamChanged(r)) return false;
    return true;
  });

  // Teams changed per system since the comparison week, for the summary line.
  const changedCounts = systemCols
    .map((s) => ({ label: s.label, n: rows.filter((r) => (deltaOf(r, s.key) ?? 0) !== 0).length }))
    .filter((c) => c.n > 0);

  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      const av = sortKey === "yc" || sortKey === "consensus" ? a[sortKey] : a.values[sortKey];
      const bv = sortKey === "yc" || sortKey === "consensus" ? b[sortKey] : b.values[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  // Div/Conf/Team stay pinned while scrolling horizontally through the
  // (many) rating-system columns — Div and Conf get fixed widths so
  // Team's own left offset (and everything stacked after it) is
  // predictable; Team itself is left unconstrained so long team names
  // still display in full.
  const DIV_COL_WIDTH = 46;
  const CONF_COL_WIDTH = 150;
  const TEAM_COL_LEFT = DIV_COL_WIDTH + CONF_COL_WIDTH;
  const stickyBg = "var(--turf)";
  const stickyHeaderStyle = (left: number): CSSProperties => ({ position: "sticky", left, zIndex: 21, background: stickyBg });
  const stickyCellStyle = (left: number): CSSProperties => ({
    padding: "0.3rem 0.6rem",
    borderBottom: "1px solid var(--hash)",
    position: "sticky",
    left,
    zIndex: 5,
    background: "var(--turf-panel)",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button key={d} className={`mode-btn ${divFilter === d ? "mode-btn-active" : ""}`} onClick={() => setDivFilter(d)}>
            {d === "all" ? "All" : d}
          </button>
        ))}
        <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
          <option value="">All conferences</option>
          {CONFERENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {prevWeek != null && (
          <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
            Changed since Week {prevWeek} only
          </label>
        )}
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        {prevWeek == null
          ? "No earlier saved week to compare against."
          : changedCounts.length === 0
            ? `Nothing has changed since saved Week ${prevWeek}.`
            : `Changed since saved Week ${prevWeek} (▲ better, ▼ worse): ${changedCounts.map((c) => `${c.label} ${c.n}`).join(" · ")}`}
      </p>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader
                label="Div"
                sortKey="div"
                active={sortKey === "div"}
                dir={sortDir}
                onClick={handleSort}
                style={{ ...stickyHeaderStyle(0), width: DIV_COL_WIDTH, minWidth: DIV_COL_WIDTH }}
              />
              <SortHeader
                label="Conf"
                sortKey="conf"
                active={sortKey === "conf"}
                dir={sortDir}
                onClick={handleSort}
                style={{ ...stickyHeaderStyle(DIV_COL_WIDTH), width: CONF_COL_WIDTH, minWidth: CONF_COL_WIDTH }}
              />
              <SortHeader
                label="Team"
                sortKey="team"
                active={sortKey === "team"}
                dir={sortDir}
                onClick={handleSort}
                style={stickyHeaderStyle(TEAM_COL_LEFT)}
              />
              <SortHeader label="YC" sortKey="yc" active={sortKey === "yc"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader
                label={"Consen­sus"}
                sortKey="consensus"
                active={sortKey === "consensus"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              {systemCols.map((s) => (
                <SortHeader key={s.key} label={s.label} sortKey={s.key} active={sortKey === s.key} dir={sortDir} onClick={handleSort} align="right" />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team}>
                <td style={{ ...stickyCellStyle(0), width: DIV_COL_WIDTH, minWidth: DIV_COL_WIDTH }}>{r.div}</td>
                <td style={{ ...stickyCellStyle(DIV_COL_WIDTH), width: CONF_COL_WIDTH, minWidth: CONF_COL_WIDTH }}>{r.conf}</td>
                <td style={{ ...stickyCellStyle(TEAM_COL_LEFT), whiteSpace: "nowrap" }}>
                  <TeamLink team={r.team} />
                </td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                  {fmtNum(r.yc)}
                  {deltaCell(r, "yc")}
                </td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtNum(r.consensus)}
                  {deltaCell(r, "consensus")}
                </td>
                {systemCols.map((s) => (
                  <td key={s.key} style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {fmtNum(r.values[s.key])}
                    {deltaCell(r, s.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Power Ratings History — a verification view, not an editor. Lets you
// confirm the weekly "Save as week" snapshots (SaveAsWeekControl, above)
// are actually landing correctly: pick a season, pick one of its saved
// weeks, and see every rating system's value for every team that week,
// straight from weekly_power_ratings. Starts empty for any season with no
// saved weeks yet (2026 is the first season this was ever wired up).
// ---------------------------------------------------------------------
interface HistoryRow {
  team: string;
  conference: string | null;
  division: string | null;
  values: Record<string, number>;
}

function pivotHistoryRows(rows: WeeklyPowerRatingRow[]): { rows: HistoryRow[]; systemKeys: string[] } {
  const byTeam = new Map<string, HistoryRow>();
  const systemKeys = new Set<string>();
  for (const r of rows) {
    let row = byTeam.get(r.team);
    if (!row) {
      row = { team: r.team, conference: r.conference, division: r.division, values: {} };
      byTeam.set(r.team, row);
    }
    row.values[r.system_key] = r.value;
    systemKeys.add(r.system_key);
  }
  // Order columns by the canonical RATING_SYSTEMS registry order (falling
  // back to alphabetical for any key that isn't in the registry, e.g. an
  // old/retired system that still has historical rows).
  const known = RATING_SYSTEMS.map((s) => s.key).filter((k) => systemKeys.has(k));
  const unknown = Array.from(systemKeys).filter((k) => !RATING_SYSTEMS_BY_KEY[k]).sort();
  return { rows: Array.from(byTeam.values()), systemKeys: [...known, ...unknown] };
}

function HistoryTable({
  title,
  subtitle,
  rows,
  systemKeys,
  sortKey,
  sortDir,
  onSort,
  isDiff,
}: {
  title: string;
  subtitle?: string;
  rows: HistoryRow[];
  systemKeys: string[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  isDiff?: boolean;
}) {
  const sorted = useMemo(() => {
    return [...rows].sort((a: any, b: any) => {
      const av = sortKey === "team" || sortKey === "conference" ? a[sortKey] : a.values[sortKey];
      const bv = sortKey === "team" || sortKey === "conference" ? b[sortKey] : b.values[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir]);

  // Ratings are negative-is-better, so in the change table a negative
  // number means the team improved.
  function diffColor(v: number | null): string | undefined {
    if (!isDiff || v == null || v === 0) return undefined;
    return v < 0 ? "var(--c-ok)" : "var(--c-err)";
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", marginBottom: "0.4rem", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>{subtitle}</div>}
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No rows.</p>
      ) : (
        <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={onSort} />
                <SortHeader label="Conf" sortKey="conference" active={sortKey === "conference"} dir={sortDir} onClick={onSort} />
                {systemKeys.map((key) => (
                  <SortHeader
                    key={key}
                    label={RATING_SYSTEMS_BY_KEY[key]?.label ?? key}
                    sortKey={key}
                    active={sortKey === key}
                    dir={sortDir}
                    onClick={onSort}
                    align="right"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.team}>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLink team={r.team} />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conference ?? "–"}</td>
                  {systemKeys.map((key) => {
                    const v = r.values[key] ?? null;
                    return (
                      <td
                        key={key}
                        style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", color: diffColor(v) }}
                      >
                        {fmtNum(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PowerRatingsHistorySection() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [savedWeeks, setSavedWeeks] = useState<number[]>([]);
  const [weekA, setWeekA] = useState<number | null>(null); // earlier week (middle table)
  const [weekB, setWeekB] = useState<number | null>(null); // later week (bottom table)
  const [rawA, setRawA] = useState<WeeklyPowerRatingRow[]>([]);
  const [rawB, setRawB] = useState<WeeklyPowerRatingRow[]>([]);
  const [loadingWeeks, setLoadingWeeks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("team");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Changing the "to" week moves the "from" week to the saved week just before it.
  function chooseWeekB(w: number | null) {
    setWeekB(w);
    if (w == null) return;
    const earlier = savedWeeks.filter((x) => x < w);
    setWeekA(earlier.length > 0 ? earlier[earlier.length - 1] : w);
  }

  useEffect(() => {
    setLoadingWeeks(true);
    setError(null);
    setWeekA(null);
    setWeekB(null);
    setRawA([]);
    setRawB([]);
    fetchSavedRatingWeeks(season)
      .then((weeks) => {
        setSavedWeeks(weeks);
        if (weeks.length > 0) {
          const b = weeks[weeks.length - 1]; // most recent saved week
          setWeekB(b);
          setWeekA(weeks.length > 1 ? weeks[weeks.length - 2] : b); // the saved week before it
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load saved weeks"))
      .finally(() => setLoadingWeeks(false));
  }, [season]);

  useEffect(() => {
    if (weekA == null || weekB == null) return;
    setLoadingData(true);
    setError(null);
    Promise.all([fetchWeeklyPowerRatings(season, weekA), fetchWeeklyPowerRatings(season, weekB)])
      .then(([a, b]) => {
        setRawA(a);
        setRawB(b);
      })
      .catch((err) => setError(err.message ?? "Failed to load weeks"))
      .finally(() => setLoadingData(false));
  }, [season, weekA, weekB]);

  const pivotA = useMemo(() => pivotHistoryRows(rawA), [rawA]);
  const pivotB = useMemo(() => pivotHistoryRows(rawB), [rawB]);

  // Change = later week minus earlier week, per team per system, only
  // where both weeks have a value.
  const diff = useMemo(() => {
    const aByTeam = new Map(pivotA.rows.map((r) => [r.team, r]));
    const keys = new Set<string>();
    const out: HistoryRow[] = [];
    for (const b of pivotB.rows) {
      const a = aByTeam.get(b.team);
      if (!a) continue;
      const values: Record<string, number> = {};
      for (const k of Object.keys(b.values)) {
        if (a.values[k] == null) continue;
        values[k] = b.values[k] - a.values[k];
        keys.add(k);
      }
      out.push({ team: b.team, conference: b.conference, division: b.division, values });
    }
    const known = RATING_SYSTEMS.map((s) => s.key).filter((k) => keys.has(k));
    const unknown = Array.from(keys).filter((k) => !RATING_SYSTEMS_BY_KEY[k]).sort();
    return { rows: out, systemKeys: [...known, ...unknown] };
  }, [pivotA, pivotB]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const weekSelect = (value: number | null, onChange: (w: number | null) => void) => (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
      disabled={savedWeeks.length === 0}
    >
      {savedWeeks.length === 0 && <option value="">No saved weeks</option>}
      {savedWeeks.map((w) => (
        <option key={w} value={w}>
          Week {w}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Power Ratings History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Pick any two saved weeks. The bottom two tables show each week's stored ratings; the top table is the change
        from the first to the second (ratings are negative-is-better, so a negative change means the team improved).
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>From {weekSelect(weekA, setWeekA)}</label>
        <label style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>To {weekSelect(weekB, chooseWeekB)}</label>
        {loadingWeeks && <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Loading weeks…</span>}
      </div>

      {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}

      {!loadingWeeks && savedWeeks.length === 0 && (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
          No saved snapshots for {season} yet — use "Save as week" on the Manage tab once ratings look right for a given week.
        </p>
      )}

      {weekA != null && weekB != null &&
        (loadingData ? (
          <p>Loading…</p>
        ) : (
          <>
            <HistoryTable
              title={`Change: Week ${weekA} → Week ${weekB}`}
              subtitle="later minus earlier · green = improved"
              rows={diff.rows}
              systemKeys={diff.systemKeys}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              isDiff
            />
            <HistoryTable
              title={`Week ${weekA}`}
              rows={pivotA.rows}
              systemKeys={pivotA.systemKeys}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <HistoryTable
              title={`Week ${weekB}`}
              rows={pivotB.rows}
              systemKeys={pivotB.systemKeys}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Top-level panel.
// ---------------------------------------------------------------------
export default function RatingSystemsPanel({ onBack }: { onBack: () => void }) {
  const [panelTab, setPanelTab] = useState<"manage" | "performance" | "history">("manage");
  const [pulls, setPulls] = useState<RatingPullRow[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    setError(null);
    Promise.all([fetchRatingPulls(), fetchRatingWeights()])
      .then(([p, w]) => {
        setPulls(p);
        setWeights(w);
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  // The saved week before the admin week: what "changed" deltas in the table compare against.
  const { week: adminWeek, ready: adminWeekReady } = useAdminWeek();
  const [prev, setPrev] = useState<{ week: number | null; byTeam: Map<string, Record<string, number>> }>({ week: null, byTeam: new Map() });
  useEffect(() => {
    if (!adminWeekReady) return;
    fetchSavedRatingsAtOrBefore(new Date().getFullYear(), adminWeek - 1)
      .then(({ week, rows }) => {
        const byTeam = new Map<string, Record<string, number>>();
        for (const r of rows) {
          const v = byTeam.get(r.team) ?? {};
          v[r.system_key] = r.value;
          byTeam.set(r.team, v);
        }
        setPrev({ week, byTeam });
      })
      .catch(() => setPrev({ week: null, byTeam: new Map() }));
  }, [adminWeek, adminWeekReady]);

  const conglomerated = useMemo(() => computeConglomeratedTable(pulls, weights), [pulls, weights]);

  return (
    <div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${panelTab === "manage" ? "mode-btn-active" : ""}`} onClick={() => setPanelTab("manage")}>
          Manage
        </button>
        <button className={`mode-btn ${panelTab === "performance" ? "mode-btn-active" : ""}`} onClick={() => setPanelTab("performance")}>
          Performance &amp; Weights
        </button>
        <button className={`mode-btn ${panelTab === "history" ? "mode-btn-active" : ""}`} onClick={() => setPanelTab("history")}>
          Power Ratings History
        </button>
      </div>

      {panelTab === "history" ? (
        <PowerRatingsHistorySection />
      ) : panelTab === "performance" ? (
        <>
          <h2 style={{ marginTop: 0 }}>Performance &amp; Weights</h2>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
            Each system's live win % this season, and the weight editor for YC's customizable weighted average.
          </p>
          {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}
          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <SystemPerformanceSummary season={new Date().getFullYear()} />
              <WeightsEditor weights={weights} onSave={async (w) => { await saveRatingWeights(w); loadAll(); }} />
            </>
          )}
        </>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Rating Systems</h2>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
            Pull FPI/SP+/SRS/Core/Elo from CFBD, pull the published sheet, and upload McIllece/Massey weekly. YC is a
            customizable weighted average across every system (including Consensus, itself a simple average of the
            source systems). Save the current table to a specific week once you're happy with it.
          </p>

          {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}
          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <SyncControls onDataChanged={loadAll} />
              <SaveAsWeekControl rows={conglomerated} season={new Date().getFullYear()} />
              <PushYcControl rows={conglomerated} />
              <ConglomeratedTable rows={conglomerated} prevWeek={prev.week} prev={prev.byTeam} />
            </>
          )}
        </>
      )}
    </div>
  );
}
