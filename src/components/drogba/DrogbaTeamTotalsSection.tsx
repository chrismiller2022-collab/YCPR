import { useEffect, useMemo, useState } from "react";
import { fetchGameProjectionLocks } from "../../lib/api/gameProjectionLocks";
import { ycSpreadByGame } from "../../lib/drogba/agreement";
import { atsColor, isSmallSample } from "../../lib/drogba/colors";
import { buildTeamTotalRows, teamPointsMae, teamTotalBets, TT_ARM_LABELS, type TTArm } from "../../lib/drogba/teamTotalsCompare";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM } from "./shared";

const SEASONS = [2024, 2025, 2026];
const DIFFS = [1, 1.5, 2, 3];
const ARMS: Exclude<TTArm, "vegas">[] = ["yc", "drogba", "blend"];
const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };

export default function DrogbaTeamTotalsSection({ state }: { state: DrogbaState }) {
  const [yc, setYc] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.games.length) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ BET_HISTORY }, locks] = await Promise.all([import("../../data/betHistory.data"), fetchGameProjectionLocks(2026, Array.from({ length: 16 }, (_, i) => i + 1))]);
        if (!cancelled) setYc(ycSpreadByGame(state.games, BET_HISTORY as any, Object.values(locks)));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Loading YC projections failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.games]);

  const rows = useMemo(() => (state.engine && yc ? buildTeamTotalRows(state.engine.signals, yc, SEASONS) : null), [state.engine, yc]);

  return (
    <div>
      <h3 style={H3}>Team totals: split by DROGBA's spread vs YC's</h3>
      <p style={DIM}>
        Same game total (Bovada's opening total) in every row, split into two team totals by each spread, so only the spread differs. This is a side-by-side, not a replacement: YC's team totals are unchanged. A team-total "bet" is graded against the same total
        split by the opening spread (the site's stand-in; real team-total lines are only on file for a few 2026 weeks), so it is the spread view again, in team-total form. 2024–26, DROGBA fit on earlier seasons only.
      </p>
      {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
      {!rows && !error && <p style={DIM}>Loading…</p>}
      {rows && (
        <>
          {(["power", "other", "all"] as (Tier | "all")[]).map((tier) => {
            const sub = tier === "all" ? rows : rows.filter((r) => r.tier === tier);
            return (
              <div key={tier}>
                <h4 style={{ margin: "0.9rem 0 0.2rem", fontSize: "0.9rem" }}>
                  {tier === "all" ? "All games" : TIER_LABELS[tier]} <span style={{ fontWeight: 400, color: "var(--chalk-dim)", fontSize: "0.78rem" }}>· {sub.length} games</span>
                </h4>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={CELL}>Spread used to split the total</th>
                        <th style={HEAD} title="Average miss, in points, of each team's projected points">Team points MAE</th>
                        {DIFFS.map((d) => (
                          <th key={d} style={HEAD}>Bets {d}+ off</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(["vegas", ...ARMS] as TTArm[]).map((arm) => (
                        <tr key={arm}>
                          <td style={CELL}>{TT_ARM_LABELS[arm]}</td>
                          <td style={NUM}>{teamPointsMae(sub, arm)?.toFixed(3) ?? "–"}</td>
                          {DIFFS.map((d) => {
                            if (arm === "vegas") return <td key={d} style={{ ...NUM, color: "var(--chalk-dim)" }}>–</td>;
                            const b = teamTotalBets(sub, arm, d);
                            const small = isSmallSample(b.w + b.l);
                            return (
                              <td key={d} style={{ ...NUM, color: atsColor(b.atsPct), opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }} title={`${b.w}-${b.l}${b.p ? `-${b.p}` : ""}`}>
                                {b.atsPct == null ? "–" : `${b.atsPct.toFixed(1)}%`} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({b.n})</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
