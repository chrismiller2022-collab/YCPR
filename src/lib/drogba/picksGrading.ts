// Grades logged DROGBA picks against the open they were compared with and against the close, and summarizes groups of them.
import { margin, type DGame } from "./dataset";
import type { DrogbaPickRow } from "../api/drogbaData";

export interface GradedPick {
  p: DrogbaPickRow;
  g: DGame | undefined;
  result: "W" | "L" | "P" | null; // vs the open the pick was made at
  vsClose: "W" | "L" | "P" | null;
  clv: number | null; // points the line moved toward the pick, open → close
}

export function gradePicks(picks: DrogbaPickRow[], gameById: Map<string, DGame>, onlyFiltered: boolean): GradedPick[] {
  return picks
    .filter((p) => p.side && p.open_spread != null && (!onlyFiltered || p.filtered))
    .map((p) => {
      const g = gameById.get(p.game_id);
      const side = p.side === "home" ? 1 : -1;
      let result: GradedPick["result"] = null;
      let vsClose: GradedPick["vsClose"] = null;
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
}

export interface PickSummary {
  n: number;
  open: { w: number; l: number; n: number; pct: number };
  close: { w: number; l: number; n: number; pct: number };
  clv: number | null;
  movedOur: number;
  movedAgainst: number;
}

export function summarizePicks(rows: GradedPick[]): PickSummary {
  const count = (key: "result" | "vsClose") => {
    const w = rows.filter((r) => r[key] === "W").length;
    const l = rows.filter((r) => r[key] === "L").length;
    return { w, l, n: w + l, pct: w + l ? (100 * w) / (w + l) : 0 };
  };
  const clvRows = rows.filter((r) => r.clv != null);
  return {
    n: rows.length,
    open: count("result"),
    close: count("vsClose"),
    clv: clvRows.length ? clvRows.reduce((a, r) => a + r.clv!, 0) / clvRows.length : null,
    movedOur: clvRows.filter((r) => r.clv! > 0).length,
    movedAgainst: clvRows.filter((r) => r.clv! < 0).length,
  };
}
