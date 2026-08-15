// Pythagorean expectation, adapted from Bill James's baseball formula:
// https://en.wikipedia.org/wiki/Pythagorean_expectation
// win% ~= PF^exp / (PF^exp + PA^exp). 2.37 is the commonly-cited exponent
// for football (vs. baseball's ~1.83), popularized by Football Outsiders.
export const PYTHAG_EXPONENT = 2.37;

export function pythagWinPct(pointsFor: number, pointsAgainst: number): number | null {
  if (pointsFor <= 0 && pointsAgainst <= 0) return null;
  const pf = Math.pow(pointsFor, PYTHAG_EXPONENT);
  const pa = Math.pow(pointsAgainst, PYTHAG_EXPONENT);
  if (pf + pa === 0) return null;
  return pf / (pf + pa);
}
