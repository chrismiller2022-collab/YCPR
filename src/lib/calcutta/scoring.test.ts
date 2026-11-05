import { describe, expect, it } from "vitest";
import { addParticipant, lotsFromField, newAuction, openLot, ownerSummaries, placeBid, sellCurrent } from "./engine";
import { NFL_2025_PLAYOFFS, NFL_2025_SEEDS } from "./fixtures.nfl2025";
import { emptyNflSeedSlots, nflFieldFromSlots } from "./formats";
import { deriveFromGames, mergeEspnGames, scored } from "./scoring";
import type { CalcuttaAuction } from "./types";

function auction(): CalcuttaAuction {
  let a = newAuction("2025", "nfl_playoffs", 0);
  const slots = emptyNflSeedSlots().map((s) => ({ ...s, abbr: NFL_2025_SEEDS[s.conf][s.seed - 1] }));
  a = { ...a, field: nflFieldFromSlots(slots) };
  return { ...a, lots: lotsFromField(a.field, "seed") };
}

function withGames(a: CalcuttaAuction, upToRound = 3): CalcuttaAuction {
  let games = a.games ?? [];
  for (let r = 0; r <= upToRound; r++) {
    const list = NFL_2025_PLAYOFFS.filter((g) => g.round === r).map((g) => ({ ...g, home: { ...g.home }, away: { ...g.away } }));
    games = mergeEspnGames({ ...a, games }, r, list as any, r === 3).games;
  }
  return { ...a, games, autoScore: true };
}

const prop = (a: CalcuttaAuction, kind: string) => a.payouts.props.find((p) => p.kind === kind)!;

describe("auto-scoring from the game log (2025 playoffs)", () => {
  it("imports all 13 games and works out rounds cleared", () => {
    const a = withGames(auction());
    expect(a.games!.length).toBe(13);
    const d = deriveFromGames(a);
    expect(d.championId).toBe("SEA");
    expect(d.results.SEA).toEqual({ roundsCleared: 4, eliminated: false });
    expect(d.results.NE).toEqual({ roundsCleared: 3, eliminated: true });
    expect(d.results.DEN).toEqual({ roundsCleared: 2, eliminated: true }); // bye + Divisional win
    expect(d.results.LAR).toEqual({ roundsCleared: 2, eliminated: true });
    expect(d.results.GB).toEqual({ roundsCleared: 0, eliminated: true });
  });

  it("settles the side prizes", () => {
    const a = withGames(auction());
    const d = deriveFromGames(a);
    // 6-over-3 upsets: BUF by 3, SF by 4; LAR (5) over CHI (2) by 3 → SF wins the margin tiebreak
    expect(d.props[prop(a, "biggest_upset").id]).toMatchObject({ winners: ["SF"], final: true });
    expect(d.props[prop(a, "worst_loss").id]).toMatchObject({ winners: ["SF"], final: true }); // 41-6 at SEA
    expect(d.props[prop(a, "cinderella").id]).toMatchObject({ winners: ["LAR"], final: true });
    // No closing lines in the fixture → ATS can't settle
    expect(d.props[prop(a, "best_ats").id].final).toBe(false);
    expect(d.props[prop(a, "best_ats").id].blocker).toMatch(/Missing closing line for 13/);
  });

  it("leaves prizes unsettled mid-playoffs and pays rounds as they happen", () => {
    const a = withGames(auction(), 0);
    const d = deriveFromGames(a);
    expect(d.props[prop(a, "biggest_upset").id].final).toBe(false);
    expect(d.props[prop(a, "cinderella").id].final).toBe(false);
    expect(scored(a).payouts.props.every((p) => p.teamIds.length === 0)).toBe(true);
    expect(d.results.SF.roundsCleared).toBe(1);
  });

  it("ATS settles with lines; ESPN never overwrites a hand-typed line", () => {
    let a = withGames(auction());
    a = { ...a, games: a.games!.map((g) => ({ ...g, homeSpread: -3, lineManual: true })) };
    const d = deriveFromGames(a);
    expect(d.props[prop(a, "best_ats").id].final).toBe(true);
    const re = mergeEspnGames(a, 0, NFL_2025_PLAYOFFS.filter((g) => g.round === 0).map((g) => ({ ...g, odds: { homeSpread: -7 } })) as any, false);
    expect(re.games.every((g) => g.homeSpread === -3)).toBe(true);
  });

  it("feeds payouts: SEA's owner collects rounds + nothing else", () => {
    let a = withGames(auction());
    for (const n of ["Chris", "Kal"]) a = addParticipant(a, n, 0).auction;
    const seaLot = a.lots.find((l) => l.teamIds[0] === "SEA")!;
    a = openLot(a, seaLot.id, 0).auction;
    a = placeBid(a, a.participants[0].id, 100, 0).auction;
    a = sellCurrent(a, 0).auction;
    const chris = ownerSummaries(a).find((s) => s.participant.name === "Chris")!;
    // bye not paid; Div 5 + Conf 10 + SB 17 = 32% of $100
    expect(chris.earned).toBeCloseTo(32);
  });
});
