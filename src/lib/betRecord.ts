import type { BetResult, PlacedBetRow } from "./api/placedBets";

// Win/loss/profit math for placed bets — shared by the Placed Bets page
// and the admin Overview tiles so both always agree.

// Profit/loss in dollars for a settled bet. Prefers the stated to_win
// (what the book actually quoted) over deriving one from price+stake,
// since real books round odd cents in ways a formula won't reproduce
// exactly. Returns null for a pending bet or one missing a stake (e.g.
// bets logged from Admin Matchups' checkbox before this had a stake
// column) — null is excluded from every record/ROI total, not treated
// as a zero.
export function betProfitForResult(bet: { stake: number | null; to_win: number | null; price: number }, result: BetResult): number | null {
  if (result === "pending" || bet.stake == null) return null;
  if (result === "push") return 0;
  if (result === "loss") return -bet.stake;
  if (bet.to_win != null) return bet.to_win;
  return bet.price > 0 ? bet.stake * (bet.price / 100) : bet.stake * (100 / Math.abs(bet.price));
}
export function betProfit(bet: PlacedBetRow): number | null {
  return betProfitForResult(bet, bet.result);
}

export interface BetRecord {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  staked: number;
  profit: number;
}
export function emptyRecord(): BetRecord {
  return { wins: 0, losses: 0, pushes: 0, pending: 0, staked: 0, profit: 0 };
}
export function addBetToRecord(rec: BetRecord, bet: PlacedBetRow) {
  if (bet.result === "pending") {
    rec.pending++;
    return;
  }
  if (bet.result === "win") rec.wins++;
  else if (bet.result === "loss") rec.losses++;
  else if (bet.result === "push") rec.pushes++;
  if (bet.stake != null) rec.staked += bet.stake;
  const p = betProfit(bet);
  if (p != null) rec.profit += p;
}
export function roi(rec: BetRecord): number | null {
  return rec.staked > 0 ? (rec.profit / rec.staked) * 100 : null;
}
