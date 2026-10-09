import { useEffect, useMemo, useState } from "react";
import { fetchDrogbaPicks, type DrogbaPickRow } from "../../lib/api/drogbaData";
import { gradePicks, summarizePicks } from "../../lib/drogba/picksGrading";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { atsColor, clvColor } from "../../lib/drogba/colors";
import { TIER_LABELS } from "../../lib/drogba/tiers";
import { CELL, DIM, H3, NUM, P, f1, pct, sgn, spreadLabel } from "./shared";

// What the model said while the line was open, graded against the open it was compared with AND the close.
export default function DrogbaPicksLogTab({ state }: { state: DrogbaState }) {
  const [picks, setPicks] = useState<DrogbaPickRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyFiltered, setOnlyFiltered] = useState(true);

  useEffect(() => {
    fetchDrogbaPicks().then(setPicks).catch((e) => setError(e?.message ?? "Failed to load the log"));
  }, []);

  const gameById = useMemo(() => new Map(state.games.map((g) => [g.id, g])), [state.games]);

  const graded = useMemo(() => gradePicks(picks ?? [], gameById, onlyFiltered), [picks, gameById, onlyFiltered]);

  const summarize = summarizePicks;
  const tierSummary = [
    { label: TIER_LABELS.power + " (primary)", ...summarize(graded.filter((r) => r.p.tier === "power")) },
    { label: TIER_LABELS.other + " (tracked)", ...summarize(graded.filter((r) => r.p.tier !== "power")) },
    { label: "All picks", ...summarize(graded) },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Picks log</h2>
      <p style={P}>
        Numbers saved from the This week tab while the line was open. The first save for a game is kept (it's a record of what the model said then); it only changes if you explicitly overwrite. Graded both ways: against the open
        the number was compared with, and against the closing line — plus how far the line moved toward the pick (closing-line value).
      </p>
      <label style={{ fontSize: "0.85rem" }}>
        <input type="checkbox" checked={onlyFiltered} onChange={(e) => setOnlyFiltered(e.target.checked)} /> Only picks that passed the filter
      </label>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {picks == null && !error && <p style={DIM}>Loading…</p>}
      {picks != null && (
        <>
          <h3 style={H3}>Record</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Group</th>
                  <th style={NUM}>Picks</th>
                  <th style={NUM}>vs open</th>
                  <th style={NUM}>ATS</th>
                  <th style={NUM}>vs close</th>
                  <th style={NUM}>Line moved to us</th>
                  <th style={NUM}>Closing-line value</th>
                </tr>
              </thead>
              <tbody>
                {tierSummary.map((t) => (
                  <tr key={t.label}>
                    <td style={{ ...CELL, fontWeight: t.label === "All picks" ? 700 : 400 }}>{t.label}</td>
                    <td style={NUM}>{t.n}</td>
                    <td style={NUM}>{t.open.w}–{t.open.l}</td>
                    <td style={{ ...NUM, color: atsColor(t.open.n ? t.open.pct : null), fontWeight: 700 }}>{t.open.n ? pct(t.open.pct) : "–"}</td>
                    <td style={NUM}>{t.close.w}–{t.close.l}</td>
                    <td style={NUM}>{t.movedOur} of {t.movedOur + t.movedAgainst}</td>
                    <td style={{ ...NUM, color: clvColor(t.clv), fontWeight: 700 }}>{t.clv == null ? "–" : sgn(t.clv, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Wk</th>
                  <th style={CELL}>Group</th>
                  <th style={CELL}>Matchup</th>
                  <th style={CELL}>Pick</th>
                  <th style={NUM}>Open</th>
                  <th style={NUM}>Close</th>
                  <th style={NUM}>DROGBA</th>
                  <th style={NUM}>Edge (pts)</th>
                  <th style={NUM}>Line moved to us</th>
                  <th style={CELL}>vs open</th>
                  <th style={CELL}>vs close</th>
                </tr>
              </thead>
              <tbody>
                {graded.map(({ p, g, result, vsClose, clv }) => (
                  <tr key={p.game_id}>
                    <td style={CELL}>{p.week}</td>
                    <td style={{ ...CELL, color: p.tier === "power" ? undefined : "var(--chalk-dim)" }}>{p.tier === "power" ? "Power" : "Other"}</td>
                    <td style={CELL}>{p.away_team} @ {p.home_team}</td>
                    <td style={CELL}>{p.side === "home" ? spreadLabel(p.home_team, p.open_spread!) : spreadLabel(p.away_team, -p.open_spread!)}</td>
                    <td style={NUM}>{f1(p.open_spread)}</td>
                    <td style={NUM}>{f1(g?.close)}</td>
                    <td style={NUM}>{f1(p.model_home_spread)}</td>
                    <td style={NUM}>{sgn(p.edge, 2)}</td>
                    <td style={{ ...NUM, color: clvColor(clv) }}>{sgn(clv, 1)}</td>
                    <td style={{ ...CELL, color: result === "W" ? "#8fd39a" : result === "L" ? "#e07a7a" : undefined, fontWeight: 700 }}>{result ?? "–"}</td>
                    <td style={{ ...CELL, color: vsClose === "W" ? "#8fd39a" : vsClose === "L" ? "#e07a7a" : undefined, fontWeight: 700 }}>{vsClose ?? "–"}</td>
                  </tr>
                ))}
                {graded.length === 0 && (
                  <tr>
                    <td style={CELL} colSpan={11}>Nothing logged yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
