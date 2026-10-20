import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "./SortHeader";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/api/fetchAll";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchTeamHfa, indexTeamHfa, type TeamHfaRow } from "../lib/api/teamHfa";
import { fetchTeamRankingsHfaPage, saveTeamHfa, type HfaSource, type TrHfaPage } from "../lib/api/ratingSystems";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useAdminWeek } from "../lib/adminWeek";
import { matchTeamRows } from "../lib/teamNameMatch";
import { parseMasseyCsv } from "../lib/ratingsCsv";
import { TEAMS } from "../data/teams";
import { BLUE_CHIP_HFA } from "../data/blueChipHfa";
import { winPct, type LineMode, type RecordTally } from "../lib/betHistory";
import {
  DEFAULT_HFA_SETTINGS,
  VARIANTS,
  backtestGames,
  bestFlatHfa,
  runVariant,
  teamInputs,
  variantHfa,
  type HfaContext,
  type HfaSettings,
} from "../lib/hfaBacktest";

// Teams → HFA: every team's home-field advantage from each source (Massey CSV, TeamRankings, Blue Chip), the pulls that
// keep them current and backfill past weeks, and a 2026 backtest of each HFA choice against results, the spread signals
// and team totals.

const panel: CSSProperties = { padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf-panel)" };
const small: CSSProperties = { fontSize: "0.8rem", color: "var(--chalk-dim)" };
const SEASON = new Date().getFullYear();
const FBS = TEAMS.filter((t) => t.div === "FBS").map((t) => t.team);
const M_TO_FT = 3.28084;
const TR_PAGES: { page: TrHfaPage; source: HfaSource }[] = [
  { page: "home-adv", source: "tr" },
  { page: "home", source: "tr_home" },
  { page: "away", source: "tr_away" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const f = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d));
const rec = (t: RecordTally) => (t.w + t.l === 0 ? "—" : `${t.w}-${t.l}${t.push ? `-${t.push}` : ""} · ${winPct(t).toFixed(1)}%`);

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span style={{ minWidth: 38, fontVariantNumeric: "tabular-nums" }}>{fmt ? fmt(value) : value.toFixed(1)}</span>
    </label>
  );
}

