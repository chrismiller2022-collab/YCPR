import { describe, expect, it } from "vitest";
import { NFL_COMPOSITE_WEEK9_TEXT } from "../../data/nflCompositeRatings";
import { parseRatings } from "./ratings";

describe("parseRatings", () => {
  it("reads the composite table text", () => {
    const r = parseRatings(NFL_COMPOSITE_WEEK9_TEXT);
    expect(Object.keys(r.ratings).length).toBe(32);
    expect(r.ratings.LAR).toMatchObject({ rating: 5.5, sd: 1.1 });
    expect(r.ratings.SF.rating).toBe(4.7);
    expect(r.ratings.WSH.rating).toBe(-1.8);
    expect(r.ratings.NYG.rating).toBe(-3.8);
    expect(r.ratings.NYJ.rating).toBe(-3.9);
    expect(r.ratings.LAC.rating).toBe(-3.0);
    expect(r.unmatched).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it("reads full source rows, abbreviations, nicknames and odd minus signs", () => {
    const r = parseRatings(
      ["5 San Francisco 49ers 4.7 1.5 5.9 (1) 2.6 (11) 3.8 (6)", "KC, 3.5", "Commanders\t−1.8", "WAS -2", "Giants -3.8", "garbage 12"].join("\n"),
    );
    expect(r.ratings.SF).toMatchObject({ rating: 4.7, sd: 1.5 });
    expect(r.ratings.KC.rating).toBe(3.5);
    expect(r.ratings.WSH.rating).toBe(-2);
    expect(r.duplicates).toEqual(["WSH"]);
    expect(r.ratings.NYG.rating).toBe(-3.8);
    expect(r.unmatched.map((u) => u.text)).toEqual(["garbage 12"]);
  });
});

import { parseFieldRatings } from "./ratings";

describe("parseFieldRatings", () => {
  const field = [
    { id: "iowa", name: "Iowa" },
    { id: "iowa-state", name: "Iowa State" },
    { id: "st-johns", name: "St. John's" },
    { id: "texas-a-m", name: "Texas A&M" },
  ];
  it("matches the longest name, handles St./State and flips/scales", () => {
    const r = parseFieldRatings(["1. Iowa St. 24.5", "Iowa 18.2", "St. John's +20.1", "Texas A&M -3"].join("\n"), field, { scale: 0.5 });
    expect(r.ratings["iowa-state"].rating).toBeCloseTo(12.25);
    expect(r.ratings.iowa.rating).toBeCloseTo(9.1);
    expect(r.ratings["st-johns"].rating).toBeCloseTo(10.05);
    expect(r.ratings["texas-a-m"].rating).toBeCloseTo(-1.5);
    const flip = parseFieldRatings("Iowa -7.5", field, { lowerIsBetter: true });
    expect(flip.ratings.iowa.rating).toBe(7.5);
  });

  it("skips other schools with the same stem and win-loss records", () => {
    const f = [
      { id: "alabama", name: "Alabama" },
      { id: "duke", name: "Duke" },
      { id: "texas", name: "Texas" },
    ];
    const r = parseFieldRatings(["1 Duke ACC 35-4 +38.32 128.0", "Alabama 25.1", "Alabama State 2.0", "Texas Tech 20", "Texas SEC 19-15 12.5"].join("\n"), f);
    expect(r.ratings.duke.rating).toBeCloseTo(38.32);
    expect(r.ratings.alabama.rating).toBe(25.1);
    expect(r.ratings.texas.rating).toBe(12.5);
    expect(r.duplicates).toEqual([]);
  });
});
