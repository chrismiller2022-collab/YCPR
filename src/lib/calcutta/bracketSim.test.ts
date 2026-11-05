import { describe, expect, it } from "vitest";
import { lotsFromField, newAuction, bundleBySeed } from "./engine";
import { cfbFieldFromSeeds, parseMadnessField } from "./fields";
import { payoutTotalPct } from "./formats";
import { fairShares, payoutMatrix, simulateBracket, validateField } from "./bracketSim";
import { deriveFromGames } from "./scoring";
import type { CalcuttaAuction, FieldTeam, FormatKey } from "./types";

function madnessText(): string {
  const regs = ["East", "West", "South", "Midwest"];
  const lines: string[] = [];
  regs.forEach((r, ri) => {
    lines.push(r);
    for (let s = 1; s <= 16; s++) {
      lines.push(`${s} ${r} Seed${s} 12.3`); // trailing rating is ignored
      if ((s === 16 && ri < 2) || (s === 11 && ri >= 2)) lines.push(`${s} ${r} Seed${s}b`);
    }
  });
  return lines.join("\n");
}

function auction(format: FormatKey, field: FieldTeam[], regions?: string[]): CalcuttaAuction {
  const a = newAuction("t", format, 0);
  return { ...a, field, regions, lots: lotsFromField(field, "seed") };
}

const seedRatings = (field: FieldTeam[], top: number, step: number) => Object.fromEntries(field.map((t) => [t.id, { rating: top - step * ((t.seed ?? 1) - 1), sd: null }]));

describe("March Madness", () => {
  const p = parseMadnessField(madnessText());
  const a = auction("march_madness", p.field, p.regions);

  it("parses 68 teams with 4 First Four pairs, which sell as one lot each", () => {
    expect(p.errors).toEqual([]);
    expect(p.field.length).toBe(68);
    expect(validateField("march_madness", p.field, p.regions)).toBeNull();
    expect(a.lots.length).toBe(64);
    expect(a.lots.filter((l) => l.teamIds.length === 2).length).toBe(4);
  });

  it("default payouts total 100% and every sim pays out 100%", () => {
    expect(payoutTotalPct(a.format, a.payouts, a.field)).toBe(100);
    const sim = simulateBracket({ format: a.format, field: a.field, regions: a.regions, ratings: seedRatings(a.field, 22, 1.4), hfa: 0, marginSd: 11, ratingNoise: 1.5, useSourceSd: false, sims: 3000 });
    const m = payoutMatrix(sim, a);
    const T = sim.teamIds.length;
    for (let s = 0; s < 20; s++) {
      let t = 0;
      for (let i = 0; i < T; i++) t += m[s * T + i];
      expect(t).toBeCloseTo(100, 3);
    }
    const sum = (r: number) => Object.values(sim.reach).reduce((x, v) => x + v[r], 0);
    expect(sum(0)).toBeCloseTo(32, 6);
    expect(sum(5)).toBeCloseTo(1, 6);
    const pi = Object.entries(sim.playInWin);
    expect(pi.length).toBe(8);
    const shares = fairShares(sim, m);
    expect(shares["east-seed1"]).toBeGreaterThan(shares["east-seed8"]);
    expect(sim.propProb.cinderella["east-seed10"]).toBe(0);
  });

  it("bundles 13–16 seeds per region and per seed line", () => {
    const r = bundleBySeed(a, 13, "region", 0).auction;
    expect(r.lots.length).toBe(64 - 4 * 3);
    expect(r.lots.some((l) => l.label === "East 13–16 seeds")).toBe(true);
    const l = bundleBySeed(a, 15, "line", 0).auction;
    expect(l.lots.some((x) => x.label === "All 16 seeds")).toBe(true);
  });

  it("First Four games decide play-in, not rounds", () => {
    const g = (round: number, h: string, w: string, hs: number, as: number) => ({ id: `${h}-${w}`, round, homeId: h, awayId: w, homeScore: hs, awayScore: as, final: true, homeSpread: null, neutral: true, start: null, espnId: null, lineManual: false });
    const d = deriveFromGames({ ...a, autoScore: true, games: [g(-1, "east-seed16", "east-seed16b", 70, 60), g(0, "east-seed1", "east-seed16", 90, 60)] });
    expect(d.results["east-seed16b"]).toMatchObject({ eliminated: true, playIn: "lost", roundsCleared: 0 });
    expect(d.results["east-seed16"]).toMatchObject({ eliminated: true, playIn: "won", roundsCleared: 0 });
    expect(d.results["east-seed1"].roundsCleared).toBe(1);
  });
});

describe("CFB playoffs", () => {
  const names12 = ["Ohio State", "Indiana", "Oregon", "Notre Dame", "Texas Tech", "Georgia", "Miami", "Alabama", "Texas", "Texas A&M", "Ole Miss", "Oklahoma"];
  for (const [format, n] of [
    ["cfb_playoff12", 12],
    ["cfb_playoff24", 24],
  ] as const) {
    it(`${format}: field, byes, payouts and bracket`, () => {
      const names = Array.from({ length: n }, (_, i) => names12[i] ?? `Team ${i + 1}`);
      const field = cfbFieldFromSeeds(format, names);
      const a = auction(format, field);
      expect(validateField(format, field)).toBeNull();
      expect(field.filter((t) => t.bye).length).toBe(format === "cfb_playoff12" ? 4 : 8);
      expect(field[0].logo).toContain("espncdn");
      expect(payoutTotalPct(format, a.payouts, a.field)).toBe(100);
      const sim = simulateBracket({ format, field, ratings: seedRatings(field, 20, 0.8), hfa: 2.5, marginSd: 15, ratingNoise: 2, useSourceSd: false, sims: 3000 });
      const R = sim.rounds;
      const sum = (r: number) => Object.values(sim.reach).reduce((x, v) => x + v[r], 0);
      expect(sum(R - 1)).toBeCloseTo(1, 6);
      expect(sum(0)).toBeCloseTo(format === "cfb_playoff12" ? 8 : 16, 6); // byes + first-round winners
      const m = payoutMatrix(sim, a);
      const shares = fairShares(sim, m);
      expect(Object.values(shares).reduce((x, v) => x + v, 0)).toBeCloseTo(100, 2);
      expect(shares["Ohio State"]).toBeGreaterThan(shares[names[n - 1]]);
      // only the lowest seeds can win Cinderella
      expect(sim.propProb.cinderella[names[format === "cfb_playoff12" ? 7 : 15]]).toBe(0);
    });
  }
});
