import { useMemo, useState, type CSSProperties } from "react";
import { evaluateWalkForward } from "../../lib/drogba/model";
import { buildSections, toBets, type BucketRow, type BucketStat } from "../../lib/drogba/buckets";
import { atsColor, clvColor, isSmallSample } from "../../lib/drogba/colors";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P, sgn } from "./shared";

const EDGES = [0, 3, 4, 5, 6, 7];

function AtsCell({ pct, n, bold }: { pct: number | null; n: number; bold?: boolean }) {
  if (pct == null || n === 0) return <td style={{ ...NUM, color: "var(--chalk-dim)" }}>–</td>;
  const small = isSmallSample(n);
  return (
    <td style={{ ...NUM, color: atsColor(pct), fontWeight: bold ? 700 : 400, opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }} title={small ? `Small sample (${n} decided bets)` : undefined}>
      {pct.toFixed(1)}%
    </td>
  );
}

function Half({ h }: { h: { n: number; pct: number | null } }) {
  if (h.pct == null) return <td style={{ ...NUM, color: "var(--chalk-dim)" }}>–</td>;
  const small = isSmallSample(h.n);
  return (
    <td style={{ ...NUM, color: atsColor(h.pct), opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }}>
      {h.pct.toFixed(0)}% <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({h.n})</span>
    </td>
  );
}

function StatCells({ s, bold }: { s: BucketStat; bold?: boolean }) {
  const small = isSmallSample(s.n);
  return (
    <>
      <td style={NUM}>{s.n}</td>
      <td style={NUM}>{s.w}–{s.l}</td>
      <AtsCell pct={s.atsPct} n={s.n} bold={bold} />
      <td style={{ ...NUM, color: "var(--chalk-dim)", fontSize: "0.72rem" }}>±{s.se.toFixed(1)}</td>
      <td style={{ ...NUM, color: Math.abs(s.z) >= 2 ? (s.z > 0 ? "#8fd39a" : "#e07a7a") : "var(--chalk-dim)", opacity: small ? 0.55 : 1 }}>{s.n ? s.z.toFixed(1) : "–"}</td>
      <td style={{ ...NUM, color: clvColor(s.clv), fontWeight: bold ? 700 : 400, opacity: small ? 0.55 : 1 }}>{s.clv == null ? "–" : sgn(s.clv, 2)}</td>
      <Half h={s.early} />
      <Half h={s.late} />
    </>
  );
}

const HEAD: CSSProperties = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };

