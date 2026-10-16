import { useEffect, useMemo, useRef, useState } from "react";
import { TEAMS } from "../data/teams";
import { TEAM_LOGOS } from "../data/logos";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchMonteCarloRun, fetchMonteCarloRuns } from "../lib/api/monteCarlo";
import { fetchLatestSavedResumeRanks } from "../lib/api/resumeWeights";
import ExportPngButton from "../components/ExportPngButton";
import type { TeamSimResult } from "../lib/montecarlo/engine";

// Admin scatter plot: pick any two team metrics and see every team's logo at its (x, y). Sources: the latest weekly
// ratings upload, the latest saved Monte Carlo run, and the latest saved Resume Ratings week.

interface TeamPoint {
  team: string;
  conf: string;
  div: string;
  values: Record<string, number | null>;
}

interface Metric {
  key: string;
  label: string;
  source: string;
  lowerIsBetter?: boolean;
  pct?: boolean;
}

const METRICS: Metric[] = [
  { key: "rating", label: "Power rating", source: "Ratings", lowerIsBetter: true },
  { key: "resume", label: "Resume rating", source: "Resume Ratings" },
  { key: "sor", label: "Strength of record", source: "Ratings" },
  { key: "total_wins", label: "Projected wins", source: "Ratings" },
  { key: "season_win_line", label: "Vegas win total", source: "Ratings" },
  { key: "change_from_preseason", label: "Wins vs preseason projection", source: "Ratings" },
  { key: "ats_pct", label: "ATS win %", source: "Ratings", pct: true },
  { key: "hfa", label: "Home-field advantage", source: "Ratings" },
  { key: "mc_wins", label: "Mean wins (Monte Carlo)", source: "Monte Carlo" },
  { key: "mc_playoff", label: "Playoff odds", source: "Monte Carlo", pct: true },
  { key: "mc_conf", label: "Conference title odds", source: "Monte Carlo", pct: true },
  { key: "mc_natty", label: "Title odds", source: "Monte Carlo", pct: true },
];
const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

const P4 = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);
const W = 920;
const H = 620;
const PAD = { l: 64, r: 24, t: 20, b: 52 };
const LOGO = 26;

