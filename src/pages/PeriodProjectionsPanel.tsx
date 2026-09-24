import { Fragment, useEffect, useMemo, useState } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { applyLockedSpreadToRows, applyLockedTotals, useGameTotalsEngine, type EnrichedGameRow } from "../lib/gameTotalsEngine";
import { fetchPeriodLocks, lockPeriodProjections, lockedPeriodValue, type PeriodLockRow } from "../lib/api/periodLocks";
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PERIOD_MODEL_VERSION,
  buildPeriodDistribution,
  priceLine,
  summarize,
  type PeriodDistribution,
  type PeriodKey,
  type PeriodMarket,
  type PeriodSummary,
} from "../lib/periodSim";

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtNum(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
}
function fmtPrice(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v}`;
}
function fmtKickoff(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

interface GameRowData {
  gameId: string;
  week: number;
  awayTeam: string;
  homeTeam: string;
  startDate: string | null;
  neutralSite: boolean;
  homeSpread: number;
  total: number;
}

// What each period shows: mean away spread + mean total + team totals, either
// from the live model or, once frozen, from the stored lock.
type PeriodValues = Record<PeriodKey, { awaySpread: number | null; total: number | null; awayTotal: number | null; homeTotal: number | null; medianAwaySpread: number | null; medianTotal: number | null }>;

function valuesFromSummaries(sums: Record<PeriodKey, PeriodSummary>): PeriodValues {
  const out = {} as PeriodValues;
  for (const k of PERIOD_KEYS) {
    const s = sums[k];
    out[k] = {
      awaySpread: s.meanAwaySpread,
      total: s.meanTotal,
      awayTotal: s.meanAwayTotal,
      homeTotal: s.meanHomeTotal,
      medianAwaySpread: s.medianAwaySpread,
      medianTotal: s.medianTotal,
    };
  }
  return out;
}

function valuesFromLock(lock: PeriodLockRow): PeriodValues {
  const out = {} as PeriodValues;
  for (const k of PERIOD_KEYS) {
    if (k === "game") {
      const sp = lock.game_home_spread != null ? -lock.game_home_spread : null; // away spread = -(home spread)
      const tot = lock.game_total;
      out[k] = {
        awaySpread: sp,
        total: tot,
        awayTotal: sp != null && tot != null ? (tot - sp) / 2 : null,
        homeTotal: sp != null && tot != null ? (tot + sp) / 2 : null,
        medianAwaySpread: null,
        medianTotal: null,
      };
      continue;
    }
    const v = lockedPeriodValue(lock, k);
    out[k] = {
      awaySpread: v.awaySpread,
      total: v.total,
      awayTotal: v.awaySpread != null && v.total != null ? (v.total - v.awaySpread) / 2 : null,
      homeTotal: v.awaySpread != null && v.total != null ? (v.total + v.awaySpread) / 2 : null,
      medianAwaySpread: null,
      medianTotal: null,
    };
  }
  return out;
}

function PriceCalculator({ dist }: { dist: PeriodDistribution }) {
  const [period, setPeriod] = useState<PeriodKey>("h1");
  const [market, setMarket] = useState<PeriodMarket>("total");
  const [lineText, setLineText] = useState("");
  const line = lineText.trim() === "" ? null : Number(lineText);
  const price = line != null && !Number.isNaN(line) ? priceLine(dist, period, market, line) : null;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const overLabel = market === "spread" ? "Away covers" : "Over";
  const underLabel = market === "spread" ? "Home covers" : "Under";
  return (
    <div style={{ marginTop: "0.8rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.8rem" }}>
      <span style={{ color: "var(--chalk-dim)" }}>Price a line:</span>
      <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
        {PERIOD_KEYS.map((k) => (
          <option key={k} value={k}>
            {PERIOD_LABELS[k]}
          </option>
        ))}
      </select>
      <select value={market} onChange={(e) => setMarket(e.target.value as PeriodMarket)}>
        <option value="total">Total</option>
        <option value="spread">Spread (away line)</option>
        <option value="teamTotalAway">Away team total</option>
        <option value="teamTotalHome">Home team total</option>
      </select>
      <input value={lineText} onChange={(e) => setLineText(e.target.value)} placeholder="line, e.g. 24.5" style={{ width: 110 }} />
      {price && (
        <span>
          {overLabel} {pct(price.pOver)} ({fmtPrice(price.fairOver)}) · {underLabel} {pct(price.pUnder)} ({fmtPrice(price.fairUnder)}) · Push {pct(price.pPush)}
        </span>
      )}
    </div>
  );
}

export default function PeriodProjectionsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [periodLocks, setPeriodLocks] = useState<Record<string, PeriodLockRow>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);

  const { locks: gameLocks } = useGameProjectionLocks(season, [week]);
  const { rows: totalsRows, loading: totalsLoading } = useGameTotalsEngine(season);

  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season, week).then((g) => !cancelled && setGames(g)).catch(() => !cancelled && setGames([]));
    fetchPeriodLocks(season, week).then((l) => !cancelled && setPeriodLocks(l)).catch(() => !cancelled && setPeriodLocks({}));
    return () => {
      cancelled = true;
    };
  }, [season, week, reloadTick]);

  const rows: GameRowData[] = useMemo(() => {
    const lockedTotalByKey = new Map<string, number>();
    const lockedAwaySpreadByKey = new Map<string, number>();
    for (const g of games) {
      const l = gameLocks[g.id];
      if (l?.my_total != null) lockedTotalByKey.set(`${g.week}|${g.home_team}|${g.away_team}`, l.my_total);
      if (l?.my_away_spread != null) lockedAwaySpreadByKey.set(`${g.week}|${g.home_team}|${g.away_team}`, l.my_away_spread);
    }
    const weekRows = totalsRows.filter(
      (r: EnrichedGameRow) => r.game.week === week && r.game.homeClassification === "fbs" && r.game.awayClassification === "fbs"
    );
    const adjusted = applyLockedSpreadToRows(applyLockedTotals(weekRows, lockedTotalByKey), lockedAwaySpreadByKey);
    const out: GameRowData[] = [];
    for (const r of adjusted) {
      const total = r.projection?.projectedTotal;
      if (total == null || r.myHomeSpread == null) continue;
      out.push({
        gameId: r.game.id,
        week: r.game.week,
        awayTeam: r.game.awayTeam,
        homeTeam: r.game.homeTeam,
        startDate: r.game.startDate,
        neutralSite: r.game.neutralSite,
        homeSpread: r.myHomeSpread,
        total,
      });
    }
    return out.sort((a, b) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());
  }, [totalsRows, week, games, gameLocks]);

  // One distribution per game. A game with a frozen period lock is rebuilt
  // from the lock's own stored inputs (and only if the model version still
  // matches, so a retrain can't quietly change what's priced); otherwise
  // from today's projection.
  const computed = useMemo(() => {
    const map = new Map<string, { dist: PeriodDistribution | null; values: PeriodValues; locked: PeriodLockRow | null; versionMismatch: boolean }>();
    for (const r of rows) {
      const lock = periodLocks[r.gameId] ?? null;
      if (lock) {
        const sameVersion = lock.ridge_model_version === PERIOD_MODEL_VERSION;
        const dist =
          sameVersion && lock.game_home_spread != null && lock.game_total != null
            ? buildPeriodDistribution({ homeSpread: lock.game_home_spread, total: lock.game_total, neutralSite: lock.neutral_site })
            : null;
        map.set(r.gameId, { dist, values: valuesFromLock(lock), locked: lock, versionMismatch: !sameVersion });
        continue;
      }
      const dist = buildPeriodDistribution({ homeSpread: r.homeSpread, total: r.total, neutralSite: r.neutralSite });
      const sums = {} as Record<PeriodKey, PeriodSummary>;
      for (const k of PERIOD_KEYS) sums[k] = summarize(dist, k);
      map.set(r.gameId, { dist, values: valuesFromSummaries(sums), locked: null, versionMismatch: false });
    }
    return map;
  }, [rows, periodLocks]);

  const unlockedRows = rows.filter((r) => !periodLocks[r.gameId]);

  async function handleLock() {
    if (unlockedRows.length === 0) return;
    if (!window.confirm(`Freeze period projections for ${unlockedRows.length} game(s) in week ${week}? Once locked, a later ridge-model update won't change them.`)) return;
    setLocking(true);
    setMsg(null);
    try {
      const candidates = unlockedRows.map((r) => {
        const v = computed.get(r.gameId)!.values;
        return {
          game_id: r.gameId,
          season,
          week,
          home_team: r.homeTeam,
          away_team: r.awayTeam,
          neutral_site: r.neutralSite,
          game_home_spread: r.homeSpread,
          game_total: r.total,
          ridge_model_version: PERIOD_MODEL_VERSION,
          h1_away_spread: v.h1.awaySpread,
          h1_total: v.h1.total,
          h2_away_spread: v.h2.awaySpread,
          h2_total: v.h2.total,
          q1_away_spread: v.q1.awaySpread,
          q1_total: v.q1.total,
          q2_away_spread: v.q2.awaySpread,
          q2_total: v.q2.total,
          q3_away_spread: v.q3.awaySpread,
          q3_total: v.q3.total,
          q4_away_spread: v.q4.awaySpread,
          q4_total: v.q4.total,
        };
      });
      const result = await lockPeriodProjections(candidates);
      setMsg(`Locked ${result.locked} game(s).`);
      setReloadTick((n) => n + 1);
    } catch (err: any) {
      setMsg(err.message ?? "Lock failed");
    } finally {
      setLocking(false);
    }
  }

  const cell = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", fontSize: "0.78rem", whiteSpace: "nowrap" as const };
  const head = { ...cell, textAlign: "right" as const, color: "var(--chalk-dim)", fontWeight: 600 };

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Period Projections</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        1st/2nd half and quarter spreads, totals and team totals for each FBS-vs-FBS game, built from your projected spread and total for
        the game (those stay exactly as they are — this adds a layer underneath). Each game is priced from real historical scoreboards
        re-weighted so their quarter averages match a ridge model (model {PERIOD_MODEL_VERSION}). Regulation only — overtime excluded.
        Spread is the away line (negative = away favored). Values shown are means.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" min={1} max={16} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)} style={{ width: 60 }} />
        </label>
        <button className="menu-btn" onClick={handleLock} disabled={locking || unlockedRows.length === 0}>
          {locking ? "Locking…" : `Lock week (${unlockedRows.length} unlocked)`}
        </button>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          {rows.length - unlockedRows.length} locked · {rows.length} games
        </span>
      </div>
      {msg && <p style={{ fontSize: "0.82rem" }}>{msg}</p>}

      {totalsLoading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No FBS-vs-FBS games with a projection for week {week}.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: "left" }}>Kickoff</th>
                <th style={{ ...cell, textAlign: "left" }}>Game</th>
                <th style={head}>Game Spr</th>
                <th style={head}>Game Tot</th>
                <th style={head}>1H Spr</th>
                <th style={head}>1H Tot</th>
                <th style={head}>2H Spr</th>
                <th style={head}>2H Tot</th>
                <th style={head}>Q1 Tot</th>
                <th style={head}>Q2 Tot</th>
                <th style={head}>Q3 Tot</th>
                <th style={head}>Q4 Tot</th>
                <th style={{ ...cell, textAlign: "left" }}> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = computed.get(r.gameId)!;
                const v = c.values;
                const open = openId === r.gameId;
                return (
                  <Fragment key={r.gameId}>
                    <tr onClick={() => setOpenId(open ? null : r.gameId)} style={{ cursor: "pointer", background: open ? "var(--hash)" : undefined }}>
                      <td style={cell}>{fmtKickoff(r.startDate)}</td>
                      <td style={cell}>
                        <TeamLink team={r.awayTeam} size={16} /> @ <TeamLink team={r.homeTeam} size={16} />
                      </td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtSpread(v.game.awaySpread)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.game.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtSpread(v.h1.awaySpread)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.h1.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtSpread(v.h2.awaySpread)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.h2.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.q1.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.q2.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.q3.total)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v.q4.total)}</td>
                      <td style={{ ...cell, color: c.locked ? "var(--gold, #d9a441)" : "var(--chalk-dim)" }}>{c.locked ? "Locked" : "Live"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={13} style={{ padding: "0.7rem 0.9rem 1rem", borderBottom: "1px solid var(--hash)" }}>
                          <table style={{ borderCollapse: "collapse", fontSize: "0.78rem" }}>
                            <thead>
                              <tr>
                                <th style={{ ...cell, textAlign: "left" }}>Period</th>
                                <th style={head}>Away Spr</th>
                                <th style={head}>Total</th>
                                <th style={head}>{r.awayTeam} TT</th>
                                <th style={head}>{r.homeTeam} TT</th>
                                {!c.locked && <th style={head}>Median Spr / Tot</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {PERIOD_KEYS.map((k) => (
                                <tr key={k}>
                                  <td style={cell}>{PERIOD_LABELS[k]}</td>
                                  <td style={{ ...cell, textAlign: "right" }}>{fmtSpread(v[k].awaySpread)}</td>
                                  <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v[k].total)}</td>
                                  <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v[k].awayTotal)}</td>
                                  <td style={{ ...cell, textAlign: "right" }}>{fmtNum(v[k].homeTotal)}</td>
                                  {!c.locked && (
                                    <td style={{ ...cell, textAlign: "right" }}>
                                      {fmtSpread(v[k].medianAwaySpread)} / {fmtNum(v[k].medianTotal)}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {c.locked && c.versionMismatch && (
                            <p style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
                              Locked under an older model version ({c.locked.ridge_model_version ?? "unknown"}) — shown as frozen, pricing unavailable.
                            </p>
                          )}
                          {c.dist && <PriceCalculator dist={c.dist} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
