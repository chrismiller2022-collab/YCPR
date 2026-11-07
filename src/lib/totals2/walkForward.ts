// Totals v2's walk-forward numbers per game for 2023-26 (src/data/totals2WalkForward.json, written by train.ts --export):
// each season predicted only by fits on earlier seasons. Lazy-loaded — only the v2 History page needs it.
import type { EnrichedGameRow } from "../gameTotalsEngine";

export interface WalkForwardGame {
  move: number | null; // expected open → close move of the total
  residClose: number | null; // close model: expected (actual − closing total)
  residOpen: number | null; // open model: expected (actual − opening total)
  // The exact lines the numbers above were built against (the model's own book choice). Grading must use these: a
  // different book's "opening" line differs by a point or more and that gap would leak into the record.
  openTotal: number | null;
  openSpread: number | null; // home-relation
  closeTotal: number | null;
  closeSpread: number | null;
}

let cache: Promise<Map<string, WalkForwardGame>> | null = null;
export function loadWalkForward(): Promise<Map<string, WalkForwardGame>> {
  cache ??= import("../../data/totals2WalkForward.json").then((m: any) => {
    const out = new Map<string, WalkForwardGame>();
    for (const [id, mv, rc, ro, ot, os, ct, cs] of (m.default ?? m).games as (string | number | null)[][])
      out.set(String(id), {
        move: mv as number | null,
        residClose: rc as number | null,
        residOpen: ro as number | null,
        openTotal: (ot as number | null) ?? null,
        openSpread: (os as number | null) ?? null,
        closeTotal: (ct as number | null) ?? null,
        closeSpread: (cs as number | null) ?? null,
      });
    return out;
  });
  return cache;
}

/**
 * Rows for the v2 History page: every game's projected total becomes v2's — graded at the OPEN, the projected total is
 * the opening total + the expected line move (the ★ approach, so "amount off" is the edge); at the CLOSE, it is the
 * closing total + the close model's expected residual. Stored pre-kickoff numbers (row.v2) win over the walk-forward
 * file. Games with no v2 number are dropped, so no v1 number is ever graded here.
 */
export function toV2HistoryRows(rows: EnrichedGameRow[], wf: Map<string, WalkForwardGame>, gradeLine: "open" | "close"): EnrichedGameRow[] {
  const out: EnrichedGameRow[] = [];
  for (const r of rows) {
    if (!r.projection) continue;
    const st = r.v2;
    const w = wf.get(r.game.id);
    // Lines: the ones v2 was built against — stored (pre-kickoff) for this season, the walk-forward file's otherwise.
    const openTotal = st ? st.open_total : w?.openTotal ?? null;
    const openSpread = st ? st.open_spread : w?.openSpread ?? null;
    const closeTotal = st ? st.line_total : w?.closeTotal ?? null;
    const closeSpread = st ? st.line_spread : w?.closeSpread ?? null;
    const move = st ? st.move : w?.move ?? null;
    const resid = st ? st.resid_total : w?.residClose ?? null;
    const total = gradeLine === "open" ? (openTotal != null && move != null ? openTotal + move : null) : closeTotal != null && resid != null ? closeTotal + resid : null;
    if (total == null) continue;
    const game = { ...r.game, overUnder: closeTotal, openingOverUnder: openTotal, homeSpread: closeSpread, openingSpread: openSpread };
    out.push({
      ...r,
      game,
      odds: { ...r.odds, vegasTotal: closeTotal ?? openTotal, vegasTotalIsOpeningFallback: closeTotal == null && openTotal != null, openingTotal: openTotal, closingTotal: closeTotal },
      projection: { ...r.projection, projectedTotal: total },
    });
  }
  return out;
}
