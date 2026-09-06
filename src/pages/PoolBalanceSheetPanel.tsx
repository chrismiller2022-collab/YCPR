import { useEffect, useMemo, useState } from "react";
import { fetchBritEntries, fetchBritSeasonBonus, type BritEntryRow, type BritSeasonBonusRow } from "../lib/api/britPool";
import { fetchPoolLedger, savePoolLedgerEntry, type PoolLedgerEntry } from "../lib/api/poolLedger";
import { fetchWestgateProjectedPayout, type WestgateProjection } from "../lib/api/westgateProjection";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function fmtMoney(v: number) {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

interface LineItem {
  key: string;
  label: string;
  cost: number;
  winnings: number;
  costEditable: boolean;
  winningsEditable: boolean;
  note?: string | null;
}

function LedgerRow({
  item,
  onSave,
}: {
  item: LineItem;
  onSave: (cost: number, winnings: number) => Promise<void>;
}) {
  const [cost, setCost] = useState(String(item.cost));
  const [winnings, setWinnings] = useState(String(item.winnings));
  const [saving, setSaving] = useState(false);
  const dirty = Number(cost) !== item.cost || Number(winnings) !== item.winnings;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(item.costEditable ? Number(cost) || 0 : item.cost, item.winningsEditable ? Number(winnings) || 0 : item.winnings);
    } finally {
      setSaving(false);
    }
  }

  const net = item.winnings - item.cost;
  const cellStyle = { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)" };
  const canSave = (item.costEditable || item.winningsEditable) && dirty;

  return (
    <tr>
      <td style={cellStyle}>
        {item.label}
        {item.note && <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{item.note}</div>}
      </td>
      <td style={{ ...cellStyle, textAlign: "right" }}>
        {item.costEditable ? (
          <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 80, textAlign: "right" }} />
        ) : (
          fmtMoney(item.cost)
        )}
      </td>
      <td style={{ ...cellStyle, textAlign: "right" }}>
        {item.winningsEditable ? (
          <input type="number" value={winnings} onChange={(e) => setWinnings(e.target.value)} style={{ width: 80, textAlign: "right" }} />
        ) : (
          fmtMoney(item.winnings)
        )}
      </td>
      <td style={{ ...cellStyle, textAlign: "right", color: net >= 0 ? "green" : "crimson", fontWeight: 600 }}>{fmtMoney(net)}</td>
      <td style={cellStyle}>
        {canSave && (
          <button className="menu-btn" onClick={handleSave} disabled={saving} style={{ padding: "0.15rem 0.4rem" }}>
            {saving ? "…" : "Save"}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function PoolBalanceSheetPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<"actual" | "hypothetical">("actual");
  const [britEntries, setBritEntries] = useState<BritEntryRow[]>([]);
  const [britBonus, setBritBonus] = useState<BritSeasonBonusRow | null>(null);
  const [ledger, setLedger] = useState<PoolLedgerEntry[]>([]);
  const [hypoLedger, setHypoLedger] = useState<PoolLedgerEntry[]>([]);
  const [westgateProj, setWestgateProj] = useState<WestgateProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  useEffect(() => {
    if (ratingsLoading) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBritEntries(season),
      fetchBritSeasonBonus(season),
      fetchPoolLedger(season, false),
      fetchPoolLedger(season, true),
      fetchWestgateProjectedPayout(season, liveByTeam),
    ])
      .then(([entries, bonus, l, hl, proj]) => {
        setBritEntries(entries);
        setBritBonus(bonus);
        setLedger(l);
        setHypoLedger(hl);
        setWestgateProj(proj);
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [season, ratingsLoading, reloadTick]);

  const britCost = useMemo(() => britEntries.reduce((sum, e) => sum + (e.entry_fee ?? 0), 0), [britEntries]);
  const britWinnings = useMemo(
    () => britEntries.reduce((sum, e) => sum + (e.winnings ?? 0), 0) + (britBonus?.payout ?? 0),
    [britEntries, britBonus]
  );

  const actualItems: LineItem[] = useMemo(() => {
    const items: LineItem[] = [
      {
        key: "brit",
        label: "The Brit",
        cost: britCost,
        winnings: britWinnings,
        costEditable: false,
        winningsEditable: false,
        note: "Tracked in its own weekly/season tabs",
      },
    ];
    for (const e of ledger) {
      items.push({ key: e.pool_key, label: e.label, cost: e.cost, winnings: e.winnings, costEditable: true, winningsEditable: true, note: e.note });
    }
    return items;
  }, [britCost, britWinnings, ledger]);

  const westgateHypoItem: LineItem | null = useMemo(() => {
    const base = hypoLedger.find((e) => e.pool_key === "westgate");
    if (!base) return null;
    return {
      key: "westgate",
      label: base.label,
      cost: base.cost,
      winnings: westgateProj?.payout ?? 0,
      costEditable: true,
      // Winnings stay computed/read-only for Westgate — projected from your
      // live picks, not something to type in by hand.
      winningsEditable: false,
      note: `${base.note ?? ""}${westgateProj ? ` — projected from ${westgateProj.points.toFixed(1)} pts, rank ~${westgateProj.rank}` : ""}`,
    };
  }, [hypoLedger, westgateProj]);

  const hypotheticalItems: LineItem[] = useMemo(() => {
    return westgateHypoItem ? [...actualItems, westgateHypoItem] : actualItems;
  }, [actualItems, westgateHypoItem]);

  const activeItems = tab === "actual" ? actualItems : hypotheticalItems;
  const totalCost = activeItems.reduce((sum, i) => sum + i.cost, 0);
  const totalWinnings = activeItems.reduce((sum, i) => sum + i.winnings, 0);
  const net = totalWinnings - totalCost;
  const breakeven = Math.max(0, totalCost - totalWinnings);

  async function handleSaveLedgerRow(entry: PoolLedgerEntry, cost: number, winnings: number) {
    try {
      await savePoolLedgerEntry({ ...entry, cost, winnings });
      setReloadTick((t) => t + 1);
    } catch (err: any) {
      setError(err.message ?? "Save failed");
    }
  }

  function ledgerEntryFor(item: LineItem): PoolLedgerEntry | null {
    const source = tab === "actual" ? ledger : [...ledger, ...hypoLedger];
    return source.find((e) => e.pool_key === item.key) ?? null;
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <h2 style={{ marginTop: 0 }}>Balance Sheet</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Running cost vs. winnings across every pool this season. The Brit pulls from its own weekly
        entries; everything else here is a flat line you can edit as real payouts come in.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className={`mode-btn ${tab === "actual" ? "mode-btn-active" : ""}`} onClick={() => setTab("actual")}>
            Actual
          </button>
          <button className={`mode-btn ${tab === "hypothetical" ? "mode-btn-active" : ""}`} onClick={() => setTab("hypothetical")}>
            Hypothetical (+ Westgate)
          </button>
        </div>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {(loading || ratingsLoading) && <p>Loading…</p>}

      {!loading && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th className="th">Pool</th>
                  <th className="th" style={{ textAlign: "right" }}>
                    Cost
                  </th>
                  <th className="th" style={{ textAlign: "right" }}>
                    Winnings
                  </th>
                  <th className="th" style={{ textAlign: "right" }}>
                    Net
                  </th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((item) => {
                  const entry = ledgerEntryFor(item);
                  return (
                    <LedgerRow
                      key={item.key}
                      item={item}
                      onSave={async (cost, winnings) => {
                        if (!entry) return;
                        await handleSaveLedgerRow(entry, cost, winnings);
                      }}
                    />
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ padding: "0.4rem 0.5rem", borderTop: "2px solid var(--hash)" }}>Total</td>
                  <td style={{ padding: "0.4rem 0.5rem", borderTop: "2px solid var(--hash)", textAlign: "right" }}>{fmtMoney(totalCost)}</td>
                  <td style={{ padding: "0.4rem 0.5rem", borderTop: "2px solid var(--hash)", textAlign: "right" }}>{fmtMoney(totalWinnings)}</td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderTop: "2px solid var(--hash)",
                      textAlign: "right",
                      color: net >= 0 ? "green" : "crimson",
                    }}
                  >
                    {fmtMoney(net)}
                  </td>
                  <td style={{ borderTop: "2px solid var(--hash)" }}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: "1rem", fontWeight: 700 }}>
            Breakeven winnings still needed: {fmtMoney(breakeven)}
          </div>
          {tab === "hypothetical" && westgateProj && (
            <div className="footer-note" style={{ marginTop: "1rem" }}>
              Westgate winnings are projected from your live picks this season ({westgateProj.points.toFixed(1)} pts, ~rank{" "}
              {westgateProj.rank}) against the uploaded standings and {2025}'s payout percentages — not
              a real payout until the contest actually pays out.
            </div>
          )}
        </>
      )}
    </div>
  );
}
