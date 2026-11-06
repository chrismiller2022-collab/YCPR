import { describe, expect, it } from "vitest";
import { NFL_COMPOSITE_WEEK9_TEXT } from "../../data/nflCompositeRatings";
import { lotsFromField, newAuction } from "./engine";
import { emptyNflSeedSlots, nflFieldFromSlots } from "./formats";
import { DEFAULT_SIM, fairShares, payoutMatrix, simulateNflPlayoffs, SIM_PROP_KINDS } from "./nflPlayoffSim";
import { parseRatings } from "./ratings";
import { projectPot, roomMarkup } from "./value";

const AFC = ["BUF", "JAX", "NE", "KC", "CIN", "DEN", "HOU"];
const NFC = ["LAR", "CHI", "SEA", "DET", "SF", "MIN", "DAL"];

function auction() {
  let a = newAuction("Sim", "nfl_playoffs", 0);
  const slots = emptyNflSeedSlots().map((s) => ({ ...s, abbr: (s.conf === "AFC" ? AFC : NFC)[s.seed - 1] }));
  a = { ...a, field: nflFieldFromSlots(slots) };
  return { ...a, lots: lotsFromField(a.field, "seed") };
}
const ratings = parseRatings(NFL_COMPOSITE_WEEK9_TEXT).ratings;

describe("NFL playoff sim", () => {
  const a = auction();
  const sim = simulateNflPlayoffs({ ...DEFAULT_SIM, sims: 8000, field: a.field, ratings });

  it("has exactly one champion, 2 conf champs, 4 div winners per sim", () => {
    const sum = (r: number) => Object.values(sim.reach).reduce((s, x) => s + x[r], 0);
    expect(sum(3)).toBeCloseTo(1, 6);
    expect(sum(2)).toBeCloseTo(2, 6);
    expect(sum(1)).toBeCloseTo(4, 6);
    expect(sum(0)).toBeCloseTo(8, 6); // 6 WC winners + 2 byes
  });

  it("splits every side prize exactly once per sim", () => {
    for (const k of SIM_PROP_KINDS) expect(Object.values(sim.propProb[k]).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 4);
  });

  it("default payouts total 100% of the pot in every sim", () => {
    const m = payoutMatrix(sim, a);
    const T = sim.teamIds.length;
    for (let s = 0; s < 50; s++) {
      let t = 0;
      for (let i = 0; i < T; i++) t += m[s * T + i];
      expect(t).toBeCloseTo(100, 3);
    }
    const shares = fairShares(sim, m);
    expect(Object.values(shares).reduce((s, x) => s + x, 0)).toBeCloseTo(100, 3);
    expect(shares.LAR).toBeGreaterThan(shares.DAL);
  });

  it("favors better teams and only 5–7 seeds win Cinderella", () => {
    expect(sim.reach.LAR[3]).toBeGreaterThan(sim.reach.DAL[3]);
    expect(sim.propProb.cinderella.BUF).toBe(0);
    expect(sim.propProb.biggest_upset.HOU).toBeGreaterThan(sim.propProb.biggest_upset.BUF);
  });

  it("forces results already entered", () => {
    const s2 = simulateNflPlayoffs({ ...DEFAULT_SIM, sims: 2000, field: a.field, ratings, results: { HOU: { roundsCleared: 1, eliminated: false }, JAX: { roundsCleared: 0, eliminated: true } } });
    expect(s2.reach.HOU[0]).toBe(1);
    expect(s2.reach.JAX[0]).toBe(0);
  });

  it("projects the pot from the prior, then the room's pace", () => {
    const shares = fairShares(sim, payoutMatrix(sim, a));
    expect(projectPot(a, shares, 1000).projected).toBeCloseTo(1000);
    // Room pays 2x fair on the top lot → projection rises above the prior.
    const top = a.lots[0];
    const sold = { ...a, lots: a.lots.map((l) => (l.id === top.id ? { ...l, status: "sold" as const, price: (shares[top.teamIds[0]] / 100) * 2000, winnerId: "x" } : l)) };
    const p = projectPot(sold, shares, 1000);
    expect(p.roomPace).toBeCloseTo(2000);
    expect(p.projected).toBeGreaterThan(1000);
    expect(roomMarkup(sold, shares, 1000).byTier.fav.markup).toBeGreaterThan(1);
  });
});
