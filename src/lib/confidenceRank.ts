// Confidence pools: number the picked games N..1 by how sure the projection is about the picked side, the biggest
// projected margin for the picked team getting N. Ties fall back to the id so the order never shuffles.
export function autoConfidencePoints(
  items: { id: number; pickedSide: "away" | "home" | null; myAwaySpread: number | null }[]
): Map<number, number> {
  const picked = items
    .filter((i) => i.pickedSide != null && i.myAwaySpread != null)
    // Away spread is negative when the away team is favored, so the picked side's projected margin is -spread for
    // away and +spread for home.
    .map((i) => ({ id: i.id, margin: i.pickedSide === "away" ? -(i.myAwaySpread as number) : (i.myAwaySpread as number) }))
    .sort((a, b) => b.margin - a.margin || a.id - b.id);
  const out = new Map<number, number>();
  picked.forEach((p, idx) => out.set(p.id, picked.length - idx));
  return out;
}

/** The projected straight-up winner from an away spread (negative = away favored); null for a pick'em. */
export function projectedWinner(myAwaySpread: number | null): "away" | "home" | null {
  if (myAwaySpread == null || myAwaySpread === 0) return null;
  return myAwaySpread < 0 ? "away" : "home";
}
