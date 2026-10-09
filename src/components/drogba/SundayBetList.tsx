import { useMemo, useState } from "react";
import { invalidateDrogbaCache, saveDrogbaPicks, type DrogbaPickRow } from "../../lib/api/drogbaData";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import { buildPickRows, DEFAULT_MIN_EDGE, fitForWeek, projectWeek, type WeekSplit } from "../../lib/drogba/weekPlan";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import type { RunDiff } from "./SundayRunner";
import { CELL, DIM, H3, NUM, f1, sgn, spreadLabel } from "./shared";

const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };

// The week's games in the order to bet them: power-vs-power first, then everything else, each by size of the disagreement
// with the open. Rows below the filter are hidden unless asked for.
export default function SundayBetList({ state, split, picks, minEdge, setMinEdge, diff, onSaved }: {
  state: DrogbaState;
  split: WeekSplit;
  picks: DrogbaPickRow[];
  minEdge: number;
  setMinEdge: (v: number) => void;
  diff: RunDiff | null;
  onSaved: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const engine = state.engine;
  const rows = useMemo(
    () => (engine ? projectWeek(engine, fitForWeek(engine, split.season, split.upcoming), split.season, split.upcoming).flatMap((r) => (r.open == null ? [] : [{ ...r, open: r.open }])) : []),
    [engine, split.season, split.upcoming]
  );
  const logged = useMemo(() => new Map(picks.filter((p) => p.season === split.season && p.week === split.upcoming).map((p) => [p.game_id, p])), [picks, split]);
  if (!engine) return null;

  const moved = (id: string, now: number | null) => {
    if (!diff || now == null) return null;
    const before = diff.before.get(id);
    return before == null ? null : now - before;
  };
  const provisional = rows.filter((r) => r.pred && !state.fanduelLines.has(r.g.id)).length;

  async function save() {
    const flagged = buildPickRows(rows, minEdge);
    const ok = provisional === 0 || window.confirm(`${provisional} game(s) are still on Bovada's open (FanDuel hasn't posted them). The log keeps the first save for each game, so those would be recorded against Bovada's number. Save anyway?`);
    if (!ok) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveDrogbaPicks(flagged, false);
      invalidateDrogbaCache();
      setMsg(`Saved ${res.saved} new${res.skippedExisting ? `, left ${res.skippedExisting} already-logged games untouched` : ""}.`);
      onSaved();
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 style={H3}>Week {split.upcoming} bet list</h3>
      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.85rem" }}>
        <label>
          Bet when the model disagrees with the open by ≥{" "}
          <input className="filter" type="number" step={0.5} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} style={{ width: "5rem" }} /> pts
        </label>
        <label>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show games below the filter
        </label>
      </div>
      {(["power", "other"] as Tier[]).map((tier) => {
        const all = rows.filter((r) => r.tier === tier && r.pred);
        const shown = all.filter((r) => showAll || Math.abs(r.pred!.edge) >= minEdge);
        const hit = all.filter((r) => Math.abs(r.pred!.edge) >= minEdge).length;
        return (
          <div key={tier} style={{ marginTop: "0.8rem" }}>
            <div style={{ fontSize: tier === "power" ? "0.95rem" : "0.88rem", fontWeight: 700, color: tier === "power" ? undefined : "var(--chalk-dim)" }}>
              {TIER_LABELS[tier]}
              {tier === "power" ? " — primary" : " — also tracked"}
              <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--chalk-dim)" }}> · {hit} of {all.length} games at or above {minEdge} pts</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={HEAD}>#</th>
                    <th style={CELL}>Pick (at the open)</th>
                    <th style={CELL}>Matchup</th>
                    <th style={HEAD}>Open</th>
                    <th style={CELL}>Open book</th>
                    <th style={HEAD}>DROGBA</th>
                    <th style={HEAD}>Edge</th>
                    <th style={HEAD}>Exp. line move</th>
                    <th style={HEAD} title="How much the model number moved during the last run (new stats, openers)">Moved in run</th>
                    <th style={CELL}>Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const edge = r.pred!.edge;
                    const side = edge > 0 ? "home" : "away";
                    const hitRow = Math.abs(edge) >= minEdge;
                    const mv = moved(r.g.id, r.modelSpread);
                    const lg = logged.get(r.g.id);
                    return (
                      <tr key={r.g.id} style={hitRow ? { background: tier === "power" ? "rgba(120,200,120,0.14)" : "rgba(120,200,120,0.06)" } : undefined}>
                        <td style={NUM}>{i + 1}</td>
                        <td style={{ ...CELL, fontWeight: 700 }}>{side === "home" ? spreadLabel(r.g.home, r.open) : spreadLabel(r.g.away, -r.open)}</td>
                        <td style={CELL}>{r.g.away} @ {r.g.home}{r.g.neutral ? " (N)" : ""}</td>
                        <td style={NUM}>{f1(r.open)}</td>
                        <td style={{ ...CELL, color: r.g.openProvider === "FanDuel" ? undefined : "#e8c84a" }}>{r.g.openProvider ?? "–"}{r.g.openProvider === "FanDuel" ? "" : " (provisional)"}</td>
                        <td style={NUM}>{f1(r.modelSpread)}</td>
                        <td style={NUM}>{sgn(edge)}</td>
                        <td style={NUM}>{sgn(Math.abs(r.pred!.move), 2)}</td>
                        <td style={{ ...NUM, color: mv != null && Math.abs(mv) >= 0.3 ? "#e8c84a" : "var(--chalk-dim)" }}>{mv == null ? "–" : sgn(mv, 1)}</td>
                        <td style={{ ...CELL, color: "var(--chalk-dim)" }}>{lg ? `${f1(lg.model_home_spread)} @ ${f1(lg.open_spread)}` : "–"}</td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td style={CELL} colSpan={10}>Nothing at or above {minEdge} points in this group.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem", alignItems: "center", flexWrap: "wrap" }}>
        <button className="menu-btn" disabled={saving || rows.every((r) => !r.pred)} onClick={save}>
          Save this week to the Picks log
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Keeps the first save per game. {provisional ? `${provisional} game(s) are still on Bovada's open; run "Fill gaps only" once FanDuel posts them, then save.` : "Every game is on FanDuel's open."}
        </span>
      </div>
      {msg && <p style={DIM}>{msg}</p>}
      {diff && (
        <RunChanges diff={diff} games={state.games} />
      )}
    </div>
  );
}

function RunChanges({ diff, games }: { diff: RunDiff; games: DrogbaState["games"] }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const changes = Array.from(diff.after.entries())
    .map(([id, now]) => ({ id, now, before: diff.before.get(id) }))
    .filter((c) => c.before == null || Math.abs(c.now - c.before) >= 0.3)
    .sort((a, b) => Math.abs((b.before == null ? 99 : b.now - b.before)) - Math.abs((a.before == null ? 99 : a.now - a.before)));
  return (
    <div style={{ marginTop: "0.8rem" }}>
      <div style={{ fontSize: "0.88rem", fontWeight: 700 }}>What changed in this run</div>
      <p style={DIM}>
        {changes.length === 0
          ? "No game's model number moved by 0.3 points or more: the new data did not change this week's projections."
          : `${changes.length} game(s) had a model number that moved by 0.3 points or more (or was newly projectable) after the new results, stats and play-by-play came in.`}
      </p>
      {changes.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={CELL}>Matchup</th>
                <th style={HEAD}>Before</th>
                <th style={HEAD}>After</th>
                <th style={HEAD}>Change</th>
              </tr>
            </thead>
            <tbody>
              {changes.slice(0, 40).map((c) => {
                const g = byId.get(c.id);
                return (
                  <tr key={c.id}>
                    <td style={CELL}>{g ? `${g.away} @ ${g.home}` : c.id}</td>
                    <td style={NUM}>{c.before == null ? "none" : f1(c.before)}</td>
                    <td style={NUM}>{f1(c.now)}</td>
                    <td style={NUM}>{c.before == null ? "new" : sgn(c.now - c.before, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
