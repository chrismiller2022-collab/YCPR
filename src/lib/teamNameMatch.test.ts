import { describe, expect, it } from "vitest";
import { matchTeamName } from "./teamNameMatch";

describe("matchTeamName compass words", () => {
  it.each(["North Carolina State", "North Carolina St", "N Carolina State", "NC St", "NC State", "N.C. State"])("%s -> NC State", (n) => {
    expect(matchTeamName(n).matched).toBe("NC State");
  });
  it.each(["South Carolina State", "SC State", "S Carolina State"])("%s -> South Carolina State", (n) => {
    expect(matchTeamName(n).matched).toBe("South Carolina State");
  });
  it("never fuzzy-matches across a different direction word", () => {
    expect(matchTeamName("Northern Carolina State").matched).not.toBe("South Carolina State");
  });
});
