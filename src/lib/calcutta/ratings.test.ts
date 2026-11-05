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
