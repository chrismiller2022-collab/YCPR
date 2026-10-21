import type { CSSProperties, ReactElement } from "react";
import { TEAM_LOGOS } from "../data/logos";
import { PROGRESSION_HIGHER_IS_BETTER, type ProgressionMetric, type ProgressionPoint, type ProgressionSeries } from "../lib/progressionSeries";

// Weekly Progression chart for the Weekly Image Dump — same card language
// as CompactPowerRatingsGraphic (navy card, gold eyebrow, uppercase title,
// YC POWER RATINGS / site / handle footer). Pure SVG lines + absolutely
// positioned HTML <img> logos (html-to-image inlines <img> the same way it
// does for the other graphics; SVG <image> hrefs are less reliable), fixed
// pixel width so off-screen capture doesn't depend on page width.
//
//   mode "ranking": bump chart — rank 1 at top. Ranks past topN collapse
//     into one dashed "outside" row so a team's climb into the top N still
//     reads. bracket12: rank = seed; a team has no point in a week it was
//     out of the field (its line just stops), and teams that were in last
//     week's field but fell out this week are drawn faded, ending at their
//     last seed with an "OUT" tag.
//   mode "rating": line chart of raw values on one shared y scale, better
//     at the top (power: most negative at top).
//
// Caller should export with includeBranding:false (footer is baked in).

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";
const GOLD = "var(--gold, #d9a441)";

// Repo has no team color data, so lines use a fixed high-contrast palette,
// assigned in latest-week rank order (1 seed / #1 team always gets [0]).
const PALETTE = [
  "#d9a441", "#5aa9e6", "#e05d5d", "#5ec488", "#b07de0", "#f08a4b",
  "#4fd1c5", "#f2d16b", "#e67fb8", "#8fa8ff", "#a3d977", "#c9a07a",
  "#7fd4f0", "#ff9f9f", "#9ee6b8", "#d6b4ff", "#ffc27a", "#7ae0d6",
  "#c8c8c8", "#ffe08a", "#f5a3d4", "#b0c4ff", "#cce6a3", "#e0c2a3", "#a8e6ff",
];
const DROPPED_COLOR = "rgba(255,255,255,0.35)";

const METRIC_LABEL: Record<ProgressionMetric, string> = {
  power: "Power Rating",
  resume: "Résumé So Far",
  winTotals: "Projected Wins",
  bracket12: "Playoff %",
};

function weekLabel(w: number) {
  return w === 0 ? "PRE" : `WK ${w}`;
}

function fmtValue(metric: ProgressionMetric, v: number) {
  if (metric === "power") return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  if (metric === "bracket12") return `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`;
  return v.toFixed(1);
}

interface Line {
  team: string;
  color: string;
  dropped: boolean;
  points: ProgressionPoint[];
  last: ProgressionPoint;
}

/** Spread label centers apart by at least `gap`, keeping them inside [lo, hi]. */
function relaxLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => o.y);
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (let k = 1; k < out.length; k++) {
      const overlap = out[k - 1] + gap - out[k];
      if (overlap > 0.01) {
        out[k - 1] -= overlap / 2;
        out[k] += overlap / 2;
        moved = true;
      }
    }
    if (out.length) {
      if (out[0] < lo) {
        const d = lo - out[0];
        for (let k = 0; k < out.length; k++) out[k] += d;
      }
      if (out[out.length - 1] > hi) {
        const d = out[out.length - 1] - hi;
        for (let k = 0; k < out.length; k++) out[k] -= d;
      }
    }
    if (!moved) break;
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]));
  return res;
}