function Section({ title, note, rows }: { title: string; note?: string; rows: BucketRow[] }) {
  return (
    <>
      <h3 style={H3}>{title}</h3>
      {note && <p style={DIM}>{note}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ ...CELL, color: "var(--chalk-dim)" }}>Bucket</th>
              <th style={HEAD}>Bets</th>
              <th style={HEAD}>W–L</th>
              <th style={HEAD}>ATS</th>
              <th style={HEAD}>Noise</th>
              <th style={HEAD} title="Standard errors above the −110 break-even; |z| ≥ 2 is notable, but with this many buckets some will hit it by luck">z</th>
              <th style={HEAD} title="Average points the line moved toward the pick between the open and the close">CLV</th>
              <th style={HEAD}>2023–24</th>
              <th style={HEAD}>2025–26</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={CELL}>{r.label}</td>
                <StatCells s={r} />
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={CELL} colSpan={9}>No bets in this slice.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DrogbaBucketsTab({ state }: { state: DrogbaState }) {
  const engine = state.engine;
  const [minEdge, setMinEdge] = useState(3);
  const [tier, setTier] = useState<Tier | "all">("all");
  const [seasonSel, setSeasonSel] = useState<string>("all");

  const bets = useMemo(() => {
    if (!engine || !engine.hasEff) return null;
    const seasons = Array.from(new Set(engine.signals.map((s) => s.g.season))).filter((s) => s >= 2023).sort();
    const res = evaluateWalkForward(engine.signals, { testSeasons: seasons });
    return { bets: toBets(res), seasons };
  }, [engine]);

  const view = useMemo(() => {
    if (!bets) return null;
    const seasons = seasonSel === "all" ? null : seasonSel === "24+" ? bets.seasons.filter((s) => s >= 2024) : [Number(seasonSel)];
    return buildSections(bets.bets, { minEdge, seasons, tier });
  }, [bets, minEdge, tier, seasonSel]);

  // The two groups side by side at the chosen edge, regardless of the tier filter.
  const tierSummary = useMemo(() => {
    if (!bets) return null;
    const seasons = seasonSel === "all" ? null : seasonSel === "24+" ? bets.seasons.filter((s) => s >= 2024) : [Number(seasonSel)];
    return (["power", "other"] as Tier[]).map((t) => ({ t, s: buildSections(bets.bets, { minEdge, seasons, tier: t }).overall }));
  }, [bets, minEdge, seasonSel]);

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!engine) return null;
  if (!engine.hasEff) return <p style={DIM}>The efficiency layer needs per-game stats for at least two seasons (Data & sync tab).</p>;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Buckets</h2>
      <p style={P}>
        Every game where DROGBA's number differs from the opening line by at least the chosen edge is graded as a bet on the model's side (walk-forward: each season is predicted by models fit on earlier seasons only), then sliced. ATS is colored on the site's scale (yellow = the 52.4% break-even,
        green by 60%, red by 45%) and closing-line value on a scale from red (−1.5) through yellow (0) to green (+1.5, the target). Faded italics = under 30 bets. The opening line is the one chosen at the top of the page.
      </p>
      <p style={DIM}>
        With this many slices, about one in twenty will look significant by chance. Treat a bucket as a lead only if it is on the same side of break-even in both halves (2023–24 and 2025–26), has a decent sample, and its closing-line value agrees. Noise is one standard error of the win rate; z is
        how many of them the win rate sits above break-even.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Min edge{" "}
          <select className="filter" value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))}>
            {EDGES.map((e) => (
              <option key={e} value={e}>{e}+ pts</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Games{" "}
          <select className="filter" value={tier} onChange={(e) => setTier(e.target.value as Tier | "all")}>
            <option value="all">All games</option>
            <option value="power">{TIER_LABELS.power}</option>
            <option value="other">{TIER_LABELS.other}</option>
          </select>
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Seasons{" "}
          <select className="filter" value={seasonSel} onChange={(e) => setSeasonSel(e.target.value)}>
            <option value="all">All (2023–)</option>
            <option value="24+">2024 on</option>
            {bets?.seasons.map((s) => (
              <option key={s} value={String(s)}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {tierSummary && (
        <>
          <h3 style={H3}>Power vs power compared with every other game (edge ≥ {minEdge})</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ ...CELL, color: "var(--chalk-dim)" }}>Group</th>
                  <th style={HEAD}>Bets</th>
                  <th style={HEAD}>W–L</th>
                  <th style={HEAD}>ATS</th>
                  <th style={HEAD}>Noise</th>
                  <th style={HEAD}>z</th>
                  <th style={HEAD}>CLV</th>
                  <th style={HEAD}>2023–24</th>
                  <th style={HEAD}>2025–26</th>
                </tr>
              </thead>
              <tbody>
                {tierSummary.map(({ t, s }) => (
                  <tr key={t}>
                    <td style={{ ...CELL, fontWeight: 700 }}>{TIER_LABELS[t]}</td>
                    <StatCells s={s} bold />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view && (
        <>
          <p style={{ ...P, marginTop: "1.2rem" }}>
            Showing <strong>{tier === "all" ? "all games" : TIER_LABELS[tier].toLowerCase()}</strong>: {view.overall.n} bets, {view.overall.w}–{view.overall.l},{" "}
            <span style={{ color: atsColor(view.overall.atsPct), fontWeight: 700 }}>{view.overall.atsPct.toFixed(1)}% ATS</span>, closing-line value{" "}
            <span style={{ color: clvColor(view.overall.clv), fontWeight: 700 }}>{view.overall.clv == null ? "–" : sgn(view.overall.clv, 2)}</span>.
          </p>
          {view.sections.map((sec) => (
            <Section key={sec.key} title={sec.title} note={sec.note} rows={sec.rows} />
          ))}
        </>
      )}
    </div>
  );
}