export default function HfaSection() {
  const { week: adminWeek } = useAdminWeek();
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [hfaRows, setHfaRows] = useState<TeamHfaRow[]>([]);
  const [elevationM, setElevationM] = useState<Record<string, number>>({});
  const [totalsByKey, setTotalsByKey] = useState<Record<string, number>>({});
  const [reload, setReload] = useState(0);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fromWeek, setFromWeek] = useState(1);
  const [toWeek, setToWeek] = useState(adminWeek);
  const [repull, setRepull] = useState(false);
  const [masseyWeek, setMasseyWeek] = useState(adminWeek);
  useEffect(() => {
    setToWeek(adminWeek);
    setMasseyWeek(adminWeek);
  }, [adminWeek]);

  const [s, setS] = useState<HfaSettings>(DEFAULT_HFA_SETTINGS);
  const [lineMode, setLineMode] = useState<LineMode>("close");
  const [fbsOnly, setFbsOnly] = useState(true);
  const [sortKey, setSortKey] = useState("average");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showElevGames, setShowElevGames] = useState(false);

  useEffect(() => {
    fetchGamesWithLines(SEASON).then(setGames).catch(() => setGames([]));
    supabase
      .from("team_venues")
      .select("team, elevation")
      .not("elevation", "is", null)
      .then(({ data }) => setElevationM(Object.fromEntries((data ?? []).map((r: any) => [r.team, Number(r.elevation)]))));
    fetchAllRows<{ game_id: string; week: number; projected_total: number | null }>((from, to) =>
      supabase.from("game_total_snapshots").select("game_id, week, projected_total").eq("season", SEASON).order("id").range(from, to)
    )
      .then((rows) => {
        const out: Record<string, number> = {};
        for (const r of rows) if (r.projected_total != null) out[`${r.game_id}|${r.week}`] = Number(r.projected_total);
        setTotalsByKey(out);
      })
      .catch(() => setTotalsByKey({}));
  }, []);

  useEffect(() => {
    fetchTeamHfa(SEASON).then(setHfaRows).catch(() => setHfaRows([]));
  }, [reload]);

  const weeks = useMemo(() => Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b), [games]);
  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(SEASON, weeks, SEASON);
  const index = useMemo(() => indexTeamHfa(hfaRows), [hfaRows]);
  const ctx: HfaContext = useMemo(() => ({ index, elevationM }), [index, elevationM]);

  // The Totals model's projection for a game, from the snapshot saved for that game's own week.
  const totalsByGameId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of games) {
      const v = totalsByKey[`${g.id}|${g.week}`];
      if (v != null) out[g.id] = v;
    }
    return out;
  }, [games, totalsByKey]);

  const savedWeeks = useMemo(() => {
    const out: Partial<Record<HfaSource, number[]>> = {};
    for (const [src, byWeek] of Object.entries(index)) out[src as HfaSource] = Object.keys(byWeek ?? {}).map(Number).sort((a, b) => a - b);
    return out;
  }, [index]);

  // Day before a week's first kickoff: TeamRankings' page as of then is what was known going into that week.
  function asOfDate(week: number): string | null {
    const starts = games.filter((g) => g.week === week && g.start_date).map((g) => Date.parse(g.start_date!));
    if (starts.length === 0) return null;
    return new Date(Math.min(...starts) - 24 * 3600 * 1000).toISOString().slice(0, 10);
  }

  async function pullTr() {
    setBusy(true);
    const lines: string[] = [];
    try {
      let first = true;
      for (let w = fromWeek; w <= toWeek; w++) {
        // The current week reads the live page; past weeks read the page as it stood before that week's games.
        const date = w >= adminWeek ? null : asOfDate(w);
        if (w < adminWeek && !date) {
          lines.push(`Week ${w}: no games found to date it — skipped`);
          continue;
        }
        for (const { page, source } of TR_PAGES) {
          if (!repull && savedWeeks[source]?.includes(w)) continue;
          if (!first) {
            setLog([...lines, `Waiting 10s (TeamRankings crawl delay) before week ${w} ${page}…`].join("\n"));
            await sleep(10_000);
          }
          first = false;
          try {
            const rows = await fetchTeamRankingsHfaPage(page, date ?? undefined);
            const { matched, unmatched } = matchTeamRows(rows, (r) => r.team);
            const saved = await saveTeamHfa(SEASON, w, source, matched.map((m) => ({ team: m.team, value: m.row.value })), date);
            lines.push(`Week ${w} ${page}${date ? ` (as of ${date})` : " (live)"}: ${saved.saved} teams${unmatched.length ? `, unmatched: ${unmatched.map((u) => u.team).join(", ")}` : ""}`);
          } catch (e: any) {
            lines.push(`Week ${w} ${page}: failed — ${e.message ?? e}`);
          }
          setLog(lines.join("\n"));
        }
      }
      if (lines.length === 0) lines.push("Nothing to pull — every week in that range is already saved (tick Re-pull to overwrite).");
      setLog(lines.join("\n"));
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function uploadMassey(file: File) {
    setBusy(true);
    try {
      const raw = parseMasseyCsv(await file.text());
      const withHfa = raw.filter((r) => r.hfa != null);
      if (withHfa.length === 0) {
        setLog("No HFA column found in that file.");
        return;
      }
      const { matched, unmatched } = matchTeamRows(withHfa, (r) => r.team);
      const saved = await saveTeamHfa(SEASON, masseyWeek, "massey", matched.map((m) => ({ team: m.team, value: m.row.hfa! })));
      setLog(`Massey HFA for week ${masseyWeek}: saved ${saved.saved} teams${unmatched.length ? ` (${unmatched.length} unmatched, mostly FCS)` : ""}. Power ratings were not touched; upload in Rating Systems for those.`);
      setReload((n) => n + 1);
    } catch (e: any) {
      setLog(e.message ?? "Massey HFA upload failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- Team table (values going into the admin week) ----
  const teamRows = useMemo(() => {
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const raw = FBS.map((t) => teamInputs(ctx, { ...s, centerTr: false }, t, adminWeek, { tr: null, split: null }));
    const trMean = mean(raw.map((r) => r.trRaw));
    const splitMean = mean(raw.map((r) => r.split));
    return FBS.map((team) => {
      const inp = teamInputs(ctx, s, team, adminWeek, { tr: trMean, split: splitMean });
      const elev = ctx.elevationM[team];
      return {
        team,
        massey: inp.massey,
        trRaw: inp.trRaw,
        tr: inp.tr,
        bluechip: inp.bluechip,
        average: variantHfa("average", inp, s, splitMean),
        blend: variantHfa("blend", inp, s, splitMean),
        split: inp.split,
        splitHfa: inp.split != null ? variantHfa("split", inp, s, splitMean) : null,
        elevFt: elev != null ? Math.round(elev * M_TO_FT) : null,
        high: elev != null && elev >= s.elevation.thresholdM,
      };
    });
  }, [ctx, s, adminWeek]);

  const sortedTeams = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...teamRows].sort((a: any, b: any) => {
      if (sortKey === "team") return dir * a.team.localeCompare(b.team);
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [teamRows, sortKey, sortDir]);

  function onSort(k: string) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "team" ? "asc" : "desc");
    }
  }

  // ---- Backtest ----
  const rows = useMemo(() => backtestGames(games, ratingsByWeek, ctx, s, lineMode, totalsByGameId, fbsOnly), [games, ratingsByWeek, ctx, s, lineMode, totalsByGameId, fbsOnly]);
  const results = useMemo(() => VARIANTS.map((v) => ({ v, r: runVariant(v.key, rows, ctx, s) })), [rows, ctx, s]);
  const best = useMemo(() => bestFlatHfa(rows), [rows]);
  const sweep = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => i * 0.5).map((h) => ({ h, r: runVariant("flat", rows, ctx, { ...s, flat: h }) })),
    [rows, ctx, s]
  );
  const elevGames = useMemo(() => rows.filter((r) => r.highElevation), [rows]);
  const bestMae = Math.min(...results.filter((x) => x.v.key !== "live").map((x) => x.r.mae));

  const th = (label: string, k: string, align: "right" | undefined = "right") => <SortHeader label={label} sortKey={k} active={sortKey === k} dir={sortDir} onClick={onSort} align={align} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={{ ...small, margin: 0 }}>
        Home-field advantage by source, and a {SEASON} backtest of each choice. The site itself still runs a flat 2.4 everywhere; nothing here changes
        live projections or locked games. Values are what was known going into each week: week N holds what was pulled before week N kicked off.
      </p>

      <div style={{ ...panel, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div className="section-label">Pull HFA</div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="menu-btn" onClick={pullTr} disabled={busy || games.length === 0}>
            {busy ? "Working…" : "Pull TeamRankings HFA"}
          </button>
          <label style={{ fontSize: "0.82rem" }}>
            Weeks <input type="number" min={1} value={fromWeek} onChange={(e) => setFromWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 52 }} /> to{" "}
            <input type="number" min={1} value={toWeek} onChange={(e) => setToWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 52 }} />
          </label>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.3rem", alignItems: "center" }}>
            <input type="checkbox" checked={repull} onChange={(e) => setRepull(e.target.checked)} /> Re-pull weeks already saved
          </label>
          <span style={small}>Home Advantage (÷10), home rating and away rating per week, 10s apart. Past weeks use the page as of the day before that week's first game.</span>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <label className="menu-btn" style={{ cursor: busy ? "default" : "pointer" }}>
            Upload Massey CSV (HFA only)
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) uploadMassey(file); }} />
          </label>
          <label style={{ fontSize: "0.82rem" }}>
            for week <input type="number" min={0} value={masseyWeek} onChange={(e) => setMasseyWeek(parseInt(e.target.value, 10) || 0)} style={{ width: 52 }} />
          </label>
          <span style={small}>For backfilling old CSVs. The weekly Massey upload in Rating Systems already saves HFA for the admin week.</span>
        </div>
        <div style={small}>
          Saved weeks: Massey {savedWeeks.massey?.join(", ") || "none"} · TR {savedWeeks.tr?.join(", ") || "none"} · TR home {savedWeeks.tr_home?.join(", ") || "none"} · TR away{" "}
          {savedWeeks.tr_away?.join(", ") || "none"} · Blue Chip static ({Object.keys(BLUE_CHIP_HFA).length} teams)
        </div>
        {log && <pre style={{ ...small, whiteSpace: "pre-wrap", margin: 0 }}>{log}</pre>}
      </div>

      <div style={{ ...panel, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div className="section-label">Backtest settings</div>
        <div style={{ display: "flex", gap: "1.1rem", flexWrap: "wrap", alignItems: "center" }}>
          <Slider label="Flat HFA" value={s.flat} min={0} max={5} step={0.1} onChange={(v) => setS({ ...s, flat: v })} />
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.3rem", alignItems: "center" }} title="TR's Home Advantage ÷10 averages about 0.75 points across FBS, far below a typical HFA. Centered = flat value + (team's TR − league average TR).">
            <input type="checkbox" checked={s.centerTr} onChange={(e) => setS({ ...s, centerTr: e.target.checked })} /> Center TR on the flat value
          </label>
          <label style={{ fontSize: "0.82rem" }}>
            Lines{" "}
            <select value={lineMode} onChange={(e) => setLineMode(e.target.value as LineMode)}>
              <option value="close">Closing</option>
              <option value="open">Opening</option>
            </select>
          </label>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.3rem", alignItems: "center" }}>
            <input type="checkbox" checked={fbsOnly} onChange={(e) => setFbsOnly(e.target.checked)} /> FBS vs FBS only
          </label>
        </div>
        <div style={{ display: "flex", gap: "1.1rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Blend weights</span>
          <Slider label="Massey" value={s.weights.massey} min={0} max={3} step={0.25} onChange={(v) => setS({ ...s, weights: { ...s.weights, massey: v } })} fmt={(v) => v.toFixed(2)} />
          <Slider label="TR" value={s.weights.tr} min={0} max={3} step={0.25} onChange={(v) => setS({ ...s, weights: { ...s.weights, tr: v } })} fmt={(v) => v.toFixed(2)} />
          <Slider label="Blue Chip" value={s.weights.bluechip} min={0} max={3} step={0.25} onChange={(v) => setS({ ...s, weights: { ...s.weights, bluechip: v } })} fmt={(v) => v.toFixed(2)} />
        </div>
        <div style={{ display: "flex", gap: "1.1rem", flexWrap: "wrap", alignItems: "center" }}>
          <Slider label="Home/away split shrink" value={s.splitShrink} min={0} max={1} step={0.05} onChange={(v) => setS({ ...s, splitShrink: v })} fmt={(v) => v.toFixed(2)} />
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.3rem", alignItems: "center" }}>
            <input type="checkbox" checked={s.elevation.on} onChange={(e) => setS({ ...s, elevation: { ...s.elevation, on: e.target.checked } })} /> Dampen HFA when both home stadiums are high
          </label>
          <Slider
            label="above"
            value={s.elevation.thresholdM}
            min={600}
            max={2000}
            step={50}
            onChange={(v) => setS({ ...s, elevation: { ...s.elevation, thresholdM: v } })}
            fmt={(v) => `${Math.round(v * M_TO_FT).toLocaleString()} ft`}
          />
          <Slider label="keep" value={s.elevation.factor} min={0} max={1} step={0.05} onChange={(v) => setS({ ...s, elevation: { ...s.elevation, factor: v } })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: "0.4rem" }}>
          {SEASON} backtest · {rows.length} games{ratingsLoading ? " (loading ratings…)" : ""}
        </div>
        <div className="table-wrap" style={{ overflowX: "auto" }}>
          <table className="hfa-table">
            <thead>
              <tr>
                <th>HFA</th>
                <th className="th-right">Avg HFA</th>
                <th className="th-right" title="Mean absolute error of the projected margin vs the final margin">MAE</th>
                <th className="th-right">RMSE</th>
                <th className="th-right" title="Mean of (actual home margin − projected). Positive: home teams beat the projection, so HFA is too low.">Home resid.</th>
                <th className="th-right">Every bet</th>
                <th className="th-right">Filtered</th>
                <th className="th-right">WFB</th>
                <th className="th-right">NWFB</th>
                <th className="th-right" title="Team totals from the Totals model's saved projection, split by this spread">Team total MAE</th>
                <th className="th-right" title="Mean of (home points − projected home team total)">Home TT resid.</th>
                <th className="th-right" title="Mean of (away points − projected away team total). If both are positive, the Totals model is running low overall.">Away TT resid.</th>
                <th className="th-right" title="Games where a source's value came from a later week (not yet backfilled)">Lookahead</th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ v, r }) => (
                <tr key={v.key} style={v.key === "live" ? { color: "var(--chalk-dim)" } : undefined}>
                  <td title={v.note}>
                    <strong>{v.label}</strong>
                    <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>{v.note}</div>
                  </td>
                  <td className="td-right">{f(r.avgHfa)}</td>
                  <td className="td-right" style={r.mae === bestMae ? { color: "var(--c-ok)", fontWeight: 700 } : undefined}>
                    {f(r.mae, 3)}
                  </td>
                  <td className="td-right">{f(r.rmse, 2)}</td>
                  <td className="td-right">{f(r.homeResidual)}</td>
                  <td className="td-right">{rec(r.everyBet)}</td>
                  <td className="td-right">{rec(r.filtered)}</td>
                  <td className="td-right">{rec(r.wfb)}</td>
                  <td className="td-right">{rec(r.nwfb)}</td>
                  <td className="td-right">{r.ttMae == null ? "—" : `${f(r.ttMae)} (${r.ttGames})`}</td>
                  <td className="td-right">{f(r.homeTtResidual)}</td>
                  <td className="td-right">{f(r.awayTtResidual)}</td>
                  <td className="td-right" style={r.lookaheadGames > 0 ? { color: "var(--c-warn)" } : undefined}>
                    {r.lookaheadGames || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ ...small, marginTop: "0.4rem" }}>
          Every row uses each game's own week of saved power ratings and grades at Bet History's default thresholds; locks are ignored so every row is a fresh
          re-projection. Neutral sites get no HFA except in the last row, which is how Matchups and Bet History compute today. Team totals only cover weeks
          with a saved Totals snapshot (week 4 on), and HFA moves them by half its change: the game total doesn't depend on HFA, only the split does.
          {s.elevation.on && ` Elevation dampener applied to ${elevGames.length} games.`}
        </p>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ ...panel, flex: "1 1 340px" }}>
          <div className="section-label" style={{ marginBottom: "0.4rem" }}>Flat HFA sweep</div>
          {best && (
            <p style={{ ...small, marginTop: 0 }}>
              Best single flat HFA on {best.n} true home games: <strong style={{ color: "var(--chalk)" }}>{best.value.toFixed(2)}</strong> ± {best.se.toFixed(2)} (one standard
              error). Least squares, so this is the HFA that minimizes squared error, not ATS losses.
            </p>
          )}
          <table className="hfa-table">
            <thead>
              <tr>
                <th className="th-right">Flat</th>
                <th className="th-right">MAE</th>
                <th className="th-right">Home resid.</th>
                <th className="th-right">Every bet</th>
                <th className="th-right">Filtered</th>
              </tr>
            </thead>
            <tbody>
              {sweep.map(({ h, r }) => (
                <tr key={h} style={Math.abs(h - s.flat) < 0.05 ? { fontWeight: 700 } : undefined}>
                  <td className="td-right">{h.toFixed(1)}</td>
                  <td className="td-right">{f(r.mae, 3)}</td>
                  <td className="td-right">{f(r.homeResidual)}</td>
                  <td className="td-right">{rec(r.everyBet)}</td>
                  <td className="td-right">{rec(r.filtered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...panel, flex: "1 1 340px" }}>
          <div className="section-label" style={{ marginBottom: "0.4rem" }}>High-elevation matchups</div>
          <p style={{ ...small, marginTop: 0 }}>
            Games where both teams' home stadiums are above {Math.round(s.elevation.thresholdM * M_TO_FT).toLocaleString()} ft (true home games only). The idea: a mountain
            team's edge partly comes from visitors not being used to the altitude, which a visitor from altitude already is. {elevGames.length} such games
            so far, so treat any result as a hint, not proof.
          </p>
          <button className="menu-btn" onClick={() => setShowElevGames((x) => !x)} style={{ fontSize: "0.8rem" }}>
            {showElevGames ? "Hide games" : "Show games"}
          </button>
          {showElevGames && (
            <table className="hfa-table" style={{ marginTop: "0.5rem" }}>
              <thead>
                <tr>
                  <th>Wk</th>
                  <th>Game</th>
                  <th className="th-right">Proj (flat)</th>
                  <th className="th-right">Actual</th>
                </tr>
              </thead>
              <tbody>
                {elevGames.map((r) => (
                  <tr key={r.game.id}>
                    <td>{r.game.week}</td>
                    <td>
                      {r.game.away_team} @ {r.game.home_team}
                    </td>
                    <td className="td-right">{f(r.awayRating - r.homeRating + s.flat, 1)}</td>
                    <td className="td-right">{r.game.home_points! - r.game.away_points!}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ ...small, marginBottom: 0 }}>Both columns are home margins. Home stadium elevations come from the CFBD stadium pull (Data pulls tab).</p>
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: "0.4rem" }}>Team HFA going into week {adminWeek}</div>
        <div className="table-wrap" style={{ overflowX: "auto", maxHeight: 560 }}>
          <table className="hfa-table">
            <thead>
              <tr>
                {th("Team", "team", undefined)}
                {th("Massey", "massey")}
                {th("TR ÷10", "trRaw")}
                {th(s.centerTr ? "TR centered" : "TR used", "tr")}
                {th("Blue Chip", "bluechip")}
                {th("Average", "average")}
                {th("Blend", "blend")}
                {th("TR home − away", "split")}
                {th("Split HFA", "splitHfa")}
                {th("Elevation", "elevFt")}
              </tr>
            </thead>
            <tbody>
              {sortedTeams.map((t) => (
                <tr key={t.team}>
                  <td>{t.team}</td>
                  <td className="td-right">{f(t.massey)}</td>
                  <td className="td-right">{f(t.trRaw)}</td>
                  <td className="td-right">{f(t.tr)}</td>
                  <td className="td-right">{f(t.bluechip, 1)}</td>
                  <td className="td-right">{f(t.average)}</td>
                  <td className="td-right">{f(t.blend)}</td>
                  <td className="td-right">{f(t.split, 1)}</td>
                  <td className="td-right">{f(t.splitHfa)}</td>
                  <td className="td-right" style={t.high ? { color: "var(--c-warn)", fontWeight: 600 } : undefined}>
                    {t.elevFt != null ? `${t.elevFt.toLocaleString()} ft` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={small}>Missing values fall back to the flat slider in Average, Blend and Split. Elevation in amber is above the dampener threshold.</p>
      </div>
    </div>
  );
}
