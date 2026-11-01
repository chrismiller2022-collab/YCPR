import { useEffect, useMemo, useRef, useState } from "react";
import { useDefaultToAdminWeek } from "../../lib/adminWeek";
import { fetchDrogbaPicks, fetchMarketLines, MARKET_VENUES, type DrogbaPickRow, type MarketLines } from "../../lib/api/drogbaData";
import { EDGE_CAP } from "../../lib/drogba/model";
import { buildPickRows, currentWeekSplit, DEFAULT_MIN_EDGE, fitForWeek, projectWeek } from "../../lib/drogba/weekPlan";
import { gradePicks, summarizePicks, type GradedPick } from "../../lib/drogba/picksGrading";
import { pullWeekOpeners } from "../../lib/drogba/fanduelPull";
import { saveWeekPicks } from "../../lib/drogba/saveWeek";
import { atsColor, clvColor } from "../../lib/drogba/colors";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import { CELL, DIM, NUM, P, away, f1, pct, sgn, spreadLabel } from "./shared";

const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const resultColor = (r: string | null) => (r === "W" ? "#8fd39a" : r === "L" ? "#e07a7a" : undefined);

// One week of DROGBA, before or after the games: the numbers saved to the picks log when the Sunday run went (games
// never saved fall back to what the model says now, marked "live"), every line on file for each game, and how each
// pick did against the open and the close.
export default function DrogbaThisWeekTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const stateRef = useRef(state);
  stateRef.current = state;
  const seasons = useMemo(() => Array.from(new Set(state.games.map((g) => g.season))).sort((a, b) => b - a), [state.games]);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [minEdge, setMinEdge] = useState(DEFAULT_MIN_EDGE);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<DrogbaPickRow[] | null>(null);
  const [markets, setMarkets] = useState<Map<string, MarketLines>>(new Map());
  const [nonce, setNonce] = useState(0);
  const S = season ?? seasons[0] ?? new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDrogbaPicks(), fetchMarketLines(S, week).catch(() => new Map<string, MarketLines>())])
      .then(([p, m]) => {
        if (cancelled) return;
        setPicks(p);
        setMarkets(m);
      })
      .catch((e) => !cancelled && setMsg(e?.message ?? "Loading the picks log failed"));
    return () => {
      cancelled = true;
    };
  }, [S, week, nonce]);

  const gameById = useMemo(() => new Map(state.games.map((g) => [g.id, g])), [state.games]);
  const saved = useMemo(() => (picks ?? []).filter((p) => p.season === S && p.week === week), [picks, S, week]);

  // Saved rows first; any game with an opening line that was never saved gets the model's number now.
  const rows = useMemo(() => {
    if (!engine) return [];
    const savedIds = new Set(saved.map((p) => p.game_id));
    const live = projectWeek(engine, fitForWeek(engine, S, week), S, week, true).filter((r) => !savedIds.has(r.g.id));
    const liveRows: DrogbaPickRow[] = buildPickRows(live, minEdge).map((p) => ({ ...p, created_at: "" }));
    const graded = gradePicks([...saved, ...liveRows], gameById, false);
    // Games with no opening line or no model number yet (last week's stats not pulled) still show what's on file and
    // the markets, with no pick.
    const pickable = new Set(liveRows.map((p) => p.game_id));
    const noOpen: GradedPick[] = live
      .filter((r) => !pickable.has(r.g.id))
      .map((r) => ({
        p: { game_id: r.g.id, season: S, week, home_team: r.g.home, away_team: r.g.away, model_home_spread: r.modelSpread as number, open_spread: r.open, open_provider: r.open == null ? null : r.g.openProvider, edge: null, tier: r.tier, side: null, filtered: false, model_version: null, created_at: "" },
        g: r.g,
        result: null,
        vsClose: null,
        clv: null,
      }));
    return [...graded.sort((a, b) => Math.abs(b.p.edge ?? 0) - Math.abs(a.p.edge ?? 0)), ...noOpen];
  }, [engine, saved, S, week, minEdge, gameById]);

  const isPick = (r: GradedPick) => Math.abs(r.p.edge ?? 0) >= minEdge;
  const split = useMemo(() => currentWeekSplit(state.games), [state.games]);
  const weekGames = state.games.filter((g) => g.season === S && g.week === week && g.homeFbs && g.awayFbs);
  const weekOver = weekGames.length > 0 && weekGames.every((g) => g.completed || (g.startMs != null && g.startMs < Date.now()));
  const liveCount = rows.filter((r) => !r.p.created_at && r.p.open_spread != null && r.p.model_home_spread != null).length;
  const noOpenCount = rows.filter((r) => r.p.open_spread == null && r.p.model_home_spread != null).length;
  const noModelCount = rows.filter((r) => r.p.model_home_spread == null).length;

  async function rebuilt() {
    const v = stateRef.current.version;
    stateRef.current.reload();
    for (let i = 0; i < 400; i++) {
      await wait(300);
      const s = stateRef.current;
      if (s.version > v && !s.loading && !s.building) {
        if (s.error) throw new Error(s.error);
        return s;
      }
    }
    throw new Error("Timed out waiting for the ratings to rebuild");
  }

  // Before kickoff: the same save the Sunday run makes. A played week: pull FanDuel's Sunday-morning openers for it
  // from history, rebuild, and save the week as the model would have had it (only games before that week feed it).
  async function save() {
    if (!engine) return;
    if (weekOver && !window.confirm(`Backfill week ${week}: pull FanDuel's Sunday 6–11am ET lines for week ${week} that aren't on file yet (up to ~40 Odds API credits), rebuild, then save every game's number as the model would have had it before the week. Replaces anything already logged for week ${week}. Continue?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      let note = "";
      let eng = engine;
      if (weekOver) {
        const s = stateRef.current;
        const r = await pullWeekOpeners(s.games, s.bovadaOpen, s.fanduelLines, S, week);
        note = r.pulls ? `Pulled ${r.pulls} FanDuel snapshot${r.pulls > 1 ? "s" : ""} (~${r.credits} credits); ${r.covered} of ${r.games} games have a FanDuel open. ` : `FanDuel openers already on file for ${r.covered} of ${r.games} games. `;
        if (r.pulls) {
          setMsg(`${note}Rebuilding ratings…`);
          const fresh = await rebuilt();
          if (!fresh.engine) throw new Error("Ratings didn't rebuild");
          eng = fresh.engine;
        }
      }
      const res = await saveWeekPicks(eng, S, week, { backfill: weekOver, minEdge });
      setMsg(`${note}Saved ${res.saved} new, ${weekOver ? "replaced" : "refreshed"} ${res.overwritten}${res.skippedStarted ? `, ${res.skippedStarted} already kicked off (kept as logged)` : ""}.`);
      setNonce((n) => n + 1);
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!engine) return null;

  const summaryRows = [
    { label: TIER_LABELS.power + " (primary)", g: rows.filter((r) => isPick(r) && r.p.tier === "power") },
    { label: TIER_LABELS.other + " (tracked)", g: rows.filter((r) => isPick(r) && r.p.tier !== "power") },
    { label: "All picks", g: rows.filter(isPick) },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Week view</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
        <select className="filter" value={S} onChange={(e) => setSeason(Number(e.target.value))}>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="filter" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}{split && S === split.season && w === split.upcoming ? " (betting week)" : ""}</option>
          ))}
        </select>
        <label style={{ fontSize: "0.85rem" }}>
          Pick when the model disagrees with the open by ≥{" "}
          <input className="filter" type="number" step={0.5} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} style={{ width: "5rem" }} /> pts
        </label>
      </div>
      <p style={DIM}>
        The numbers saved when DROGBA was run (every Sunday run saves them; reruns refresh games that haven't kicked off, and a started game's number is final). Spreads are from the away team's side (negative = away favored). <strong>Open</strong> is the line the pick is graded against (FanDuel's open where on file, Bovada's otherwise);
        FanDuel, Bovada and the prediction markets are shown for comparison, with the markets as they stood when DROGBA was last run before kickoff. Edges are capped at {EDGE_CAP}.
        {liveCount > 0 ? ` ${liveCount} game${liveCount > 1 ? "s were" : " was"} never saved, so ${liveCount > 1 ? "they show" : "it shows"} what the model says now (marked "live").` : ""}
        {noOpenCount > 0 ? ` ${noOpenCount} game${noOpenCount > 1 ? "s have" : " has"} no opening line on file yet (run the Sunday routine), so there's no pick or edge.` : ""}
        {noModelCount > 0 ? ` ${noModelCount} game${noModelCount > 1 ? "s have" : " has"} no DROGBA number yet: last week's advanced stats aren't pulled (run the Sunday routine).` : ""}
      </p>

      <div className="table-scroll" style={{ marginBottom: "0.6rem" }}>
        <table>
          <thead>
            <tr>
              <th style={CELL}>Week {week} record</th>
              <th style={HEAD}>Picks</th>
              <th style={HEAD}>vs open</th>
              <th style={HEAD}>ATS</th>
              <th style={HEAD}>vs close</th>
              <th style={HEAD}>Closing-line value</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map(({ label, g }) => {
              const t = summarizePicks(g);
              return (
                <tr key={label}>
                  <td style={{ ...CELL, fontWeight: label === "All picks" ? 700 : 400 }}>{label}</td>
                  <td style={NUM}>{t.n}</td>
                  <td style={NUM}>{t.open.n ? `${t.open.w}–${t.open.l}` : "–"}</td>
                  <td style={{ ...NUM, color: atsColor(t.open.n ? t.open.pct : null), fontWeight: 700 }}>{t.open.n ? pct(t.open.pct) : "–"}</td>
                  <td style={NUM}>{t.close.n ? `${t.close.w}–${t.close.l}` : "–"}</td>
                  <td style={{ ...NUM, color: clvColor(t.clv), fontWeight: 700 }}>{t.clv == null ? "–" : sgn(t.clv, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(["power", "other"] as Tier[]).map((tier) => {
        const tierRows = rows.filter((r) => (r.p.tier ?? "other") === tier);
        const hits = tierRows.filter(isPick).length;
        return (
          <div key={tier} style={{ marginTop: tier === "power" ? "0.5rem" : "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.3rem", fontSize: tier === "power" ? "1.05rem" : "0.95rem", color: tier === "power" ? undefined : "var(--chalk-dim)" }}>
              {TIER_LABELS[tier]}
              {tier === "power" ? " — primary" : " — also tracked"}
              <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--chalk-dim)" }}> · {tierRows.length} games, {hits} at or above {minEdge} pts</span>
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={CELL}>Matchup</th>
                    <th style={CELL}>Pick (at the open)</th>
                    <th style={HEAD}>DROGBA</th>
                    <th style={HEAD}>Open</th>
                    <th style={HEAD}>Edge</th>
                    <th style={HEAD}>FanDuel</th>
                    <th style={HEAD}>Bovada</th>
                    {MARKET_VENUES.map((v) => (
                      <th key={v.key} style={HEAD}>{v.label}</th>
                    ))}
                    <th style={HEAD}>Close</th>
                    <th style={HEAD}>Final</th>
                    <th style={CELL}>vs open</th>
                    <th style={CELL}>vs close</th>
                    <th style={CELL}>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map(({ p, g, result, vsClose }) => {
                    const hit = Math.abs(p.edge ?? 0) >= minEdge;
                    const started = g?.completed || (g?.startMs != null && g.startMs < Date.now());
                    const mk = p.market_lines ?? (p.created_at || started ? null : markets.get(p.game_id)) ?? null;
                    const pickText = p.side == null || p.open_spread == null ? (p.model_home_spread == null ? "– (no DROGBA number)" : "– (no open yet)") : p.side === "home" ? spreadLabel(p.home_team, p.open_spread) : spreadLabel(p.away_team, -p.open_spread);
                    return (
                      <tr key={p.game_id} style={hit ? { background: tier === "power" ? "rgba(120,200,120,0.14)" : "rgba(120,200,120,0.06)" } : undefined}>
                        <td style={CELL}>{p.away_team} @ {p.home_team}{g?.neutral ? " (N)" : ""}</td>
                        <td style={{ ...CELL, fontWeight: hit ? 700 : 400, color: hit ? undefined : "var(--chalk-dim)" }}>{pickText}</td>
                        <td style={NUM}>{f1(away(p.model_home_spread))}</td>
                        <td style={NUM} title={p.open_provider ?? undefined}>{f1(away(p.open_spread))}{p.open_provider && p.open_provider !== "FanDuel" ? <span style={{ color: "#e8c84a" }}> B</span> : null}</td>
                        <td style={NUM}>{sgn(away(p.edge))}</td>
                        <td style={NUM}>{f1(away(state.fanduelLines.get(p.game_id)?.open))}</td>
                        <td style={NUM}>{f1(away(state.bovadaOpen.get(p.game_id)))}</td>
                        {MARKET_VENUES.map((v) => (
                          <td key={v.key} style={NUM}>{f1(away(mk?.[v.key]))}</td>
                        ))}
                        <td style={NUM}>{f1(away(g?.close))}</td>
                        <td style={NUM}>{g?.completed ? `${g.awayPts}–${g.homePts}` : "–"}</td>
                        <td style={{ ...CELL, color: resultColor(result), fontWeight: 700 }}>{result ?? "–"}</td>
                        <td style={{ ...CELL, color: resultColor(vsClose), fontWeight: 700 }}>{vsClose ?? "–"}</td>
                        <td style={{ ...CELL, color: "var(--chalk-dim)" }}>
                          {p.created_at
                            ? new Date(p.created_at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + (p.model_version?.endsWith("-backfill") ? " (backfill)" : "")
                            : <span style={{ color: "#e8c84a" }}>live</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {tierRows.length === 0 && (
                    <tr>
                      <td style={CELL} colSpan={15}>No games in this group with an opening line for this week.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p style={DIM}>A yellow "B" after an Open means it's Bovada's open (FanDuel had no line on file for that game).</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem", alignItems: "center" }}>
        <button className="menu-btn" disabled={busy || rows.length === 0} onClick={save}>
          {weekOver ? `Backfill week ${week} (FanDuel openers + save)` : `Save week ${week} now`}
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          {weekOver
            ? "For a week that was never logged, or logged against the wrong openers: rebuilds the week's numbers from games before it."
            : "The Sunday run already does this; saving again refreshes games that haven't kicked off."}
        </span>
      </div>
      {msg && <p style={P}>{msg}</p>}
    </div>
  );
}
