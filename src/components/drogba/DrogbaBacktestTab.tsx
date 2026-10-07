import { useMemo, useState } from "react";
import { isFbsGame, margin } from "../../lib/drogba/dataset";
import {
  evaluateWalkForward,
  fitLayer1,
  fitLayer2,
  thresholdTable,
  type GameSignals,
  type ThresholdRow,
} from "../../lib/drogba/model";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P, f1, pct, sgn } from "./shared";

interface RawEdgeRow {
  min: number;
  n: number;
  w: number;
  l: number;
  ats: number;
  avgCover: number;
  avgMove: number;
}

// Plain ATS table by the size of the raw disagreement between a signal and the opening line.
function rawEdgeTable(signals: GameSignals[], pick: (s: GameSignals) => number | null, filter: (s: GameSignals) => boolean): RawEdgeRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((min) => {
    let w = 0,
      l = 0,
      cover = 0,
      mv = 0,
      mvN = 0;
    for (const s of signals) {
      if (!s.g.completed || !filter(s)) continue;
      const m = pick(s);
      if (m == null) continue;
      const edge = m + s.g.open!;
      if (edge === 0 || Math.abs(edge) < min) continue;
      const side = edge > 0 ? 1 : -1;
      const c = side * (margin(s.g) + s.g.open!);
      cover += c;
      if (c > 0) w++;
      else if (c < 0) l++;
      if (s.g.close != null) {
        mv += side * (s.g.open! - s.g.close);
        mvN++;
      }
    }
    return { min, n: w + l, w, l, ats: w + l ? (100 * w) / (w + l) : 0, avgCover: w + l ? cover / (w + l) : 0, avgMove: mvN ? mv / mvN : 0 };
  });
}

