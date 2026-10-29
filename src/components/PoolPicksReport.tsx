import { useMemo, useRef, useState } from "react";
import TeamLogo from "./TeamLogo";
import ExportPdfButton from "./ExportPdfButton";
import { usePoolReport, type PoolSlateGame } from "../lib/usePoolReport";
import { POOL_REPORT_WEIGHTS, suggestPicks, type Factor, type PoolPickRules, type ReportGame, type Side } from "../lib/poolReport";

export interface PoolReportOption {
  key: string;
  label: string;
  rules: PoolPickRules;
  // Why a game can't be picked in this pool (shown greyed out), or null if it can.
  ineligibleReason?: (g: ReportGame) => string | null;
}

export type ApplyMode = "clear" | "fill";

export interface AppliedPicks {
  poolKey: string;
  mode: ApplyMode;
  picks: { gameId: string; side: Side; key: boolean }[];
  // Every game id in report order (ranked first), for the page's "Report" sort.
  order: string[];
}

const fmtLine = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);

function factorColor(f: Factor): string | undefined {
  if (f.score == null || Math.abs(f.score) < 0.15) return "var(--chalk-dim)";
  return f.score > 0 ? "#8fd39a" : "#c45c52";
}

// Compact column headers for the ranked table — the cards below keep the full factor labels.
const FACTOR_HEADER: Record<string, string> = {
  edge: "Pool vs mine",
  vegas: "Pool vs Vegas",
  keysMine: "Keys mine ↔ pool",
  keysVegas: "Keys Vegas ↔ pool",
  role: "Role record",
  team: "Team record",
  named: "McI / JP+ / Con",
  totals: "Totals",
  systems: "All sys",
};

// Non-breaking hyphens so a record like 75-66-3 never splits across lines.
const noBreak = (s: string) => s.replace(/(\d)-(\d)/g, "$1\u2011$2");

const TIER_COLOR: Record<string, string> = { A: "#8fd39a", B: "#c9d38f", C: "var(--chalk-dim)", D: "#c45c52" };

