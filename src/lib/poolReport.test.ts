import { describe, expect, it } from "vitest";
import { buildPoolReport, buildSeasonStats, recordScore, scoreGame, suggestPicks, type ReportGameInput, type SeasonGame } from "./poolReport";

const season = (over: Partial<SeasonGame>): SeasonGame => ({
  week: 1,
  away: "A",
  home: "H",
  myLine: null,
  vegasLine: null,
  actCover: null,
  myTotal: null,
  vegasTotal: null,
  ...over,
});

const game = (over: Partial<ReportGameInput>): ReportGameInput => ({
  gameId: "g",
  away: "Away U",
  home: "Home U",
  startDate: null,
  completed: false,
  poolLine: null,
  myLine: null,
  vegasLine: null,
  myTotal: null,
  vegasTotal: null,
  systemLines: {},
  ...over,
});

const factor = (g: ReturnType<typeof scoreGame>, key: string) => g.factors.find((f) => f.key === key)!;

describe("poolReport", () => {
  it("records my model's picks vs Vegas by role, team and O/U call", () => {
    const stats = buildSeasonStats([
      // I like the away dog (+7 vs my +3) and it covers; I projected Under.
      season({ away: "X", home: "Y", myLine: 3, vegasLine: 7, actCover: "away", myTotal: 40, vegasTotal: 45 }),
      // I like the home fav (Vegas home -3, my home -6) and it doesn't cover.
      season({ away: "X", home: "Z", myLine: 6, vegasLine: 3, actCover: "away" }),
      // No line — skipped.
      season({ away: "Y", home: "Z", myLine: 1, vegasLine: null, actCover: "home" }),
    ]);
    expect(stats.byRole["away-dog"]).toEqual({ w: 1, l: 0, p: 0 });
    expect(stats.byRole["home-fav"]).toEqual({ w: 0, l: 1, p: 0 });
    expect(stats.byRole.dog).toEqual({ w: 1, l: 0, p: 0 });
    expect(stats.teamWhenProjected.get("X")).toEqual({ w: 1, l: 0, p: 0 });
    expect(stats.teamWhenProjected.get("Z")).toEqual({ w: 0, l: 1, p: 0 });
    // X was in both games: my call was right once (on X), wrong once (on Z).
    expect(stats.teamCallAccuracy.get("X")).toEqual({ w: 1, l: 1, p: 0 });
    expect(stats.byTotalCall["dog-Under"]).toEqual({ w: 1, l: 0, p: 0 });
  });

  it("shrinks small records toward 50%", () => {
    expect(recordScore({ w: 0, l: 0, p: 0 })).toBeNull();
    expect(recordScore({ w: 1, l: 0, p: 0 })!).toBeLessThan(0.5);
    expect(recordScore({ w: 20, l: 5, p: 0 })!).toBe(1);
    expect(recordScore({ w: 5, l: 5, p: 0 })).toBe(0);
  });

  it("takes the side my line covers against the pool line and scores edge, Vegas and key numbers", () => {
    const stats = buildSeasonStats([]);
    // Pool: away +3.5. Mine: away -1. Vegas: away +2.5.
    const g = scoreGame(game({ poolLine: 3.5, myLine: -1, vegasLine: 2.5 }), stats);
    expect(g.side).toBe("away");
    expect(g.sideLine).toBe(3.5);
    expect(factor(g, "edge").score).toBeCloseTo(4.5 / 7);
    // Pool gives the away side a point more than Vegas -> positive.
    expect(factor(g, "vegas").score).toBeCloseTo(1 / 3);
    // Mine -1 vs pool +3.5 straddles +3 only.
    expect(factor(g, "keysMine").score).toBeCloseTo(0.6);
    // Vegas +2.5 vs pool +3.5 crosses +3, on my side.
    expect(factor(g, "keysVegas").score).toBeCloseTo(0.6);

    // Home side: pool home -3.5, mine home -8, Vegas home -2.5 — the pool makes home lay more than Vegas.
    const h = scoreGame(game({ poolLine: 3.5, myLine: 8, vegasLine: 2.5 }), stats);
    expect(h.side).toBe("home");
    expect(h.sideLine).toBe(-3.5);
    expect(factor(h, "vegas").score).toBeCloseTo(-1 / 3);
    // Vegas and pool straddle 3 against my side.
    expect(factor(h, "keysVegas").score).toBeCloseTo(-0.6);
  });

  it("counts McIllece/JP+/Consensus and all systems against the pool line", () => {
    const g = scoreGame(
      game({
        poolLine: 3,
        myLine: 0,
        systemLines: { mcillece: 1, jpplus: 5, consensus: 2, yc: 0, sp: 1, fpi: 4, massey: 3 },
      }),
      buildSeasonStats([])
    );
    expect(g.side).toBe("away");
    // McIllece and Consensus with me, JP+ against.
    expect(factor(g, "named").score).toBeCloseTo(1 / 3);
    // Counted: mcillece, jpplus, sp, fpi (massey is on the number; yc/consensus excluded) -> 2 with, 2 against.
    expect(factor(g, "systems").short).toBe("2/4");
    expect(factor(g, "systems").score).toBe(0);
  });

  it("ranks open games best first and picks the top eligible ones", () => {
    const stats = buildSeasonStats([]);
    const report = buildPoolReport(
      [
        game({ gameId: "small", poolLine: 1, myLine: 0 }),
        game({ gameId: "none", poolLine: 1, myLine: 1 }),
        game({ gameId: "big", poolLine: 10, myLine: 0 }),
        game({ gameId: "done", poolLine: 20, myLine: 0, completed: true }),
        game({ gameId: "mid", poolLine: 0, myLine: 5 }),
      ],
      stats
    );
    expect(report.map((g) => [g.input.gameId, g.rank])).toEqual([
      ["big", 1],
      ["mid", 2],
      ["small", 3],
      ["none", null],
      ["done", null],
    ]);
    expect(suggestPicks(report, { picks: 2, keyPicks: 1, eligible: (g) => g.input.gameId !== "big" })).toEqual([
      { gameId: "mid", side: "home", key: true },
      { gameId: "small", side: "away", key: false },
    ]);
  });
});
