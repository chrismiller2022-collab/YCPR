import { useMemo, useState } from "react";
import { useDefaultToAdminWeek } from "../../lib/adminWeek";
import { useWeeklyStats } from "../../lib/api/weeklyStats";
import { saveDrogbaPicks, invalidateDrogbaCache } from "../../lib/api/drogbaData";
import { hfaFor } from "../../lib/odds";
import { EDGE_CAP, fitLayer1, fitLayer2, predictCover, predictLayer1, type GameSignals } from "../../lib/drogba/model";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, NUM, P, evAtMinus110, f1, pct, sgn, spreadLabel, winProb } from "./shared";

export const MODEL_VERSION = "drogba-v1";

export default function DrogbaThisWeekTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const seasons = useMemo(() => Array.from(new Set(state.games.map((g) => g.season))).sort((a, b) => b - a), [state.games]);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [minCover, setMinCover] = useState(1.0);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const S = season ?? seasons[0] ?? new Date().getFullYear();

  const fit = useMemo(() => {
    if (!engine) return null;
    const train = engine.signals.filter((s) => s.g.completed && (s.g.season < S || (s.g.season === S && s.g.week < week)));
    const l1 = engine.hasEff ? fitLayer1(train) : null;
    const l2c = fitLayer2(train.filter((s) => s.consensusMargin != null), l1, true);
    const l2e = l1 ? fitLayer2(train, l1, false) : null;
    return { l1, l2c, l2e, trainN: train.length };
  }, [engine, S, week]);

  const rows = useMemo(() => {
    if (!engine || !fit) return [];
    return engine.signals
      .filter((s) => s.g.season === S && s.g.week === week && !s.g.completed)
      .map((s0) => {
        const g = s0.g;
        // Consensus: frozen lock / saved projection if there is one, otherwise today's live ratings.
        let consSpread = engine.consensus.get(g.id) ?? null;
        let consSource = consSpread != null ? "locked" : "";
        if (consSpread == null) {
          const h = liveByTeam[g.home]?.rating;
          const a = liveByTeam[g.away]?.rating;
          if (h != null && a != null) {
            consSpread = h - a - (g.neutral ? 0 : hfaFor(g.home, liveByTeam));
            consSource = "live";
          }
        }
        const s: GameSignals = { ...s0, consensusMargin: consSpread == null ? null : -consSpread };
        const l2 = s.consensusMargin != null && fit.l2c ? fit.l2c : fit.l2e;
        const cover = l2 ? predictCover(l2, fit.l1, s) : null;
        const effMargin = fit.l1 ? predictLayer1(fit.l1, s) : null;
        const open = g.open!;
        const p = cover == null ? null : winProb(cover);
        return {
          g,
          open,
          close: g.close,
          consSpread,
          consSource,
          consEdge: consSpread == null ? null : -consSpread + open,
          effSpread: effMargin == null ? null : -effMargin,
          cover,
          modelSpread: cover == null ? null : open - cover,
          side: cover == null ? null : cover > 0 ? ("home" as const) : ("away" as const),
          p,
          ev: p == null ? null : evAtMinus110(p),
        };
      })
      .sort((a, b) => Math.abs(b.cover ?? 0) - Math.abs(a.cover ?? 0));
  }, [engine, fit, S, week, liveByTeam]);

  async function save(overwrite: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const picks = rows
        .filter((r) => r.cover != null)
        .map((r) => ({
          game_id: r.g.id,
          season: r.g.season,
          week: r.g.week,
          home_team: r.g.home,
          away_team: r.g.away,
          model_home_spread: r.modelSpread!,
          open_spread: r.open,
          open_provider: r.g.openProvider,
          edge: r.cover,
          side: r.side,
          filtered: Math.abs(r.cover!) >= minCover,
          model_version: MODEL_VERSION,
        }));
      const res = await saveDrogbaPicks(picks, overwrite);
      invalidateDrogbaCache();
      setMsg(`Saved ${res.saved} new${res.skippedExisting ? `, left ${res.skippedExisting} already-logged games untouched` : ""}${res.overwritten ? `, overwrote ${res.overwritten}` : ""}.`);
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!engine || !fit) return null;

  const variant = fit.l2c ? (fit.l1 ? "efficiency + consensus" : "consensus only") : fit.l2e ? "efficiency only" : "none";
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>This week</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
        <select className="filter" value={S} onChange={(e) => setSeason(Number(e.target.value))}>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="filter" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        <label style={{ fontSize: "0.85rem" }}>
          Pick when model expects to cover by ≥{" "}
          <input className="filter" type="number" step={0.25} value={minCover} onChange={(e) => setMinCover(Number(e.target.value))} style={{ width: "5rem" }} />
        </label>
      </div>
      <p style={DIM}>
        Model in use: <strong>{variant}</strong> (fit on {fit.trainN} finished games before this week). Spreads are home-relation: negative = home favored. "Expected cover" is the model's estimate of the points the home side beats the
        open by (negative = away side). Win % assumes a 13-point standard deviation on spread results. This is the model's output, not a recommendation to bet — see the Backtest tab for how reliable each level has been.
      </p>
      {variant === "none" && <p style={{ color: "crimson", fontSize: "0.85rem" }}>Not enough history to fit the model yet — run the backfill on the Data & sync tab.</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Matchup</th>
              <th style={NUM}>Open (home)</th>
              <th style={NUM}>Now (home)</th>
              <th style={NUM}>My consensus</th>
              <th style={NUM}>Consensus edge</th>
              <th style={NUM}>Efficiency model</th>
              <th style={NUM}>Expected cover</th>
              <th style={NUM}>DROGBA spread</th>
              <th style={CELL}>Pick (at the open)</th>
              <th style={NUM}>Win %</th>
              <th style={NUM}>EV @ −110</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hit = r.cover != null && Math.abs(r.cover) >= minCover;
              return (
                <tr key={r.g.id} style={hit ? { background: "rgba(120,200,120,0.10)" } : undefined}>
                  <td style={CELL}>{r.g.away} @ {r.g.home}{r.g.neutral ? " (N)" : ""}</td>
                  <td style={NUM}>{f1(r.open)}</td>
                  <td style={NUM}>{f1(r.close)}</td>
                  <td style={NUM}>{f1(r.consSpread)}{r.consSource === "live" ? "*" : ""}</td>
                  <td style={NUM}>{sgn(r.consEdge)}{r.consEdge != null && Math.abs(r.consEdge) > EDGE_CAP ? " (capped)" : ""}</td>
                  <td style={NUM}>{f1(r.effSpread)}</td>
                  <td style={NUM}>{sgn(r.cover, 2)}</td>
                  <td style={NUM}>{f1(r.modelSpread)}</td>
                  <td style={CELL}>
                    {r.side == null ? "–" : r.side === "home" ? spreadLabel(r.g.home, r.open) : spreadLabel(r.g.away, -r.open)}
                  </td>
                  <td style={NUM}>{r.p == null ? "–" : pct(r.p * 100)}</td>
                  <td style={NUM}>{r.ev == null ? "–" : sgn(r.ev * 100, 1) + "%"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td style={CELL} colSpan={11}>No unplayed FBS-vs-FBS games with an opening line for this week.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={DIM}>* consensus taken from today's live ratings (not frozen yet). Games already in a Freeze Week lock use the locked number.</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <button className="menu-btn" disabled={saving || rows.every((r) => r.cover == null)} onClick={() => save(false)}>
          Save this week's numbers to the Picks Log
        </button>
        <button
          className="menu-btn"
          disabled={saving || rows.every((r) => r.cover == null)}
          onClick={() => {
            if (window.confirm("Overwrite the already-logged numbers for these games? The log is meant to be a record of what the model said while the line was open.")) save(true);
          }}
        >
          Overwrite existing
        </button>
      </div>
      {msg && <p style={P}>{msg}</p>}
    </div>
  );
}