export default function PoolPicksReport({
  season,
  week,
  title,
  slate,
  pools,
  onApply,
  onClose,
}: {
  season: number;
  week: number;
  title: string;
  slate: PoolSlateGame[];
  pools: PoolReportOption[];
  onApply: (applied: AppliedPicks) => void;
  onClose: () => void;
}) {
  const { report, ratingsWeek, loading, error } = usePoolReport(season, week, slate);
  const [poolKey, setPoolKey] = useState(pools[0].key);
  const [mode, setMode] = useState<ApplyMode>("clear");
  const exportRef = useRef<HTMLDivElement>(null);
  const pool = pools.find((p) => p.key === poolKey) ?? pools[0];

  const picks = useMemo(() => suggestPicks(report, pool.rules), [report, pool]);
  const pickById = useMemo(() => new Map(picks.map((p) => [p.gameId, p])), [picks]);
  const ranked = report.filter((g) => g.rank != null);
  const unranked = report.length - ranked.length;
  const factorKeys = ranked[0]?.factors.map((f) => f.key) ?? [];

  function apply() {
    onApply({ poolKey: pool.key, mode, picks, order: report.map((g) => g.input.gameId) });
    onClose();
  }

  // Fixed layout + wrapping keeps the whole table inside the popup's width — rows grow taller instead of scrolling sideways.
  const cell = { padding: "0.3rem 0.35rem", borderBottom: "1px solid var(--hash)", verticalAlign: "top" as const, overflowWrap: "break-word" as const };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 10,
          padding: "1.25rem",
          width: 1180,
          maxWidth: "96vw",
          maxHeight: "92vh",
          overflowY: "auto",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: "0.75rem", right: "0.75rem", background: "none", border: "none", color: "var(--chalk-dim)", fontSize: "1.2rem", lineHeight: 1, cursor: "pointer", padding: "0.25rem" }}
        >
          ✕
        </button>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem", paddingRight: "2rem" }}>
          {pools.length > 1 &&
            pools.map((p) => (
              <button key={p.key} className={`mode-btn ${p.key === poolKey ? "mode-btn-active" : ""}`} onClick={() => setPoolKey(p.key)}>
                {p.label}
              </button>
            ))}
          <span style={{ flex: 1 }} />
          <ExportPdfButton targetRef={exportRef} filename={() => `${pool.label.toLowerCase().replace(/\W+/g, "-")}-pool-report-${season}-wk${week}`} />
          <select value={mode} onChange={(e) => setMode(e.target.value as ApplyMode)} title="What happens to picks already on the page">
            <option value="clear">Clear & make picks</option>
            <option value="fill">Keep my picks, fill open slots</option>
          </select>
          <button onClick={apply} disabled={loading || picks.length === 0} title="Pick the suggested games and sort the page in report order — nothing is saved until you press Save">
            Sort & Make Picks
          </button>
        </div>

        <div ref={exportRef} style={{ background: "var(--turf-panel)", padding: "0.25rem" }}>
          <div style={{ fontWeight: 700 }}>
            {title} Pool Report — {pool.label}
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.75rem" }}>
            {season} · Week {week} · Suggested: top {pool.rules.picks} eligible
            {pool.rules.keyPicks > 0 ? `, #1 as key pick` : ""}
            {ratingsWeek != null && ratingsWeek !== week ? ` · Rating systems from saved Week ${ratingsWeek}` : ""}
            {ratingsWeek == null && !loading ? " · No saved rating-system snapshot" : ""}
          </div>

          {loading ? (
            <p style={{ color: "var(--chalk-dim)" }}>Loading season data…</p>
          ) : error ? (
            <p style={{ color: "crimson" }}>{error}</p>
          ) : ranked.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No open games with both a pool line and my line.</p>
          ) : (
            <>
              <div style={{ border: "1px solid var(--hash)", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", fontSize: "0.74rem" }}>
                  <colgroup>
                    <col style={{ width: "2.2rem" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "3.6rem" }} />
                    {factorKeys.map((k) => (
                      <col key={k} />
                    ))}
                    <col style={{ width: "4rem" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--chalk-dim)" }}>
                      <th style={cell}>#</th>
                      <th style={cell}>Game</th>
                      <th style={cell}>Side (pool line)</th>
                      <th style={cell}>Score</th>
                      {factorKeys.map((k) => (
                        <th key={k} style={cell}>
                          {FACTOR_HEADER[k]}
                        </th>
                      ))}
                      <th style={cell}>Pick</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((g) => {
                      const why = pool.ineligibleReason?.(g) ?? null;
                      const pick = pickById.get(g.input.gameId);
                      return (
                        <tr key={g.input.gameId} style={{ opacity: why ? 0.45 : 1, background: pick?.key ? "var(--gold-dim)" : pick ? "var(--a-tint-1)" : undefined }}>
                          <td style={cell}>{g.rank}</td>
                          <td style={cell}>
                            {g.input.away}
                            <br />@ {g.input.home}
                          </td>
                          <td style={{ ...cell, fontWeight: 700 }}>
                            <TeamLogo team={g.sideTeam!} size={14} /> {g.sideTeam} {fmtLine(g.sideLine)}
                          </td>
                          <td style={{ ...cell, fontWeight: 700 }}>
                            {g.score} <span style={{ color: TIER_COLOR[g.tier!] }}>{g.tier}</span>
                          </td>
                          {g.factors.map((f) => (
                            <td key={f.key} style={{ ...cell, color: factorColor(f), whiteSpace: "pre-line" }} title={f.detail}>
                              {noBreak(f.short)}
                            </td>
                          ))}
                          <td style={cell}>{why ? <span title={why}>ineligible</span> : pick ? (pick.key ? "🔑 Key" : "✅") : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {unranked > 0 && (
                <p style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", margin: "0.4rem 0 0" }}>
                  {unranked} game{unranked === 1 ? "" : "s"} not ranked (completed, no line, or my line equals the pool line).
                </p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
                {ranked.map((g) => {
                  const why = pool.ineligibleReason?.(g) ?? null;
                  const pick = pickById.get(g.input.gameId);
                  return (
                    <div key={g.input.gameId} style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.6rem 0.7rem", opacity: why ? 0.55 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontWeight: 700, fontSize: "0.82rem" }}>
                        <span>
                          #{g.rank} {g.sideTeam} {fmtLine(g.sideLine)}
                        </span>
                        <span>
                          {g.score} <span style={{ color: TIER_COLOR[g.tier!] }}>{g.tier}</span>
                          {pick ? (pick.key ? " · 🔑 Key" : " · ✅ Pick") : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginBottom: "0.35rem" }}>
                        {g.input.away} @ {g.input.home} · Pool {fmtLine(g.input.poolLine)} · Mine {fmtLine(g.input.myLine == null ? null : Math.round(g.input.myLine * 10) / 10)} · Vegas{" "}
                        {fmtLine(g.input.vegasLine)}
                        {why ? ` · ${why}` : ""}
                      </div>
                      {g.factors.map((f) => (
                        <div key={f.key} style={{ display: "flex", gap: "0.4rem", fontSize: "0.72rem", padding: "0.1rem 0" }}>
                          <span style={{ color: factorColor(f), minWidth: "1rem" }}>{f.score == null ? "·" : f.score > 0.15 ? "▲" : f.score < -0.15 ? "▼" : "•"}</span>
                          <span>
                            <span style={{ color: "var(--chalk-dim)" }}>{f.label}:</span> {f.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <p style={{ fontSize: "0.68rem", color: "var(--chalk-dim)", marginTop: "0.9rem" }}>
                Side = the team my line covers against the pool line. Score 0–100 is the weighted sum of each factor (
                {Object.entries(POOL_REPORT_WEIGHTS)
                  .map(([k, w]) => `${k} ${w}`)
                  .join(", ")}
                ). Season records are weeks before this one, FBS vs FBS, my model's picks graded ATS vs the Vegas closing line, pulled toward 50% so small samples
                can't dominate. Tiers: A ≥ 70, B ≥ 60, C ≥ 50, D below.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
