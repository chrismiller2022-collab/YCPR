import { useEffect, useMemo, useState } from "react";
import { fetchDrogbaPicks, type DrogbaPickRow } from "../../lib/api/drogbaData";
import { margin } from "../../lib/drogba/dataset";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
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

  const graded = useMemo(() => {
    return (picks ?? [])
      .filter((p) => p.side && p.open_spread != null && (!onlyFiltered || p.filtered))
      .map((p) => {
        const g = gameById.get(p.game_id);
        const side = p.side === "home" ? 1 : -1;
        let result: "W" | "L" | "P" | null = null;
        let vsClose: "W" | "L" | "P" | null = null;
        let clv: number | null = null;
        if (g?.completed) {
          const c = side * (margin(g) + p.open_spread!);
          result = c > 0 ? "W" : c < 0 ? "L" : "P";
          if (g.close != null) {
            const cc = side * (margin(g) + g.close);
            vsClose = cc > 0 ? "W" : cc < 0 ? "L" : "P";
          }
        }
        if (g?.close != null) clv = side * (p.open_spread! - g.close);
        return { p, g, result, vsClose, clv };
      });
  }, [picks, gameById, onlyFiltered]);

  const tally = (key: "result" | "vsClose") => {
    const w = graded.filter((r) => r[key] === "W").length;
    const l = graded.filter((r) => r[key] === "L").length;
    return { w, l, pct: w + l ? (100 * w) / (w + l) : 0 };
  };
  const open = tally("result");
  const close = tally("vsClose");
  const clvRows = graded.filter((r) => r.clv != null);
  const avgClv = clvRows.length ? clvRows.reduce((a, r) => a + r.clv!, 0) / clvRows.length : null;
  const movedOurWay = clvRows.filter((r) => r.clv! > 0).length;
  const movedAgainst = clvRows.filter((r) => r.clv! < 0).length;

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
          <p style={P}>
            vs open: <strong>{open.w}–{open.l}</strong> ({pct(open.pct)}) · vs close: <strong>{close.w}–{close.l}</strong> ({pct(close.pct)}) · line moved our way in {movedOurWay} of {movedOurWay + movedAgainst} games that moved, average {sgn(avgClv, 2)} pts
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Wk</th>
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
                    <td style={CELL}>{p.away_team} @ {p.home_team}</td>
                    <td style={CELL}>{p.side === "home" ? spreadLabel(p.home_team, p.open_spread!) : spreadLabel(p.away_team, -p.open_spread!)}</td>
                    <td style={NUM}>{f1(p.open_spread)}</td>
                    <td style={NUM}>{f1(g?.close)}</td>
                    <td style={NUM}>{f1(p.model_home_spread)}</td>
                    <td style={NUM}>{sgn(p.edge, 2)}</td>
                    <td style={NUM}>{sgn(clv, 1)}</td>
                    <td style={CELL}>{result ?? "–"}</td>
                    <td style={CELL}>{vsClose ?? "–"}</td>
                  </tr>
                ))}
                {graded.length === 0 && (
                  <tr>
                    <td style={CELL} colSpan={10}>Nothing logged yet.</td>
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