function fmt(m: Metric, v: number | null): string {
  if (v == null) return "–";
  return m.pct ? `${(v * 100).toFixed(1)}%` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function niceTicks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function VizBuilderPanel() {
  const season = new Date().getFullYear();
  const { byTeam: stats } = useWeeklyStats("latest");
  const [mc, setMc] = useState<{ week: number; results: TeamSimResult[] } | null>(null);
  const [resume, setResume] = useState<{ week: number; byTeam: Record<string, { rank: number; rating: number }> } | null>(null);
  const [xKey, setXKey] = useState("rating");
  const [yKey, setYKey] = useState("resume");
  const [group, setGroup] = useState("FBS");
  const [flipX, setFlipX] = useState(true);
  const [flipY, setFlipY] = useState(false);
  const [hover, setHover] = useState<TeamPoint | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMonteCarloRuns(season)
      .then(async (list) => (list[0] ? fetchMonteCarloRun(list[0].id) : null))
      .then((run) => setMc(run ? { week: run.week, results: run.results } : null))
      .catch(() => setMc(null));
    fetchLatestSavedResumeRanks(season)
      .then(setResume)
      .catch(() => setResume(null));
  }, [season]);

  const points = useMemo<TeamPoint[]>(() => {
    const mcBy = new Map((mc?.results ?? []).map((r) => [r.team, r]));
    return TEAMS.map((t) => {
      const s: any = stats[t.team] ?? {};
      const r = mcBy.get(t.team);
      const atsN = (s.ats_wins ?? 0) + (s.ats_losses ?? 0);
      return {
        team: t.team,
        conf: t.conf,
        div: t.div,
        values: {
          rating: s.rating ?? t.rating ?? null,
          resume: resume?.byTeam[t.team]?.rating ?? null,
          sor: s.sor ?? null,
          total_wins: s.total_wins ?? null,
          season_win_line: s.season_win_line ?? null,
          change_from_preseason: s.change_from_preseason ?? null,
          ats_pct: atsN ? (s.ats_wins ?? 0) / atsN : null,
          hfa: s.hfa ?? null,
          mc_wins: r?.meanWins ?? null,
          mc_playoff: r ? r.playoffPct / 100 : null,
          mc_conf: r && t.conf !== "FBS Independents" ? r.confTitlePct / 100 : null,
          mc_natty: r ? r.nattyPct / 100 : null,
        },
      };
    });
  }, [stats, mc, resume]);

  const conferences = useMemo(() => Array.from(new Set(TEAMS.filter((t) => t.div === "FBS").map((t) => t.conf))).sort(), []);

  const shown = points.filter((p) => {
    if (p.values[xKey] == null || p.values[yKey] == null) return false;
    if (group === "FBS") return p.div === "FBS";
    if (group === "FCS") return p.div === "FCS";
    if (group === "P4") return P4.has(p.conf);
    if (group === "G6") return p.div === "FBS" && !P4.has(p.conf) && p.conf !== "FBS Independents";
    return p.conf === group;
  });

  const xm = METRIC_BY_KEY[xKey];
  const ym = METRIC_BY_KEY[yKey];
  const xs = shown.map((p) => p.values[xKey] as number);
  const ys = shown.map((p) => p.values[yKey] as number);
  const pad = (lo: number, hi: number) => {
    const d = (hi - lo || 1) * 0.06;
    return [lo - d, hi + d];
  };
  const [x0, x1] = xs.length ? pad(Math.min(...xs), Math.max(...xs)) : [0, 1];
  const [y0, y1] = ys.length ? pad(Math.min(...ys), Math.max(...ys)) : [0, 1];
  const sx = (v: number) => {
    const t = (v - x0) / (x1 - x0);
    return PAD.l + (flipX ? 1 - t : t) * (W - PAD.l - PAD.r);
  };
  const sy = (v: number) => {
    const t = (v - y0) / (y1 - y0);
    return H - PAD.b - (flipY ? 1 - t : t) * (H - PAD.t - PAD.b);
  };
  const mx = xs.length ? median(xs) : null;
  const my = ys.length ? median(ys) : null;

  const select = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {METRICS.map((m) => (
        <option key={m.key} value={m.key}>
          {m.label}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <h2>Viz Builder</h2>
      <p>
        Plot any two team metrics against each other, logos as points. Dashed lines are the medians of the teams shown. Sources: latest ratings
        upload{mc ? `, Week ${mc.week} Monte Carlo run` : ""}
        {resume ? `, Week ${resume.week} Resume Ratings` : ""}.
      </p>

      <div className="admin-panel admin-toolbar" style={{ marginBottom: 14 }}>
        <label className="admin-field" htmlFor="viz-x">
          X axis {select(xKey, setXKey, "viz-x")}
        </label>
        <label className="admin-field" htmlFor="viz-y">
          Y axis {select(yKey, setYKey, "viz-y")}
        </label>
        <label className="admin-field" htmlFor="viz-group">
          Teams
          <select id="viz-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="FBS">All FBS</option>
            <option value="P4">Power 4</option>
            <option value="G6">Group of 6</option>
            <option value="FCS">FCS</option>
            {conferences.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.84rem", paddingBottom: 6 }}>
          <input type="checkbox" checked={flipX} onChange={(e) => setFlipX(e.target.checked)} /> Flip X (better to the right)
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.84rem", paddingBottom: 6 }}>
          <input type="checkbox" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} /> Flip Y
        </label>
        <span style={{ marginLeft: "auto" }}>
          <ExportPngButton targetRef={exportRef} filename={() => `viz-${xKey}-vs-${yKey}`} showTweet={false} />
        </span>
      </div>
      {(xm.lowerIsBetter || ym.lowerIsBetter) && (
        <p className="admin-muted" style={{ fontSize: "0.8rem", marginTop: -6 }}>
          Power rating is lower-is-better (negative = stronger); flip that axis to put the best teams up and to the right.
        </p>
      )}

      <div ref={exportRef} className="admin-panel" style={{ position: "relative", padding: 8, overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }} role="img" aria-label={`${ym.label} vs ${xm.label}`}>
          <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="var(--a-inset, transparent)" />
          {niceTicks(x0, x1).map((v) => (
            <g key={`x${v}`}>
              <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke="var(--hash)" strokeWidth={1} />
              <text x={sx(v)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="var(--chalk-dim)">
                {fmt(xm, v)}
              </text>
            </g>
          ))}
          {niceTicks(y0, y1).map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="var(--hash)" strokeWidth={1} />
              <text x={PAD.l - 8} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--chalk-dim)">
                {fmt(ym, v)}
              </text>
            </g>
          ))}
          {mx != null && <line x1={sx(mx)} x2={sx(mx)} y1={PAD.t} y2={H - PAD.b} stroke="var(--chalk-dim)" strokeDasharray="4 4" strokeWidth={1} />}
          {my != null && <line x1={PAD.l} x2={W - PAD.r} y1={sy(my)} y2={sy(my)} stroke="var(--chalk-dim)" strokeDasharray="4 4" strokeWidth={1} />}
          <text x={(PAD.l + W - PAD.r) / 2} y={H - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--chalk)">
            {xm.label}
          </text>
          <text transform={`translate(16 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--chalk)">
            {ym.label}
          </text>
          {shown.map((p) => {
            const cx = sx(p.values[xKey] as number);
            const cy = sy(p.values[yKey] as number);
            const logo = TEAM_LOGOS[p.team];
            return (
              <g key={p.team} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                {logo ? (
                  <image href={logo} x={cx - LOGO / 2} y={cy - LOGO / 2} width={LOGO} height={LOGO} crossOrigin="anonymous" />
                ) : (
                  <circle cx={cx} cy={cy} r={5} fill="var(--chalk-dim)" />
                )}
                <title>{p.team}</title>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="admin-callout" style={{ position: "absolute", top: 12, right: 12, background: "var(--a-surface)", pointerEvents: "none" }}>
            <b>{hover.team}</b> · {hover.conf}
            <div>
              {xm.label}: {fmt(xm, hover.values[xKey])}
            </div>
            <div>
              {ym.label}: {fmt(ym, hover.values[yKey])}
            </div>
          </div>
        )}
      </div>
      <p className="admin-muted" style={{ fontSize: "0.8rem" }}>
        {shown.length} teams shown. Teams missing either metric are left out.
      </p>
    </div>
  );
}