export default function ProgressionGraphic({
  metric,
  mode,
  topN = 12,
  series,
  eyebrow,
  header,
  subtitle,
  width = 1200,
}: {
  metric: ProgressionMetric;
  mode: "rating" | "ranking";
  /** How many teams to chart, picked by the latest week's rank (bracket12 always uses the 12-team field). */
  topN?: number;
  series: ProgressionSeries | null;
  /** Small gold uppercase label, e.g. "WEEK 8 · FBS". */
  eyebrow: string;
  /** Title, e.g. "POWER RATINGS — WEEKLY PROGRESSION". */
  header: string;
  /** Optional one-line note under the title; a sensible default is generated per metric/mode. */
  subtitle?: string;
  /** Total card width in px (default 1200). */
  width?: number;
}) {
  const weeks = series?.weeks ?? [];
  const latestWeek = weeks.length ? weeks[weeks.length - 1] : null;
  const prevWeek = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const isBracket = metric === "bracket12";
  const n = isBracket ? 12 : topN;
  const higherIsBetter = PROGRESSION_HIGHER_IS_BETTER[metric];

  // --- pick teams: latest week's top N (plus bracket drop-outs) ---
  const lines: Line[] = [];
  if (series && latestWeek != null) {
    const current = series.teams
      .map((t) => ({ t, p: t.points.find((p) => p.week === latestWeek) }))
      .filter((x): x is { t: (typeof series.teams)[number]; p: ProgressionPoint } => !!x.p && x.p.rank <= n)
      .sort((a, b) => a.p.rank - b.p.rank);
    current.forEach(({ t }, i) => {
      const pts = t.points.filter((p) => weeks.includes(p.week));
      lines.push({ team: t.team, color: PALETTE[i % PALETTE.length], dropped: false, points: pts, last: pts[pts.length - 1] });
    });
    if (isBracket && mode === "ranking" && prevWeek != null) {
      for (const t of series.teams) {
        if (lines.some((l) => l.team === t.team)) continue;
        const pts = t.points.filter((p) => weeks.includes(p.week));
        if (pts.some((p) => p.week === prevWeek)) lines.push({ team: t.team, color: DROPPED_COLOR, dropped: true, points: pts, last: pts[pts.length - 1] });
      }
    }
  }

  // --- geometry ---
  const PAD_X = 26;
  const innerW = width - PAD_X * 2;
  const LEFT = 56;
  const RIGHT = 270;
  // label column offset from the last week: ranking mode sits right next to the
  // numbered circles; rating mode needs room for angled leader lines
  const LABEL_DX = mode === "ranking" ? 26 : 50;
  const TOP = 16;
  const ROW = 40;
  const hasOverflowRow = mode === "ranking" && !isBracket;
  const plotH = mode === "ranking" ? (n - 1) * ROW + (hasOverflowRow ? ROW + 10 : 0) : 470;
  const BOTTOM = 34;
  const svgH = TOP + plotH + BOTTOM;
  const plotW = innerW - LEFT - RIGHT;
  const xOf = (w: number) => {
    const i = weeks.indexOf(w);
    return LEFT + (weeks.length <= 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW);
  };

  // y scale
  const overflowY = TOP + (n - 1) * ROW + ROW + 10;
  let yOf: (p: ProgressionPoint) => number;
  let yTicks: { y: number; label: string }[] = [];
  if (mode === "ranking") {
    yOf = (p) => (p.rank > n ? overflowY : TOP + (p.rank - 1) * ROW);
    for (let r = 1; r <= n; r++) yTicks.push({ y: TOP + (r - 1) * ROW, label: String(r) });
    if (hasOverflowRow) yTicks.push({ y: overflowY, label: `${n + 1}+` });
  } else {
    const vals = lines.flatMap((l) => l.points.map((p) => p.value));
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    const rawStep = span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? 10 * mag;
    lo = Math.floor((lo - span * 0.04) / step) * step;
    hi = Math.ceil((hi + span * 0.04) / step) * step;
    // better at the top: higherIsBetter -> hi at top; power -> lo (most negative) at top
    yOf = (p) => {
      const f = (p.value - lo) / (hi - lo);
      return TOP + (higherIsBetter ? 1 - f : f) * plotH;
    };
    for (let v = lo; v <= hi + step / 2; v += step) {
      const vv = Math.round(v / step) * step;
      yTicks.push({ y: yOf({ week: 0, value: vv, rank: 0 }), label: fmtValue(metric, vv) });
    }
  }

  // end labels
  const endX = latestWeek != null ? xOf(latestWeek) : LEFT + plotW;
  const labelYs = relaxLabels(
    lines.map((l) => yOf(l.last)),
    mode === "ranking" ? Math.min(ROW, 30) : 30,
    TOP - 8,
    TOP + plotH + 8
  );

  const defaultSubtitle =
    mode === "ranking"
      ? isBracket
        ? "Projected CFP seed each week (latest Monte Carlo run per week) · faded = fell out of the field"
        : `Rank each week · top ${n} as of ${latestWeek != null ? weekLabel(latestWeek).toLowerCase() : "latest week"}`
      : `${METRIC_LABEL[metric]} each week · ${higherIsBetter ? "higher" : "lower"} is better (top of chart)`;

  const logoStyle = (x: number, y: number, size: number, faded: boolean): CSSProperties => ({
    position: "absolute",
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
    objectFit: "contain",
    opacity: faded ? 0.45 : 1,
    display: "block",
  });

  const empty = !series || lines.length === 0;

  return (
    <div style={{ background: "#1f2041", padding: `22px ${PAD_X}px`, width, boxSizing: "border-box", fontFamily: "inherit" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 6 }}>{eyebrow}</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.03em", color: "#fff", textTransform: "uppercase" }}>{header}</div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "rgba(255,255,255,0.5)", marginTop: 6 }}>{subtitle ?? defaultSubtitle}</div>
      </div>

      {empty ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
          No saved weekly data yet.
        </div>
      ) : (
        <div style={{ position: "relative", width: innerW, height: svgH }}>
          <svg width={innerW} height={svgH} viewBox={`0 0 ${innerW} ${svgH}`} style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}>
            {/* grid */}
            {yTicks.map((t) => (
              <g key={`y${t.label}${t.y}`}>
                <line x1={LEFT - 6} x2={LEFT + plotW} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.08)" strokeDasharray={t.label.endsWith("+") ? "4 4" : undefined} />
                <text x={LEFT - 14} y={t.y + 4} textAnchor="end" fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.5)">
                  {t.label}
                </text>
              </g>
            ))}
            {weeks.map((w) => (
              <g key={`x${w}`}>
                <line x1={xOf(w)} x2={xOf(w)} y1={TOP - 8} y2={TOP + plotH + 8} stroke="rgba(255,255,255,0.06)" />
                <text x={xOf(w)} y={TOP + plotH + 26} textAnchor="middle" fontSize={11} fontWeight={800} letterSpacing="0.06em" fill={w === latestWeek ? GOLD : "rgba(255,255,255,0.55)"}>
                  {weekLabel(w)}
                </text>
              </g>
            ))}

            {/* lines: dropped first (underneath), then worst-to-best so #1 sits on top */}
            {[...lines].reverse().sort((a, b) => Number(b.dropped) - Number(a.dropped)).map((l) => {
              const segs: ReactElement[] = [];
              for (let i = 1; i < l.points.length; i++) {
                const a = l.points[i - 1];
                const b = l.points[i];
                // bracket12: a gap in weeks = out of the field in between — don't bridge it
                if (isBracket && weeks.indexOf(b.week) - weeks.indexOf(a.week) > 1) continue;
                // both ends below the top N: nothing to show (avoids a pile of dashes on the "N+" row)
                if (mode === "ranking" && a.rank > n && b.rank > n) continue;
                const outside = mode === "ranking" && (a.rank > n || b.rank > n);
                segs.push(
                  <line
                    key={`${l.team}-${a.week}`}
                    x1={xOf(a.week)}
                    y1={yOf(a)}
                    x2={xOf(b.week)}
                    y2={yOf(b)}
                    stroke={l.color}
                    strokeWidth={l.dropped ? 2.5 : 3.5}
                    strokeOpacity={outside ? 0.45 : 0.95}
                    strokeDasharray={outside || l.dropped ? "6 5" : undefined}
                    strokeLinecap="round"
                  />
                );
              }
              return <g key={l.team}>{segs}</g>;
            })}

            {/* points */}
            {lines.map((l) =>
              l.points.map((p, i) => {
                const isLast = i === l.points.length - 1;
                const isFirstOfRun = i === 0 || (isBracket && weeks.indexOf(p.week) - weeks.indexOf(l.points[i - 1].week) > 1);
                // ranking mode: start-of-line points carry a logo (drawn as HTML below)
                if (mode === "ranking" && isFirstOfRun && !(p.rank > n) && !isLast) return null;
                const outside = mode === "ranking" && p.rank > n;
                // an outside point only matters where a line enters/leaves the top N
                if (outside && !((l.points[i - 1]?.rank ?? 99) <= n || (l.points[i + 1]?.rank ?? 99) <= n)) return null;
                if (mode === "ranking" && !outside) {
                  return (
                    <g key={`${l.team}-p${p.week}`}>
                      <circle cx={xOf(p.week)} cy={yOf(p)} r={10} fill="#1f2041" stroke={l.color} strokeWidth={2.5} opacity={l.dropped ? 0.6 : 1} />
                      <text x={xOf(p.week)} y={yOf(p) + 3.8} textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#fff" opacity={l.dropped ? 0.6 : 1}>
                        {p.rank}
                      </text>
                    </g>
                  );
                }
                return <circle key={`${l.team}-p${p.week}`} cx={xOf(p.week)} cy={yOf(p)} r={outside ? 3 : isLast ? 5 : 4} fill={l.color} opacity={outside ? 0.5 : 1} />;
              })
            )}

            {/* end labels: leader line from last point to the label column */}
            {lines.map((l, i) => {
              const x0 = xOf(l.last.week);
              const y0 = yOf(l.last);
              const ly = labelYs[i];
              const lx = endX + LABEL_DX;
              const tag = l.dropped
                ? `OUT · was #${l.last.rank}`
                : mode === "ranking"
                  ? isBracket
                    ? `#${l.last.rank} seed · ${fmtValue(metric, l.last.value)}`
                    : `#${l.last.rank} · ${fmtValue(metric, l.last.value)}`
                  : fmtValue(metric, l.last.value);
              return (
                <g key={`lbl-${l.team}`} opacity={l.dropped ? 0.65 : 1}>
                  {(Math.abs(ly - y0) > 1 || x0 < endX - 1) && <path d={`M ${x0 + (mode === "ranking" ? 11 : 6)} ${y0} L ${lx - 16} ${ly}`} stroke={l.color} strokeOpacity={0.5} strokeWidth={1.2} fill="none" />}
                  <text x={lx + 18} y={ly - 1} fontSize={13} fontWeight={800} fill="#fff">
                    {l.team}
                  </text>
                  <text x={lx + 18} y={ly + 12} fontSize={10.5} fontWeight={700} fill={l.dropped ? DROPPED_COLOR : l.color}>
                    {tag}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* logos (HTML so html-to-image inlines them like the other graphics) */}
          {lines.map((l, i) => {
            const logo = TEAM_LOGOS[l.team];
            if (!logo) return null;
            const nodes: ReactElement[] = [<img key="end" src={logo} alt="" style={logoStyle(endX + LABEL_DX, labelYs[i], 26, l.dropped)} />];
            if (mode === "ranking") {
              l.points.forEach((p, k) => {
                const isFirstOfRun = k === 0 || (isBracket && weeks.indexOf(p.week) - weeks.indexOf(l.points[k - 1].week) > 1);
                if (isFirstOfRun && p.rank <= n && k !== l.points.length - 1) {
                  nodes.push(<img key={`s${p.week}`} src={logo} alt="" style={logoStyle(xOf(p.week), yOf(p), 24, l.dropped)} />);
                }
              });
            }
            return <span key={l.team}>{nodes}</span>;
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          paddingTop: 10,
          marginTop: 6,
          borderTop: "1px solid rgba(255,255,255,0.15)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.55)" }}>YC POWER RATINGS</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{SITE_URL}</span>
        <span style={{ color: GOLD }}>{TWITTER_HANDLE}</span>
      </div>
    </div>
  );
}
