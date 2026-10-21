import { useRef, useState, type CSSProperties } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLogo from "../components/TeamLogo";
import PollComparisonGraphic from "../components/PollComparisonGraphic";
import { usePollComparison } from "../lib/usePollComparison";
import { POLL_LABELS, type CompareLabel, type PollComparison, type PollKey } from "../lib/pollComparison";
import { exportNodeAsPng } from "../lib/exportPng";

// Admin > Reports > Poll vs Résumé: "How did the AP poll / committee do?"
// Pulls the week's polls (CFBD, ESPN fallback) and compares the chosen poll's
// top 25 to both of my résumé rankings, with the capture-ready graphic.

const panel: CSSProperties = { padding: "1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 };
const th: CSSProperties = { textAlign: "right", padding: "4px 8px", fontSize: "0.72rem", color: "var(--chalk-dim)", borderBottom: "1px solid var(--hash)" };
const td: CSSProperties = { textAlign: "right", padding: "3px 8px", fontSize: "0.85rem" };

function diffColor(d: number | null) {
  if (d == null || d === 0) return undefined;
  return d > 0 ? "#5aa869" : "#c45c52";
}

function ComparisonTable({ title, cmp, short }: { title: string; cmp: PollComparison | null; short: string }) {
  if (!cmp) return <div style={panel}>{title}: no résumé ranks saved for this week.</div>;
  const fmt = (r: { team: string; diff: number | null }) => `${r.team} (${r.diff! > 0 ? "+" : ""}${r.diff})`;
  return (
    <div style={{ ...panel, flex: 1, minWidth: 380 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
        <span>
          Spearman <b>{cmp.spearman == null ? "–" : cmp.spearman.toFixed(3)}</b> <span style={{ color: "var(--chalk-dim)" }}>(n={cmp.spearmanN})</span>
        </span>
        <span>
          Top-25 overlap <b>{cmp.overlap}/25</b>
        </span>
        <span>
          Mean |diff| <b>{cmp.meanAbsDiff == null ? "–" : cmp.meanAbsDiff.toFixed(1)}</b>
        </span>
      </div>
      <div style={{ fontSize: "0.85rem", marginBottom: "0.6rem", lineHeight: 1.5 }}>
        <div>
          <b style={{ color: "#5aa869" }}>Most over-ranked by {short}:</b> {cmp.mostOverRanked.slice(0, 5).map(fmt).join(", ") || "–"}
        </div>
        <div>
          <b style={{ color: "#c45c52" }}>Most under-ranked by {short}:</b> {cmp.mostUnderRanked.slice(0, 5).map(fmt).join(", ") || "–"}
        </div>
        <div>
          <b>My top 25, unranked by {short}:</b> {cmp.myTop25NotInPoll.map((r) => `${r.team} (#${r.myRank})`).join(", ") || "–"}
        </div>
        <div>
          <b>{short} top 25, outside my top 25:</b> {cmp.pollTop25NotInMine.map((r) => `${r.team} (${short} #${r.pollRank}, me #${r.myRank ?? "–"})`).join(", ") || "–"}
        </div>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Team</th>
            <th style={th}>{short}</th>
            <th style={th}>Mine</th>
            <th style={th}>Diff</th>
            <th style={{ ...th, textAlign: "left" }}>Top {cmp.topN}</th>
          </tr>
        </thead>
        <tbody>
          {cmp.rows.map((r) => (
            <tr key={r.team}>
              <td style={{ ...td, textAlign: "left" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <TeamLogo team={r.team} size={16} />
                  {r.team}
                </span>
              </td>
              <td style={td}>{r.pollRank ?? "–"}</td>
              <td style={td}>{r.myRank ?? "–"}</td>
              <td style={{ ...td, fontWeight: 700, color: diffColor(r.diff) }}>{r.diff == null ? "–" : `${r.diff > 0 ? "+" : ""}${r.diff}`}</td>
              <td style={{ ...td, textAlign: "left", fontSize: "0.75rem" }}>
                {r.myTopNotPollTop ? <span style={{ color: "#f2c14e" }}>deserves in</span> : r.pollTopNotMyTop ? <span style={{ color: "#6fb6ff" }}>shouldn't be in</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PollComparisonAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [poll, setPoll] = useState<PollKey | undefined>(undefined);
  const [which, setWhich] = useState<CompareLabel>("Resume So Far");
  const graphicRef = useRef<HTMLDivElement>(null);

  const r = usePollComparison(season, week, { poll });
  const short = r.pollKey === "cfp" ? "CFP" : r.pollKey === "coaches" ? "Coaches" : "AP";
  const cmp = which === "Resume So Far" ? r.soFar : r.projected;
  const header = r.pollKey === "cfp" ? "How did the committee do?" : `How did the ${short} poll do?`;

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: "1rem" }}>
        ← Back
      </button>
      <h2 style={{ marginTop: 0 }}>Poll vs Résumé</h2>
      <div style={{ ...panel, display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
        </label>
        <label>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Poll{" "}
          <select value={r.pollKey ?? ""} onChange={(e) => setPoll(e.target.value as PollKey)} disabled={r.availablePolls.length === 0}>
            {r.availablePolls.map((k) => (
              <option key={k} value={k}>
                {POLL_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          {r.loading ? "Loading…" : r.polls ? `Source: ${r.polls.source.toUpperCase()} · So Far wk ${r.soFarWeek ?? "–"} · Projected wk ${r.projectedWeek ?? "–"}` : ""}
        </span>
      </div>
      {r.error && <div style={{ ...panel, color: "#c45c52", marginBottom: "1rem" }}>{r.error}</div>}
      {r.polls && (r.polls.notes.length > 0 || r.polls.unmatched.length > 0) && (
        <div style={{ ...panel, fontSize: "0.8rem", marginBottom: "1rem" }}>
          {r.polls.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {r.polls.unmatched.length > 0 && <div style={{ color: "#e0a95f" }}>Unmatched poll names: {r.polls.unmatched.join(", ")}</div>}
        </div>
      )}
      {r.polls && !r.pollKey && !r.loading && <div style={{ ...panel, marginBottom: "1rem" }}>No polls found for {season} week {week}.</div>}

      {r.pollKey && (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "flex-start" }}>
            <ComparisonTable title={`${POLL_LABELS[r.pollKey]} vs Resume So Far`} cmp={r.soFar} short={short} />
            <ComparisonTable title={`${POLL_LABELS[r.pollKey]} vs Projected Resume`} cmp={r.projected} short={short} />
          </div>

          <div style={{ ...panel, marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <b>Graphic</b>
              {(["Resume So Far", "Projected Resume"] as CompareLabel[]).map((l) => (
                <button key={l} onClick={() => setWhich(l)} style={{ fontWeight: which === l ? 800 : 400 }}>
                  {l}
                </button>
              ))}
              <button
                disabled={!cmp}
                onClick={() => graphicRef.current && exportNodeAsPng(graphicRef.current, `poll-vs-${which === "Resume So Far" ? "sofar" : "projected"}-${r.pollKey}-wk${week}`, undefined, undefined, false, undefined, false)}
              >
                Download PNG
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              {cmp ? (
                <div ref={graphicRef} style={{ width: "fit-content" }}>
                  <PollComparisonGraphic
                    pollName={POLL_LABELS[r.pollKey]}
                    pollShortName={short}
                    compareLabel={which}
                    rows={cmp.rows}
                    eyebrow={`Week ${week} · ${season}`}
                    header={header}
                    stats={{ overlap: cmp.overlap, spearman: cmp.spearman }}
                    topN={cmp.topN}
                  />
                </div>
              ) : (
                <div>No {which} ranks for this week.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
