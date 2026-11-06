import { describe, expect, it } from "vitest";
import { lotsFromField, newAuction } from "./engine";
import { cfbFieldFromSeeds, madnessFieldFromEspn } from "./fields";
import { CFP_2025, MM_2025 } from "./fixtures.espnCollege2025";
import { deriveFromGames, guessFirstFour, madnessGameDays, mergeEspnGames } from "./scoring";
import { validateField } from "./bracketSim";
import type { CalcuttaAuction } from "./types";

const copy = <T,>(x: T): any => JSON.parse(JSON.stringify(x));

describe("ESPN sync — 2025-26 College Football Playoff", () => {
  const seeds = ["Indiana", "Ohio State", "Georgia", "Texas Tech", "Oregon", "Ole Miss", "Texas A&M", "Oklahoma", "Alabama", "Miami", "Tulane", "James Madison"];
  const a0 = newAuction("CFP", "cfb_playoff12", 0);
  const field = cfbFieldFromSeeds("cfb_playoff12", seeds);
  const a: CalcuttaAuction = { ...a0, field, lots: lotsFromField(field, "seed"), autoScore: true };

  it("matches every CFP game by ESPN id and reads the round from ESPN's note", () => {
    const r = mergeEspnGames(a, null, copy(CFP_2025), null);
    expect(r.added).toBe(11);
    expect(r.skipped).toBe(0);
    const byRound = [0, 1, 2, 3].map((n) => r.games.filter((g) => g.round === n).length);
    expect(byRound).toEqual([4, 4, 2, 1]);
    expect(r.games.find((g) => g.round === 0)!.neutral).toBe(false); // campus
    expect(r.games.find((g) => g.round === 3)!.neutral).toBe(true);
    const d = deriveFromGames({ ...a, games: r.games });
    expect(d.championId).toBe("Indiana");
    expect(d.results.Indiana).toEqual({ roundsCleared: 4, eliminated: false }); // bye + 3 wins
    expect(d.results.Miami.roundsCleared).toBe(3); // 10 seed: R1, QF, SF wins, lost the title game
    expect(d.results.Miami.eliminated).toBe(true);
  });

  it("works out rounds from earlier games when there's no note", () => {
    const noNotes = copy(CFP_2025).map((g: any) => ({ ...g, note: null }));
    const r = mergeEspnGames(a, null, noNotes, null);
    expect([0, 1, 2, 3].map((n) => r.games.filter((g) => g.round === n).length)).toEqual([4, 4, 2, 1]);
  });
});

describe("ESPN sync — 2025 NCAA tournament", () => {
  const built = madnessFieldFromEspn(copy(MM_2025));
  const a0 = newAuction("MM", "march_madness", 0);
  const a: CalcuttaAuction = { ...a0, field: built.field, regions: built.regions, lots: lotsFromField(built.field, "seed"), autoScore: true };

  it("fills the whole 68-team bracket from ESPN, Final Four pairing included", () => {
    expect(built.errors).toEqual([]);
    expect(built.field.length).toBe(68);
    expect(validateField("march_madness", built.field, built.regions)).toBeNull();
    expect(built.field.find((t) => t.name === "Duke")).toMatchObject({ seed: 1, group: "East" });
    expect(built.field.filter((t) => t.seed === 16).length).toBe(6); // two First Four pairs on the 16 line
    // 2025 semis: South v West, East v Midwest (some order)
    const semis = [built.regions.slice(0, 2).sort().join("|"), built.regions.slice(2).sort().join("|")].sort();
    expect(semis).toEqual(["East|Midwest", "South|West"]);
  });

  it("imports all 67 games and settles the tournament", () => {
    const r = mergeEspnGames(a, null, copy(MM_2025), null);
    expect(r.added).toBe(67);
    expect(r.skipped).toBe(0);
    expect([-1, 0, 1, 2, 3, 4, 5].map((n) => r.games.filter((g) => g.round === n).length)).toEqual([4, 32, 16, 8, 4, 2, 1]);
    const d = deriveFromGames({ ...a, games: r.games });
    expect(a.field.find((t) => t.id === d.championId)?.name).toBe("Florida");
    expect(d.results.florida.roundsCleared).toBe(6);
    const playInLosers = Object.values(d.results).filter((x) => x.playIn === "lost").length;
    expect(playInLosers).toBe(4);
    const low = a.payouts.props.find((p) => p.kind === "lowest_f4_seed")!;
    expect(d.props[low.id].final).toBe(true); // 2025 Final Four was all 1 seeds
    expect(d.props[low.id].winners.length).toBe(4);
  });

  it("knows the game days", () => {
    const ff = guessFirstFour(2025);
    expect(ff.toISOString().slice(0, 10)).toBe("2025-03-18");
    const days = madnessGameDays(ff);
    expect(days[0]).toBe("20250318");
    expect(days[days.length - 1]).toBe("20250407");
    expect(guessFirstFour(2026).toISOString().slice(0, 10)).toBe("2026-03-17");
  });
});
