import { useMemo, useState } from "react";
import { useDefaultToAdminWeek } from "../../lib/adminWeek";
import { saveDrogbaPicks, invalidateDrogbaCache } from "../../lib/api/drogbaData";
import { fitEdgeResponse, fitLayer1, predictEdge, predictLayer1, EDGE_CAP } from "../../lib/drogba/model";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { gameTier, TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import { CELL, DIM, NUM, P, f1, sgn, spreadLabel } from "./shared";

export const MODEL_VERSION = "drogba-v2-independent";
const DEFAULT_MIN_EDGE = 5; // JP+'s published threshold; the backtest shows what each level has actually done

export default function DrogbaThisWeekTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const seasons = useMemo(() => Array.from(new Set(state.games.map((g) => g.season))).sort((a, b) => b - a), [state.games]);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [minEdge, setMinEdge] = useState(DEFAULT_MIN_EDGE);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const S = season ?? seasons[0] ?? new Date().getFullYear();

  // Fit only on games finished before the week being looked at.
  const fit = useMemo(() => {
    if (!engine || !engine.hasEff) return null;
    const train = engine.signals.filter((s) => s.g.completed && (s.g.season < S || (s.g.season === S && s.g.week < week)));
    const l1 = fitLayer1(train);
    // The response (how much a disagreement is worth) is measured on the most recent three seasons: the
    // edge was much stronger in 2023 than since, and an all-seasons average overstates today's.
    const resp = l1 ? fitEdgeResponse(train.filter((s) => s.g.season >= S - 2), l1) : null;
    return l1 && resp ? { l1, resp, trainN: train.length } : null;
  }, [engine, S, week]);

  const rows = useMemo(() => {
    if (!engine || !fit) return [];
    return engine.signals
      .filter((s) => s.g.season === S && s.g.week === week && !s.g.completed && s.g.open != null)
      .map((s) => {
        const m = predictLayer1(fit.l1, s);
        const tier = gameTier(s.g);
        if (m == null) return { s, g: s.g, tier, open: s.g.open!, modelSpread: null as number | null, pred: null };
        return { s, g: s.g, tier, open: s.g.open!, modelSpread: -m, pred: predictEdge(fit.resp, s, m) };
      })
      .sort((a, b) => Math.abs(b.pred?.edge ?? 0) - Math.abs(a.pred?.edge ?? 0));
  }, [engine, fit, S, week]);

  async function save(overwrite: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const picks = rows
        .filter((r) => r.pred && r.modelSpread != null)
        .map((r) => ({
          game_id: r.g.id,
          season: r.g.season,
          week: r.g.week,
          home_team: r.g.home,
          away_team: r.g.away,
          model_home_spread: r.modelSpread!,
          open_spread: r.open,
          open_provider: r.g.openProvider,
          edge: r.pred!.edge,
          tier: r.tier,
          side: r.pred!.edge > 0 ? ("home" as const) : ("away" as const),
          filtered: Math.abs(r.pred!.edge) >= minEdge,
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
  if (!engine) return null;

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
          Pick when the model disagrees with the open by ≥{" "}
          <input className="filter" type="number" step={0.5} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} style={{ width: "5rem" }} /> pts
        </label>
      </div>
      <p style={DIM}>
        DROGBA runs on CFBD data alone (no lines, no one else's ratings), so it can be run Sunday morning as soon as Saturday's stats are in. Spreads are home-relation (negative = home favored). <strong>Edge</strong> is how many points the model says the home side beats the open by
        (negative = the away side); edges are capped at {EDGE_CAP}. "Exp. line move" is the move toward the pick the model has earned per point of edge over the last three seasons, and "Exp. cover" is the points the pick has covered by; both are modest estimates that move with the opening line used — see the Backtest and Buckets tabs for what each edge level has actually done.
        {fit ? ` Fit on ${fit.trainN} finished games before this week.` : ""}
      </p>
      {!fit && <p style={{ color: "crimson", fontSize: "0.85rem" }}>Not enough history to fit the model yet — run the backfill on the Data & sync tab.</p>}
      {(["power", "other"] as Tier[]).map((tier) => {
        const tierRows = rows.filter((r) => r.tier === tier);
        const picks = tierRows.filter((r) => r.pred && Math.abs(r.pred.edge) >= minEdge).length;
        return (
          <div key={tier} style={{ marginTop: tier === "power" ? "0.5rem" : "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.3rem", fontSize: tier === "power" ? "1.05rem" : "0.95rem", color: tier === "power" ? undefined : "var(--chalk-dim)" }}>
              {TIER_LABELS[tier]}
              {tier === "power" ? " — primary" : " — also tracked"}
              <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--chalk-dim)" }}> · {tierRows.length} games, {picks} at or above {minEdge} pts</span>
            </h3>
            <p style={{ ...DIM, margin: "0 0 0.4rem" }}>
              {tier === "power"
                ? "Both teams in the SEC, Big Ten, Big 12, ACC or Notre Dame. Over 2023–26 this is where the model's disagreements paid off (63.6% ATS and +1.4 points of closing-line value at 6+ point edges vs FanDuel's open)."
                : "Everything else. Over 2023–26 the model's disagreements here were at or below break-even (47.8% at 6+ points), so these are shown and logged but not the main list."}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={CELL}>Matchup</th>
                    <th style={NUM}>Open (home)</th>
                    <th style={CELL}>Open book</th>
                    <th style={NUM}>DROGBA spread</th>
                    <th style={NUM}>Edge</th>
                    <th style={CELL}>Pick (at the open)</th>
                    <th style={NUM}>Exp. line move</th>
                    <th style={NUM}>Exp. cover</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((r) => {
                    const edge = r.pred?.edge ?? null;
                    const hit = edge != null && Math.abs(edge) >= minEdge;
                    const side = edge == null ? null : edge > 0 ? "home" : "away";
                    return (
                      <tr key={r.g.id} style={hit ? { background: tier === "power" ? "rgba(120,200,120,0.14)" : "rgba(120,200,120,0.06)" } : undefined}>
                        <td style={CELL}>{r.g.away} @ {r.g.home}{r.g.neutral ? " (N)" : ""}</td>
                        <td style={NUM}>{f1(r.open)}</td>
                        <td style={CELL}>{r.g.openProvider ?? "–"}</td>
                        <td style={NUM}>{f1(r.modelSpread)}</td>
                        <td style={NUM}>{sgn(edge)}</td>
                        <td style={CELL}>{side == null ? "–" : side === "home" ? spreadLabel(r.g.home, r.open) : spreadLabel(r.g.away, -r.open)}</td>
                        <td style={NUM}>{r.pred == null ? "–" : sgn(Math.abs(r.pred.move), 2)}</td>
                        <td style={NUM}>{r.pred == null ? "–" : sgn(Math.abs(r.pred.cover), 2)}</td>
                      </tr>
                    );
                  })}
                  {tierRows.length === 0 && (
                    <tr>
                      <td style={CELL} colSpan={8}>No unplayed games in this group with an opening line for this week.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <button className="menu-btn" disabled={saving || rows.every((r) => !r.pred)} onClick={() => save(false)}>
          Save this week's numbers to the Picks Log
        </button>
        <button
          className="menu-btn"
          disabled={saving || rows.every((r) => !r.pred)}
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
