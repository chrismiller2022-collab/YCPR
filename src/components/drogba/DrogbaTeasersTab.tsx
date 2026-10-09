import { useEffect, useMemo, useState } from "react";
import { fetchGameProjectionLocks } from "../../lib/api/gameProjectionLocks";
import { ycSpreadByGame } from "../../lib/drogba/agreement";
import { isSmallSample } from "../../lib/drogba/colors";
import {
  bandStat,
  breakEvenPerLeg,
  buildTeaserGames,
  CONDITION_LABELS,
  drogbaMargins,
  legStat,
  ticketEv,
  toWinFromAmerican,
  TOTAL_BAND_LABELS,
  type Condition,
  type LegFilter,
  type LegStat,
  type LineSource,
  type Role,
  type TotalBand,
} from "../../lib/drogba/teasers";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P } from "./shared";

const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];
const FEATURED: { role: Role; line: number }[] = [
  { role: "fav", line: 8.5 },
  { role: "dog", line: 2.5 },
  { role: "dog", line: 1.5 },
  { role: "fav", line: 7.5 },
];
const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };
const RED = [224, 122, 122];
const YELLOW = [232, 200, 74];
const GREEN = [143, 211, 154];
const lerp = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
// Yellow at the break-even, green above it, red below; full color ~7.6 points away (same spread as the site's ATS scale).
function colorVs(pct: number | null, be: number | null): string | undefined {
  if (pct == null || be == null) return undefined;
  const t = Math.max(-1, Math.min(1, (pct - be * 100) / 7.6));
  return t >= 0 ? lerp(YELLOW, GREEN, t) : lerp(YELLOW, RED, -t);
}

function Cell({ s, be, bold }: { s: LegStat; be: number | null; bold?: boolean }) {
  if (s.pct == null) return <td style={{ ...NUM, color: "var(--chalk-dim)" }}>–</td>;
  const small = isSmallSample(s.w + s.l);
  return (
    <td style={{ ...NUM, color: colorVs(s.pct, be), fontWeight: bold ? 700 : 400, opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }} title={`${s.w}-${s.l}${s.p ? `-${s.p}` : ""}${small ? " (small sample)" : ""}`}>
      {s.pct.toFixed(1)}% <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({s.n})</span>
    </td>
  );
}

