import { useState } from "react";
import { computeSosForPastWeek, type SosRow } from "../lib/sosCompute";
import { saveSosToSite } from "../lib/api/ratingSystems";
import { DEFAULT_SOS_WEIGHTS } from "../lib/sosBlend";

// Backfill past SOS weeks (weeks saved before the SOS Blend existed, or never saved): recomputes each week from what
// was known going into it, shows the numbers, and writes only when you click Save.

type Preview = { week: number; rows: SosRow[]; saveRows: any[]; ratedTeams: number; ycTeams: number };

const f = (v: number | null | undefined, d = 2) => (v == null ? "–" : v.toFixed(d));

export default function SosBackfillSection({ season, onSaved }: { season: number; onSaved: () => void }) {
  const [weeksText, setWeeksText] = useState("1,2,3,4");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showWeek, setShowWeek] = useState<number | null>(null);

  const weeks = weeksText
    .split(/[ ,]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => n >= 1);

  async function compute() {
    setBusy(true);
    setMsg(null);
    try {
      const out: Preview[] = [];
      for (const w of weeks) {
        await new Promise((r) => setTimeout(r, 0)); // let the "Computing" state paint between weeks
        out.push({ week: w, ...(await computeSosForPastWeek(season, w, DEFAULT_SOS_WEIGHTS)) });
      }
      setPreviews(out);
      setShowWeek(out[0]?.week ?? null);
    } catch (e: any) {
      setMsg(e.message ?? "Couldn't compute");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!window.confirm(`Save SOS for week${previews.length > 1 ? "s" : ""} ${previews.map((p) => p.week).join(", ")}? This replaces anything already saved for those weeks.`)) return;
    setBusy(true);
    try {
      for (const p of previews) await saveSosToSite(season, p.week, p.saveRows);
      setMsg(`Saved weeks ${previews.map((p) => p.week).join(", ")}.`);
      onSaved();
    } catch (e: any) {
      setMsg(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const shown = previews.find((p) => p.week === showWeek);
  const fbs = shown ? shown.saveRows.filter((r) => r.div === "FBS").sort((a, b) => (a.blendScore ?? 99) - (b.blendScore ?? 99)) : [];

  return (
    <div style={{ marginTop: "1.5rem", padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf-panel)" }}>
      <div className="section-label" style={{ marginBottom: "0.4rem" }}>Backfill past weeks</div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Each week uses that week's saved power ratings and saved YC, and only results played before it. Default blend weights. Nothing is written until you
        click Save.
      </p>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.82rem" }}>
          Weeks <input value={weeksText} onChange={(e) => setWeeksText(e.target.value)} style={{ width: 110 }} />
        </label>
        <button className="menu-btn" onClick={compute} disabled={busy || weeks.length === 0}>
          {busy && previews.length === 0 ? "Computing…" : "Compute"}
        </button>
        {previews.length > 0 && (
          <button className="menu-btn" onClick={save} disabled={busy}>
            Save {previews.length} week{previews.length > 1 ? "s" : ""} to site
          </button>
        )}
        {msg && <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{msg}</span>}
      </div>
      {previews.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "0.4rem", margin: "0.6rem 0" }}>
            {previews.map((p) => (
              <button key={p.week} className={`mode-btn ${showWeek === p.week ? "mode-btn-active" : ""}`} onClick={() => setShowWeek(p.week)}>
                Week {p.week}
              </button>
            ))}
          </div>
          {shown && (
            <>
              <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.4rem" }}>
                {shown.ratedTeams} teams with saved ratings, {shown.ycTeams} with saved YC. FBS, hardest first.
              </div>
              <div style={{ overflowX: "auto", maxHeight: 420 }}>
                <table className="hfa-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Team</th>
                      <th className="th-right">Blend</th>
                      <th className="th-right">Avg opp PR</th>
                      <th className="th-right">SOS (SRS)</th>
                      <th className="th-right">#12 team wins</th>
                      <th className="th-right">Top 7</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fbs.map((r, i) => (
                      <tr key={r.team}>
                        <td>{i + 1}</td>
                        <td>{r.team}</td>
                        <td className="td-right">{f(r.blendScore)}</td>
                        <td className="td-right">{f(r.avgOppYcTotal)}</td>
                        <td className="td-right">{f(r.sosSrsTotal)}</td>
                        <td className="td-right">{f(r.hypoWins)}</td>
                        <td className="td-right">{f(r.top7)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
