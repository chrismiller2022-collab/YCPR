import type { CSSProperties } from "react";
import { TEAM_LOGOS } from "../data/logos";
import { POLL_DIFF_CLAMP, clampDiff, type CompareLabel, type PollComparisonRow } from "../lib/pollComparison";

// "How did the AP poll / committee do?" — every poll top-25 team placed on a
// number line by diff = YCPR rank - poll rank. Left (red) = UNDER-RANKED by
// the poll (the résumé has them higher), right (green) = OVER-RANKED. Diffs
// beyond ±14 sit in the end columns, labeled "14+". Teams in YCPR's top 25
// that the poll leaves out entirely get their own strip underneath.
//
// Capture-ready like CompactPowerRatingsGraphic: fixed width, own header and
// footer baked in (pass includeBranding:false to exportNodeAsPng/Blob), and
// no page-relative CSS, so it renders the same off-screen.

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";
const WIDTH = 1600;
const PAD_X = 40;
const COLS = POLL_DIFF_CLAMP * 2 + 1;
const COL_W = (WIDTH - PAD_X * 2) / COLS;
const LOGO = 40;
const ITEM_H = LOGO + 22;

const RED = "#d0584c";
const GREEN = "#4fae66";
const GOLD = "#f2c14e";
const BLUE = "#6fb6ff";

function ringStyle(r: PollComparisonRow): CSSProperties {
  const color = r.myTopNotPollTop ? GOLD : r.pollTopNotMyTop ? BLUE : null;
  return {
    width: LOGO + 8,
    height: LOGO + 8,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // Light disc behind every logo so dark logos (Ohio State, Notre Dame…) read on the navy/gradient.
    background: "#f4f2ec",
    border: color ? `4px solid ${color}` : "2px solid rgba(255,255,255,0.35)",
    boxShadow: color ? `0 0 12px ${color}` : "0 1px 3px rgba(0,0,0,0.35)",
    boxSizing: "border-box",
  };
}

function Logo({ team, size = LOGO }: { team: string; size?: number }) {
  const src = TEAM_LOGOS[team];
  if (src) return <img src={src} alt={team} width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {team.slice(0, 4).toUpperCase()}
    </div>
  );
}

function numberColor(d: number): string {
  if (d === 0) return "#fff";
  const t = Math.abs(d) / POLL_DIFF_CLAMP;
  const alpha = 0.55 + 0.45 * t;
  return d < 0 ? `rgba(240,120,108,${alpha})` : `rgba(110,205,132,${alpha})`;
}