export default function DrogbaTeasersTab({ state }: { state: DrogbaState }) {
  // ---- pricing
  const [legs, setLegs] = useState(2);
  const [risk, setRisk] = useState(10);
  const [toWin, setToWin] = useState(9.34);
  const [mode, setMode] = useState<"ticket" | "american" | "cents">("ticket");
  const [american, setAmerican] = useState(-120);
  const [cents, setCents] = useState(72);
  const be = useMemo(() => {
    if (mode === "cents") return cents > 0 && cents < 100 ? cents / 100 : null;
    return breakEvenPerLeg(mode === "american" ? { legs, risk: 100, toWin: toWinFromAmerican(american) } : { legs, risk, toWin });
  }, [mode, legs, risk, toWin, american, cents]);

  // ---- filters
  const [source, setSource] = useState<LineSource>("close");
  const [points, setPoints] = useState(6);
  const [tier, setTier] = useState<Tier | "all">("all");
  const [band, setBand] = useState<TotalBand>("any");
  const [cond, setCond] = useState<Condition>("none");
  const [role, setRole] = useState<Role>("dog");
  const filter: LegFilter = { tier, band, cond, points };

  // ---- projections for the conditions
  const [yc, setYc] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!state.games.length) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ BET_HISTORY }, locks] = await Promise.all([import("../../data/betHistory.data"), fetchGameProjectionLocks(2026, Array.from({ length: 16 }, (_, i) => i + 1))]);
        if (!cancelled) setYc(ycSpreadByGame(state.games, BET_HISTORY as any, Object.values(locks)));
      } catch {
        if (!cancelled) setYc(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.games]);
  const dm = useMemo(() => (state.engine && cond !== "none" ? drogbaMargins(state.engine.signals, [2023, 2024, 2025, 2026]) : new Map<string, number>()), [state.engine, cond]);
  const games = useMemo(() => buildTeaserGames(state.games, source, yc ?? new Map(), dm), [state.games, source, yc, dm]);

  // ---- pair builder
  const [legA, setLegA] = useState("fav|8.5");
  const [legB, setLegB] = useState("dog|2.5");

  if (state.loading || state.building) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error) return <p style={{ color: "crimson" }}>{state.error}</p>;

  const lines = Array.from({ length: 14 }, (_, i) => i + 0.5); // 0.5 … 13.5
  const pair = (key: string) => {
    const [r, l] = key.split("|");
    return { role: r as Role, line: Number(l) };
  };
  const a = pair(legA);
  const b = pair(legB);
  const sA = legStat(games, a.role, a.line, filter);
  const sB = legStat(games, b.role, b.line, filter);
  const ev = sA.pct != null && sB.pct != null ? ticketEv([sA.pct, sB.pct], mode === "american" ? { legs: 2, risk: 100, toWin: toWinFromAmerican(american) } : { legs: 2, risk, toWin }) : null;
  const legOptions = [...FEATURED.map((f) => `${f.role}|${f.line}`), ...lines.flatMap((l) => (["fav", "dog"] as Role[]).map((r) => `${r}|${l}`))].filter((v, i, arr) => arr.indexOf(v) === i);
  const legLabel = (key: string) => {
    const { role: r, line } = pair(key);
    return r === "fav" ? `Favorite −${line} → −${line - points}` : `Underdog +${line} → +${line + points}`;
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ marginTop: 0 }}>Teasers</h2>
      <p style={P}>
        How often a teased leg covers, by season and line, FBS vs FBS, 2021–26. A favorite at −8.5 teased {points} points is −{(8.5 - points).toFixed(1)}; an underdog at +2.5 teased is +{(2.5 + points).toFixed(1)}. Pushes are counted as pushes and left out of the
        percentage. Colors compare each rate to the break-even set below, not to −110.
      </p>

      <h3 style={H3}>Break-even per leg</h3>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.85rem" }}>
        <select className="filter" value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="ticket">Ticket: risk / to win</option>
          <option value="american">Ticket: American odds</option>
          <option value="cents">Per-leg price (prediction market, ¢)</option>
        </select>
        {mode !== "cents" && (
          <label>
            Legs{" "}
            <input className="filter" type="number" min={1} max={8} value={legs} onChange={(e) => setLegs(Math.max(1, Number(e.target.value)))} style={{ width: "4rem" }} />
          </label>
        )}
        {mode === "ticket" && (
          <>
            <label>
              Risk <input className="filter" type="number" step={0.01} value={risk} onChange={(e) => setRisk(Number(e.target.value))} style={{ width: "5rem" }} />
            </label>
            <label>
              To win <input className="filter" type="number" step={0.01} value={toWin} onChange={(e) => setToWin(Number(e.target.value))} style={{ width: "5rem" }} />
            </label>
          </>
        )}
        {mode === "american" && (
          <label>
            Odds <input className="filter" type="number" value={american} onChange={(e) => setAmerican(Number(e.target.value))} style={{ width: "5rem" }} />
          </label>
        )}
        {mode === "cents" && (
          <label>
            Price per leg <input className="filter" type="number" step={0.5} value={cents} onChange={(e) => setCents(Number(e.target.value))} style={{ width: "5rem" }} />¢
          </label>
        )}
        <strong style={{ fontSize: "1rem" }}>{be == null ? "–" : `${(be * 100).toFixed(1)}% per leg`}</strong>
      </div>
      <p style={DIM}>
        Legs are treated as independent, so the whole-ticket break-even is the per-leg rate multiplied by itself. {mode === "cents" ? "A prediction-market price in cents is the break-even for that leg." : "Example: two legs paying 10 to win 9.34 need 71.9% each."}
      </p>

      <h3 style={H3}>Filters</h3>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.85rem" }}>
        <select className="filter" value={source} onChange={(e) => setSource(e.target.value as LineSource)}>
          <option value="close">Closing line (Bovada)</option>
          <option value="open">Opening line (model's open)</option>
        </select>
        <label>
          Teaser points{" "}
          <select className="filter" value={points} onChange={(e) => setPoints(Number(e.target.value))}>
            {[6, 6.5, 7].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <select className="filter" value={tier} onChange={(e) => setTier(e.target.value as any)}>
          <option value="all">All games</option>
          <option value="power">{TIER_LABELS.power}</option>
          <option value="other">{TIER_LABELS.other}</option>
        </select>
        <select className="filter" value={band} onChange={(e) => setBand(e.target.value as TotalBand)}>
          {(Object.keys(TOTAL_BAND_LABELS) as TotalBand[]).map((k) => (
            <option key={k} value={k}>{TOTAL_BAND_LABELS[k]}</option>
          ))}
        </select>
        <select className="filter" value={cond} onChange={(e) => setCond(e.target.value as Condition)}>
          {(Object.keys(CONDITION_LABELS) as Condition[]).map((k) => (
            <option key={k} value={k}>{CONDITION_LABELS[k]}</option>
          ))}
        </select>
      </div>
      {cond !== "none" && (
        <p style={DIM}>
          The condition keeps only games where that projection already has the original side covering the original line (favorite wins by more than the line; underdog loses by less than it). YC numbers exist for 2024–26 and DROGBA's (fit on earlier
          seasons) for 2023–26, so earlier seasons show –. {yc == null ? "Loading YC projections…" : ""}
        </p>
      )}

      <h3 style={H3}>Featured legs, by season</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Leg</th>
              {SEASONS.map((s) => (
                <th key={s} style={HEAD}>{s}</th>
              ))}
              <th style={HEAD}>All</th>
              <th style={HEAD} title="2024–26 compared with 2021–23">Last 3 vs first 3</th>
            </tr>
          </thead>
          <tbody>
            {FEATURED.map((f) => {
              const early = legStat(games, f.role, f.line, filter, [2021, 2022, 2023]);
              const late = legStat(games, f.role, f.line, filter, [2024, 2025, 2026]);
              return (
                <tr key={`${f.role}${f.line}`}>
                  <td style={CELL}>{legLabel(`${f.role}|${f.line}`)}</td>
                  {SEASONS.map((s) => (
                    <Cell key={s} s={legStat(games, f.role, f.line, filter, [s])} be={be} />
                  ))}
                  <Cell s={legStat(games, f.role, f.line, filter)} be={be} bold />
                  <td style={NUM}>{early.pct == null || late.pct == null ? "–" : `${late.pct - early.pct > 0 ? "+" : ""}${(late.pct - early.pct).toFixed(1)}`}</td>
                </tr>
              );
            })}
            {(
              [
                { label: "Favorites −7.5 to −9.5 (all three lines)", role: "fav" as Role, lo: 7.5, hi: 9.5 },
                { label: "Underdogs +1.5 to +3.5 (all three lines)", role: "dog" as Role, lo: 1.5, hi: 3.5 },
              ]
            ).map((x) => (
              <tr key={x.label}>
                <td style={CELL}>{x.label}</td>
                {SEASONS.map((s) => (
                  <Cell key={s} s={bandStat(games, x.role, x.lo, x.hi, filter, [s])} be={be} />
                ))}
                <Cell s={bandStat(games, x.role, x.lo, x.hi, filter)} be={be} bold />
                <td style={NUM}>–</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={H3}>Every line</h3>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
        {(["dog", "fav"] as Role[]).map((r) => (
          <button key={r} className={`mode-btn ${role === r ? "mode-btn-active" : ""}`} onClick={() => setRole(r)}>
            {r === "dog" ? "Underdogs" : "Favorites"}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Line → teased</th>
              {SEASONS.map((s) => (
                <th key={s} style={HEAD}>{s}</th>
              ))}
              <th style={HEAD}>All</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const all = legStat(games, role, l, filter);
              if (all.n === 0) return null;
              return (
                <tr key={l}>
                  <td style={CELL}>{role === "fav" ? `−${l} → −${l - points}` : `+${l} → +${l + points}`}</td>
                  {SEASONS.map((s) => (
                    <Cell key={s} s={legStat(games, role, l, filter, [s])} be={be} />
                  ))}
                  <Cell s={all} be={be} bold />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={H3}>Two-leg ticket</h3>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.85rem" }}>
        {[
          [legA, setLegA],
          [legB, setLegB],
        ].map(([val, set], i) => (
          <select key={i} className="filter" value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)}>
            {legOptions.map((o) => (
              <option key={o} value={o}>{legLabel(o)}</option>
            ))}
          </select>
        ))}
      </div>
      <p style={P}>
        {sA.pct == null || sB.pct == null ? (
          "Not enough games for one of the legs with these filters."
        ) : (
          <>
            Cover rates {sA.pct.toFixed(1)}% ({sA.n}) and {sB.pct.toFixed(1)}% ({sB.n}) → both hit {((sA.pct * sB.pct) / 100).toFixed(1)}% of the time if independent
            {ev == null ? "" : `; expected profit ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}¢ per $1 risked at ${mode === "american" ? `${american}` : `${risk} to win ${toWin}`}`}.
            Both legs would have to come from different games; same-game legs aren't independent.
          </>
        )}
      </p>
      <p style={DIM}>
        Counts are small for any single line in a single season (the numbers in brackets), so read the All column and the three-line bands first. A leg above the break-even in every season is more believable than one that is high on average.
      </p>
    </div>
  );
}
