// DROGBA vs YC (the site's own consensus projections): when both say the same side of the opening line, do the bets do
// better than when they disagree? DROGBA is independent of YC (it never sees it); this only compares the two afterwards.
// YC history: 2024-25 from the static Bet History file, 2026 from game_projection_locks.
import { margin, type DGame } from "./dataset";
import { fitLayer1, predictLayer1, EDGE_CAP, type GameSignals } from "./model";
import { gameTier, type Tier } from "./tiers";

export interface BetHistoryProjection {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  prediction: number | null; // YC's projected HOME spread (negative = home favored)
}
export interface LockProjection {
  game_id: string;
  my_away_spread: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Game id -> YC's projected home spread. In the Bet History file, 2025 weeks 10+ store `prediction` with the opposite
// sign from every other row (checked against the closing line: 100% flipped from week 10 on), so it is un-flipped here.
export function ycSpreadByGame(games: DGame[], history: BetHistoryProjection[], locks: LockProjection[]): Map<string, number> {
  const out = new Map<string, number>();
  const byKey = new Map(games.map((g) => [`${g.season}|${norm(g.home)}|${norm(g.away)}`, g]));
  for (const b of history) {
    if (b.prediction == null) continue;
    const g = byKey.get(`${b.season}|${norm(b.homeTeam)}|${norm(b.awayTeam)}`);
    if (g) out.set(g.id, (b.season === 2025 && b.week >= 10 ? -1 : 1) * b.prediction);
  }
  for (const l of locks) if (l.my_away_spread != null) out.set(l.game_id, -l.my_away_spread);
  return out;
}

export interface AgreementRow {
  g: DGame;
  tier: Tier;
  eD: number; // DROGBA edge vs the open (capped), positive = home side
  eY: number; // YC edge vs the open, positive = home side
  cover: number; // points the HOME side covered the open by
  clvHome: number | null; // open − close: points the line moved toward the home side
}

// Walk-forward: each season's DROGBA numbers come from a model fit only on earlier seasons.
export function buildAgreementRows(signals: GameSignals[], yc: Map<string, number>, seasons: number[]): AgreementRow[] {
  const rows: AgreementRow[] = [];
  for (const S of seasons) {
    const l1 = fitLayer1(signals.filter((s) => s.g.season < S && s.g.completed));
    if (!l1) continue;
    for (const s of signals) {
      if (s.g.season !== S || !s.g.completed || s.g.open == null) continue;
      const y = yc.get(s.g.id);
      if (y == null) continue;
      const m = predictLayer1(l1, s);
      if (m == null) continue;
      const open = s.g.open;
      rows.push({
        g: s.g,
        tier: gameTier(s.g),
        eD: Math.max(-EDGE_CAP, Math.min(EDGE_CAP, m + open)),
        eY: -y + open,
        cover: margin(s.g) + open,
        clvHome: s.g.close == null ? null : open - s.g.close,
      });
    }
  }
  return rows;
}

export type AgreeSet = "all" | "agree" | "agreeStrong" | "disagree";
export const AGREE_LABELS: Record<AgreeSet, string> = {
  all: "All DROGBA picks",
  agree: "YC on the same side",
  agreeStrong: "YC on the same side by 1.5+",
  disagree: "YC on the other side",
};
export const YC_STRONG = 1.5;

export interface AgreeStat {
  n: number;
  w: number;
  l: number;
  atsPct: number | null;
  clv: number | null;
}

export function agreementStat(rows: AgreementRow[], tier: Tier | "all", minEdge: number, set: AgreeSet): AgreeStat {
  let w = 0, l = 0, clv = 0, nc = 0, n = 0;
  for (const r of rows) {
    if (tier !== "all" && r.tier !== tier) continue;
    if (r.eD === 0 || Math.abs(r.eD) < minEdge) continue;
    const sd = Math.sign(r.eD);
    const ycSame = Math.sign(r.eY) === sd;
    const ycOpp = Math.sign(r.eY) === -sd;
    if (set === "agree" && !ycSame) continue;
    if (set === "agreeStrong" && !(ycSame && Math.abs(r.eY) >= YC_STRONG)) continue;
    if (set === "disagree" && !ycOpp) continue;
    n++;
    const c = sd * r.cover;
    if (c > 0) w++;
    else if (c < 0) l++;
    if (r.clvHome != null) {
      clv += sd * r.clvHome;
      nc++;
    }
  }
  return { n, w, l, atsPct: w + l ? (100 * w) / (w + l) : null, clv: nc ? clv / nc : null };
}
