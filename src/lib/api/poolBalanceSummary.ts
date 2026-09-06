import { fetchBritEntries, fetchBritSeasonBonus } from "./britPool";
import { fetchPoolLedger } from "./poolLedger";

export interface PoolSummaryItem {
  key: string;
  label: string;
  cost: number;
  winnings: number;
}

export interface PoolBalanceSummary {
  items: PoolSummaryItem[];
  totalCost: number;
  totalWinnings: number;
  net: number;
  breakeven: number;
}

/**
 * Read-only version of what PoolBalanceSheetPanel's "Actual" tab shows —
 * The Brit's own tracked entries/bonus plus every flat pool_ledger_entries
 * row for the season. Used by Placed Bets' Pool ROI section, which only
 * needs the totals, not per-row editing.
 */
export async function fetchPoolBalanceSummary(season: number): Promise<PoolBalanceSummary> {
  const [entries, bonus, ledger] = await Promise.all([
    fetchBritEntries(season),
    fetchBritSeasonBonus(season),
    fetchPoolLedger(season, false),
  ]);

  const britCost = entries.reduce((sum, e) => sum + (e.entry_fee ?? 0), 0);
  const britWinnings = entries.reduce((sum, e) => sum + (e.winnings ?? 0), 0) + (bonus?.payout ?? 0);

  const items: PoolSummaryItem[] = [{ key: "brit", label: "The Brit", cost: britCost, winnings: britWinnings }];
  for (const e of ledger) items.push({ key: e.pool_key, label: e.label, cost: e.cost, winnings: e.winnings });

  const totalCost = items.reduce((sum, i) => sum + i.cost, 0);
  const totalWinnings = items.reduce((sum, i) => sum + i.winnings, 0);
  return { items, totalCost, totalWinnings, net: totalWinnings - totalCost, breakeven: Math.max(0, totalCost - totalWinnings) };
}
