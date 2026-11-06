// NFL wrapper around the shared bracket sim (bracketSim.ts), kept so older
// imports keep working.
import { simulateBracket, type SimInputs } from "./bracketSim";

export * from "./bracketSim";

export function simulateNflPlayoffs(inp: Omit<SimInputs, "format">) {
  return simulateBracket({ ...inp, format: "nfl_playoffs" });
}
