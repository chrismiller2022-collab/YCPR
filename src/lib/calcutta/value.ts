import { highBid, lotHoldings, sortedLots } from "./engine";
import type { SimOutput } from "./nflPlayoffSim";
import type { CalcuttaAuction, Lot } from "./types";

// Desk money math. Everything is in "% of net pot" until it's multiplied
// by a pot estimate.
//
// Projected pot: before anything sells it's your prior (expected pot). As
// lots sell, the room's own pace — sold $ ÷ the share of total value sold —
// takes over in proportion to how much of the value is gone, and the final
// projection is sold $ + the unsold share at that blended rate.
//
// Room markup: price ÷ fair price for sold lots, by tier (favorites /
// middle / long shots, by fair share), shrunk toward 1 until a few lots in
// that tier have sold. Expected price of an unsold lot = fair × its tier's
// markup.

export function lotShare(lot: Lot, shares: Record<string, number>): number {
  return lot.teamIds.reduce((s, id) => s + (shares[id] ?? 0), 0);
}

export interface PotProjection {
  sold: number;
  /** Fraction (0–1) of total payout value already sold. */
  soldShare: number;
  /** Pot implied by the room's pace so far (null until ~2% of value sells). */
  roomPace: number | null;
  prior: number;
  projected: number;
}

export function projectPot(a: CalcuttaAuction, shares: Record<string, number>, prior: number): PotProjection {
  let sold = 0;
  let soldShare = 0;
  for (const l of a.lots) {
    if (l.status !== "sold") continue;
    sold += l.price ?? 0;
    soldShare += lotShare(l, shares) / 100;
  }
  soldShare = Math.min(1, soldShare);
  const roomPace = soldShare > 0.02 ? sold / soldShare : null;
  const rate = roomPace == null ? prior : soldShare * roomPace + (1 - soldShare) * prior;
  const unsold = a.lots.every((l) => l.status === "sold" || l.status === "unsold") ? 0 : 1 - soldShare;
  return { sold, soldShare, roomPace, prior, projected: sold + unsold * rate };
}

export type Tier = "fav" | "mid" | "long";
export const TIER_LABEL: Record<Tier, string> = { fav: "Favorites", mid: "Middle", long: "Long shots" };

/** Tier by fair-share rank among all lots (top third, middle, bottom third). */
export function lotTiers(a: CalcuttaAuction, shares: Record<string, number>): Record<string, Tier> {
  const ranked = [...a.lots].sort((x, y) => lotShare(y, shares) - lotShare(x, shares));
  const n = ranked.length;
  const out: Record<string, Tier> = {};
  ranked.forEach((l, i) => (out[l.id] = i < n / 3 ? "fav" : i < (2 * n) / 3 ? "mid" : "long"));
  return out;
}

export interface Markup {
  overall: number;
  byTier: Record<Tier, { markup: number; n: number }>;
}

const SHRINK_LOTS = 2;

export function roomMarkup(a: CalcuttaAuction, shares: Record<string, number>, netPot: number): Markup {
  const tiers = lotTiers(a, shares);
  const acc: Record<Tier, { price: number; fair: number; n: number }> = { fav: { price: 0, fair: 0, n: 0 }, mid: { price: 0, fair: 0, n: 0 }, long: { price: 0, fair: 0, n: 0 } };
  let price = 0;
  let fair = 0;
  for (const l of a.lots) {
    if (l.status !== "sold") continue;
    const f = (lotShare(l, shares) / 100) * netPot;
    const t = acc[tiers[l.id]];
    t.price += l.price ?? 0;
    t.fair += f;
    t.n++;
    price += l.price ?? 0;
    fair += f;
  }
  const shrink = (p: number, f: number, n: number) => {
    if (n === 0 || f <= 0) return 1;
    const avg = f / n;
    return (p + SHRINK_LOTS * avg) / (f + SHRINK_LOTS * avg);
  };
  const totalN = acc.fav.n + acc.mid.n + acc.long.n;
  return {
    overall: shrink(price, fair, totalN),
    byTier: {
      fav: { markup: shrink(acc.fav.price, acc.fav.fair, acc.fav.n), n: acc.fav.n },
      mid: { markup: shrink(acc.mid.price, acc.mid.fair, acc.mid.n), n: acc.mid.n },
      long: { markup: shrink(acc.long.price, acc.long.fair, acc.long.n), n: acc.long.n },
    },
  };
}

