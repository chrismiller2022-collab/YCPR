import { describe, expect, it } from "vitest";
import { TEAMS } from "../data/teams";
import { computeConglomeratedTable, conglomeratedRowsToSaveFormat } from "./ratingConglomerate";
import { buildRatingsByTeam } from "./multiRatingMatchups";
import { scaleOf } from "./ratingStandardize";
import { STD_MULTIPLIER_SETTING_KEY } from "./ratingSystems";

const fbs = TEAMS.filter((t) => t.div === "FBS").map((t) => t.team);
const pulls = fbs.flatMap((team, i) => [
  { system_key: "sp", team, division: "fbs", conference: null, value: (i % 40) - 20, pulled_at: "" },
  { system_key: "elo", team, division: "fbs", conference: null, value: 3 * ((i * 7) % 40) - 60, pulled_at: "" },
]);

describe("live YC build", () => {
  it("is standardized to the saved multiplier, keeps the old build as yc_legacy, and saves both", () => {
    const rows = computeConglomeratedTable(pulls, { sp: 1, elo: 1, [STD_MULTIPLIER_SETTING_KEY]: 12 });
    const yc = rows.filter((r) => r.div === "FBS").map((r) => r.yc as number);
    expect(scaleOf(yc)!.scale).toBeCloseTo(12, 6);
    const georgia = rows.find((r) => r.team === fbs[3])!;
    expect(georgia.values.yc_legacy).toBeCloseTo(((3 % 40) - 20 + 3 * ((21) % 40) - 60) / 2, 6);
    const saved = conglomeratedRowsToSaveFormat(rows).find((r) => r.team === fbs[3])!.values;
    expect(Object.keys(saved)).toEqual(expect.arrayContaining(["yc", "consensus", "yc_legacy", "consensus_legacy"]));
  });
  it("defaults the multiplier to 13.5", () => {
    const rows = computeConglomeratedTable(pulls, { sp: 1, elo: 1 });
    expect(scaleOf(rows.filter((r) => r.div === "FBS").map((r) => r.yc as number))!.scale).toBeCloseTo(13.5, 6);
  });
});

describe("buildRatingsByTeam old-method fill", () => {
  const row = (team: string, system_key: string, value: number) => ({ season: 2026, week: 1, team, division: null, conference: null, system_key, value });
  it("reads a pre-switch week's yc as the old method", () => {
    const bt = buildRatingsByTeam([row("A", "yc", -5), row("A", "consensus", -4)]);
    expect(bt.A.yc_legacy).toBe(-5);
    expect(bt.A.consensus_legacy).toBe(-4);
  });
  it("never backfills a week saved after the switch", () => {
    const bt = buildRatingsByTeam([row("A", "yc", -5), row("A", "yc_legacy", -6), row("B", "yc", 2)]);
    expect(bt.A.yc_legacy).toBe(-6);
    expect(bt.B.yc_legacy).toBeUndefined();
  });
});