export default function PollComparisonGraphic({
  pollName,
  compareLabel,
  rows,
  eyebrow,
  header,
  stats,
  pollShortName,
  topN = 12,
}: {
  /** e.g. "AP Poll" / "CFP Committee". */
  pollName: string;
  compareLabel: CompareLabel;
  /** PollComparison.rows from computePollComparison (the union; poll top-25 teams are plotted, my top-25-only teams go in the strip). */
  rows: PollComparisonRow[];
  /** Small gold uppercase label, e.g. "WEEK 8 · 2026". */
  eyebrow: string;
  /** Title, e.g. "HOW DID THE AP POLL DO?". */
  header: string;
  /** Optional stat line under the subtitle. */
  stats?: { overlap: number; spearman: number | null };
  /** Short poll name for the legend/chips, e.g. "AP" / "CFP". Defaults to the first word of pollName. */
  pollShortName?: string;
  /** The in/out line the markers were computed with (for the legend text). */
  topN?: number;
}) {
  const short = pollShortName ?? pollName.split(" ")[0];
  const plotted = rows.filter((r) => r.pollRank != null && r.diff != null);
  const missingMine = rows.filter((r) => r.pollRank != null && r.diff == null); // poll team with no résumé rank at all
  const leftOut = rows.filter((r) => r.inMyTop25 && !r.inPollTop25).sort((a, b) => (a.myRank as number) - (b.myRank as number));

  const columns = new Map<number, PollComparisonRow[]>();
  for (const r of plotted) {
    const c = clampDiff(r.diff as number);
    const list = columns.get(c) ?? [];
    list.push(r);
    columns.set(c, list);
  }
  for (const list of columns.values()) list.sort((a, b) => (a.pollRank as number) - (b.pollRank as number));
  const maxStack = Math.max(4, ...Array.from(columns.values()).map((l) => l.length));
  const plotH = maxStack * ITEM_H + 18;
  const diffs = Array.from({ length: COLS }, (_, i) => i - POLL_DIFF_CLAMP);

  return (
    <div style={{ width: WIDTH, background: "#1f2041", padding: `26px ${PAD_X}px 18px`, boxSizing: "border-box", fontFamily: "inherit", color: "#fff" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", color: "var(--gold, #d9a441)", textTransform: "uppercase", marginBottom: 6 }}>{eyebrow}</div>
        <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.05 }}>{header}</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.75)", marginTop: 8 }}>
          {pollName} compared to YCPR {compareLabel}
        </div>
        {stats && (
          <div style={{ display: "inline-flex", gap: 22, marginTop: 10, fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>
            <span>
              Top-25 overlap <span style={{ color: "#fff" }}>{stats.overlap}/25</span>
            </span>
            <span>
              Rank correlation <span style={{ color: "#fff" }}>{stats.spearman == null ? "–" : stats.spearman.toFixed(2)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Plot: gradient band with logo stacks rising from the axis */}
      <div style={{ position: "relative", height: plotH, borderRadius: "10px 10px 0 0", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(90deg, rgba(208,88,76,0.62) 0%, rgba(208,88,76,0.18) 40%, rgba(255,255,255,0.10) 50%, rgba(79,174,102,0.18) 60%, rgba(79,174,102,0.62) 100%)`,
          }}
        />
        {/* zero line */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: POLL_DIFF_CLAMP * COL_W + COL_W / 2 - 1, width: 2, background: "rgba(255,255,255,0.35)" }} />
        {diffs.map((d, i) => {
          const list = columns.get(d) ?? [];
          return (
            <div key={d} style={{ position: "absolute", left: i * COL_W, width: COL_W, bottom: 6, display: "flex", flexDirection: "column-reverse", alignItems: "center" }}>
              {list.map((r) => (
                <div key={r.team} style={{ height: ITEM_H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <div style={ringStyle(r)}>
                    <Logo team={r.team} size={LOGO - 8} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", lineHeight: "14px", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    {r.pollRank}
                    <span style={{ color: "rgba(255,255,255,0.6)" }}>→</span>
                    {r.myRank}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Number line */}
      <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderTop: "3px solid rgba(255,255,255,0.5)", borderRadius: "0 0 10px 10px" }}>
        {diffs.map((d) => {
          const end = Math.abs(d) === POLL_DIFF_CLAMP;
          return (
            <div key={d} style={{ width: COL_W, textAlign: "center", padding: "8px 0 6px", fontSize: end ? 22 : 26, fontWeight: 900, color: numberColor(d) }}>
              {Math.abs(d)}
              {end ? "+" : ""}
            </div>
          );
        })}
      </div>

      {/* Direction labels */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <div style={{ width: "40%" }}>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "0.04em", color: RED }}>◀ UNDER-RANKED</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{short} has them lower than their résumé says</div>
        </div>
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.05em", textTransform: "uppercase", lineHeight: 1.5 }}>
          Spots between {short} rank and YCPR rank
          <br />
          label: {short} rank → YCPR rank
        </div>
        <div style={{ width: "40%", textAlign: "right" }}>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "0.04em", color: GREEN }}>OVER-RANKED ▶</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{short} has them higher than their résumé says</div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "center", gap: 36, marginTop: 16, fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", border: `3px solid ${GOLD}`, boxShadow: `0 0 8px ${GOLD}`, boxSizing: "border-box" }} />
          In YCPR top {topN}, not {short} top {topN} — deserves to be in
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", border: `3px solid ${BLUE}`, boxShadow: `0 0 8px ${BLUE}`, boxSizing: "border-box" }} />
          In {short} top {topN}, not YCPR top {topN} — doesn't deserve to be
        </span>
      </div>

      {/* YCPR top 25 the poll left out */}
      {leftOut.length > 0 && (
        <div style={{ marginTop: 18, padding: "12px 16px", background: "rgba(255,255,255,0.05)", borderRadius: 10, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: "var(--gold, #d9a441)", textTransform: "uppercase", lineHeight: 1.3, width: 170, flexShrink: 0 }}>
            YCPR top 25
            <br />
            unranked by {short}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {leftOut.map((r) => (
              <div key={r.team} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 56 }}>
                <div style={ringStyle(r)}>
                  <Logo team={r.team} size={30} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>YC #{r.myRank}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {missingMine.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
          No YCPR {compareLabel.toLowerCase()} rank: {missingMine.map((r) => `${r.team} (${short} #${r.pollRank})`).join(", ")}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          paddingTop: 10,
          marginTop: 16,
          borderTop: "1px solid rgba(255,255,255,0.15)",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.55)" }}>YC POWER RATINGS</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{SITE_URL}</span>
        <span style={{ color: "var(--gold, #d9a441)" }}>{TWITTER_HANDLE}</span>
      </div>
    </div>
  );
}