function RawEdgeView({ title, rows }: { title: string; rows: RawEdgeRow[] }) {
  return (
    <>
      <h3 style={H3}>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Edge vs open</th>
              <th style={NUM}>Bets</th>
              <th style={NUM}>W–L</th>
              <th style={NUM}>ATS vs open</th>
              <th style={NUM}>Avg cover margin</th>
              <th style={NUM}>Line moved to us (pts)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.min}>
                <td style={CELL}>≥ {r.min}</td>
                <td style={NUM}>{r.n}</td>
                <td style={NUM}>{r.w}–{r.l}</td>
                <td style={NUM}>{pct(r.ats)}</td>
                <td style={NUM}>{sgn(r.avgCover, 2)}</td>
                <td style={NUM}>{sgn(r.avgMove, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ThresholdView({ title, note, rows }: { title: string; note?: string; rows: ThresholdRow[] }) {
  return (
    <>
      <h3 style={H3}>{title}</h3>
      {note && <p style={DIM}>{note}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Model expects to cover by ≥</th>
              <th style={NUM}>Bets</th>
              <th style={NUM}>W–L</th>
              <th style={NUM}>ATS vs open</th>
              <th style={NUM}>Line moved to us (pts)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.minCover}>
                <td style={CELL}>{r.minCover}</td>
                <td style={NUM}>{r.n}</td>
                <td style={NUM}>{r.w}–{r.l}</td>
                <td style={NUM}>{pct(r.atsPct)}</td>
                <td style={NUM}>{sgn(r.avgMoveToUs, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const THRESHOLDS = [0, 0.5, 1, 1.5, 2, 3];

export default function DrogbaBacktestTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const [ran, setRan] = useState(false);

  const out = useMemo(() => {
    if (!engine || !ran) return null;
    const sig = engine.signals;
    const withC = sig.filter((s) => s.consensusMargin != null);
    const completed = sig.filter((s) => s.g.completed && isFbsGame(s.g));

    const mae = (f: (s: GameSignals) => number | null) => {
      let a = 0,
        n = 0;
      for (const s of completed) {
        const v = f(s);
        if (v == null) continue;
        a += Math.abs(margin(s.g) - v);
        n++;
      }
      return { mae: n ? a / n : 0, n };
    };
    const baselines = [
      { label: "Opening line", ...mae((s) => -s.g.open!) },
      { label: "Closing line", ...mae((s) => (s.g.close == null ? null : -s.g.close)) },
      { label: "Scoreboard rating (walk-forward)", ...mae((s) => s.mrMargin) },
      { label: "Your consensus (2024–26)", ...mae((s) => s.consensusMargin) },
    ];

    const consSeasons = Array.from(new Set(withC.map((s) => s.g.season))).sort();
    const consOnly = evaluateWalkForward(withC, { testSeasons: consSeasons, useConsensus: true, useEff: false, loso: true });
    const effOnly = engine.hasEff
      ? evaluateWalkForward(sig, { testSeasons: [2023, 2024, 2025, 2026], useConsensus: false, useEff: true })
      : null;
    const both = engine.hasEff
      ? evaluateWalkForward(withC, { testSeasons: consSeasons, useConsensus: true, useEff: true, loso: true })
      : null;

    const l1 = engine.hasEff ? fitLayer1(sig.filter((s) => s.g.completed)) : null;
    const l2 = fitLayer2(withC.filter((s) => s.g.completed), l1, true);

    return {
      baselines,
      consEarly: rawEdgeTable(withC, (s) => s.consensusMargin, (s) => !s.late),
      consLate: rawEdgeTable(withC, (s) => s.consensusMargin, (s) => s.late),
      consOnly: thresholdTable(consOnly, THRESHOLDS),
      effOnly: effOnly ? thresholdTable(effOnly, THRESHOLDS) : null,
      both: both ? thresholdTable(both, THRESHOLDS) : null,
      l1,
      l2,
    };
  }, [engine, ran]);

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!engine) return null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Backtest</h2>
      <p style={P}>
        Every number here uses only information available before each game: ratings for week W are built from games in weeks before W, and each model is fit on other seasons than the one it's graded on. "ATS vs open" grades the
        pick against Bovada's opening spread. A 52.4% win rate is break-even at −110. {engine.hasEff ? "" : "The efficiency layer is switched off until per-game advanced stats are backfilled for at least two seasons (Data & sync tab)."}
      </p>
      <button className="menu-btn" onClick={() => setRan(true)} disabled={ran}>
        {ran ? "Backtest run" : "Run backtest"}
      </button>

      {out && (
        <>
          <h3 style={H3}>How good are the numbers themselves? (average miss vs the final margin)</h3>
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
          <p style={DIM}>The market is the bar: a rating that doesn't get near the opening line's MAE has nothing to add on its own, which is why the model is built as a disagreement-with-the-open model.</p>

          <RawEdgeView title="Your consensus vs the open — weeks 1–3 (raw edge, no model)" rows={out.consEarly} />
          <RawEdgeView title="Your consensus vs the open — week 4 on (raw edge, no model)" rows={out.consLate} />

          <ThresholdView
            title="Model: consensus only (leave-one-season-out, 2024–26)"
            note="Expected cover is the model's shrunk estimate of how many points the side beats the open by; it is much smaller than the raw edge because most of a disagreement is noise."
            rows={out.consOnly}
          />
          {out.effOnly && <ThresholdView title="Model: efficiency ratings + preseason priors only (trained on earlier seasons, graded 2023–26)" rows={out.effOnly} />}
          {out.both && <ThresholdView title="Model: efficiency + consensus (leave-one-season-out, 2024–26)" rows={out.both} />}

          {out.l2 && (
            <>
              <h3 style={H3}>Layer-2 weights (points of expected cover per point of disagreement)</h3>
              <p style={P}>{out.l2.features.map((f, i) => `${f}: ${out.l2!.coef[i].toFixed(3)}`).join("  ·  ")}</p>
            </>
          )}
          {out.l1 && (
            <>
              <h3 style={H3}>Layer-1 weights (standardized features → home margin)</h3>
              <p style={P}>{out.l1.features.map((f, i) => `${f}: ${out.l1!.coef[i].toFixed(2)}`).join("  ·  ")}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
