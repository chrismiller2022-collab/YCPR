import { useMemo, useState } from "react";
import { isFbsGame, margin } from "../../lib/drogba/dataset";
import { evaluateWalkForward, fitEdgeResponse, fitLayer1, predictLayer1, thresholdTable, type BetResult, type GameSignals } from "../../lib/drogba/model";
import { atsColor, clvColor } from "../../lib/drogba/colors";
import { gameTier, TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P, f1, pct, sgn } from "./shared";

const EDGES = [0, 3, 5, 7];
const TEST_SEASONS = [2023, 2024, 2025, 2026];

function bySeason(results: BetResult[]) {
  return TEST_SEASONS.map((season) => {
    const sub = results.filter((r) => r.g.season === season);
    const all = thresholdTable(sub, [0])[0];
    const big = thresholdTable(sub, [5])[0];
    return { season, games: sub.length, clvAll: all.avgMoveToUs, bets5: big.n, ats5: big.atsPct, clv5: big.avgMoveToUs };
  });
}

function EdgeTable({ title, note, rows }: { title: string; note?: string; rows: ReturnType<typeof thresholdTable> }) {
  return (
    <>
      <h3 style={H3}>{title}</h3>
      {note && <p style={DIM}>{note}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Model disagrees with the open by ≥</th>
              <th style={NUM}>Games</th>
              <th style={NUM}>W–L</th>
              <th style={NUM}>ATS vs open</th>
              <th style={NUM}>Line moved to the model (pts)</th>
              <th style={NUM}>Moved its way (of moved)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.minEdge}>
                <td style={CELL}>{r.minEdge} pts</td>
                <td style={NUM}>{r.n}</td>
                <td style={NUM}>{r.w}–{r.l}</td>
                <td style={{ ...NUM, color: r.n ? atsColor(r.atsPct) : undefined }}>{pct(r.atsPct)}</td>
                <td style={{ ...NUM, color: r.n ? clvColor(r.avgMoveToUs) : undefined }}>{sgn(r.avgMoveToUs, 2)}</td>
                <td style={NUM}>{pct(r.movedOurWayPct, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DrogbaBacktestTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const [ran, setRan] = useState(false);

  const out = useMemo(() => {
    if (!engine || !ran || !engine.hasEff) return null;
    const sig = engine.signals;
    const results = evaluateWalkForward(sig, { testSeasons: TEST_SEASONS });
    const completed = sig.filter((s) => s.g.completed && isFbsGame(s.g) && s.g.season >= TEST_SEASONS[0] && s.g.open != null);

    // MAE of the market-blind margin vs the lines (each test season predicted by a model fit on earlier seasons only)
    const maeRows: { open: number; close: number | null; scoreboard: number | null; model: number | null }[] = [];
    for (const S of TEST_SEASONS) {
      const l1 = fitLayer1(sig.filter((s) => s.g.season < S && s.g.completed));
      if (!l1) continue;
      for (const s of completed.filter((c) => c.g.season === S)) {
        const m = predictLayer1(l1, s);
        const mar = margin(s.g);
        maeRows.push({ open: Math.abs(mar + s.g.open!), close: s.g.close == null ? null : Math.abs(mar + s.g.close), scoreboard: s.mrMargin == null ? null : Math.abs(mar - s.mrMargin), model: m == null ? null : Math.abs(mar - m) });
      }
    }
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return { mae: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, n: v.length };
    };
    const baselines = [
      { label: "Opening line", ...avg(maeRows.map((r) => r.open)) },
      { label: "Closing line (Bovada)", ...avg(maeRows.map((r) => r.close)) },
      { label: "Scoreboard-only rating (walk-forward)", ...avg(maeRows.map((r) => r.scoreboard)) },
      { label: "DROGBA margin (efficiency + preseason, walk-forward)", ...avg(maeRows.map((r) => r.model)) },
    ];

    const weekBuckets: [string, (r: BetResult) => boolean][] = [
      ["Weeks 1–3", (r) => r.g.week <= 3],
      ["Weeks 4–8", (r) => r.g.week >= 4 && r.g.week <= 8],
      ["Week 9+", (r) => r.g.week >= 9],
    ];
    const l1All = fitLayer1(sig.filter((s) => s.g.completed));
    const resp = l1All ? fitEdgeResponse(sig.filter((s) => s.g.completed && s.g.season >= TEST_SEASONS[1]), l1All) : null;
    return {
      baselines,
      overall: thresholdTable(results, EDGES),
      tiers: (['power', 'other'] as Tier[]).map((t) => ({ t, rows: thresholdTable(results.filter((r) => gameTier(r.g) === t), EDGES) })),
      seasons: bySeason(results),
      buckets: weekBuckets.map(([label, f]) => ({ label, rows: thresholdTable(results.filter(f), [0, 5]) })),
      l1: l1All,
      resp,
    };
  }, [engine, ran]);

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!engine) return null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Backtest</h2>
      <p style={P}>
        Every number uses only information available before each game: ratings for week W come from games before week W, and each season is predicted by models fit on earlier seasons only. The model never sees a line or anyone else's projection while rating teams.
        The main yardstick is <strong>closing-line value</strong> (how far the line moves toward the model between the open and the close, in points) because it settles in a few hundred games; ATS vs the open needs thousands. 52.4% ATS is break-even at −110. The opening line used is the one chosen at the top of the page; the Methodology figures are against Bovada's open (FanDuel's earlier open adds more line movement, partly just from being earlier, and only covers part of the games).
        {engine.hasEff ? "" : " The efficiency layer is off until per-game advanced stats are backfilled for at least two seasons (Data & sync tab)."}
        {" "}Inputs in the model now: per-game efficiency{engine.hasPlays ? ", play-level success rate and isolated explosiveness" : " (play-level metrics not loaded yet)"}{engine.hasSt ? ", special teams" : ""}, scoreboard rating and preseason inputs.
      </p>
      <button className="menu-btn" onClick={() => setRan(true)} disabled={ran}>
        {ran ? "Backtest run" : "Run backtest"}
      </button>

      {out && (
        <>
          <h3 style={H3}>Accuracy (average miss vs the final margin, 2023–26)</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Predictor</th>
                  <th style={NUM}>Games</th>
                  <th style={NUM}>MAE (pts)</th>
                </tr>
              </thead>
              <tbody>
                {out.baselines.map((b) => (
                  <tr key={b.label}>
                    <td style={CELL}>{b.label}</td>
                    <td style={NUM}>{b.n}</td>
                    <td style={NUM}>{f1(b.mae, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={DIM}>JP+ publishes an MAE of 12.77 on its own walk-forward games. The market is the bar; being slightly worse than the open on its own is normal — the model is judged on what it does where it disagrees.</p>

          <EdgeTable
            title="Does a bigger disagreement with the open mean more line movement toward the model?"
            note="Each row is every game where the model's number differs from the opening line by at least that many points. 'Line moved to the model' is closing-line value."
            rows={out.overall}
          />

          {out.tiers.map(({ t, rows }) => (
            <EdgeTable
              key={t}
              title={`${TIER_LABELS[t]}${t === "power" ? " (primary)" : " (tracked)"}`}
              note={t === "power" ? "Both teams in the SEC, Big Ten, Big 12, ACC or Notre Dame (Pac-12 in 2023)." : "Every other game."}
              rows={rows}
            />
          ))}

          <h3 style={H3}>By season (edge ≥ 5 pts)</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Season</th>
                  <th style={NUM}>Games</th>
                  <th style={NUM}>Avg CLV, all games</th>
                  <th style={NUM}>Bets (≥5)</th>
                  <th style={NUM}>ATS (≥5)</th>
                  <th style={NUM}>CLV (≥5)</th>
                </tr>
              </thead>
              <tbody>
                {out.seasons.map((r) => (
                  <tr key={r.season}>
                    <td style={CELL}>{r.season}</td>
                    <td style={NUM}>{r.games}</td>
                    <td style={NUM}>{sgn(r.clvAll, 2)}</td>
                    <td style={NUM}>{r.bets5}</td>
                    <td style={{ ...NUM, color: atsColor(r.ats5) }}>{pct(r.ats5)}</td>
                    <td style={{ ...NUM, color: clvColor(r.clv5) }}>{sgn(r.clv5, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={DIM}>The edge is uneven across seasons — 2023 was far stronger than the others — so judge it over all seasons, not the best one.</p>

          {out.buckets.map((b) => (
            <EdgeTable key={b.label} title={b.label} rows={b.rows} />
          ))}

          {out.resp && (
            <>
              <h3 style={H3}>What a disagreement is worth (last three seasons, 2024+)</h3>
              <p style={P}>
                Per point of edge, weeks 1–3: line moves {sgn(out.resp.moveEarly, 3)} pts toward the model, expected cover {sgn(out.resp.coverEarly, 3)}. Week 4+: line moves {sgn(out.resp.moveLate, 3)}, expected cover {sgn(out.resp.coverLate, 3)}. Edges are capped at 8 points.
              </p>
            </>
          )}
          {out.l1 && (
            <>
              <h3 style={H3}>Margin model weights (standardized features → home margin)</h3>
              <p style={P}>{out.l1.features.map((f, i) => `${f}: ${out.l1!.coef[i].toFixed(2)}`).join("  ·  ")}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