export interface LotValue {
  lot: Lot;
  share: number; // % of net pot
  fair: number; // $
  max: number; // $ (fair less required edge)
  expected: number; // $ (fair × room markup for its tier)
  tier: Tier;
  /** Sold lots: price ÷ fair. */
  paidRatio: number | null;
}

export function lotValues(a: CalcuttaAuction, shares: Record<string, number>, netPotEst: number, edgePct: number): LotValue[] {
  const tiers = lotTiers(a, shares);
  const mk = roomMarkup(a, shares, netPotEst);
  return sortedLots(a).map((lot) => {
    const share = lotShare(lot, shares);
    const fair = (share / 100) * netPotEst;
    const tier = tiers[lot.id];
    return {
      lot,
      share,
      fair,
      max: fair * (1 - edgePct / 100),
      expected: fair * mk.byTier[tier].markup,
      tier,
      paidRatio: lot.status === "sold" && fair > 0 ? (lot.price ?? 0) / fair : null,
    };
  });
}

export interface Portfolio {
  cost: number;
  ev: number;
  pProfit: number;
  p10: number;
  p50: number;
  p90: number;
  pieces: { lot: Lot; pct: number; cost: number; ev: number }[];
}

/**
 * A person's holdings (after splits) valued at `netPot`, with the full
 * payout distribution read off the sim. `extra` adds a hypothetical
 * purchase (the lot on the block at a given price).
 */
export function portfolio(
  a: CalcuttaAuction,
  sim: SimOutput,
  matrix: Float32Array,
  participantId: string,
  netPot: number,
  extra?: { lot: Lot; price: number } | null,
): Portfolio {
  const T = sim.teamIds.length;
  const col = new Map(sim.teamIds.map((id, i) => [id, i]));
  const pieces: Portfolio["pieces"] = [];
  for (const lot of sortedLots(a)) {
    if (lot.status !== "sold") continue;
    const h = lotHoldings(a, lot).find((x) => x.participantId === participantId);
    if (h && h.pct > 0) pieces.push({ lot, pct: h.pct, cost: h.cost, ev: 0 });
  }
  if (extra) pieces.push({ lot: extra.lot, pct: 100, cost: extra.price, ev: 0 });
  const cost = pieces.reduce((s, p) => s + p.cost, 0);
  const outcomes = new Float64Array(sim.sims);
  const cols = pieces.map((p) => p.lot.teamIds.map((id) => col.get(id)).filter((x) => x != null) as number[]);
  for (let s = 0; s < sim.sims; s++) {
    let v = 0;
    pieces.forEach((p, j) => {
      let pct = 0;
      for (const c of cols[j]) pct += matrix[s * T + c];
      const dollars = (pct / 100) * netPot * (p.pct / 100);
      p.ev += dollars;
      v += dollars;
    });
    outcomes[s] = v;
  }
  for (const p of pieces) p.ev /= sim.sims;
  const sorted = Array.from(outcomes).sort((x, y) => x - y);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 0;
  let wins = 0;
  for (const v of outcomes) if (v > cost) wins++;
  return {
    cost,
    ev: pieces.reduce((s, p) => s + p.ev, 0),
    pProfit: sim.sims ? wins / sim.sims : 0,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    pieces,
  };
}

/** Spend and buying pattern per attendee — who still has money, who overpays. */
export function roomTracker(a: CalcuttaAuction, values: LotValue[]) {
  return a.participants.map((p) => {
    const won = values.filter((v) => v.lot.status === "sold" && v.lot.winnerId === p.id);
    const spent = won.reduce((s, v) => s + (v.lot.price ?? 0), 0);
    const fair = won.reduce((s, v) => s + v.fair, 0);
    const bids = a.bids.filter((b) => b.participantId === p.id && !b.voided).length;
    const high = a.live.lotId ? highBid(a, a.live.lotId) : null;
    return { p, spent, fair, ratio: fair > 0 ? spent / fair : null, teams: won.length, bids, leading: high?.participantId === p.id };
  });
}
