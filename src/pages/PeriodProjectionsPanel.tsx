import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/api/fetchAll";
import { BET_HISTORY } from "../data/betHistory.data";
import { pickLine } from "../lib/matchupsCompute";
import { syncTeamTotalsNow } from "../lib/api/teamTotalLines";
import {
  fetchLivePeriodLines,
  fetchUpcomingEvents,
  parseEventOdds,
  savePeriodMarketLines,
  type GameRef,
} from "../lib/api/oddsHistorical";
import { GRADE_PERIODS, consensusLines, gradeItems, summarizeGrades, type GradeItem, type GradedBet, type PeriodLineRowLite } from "../lib/periodGrading";
import { matchSchoolMascotName } from "../lib/teamNameMatch";
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

function pctStr(w: number, l: number): string {
  return w + l === 0 ? "–" : `${((w / (w + l)) * 100).toFixed(1)}%`;
}

export function GradeSection({ title, items, note }: { title: string; items: GradeItem[]; note?: string }) {
  const [minOff, setMinOff] = useState(1.5);
  const [showBets, setShowBets] = useState(false);
  const bets: GradedBet[] = useMemo(() => gradeItems(items), [items]);
  const rows = useMemo(() => summarizeGrades(bets, minOff), [bets, minOff]);
  const cell = { padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", fontSize: "0.78rem", whiteSpace: "nowrap" as const };
  const shown = bets.filter((b) => b.off >= minOff);
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="section-label" style={{ marginBottom: "0.4rem" }}>
        {title}
      </div>
      {note && <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>{note}</p>}
      {bets.length === 0 ? (
        <p style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>No games with both period lines and a projection yet.</p>
      ) : (
        <>
          <label style={{ fontSize: "0.8rem" }}>
            Filtered = bets at least{" "}
            <input type="number" min={0} step={0.5} value={minOff} onChange={(e) => setMinOff(parseFloat(e.target.value) || 0)} style={{ width: 60 }} /> points off the line
          </label>
          <table style={{ borderCollapse: "collapse", marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: "left" }}>Period</th>
                <th style={{ ...cell, textAlign: "left" }}>Market</th>
                <th style={{ ...cell, textAlign: "right" }}>All bets</th>
                <th style={{ ...cell, textAlign: "right" }}>Win %</th>
                <th style={{ ...cell, textAlign: "right" }}>Filtered</th>
                <th style={{ ...cell, textAlign: "right" }}>Win %</th>
                <th style={{ ...cell, textAlign: "right" }}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.period}|${r.market}`}>
                  <td style={cell}>{PERIOD_LABELS[r.period]}</td>
                  <td style={cell}>{r.market === "spread" ? "Spread" : "Total"}</td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {r.w}-{r.l}
                    {r.p ? `-${r.p}` : ""}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>{pctStr(r.w, r.l)}</td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {r.fw}-{r.fl}
                    {r.fp ? `-${r.fp}` : ""}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>{pctStr(r.fw, r.fl)}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.pending || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="menu-btn" style={{ marginTop: "0.6rem" }} onClick={() => setShowBets((v) => !v)}>
            {showBets ? "Hide bets" : `Show ${shown.length} bets`}
          </button>
          {showBets && (
            <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginTop: "0.5rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, textAlign: "left" }}>Game</th>
                    <th style={cell}>Period</th>
                    <th style={cell}>Market</th>
                    <th style={{ ...cell, textAlign: "right" }}>Line</th>
                    <th style={{ ...cell, textAlign: "right" }}>Mine</th>
                    <th style={{ ...cell, textAlign: "right" }}>Off</th>
                    <th style={cell}>Pick</th>
                    <th style={cell}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b, i) => (
                    <tr key={i}>
                      <td style={cell}>{b.label}</td>
                      <td style={cell}>{PERIOD_LABELS[b.period]}</td>
                      <td style={cell}>{b.market}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{b.market === "spread" ? fmtSpread(b.line) : fmtNum(b.line)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{b.market === "spread" ? fmtSpread(b.mine) : fmtNum(b.mine)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{b.off.toFixed(1)}</td>
                      <td style={cell}>{b.pick}</td>
                      <td style={{ ...cell, color: b.result === "win" ? "#8fd39a" : b.result === "loss" ? "#e07a7a" : undefined }}>{b.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Past games: my period projections rebuilt from what I had then (2024/25:
// the uploaded spread projection + the market's closing total, since totals
// weren't being projected; 2026: the locked spread/total), graded against
// the saved period lines and the real quarter scores.
export function HistoryGrading() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(0);
  const [items, setItems] = useState<GradeItem[] | null>(null);
  const [status, setStatus] = useState("");
  const allWeeks = useMemo(() => Array.from({ length: 16 }, (_, i) => i + 1), []);
  const { locks } = useGameProjectionLocks(season, allWeeks);
  const lockCount = Object.keys(locks).length;

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setStatus("Loading…");
    (async () => {
      const games = (await fetchGamesWithLines(season)).filter(
        (g) => g.home_classification === "fbs" && g.away_classification === "fbs" && g.completed && (week === 0 || g.week === week) && g.home_line_scores
      );
      const lineRows = await fetchAllRows<PeriodLineRowLite>((from, to) =>
        supabase.from("period_market_lines").select("game_id, period, market_type, provider, point").eq("season", season).order("id").range(from, to)
      );
      const byGame = new Map<string, PeriodLineRowLite[]>();
      for (const r of lineRows) byGame.set(r.game_id, [...(byGame.get(r.game_id) ?? []), r]);
      const withLines = games.filter((g) => byGame.has(g.id));
      const bh = new Map(BET_HISTORY.filter((r) => r.season === season).map((r) => [`${r.week}|${r.homeTeam}|${r.awayTeam}`, r]));
      const out: GradeItem[] = [];
      let noProjection = 0;
      for (const g of withLines) {
        let homeSpread: number | null = null;
        let total: number | null = null;
        if (season < 2026) {
          const r = bh.get(`${g.week}|${g.home_team}|${g.away_team}`);
          if (r) homeSpread = r.prediction;
          total = pickLine(g.lines)?.over_under ?? null;
        } else {
          const l = locks[g.id];
          if (l?.my_away_spread != null && l.my_total != null) {
            homeSpread = -l.my_away_spread;
            total = l.my_total;
          }
        }
        if (homeSpread == null || total == null) {
          noProjection++;
          continue;
        }
        const dist = buildPeriodDistribution({ homeSpread, total, neutralSite: g.neutral_site });
        const mine = {} as GradeItem["mine"];
        for (const p of GRADE_PERIODS) {
          const sm = summarize(dist, p);
          mine[p] = { awaySpread: sm.meanAwaySpread, total: sm.meanTotal };
        }
        out.push({
          gameId: g.id,
          label: `${g.away_team} @ ${g.home_team} (wk ${g.week})`,
          mine,
          lines: consensusLines(byGame.get(g.id)!),
          awayLineScores: g.away_line_scores,
          homeLineScores: g.home_line_scores,
        });
      }
      if (cancelled) return;
      setItems(out);
      setStatus(`${withLines.length} game(s) with saved period lines${noProjection ? `, ${noProjection} skipped (no projection found)` : ""}.`);
    })().catch((e) => !cancelled && setStatus(e.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, lockCount]);

  return (
    <div style={{ marginTop: "2.5rem", borderTop: "1px solid var(--hash)", paddingTop: "1rem" }}>
      <h3 style={{ marginTop: 0 }}>Grade history</h3>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" min={0} max={16} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 0)} style={{ width: 60 }} /> (0 = all)
        </label>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{status}</span>
      </div>
      {items && (
        <GradeSection
          title={`Period projections vs saved period lines — ${season}${week ? ` week ${week}` : ""}`}
          items={items}
          note={
            season < 2026
              ? "My spread = the uploaded projection at the time; total = the market's closing total (totals weren't projected then). Lines are the median across books at a snapshot 5 minutes before kickoff."
              : "Uses the locked spread and total for each game. Lines are the median across books."
          }
        />
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

  const [lineRows, setLineRows] = useState<Record<string, PeriodLineRowLite[]>>({});
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncHalves, setSyncHalves] = useState(true);
  const [syncQuarters, setSyncQuarters] = useState(false);
  const [syncTeamTotals, setSyncTeamTotals] = useState(true);
  const { locks: gameLocks } = useGameProjectionLocks(season, [week]);
  const { rows: totalsRows, loading: totalsLoading } = useGameTotalsEngine(season);

  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season, week).then((g) => !cancelled && setGames(g)).catch(() => !cancelled && setGames([]));
    fetchPeriodLocks(season, week).then((l) => !cancelled && setPeriodLocks(l)).catch(() => !cancelled && setPeriodLocks({}));
    fetchAllRows<PeriodLineRowLite>((from, to) =>
      supabase.from("period_market_lines").select("game_id, period, market_type, provider, point").eq("season", season).eq("week", week).order("id").range(from, to)
    )
      .then((rows) => {
        if (cancelled) return;
        const m: Record<string, PeriodLineRowLite[]> = {};
        for (const r of rows) (m[r.game_id] ??= []).push(r);
        setLineRows(m);
      })
      .catch(() => !cancelled && setLineRows({}));
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

  const weekGradeItems: GradeItem[] = useMemo(() => {
    const out: GradeItem[] = [];
    for (const r of rows) {
      const lr = lineRows[r.gameId];
      if (!lr) continue;
      const g = games.find((x) => x.id === r.gameId);
      const v = computed.get(r.gameId)?.values;
      if (!v) continue;
      const mine = {} as GradeItem["mine"];
      for (const p of GRADE_PERIODS) mine[p] = { awaySpread: v[p].awaySpread, total: v[p].total };
      out.push({ gameId: r.gameId, label: `${r.awayTeam} @ ${r.homeTeam}`, mine, lines: consensusLines(lr), awayLineScores: g?.away_line_scores, homeLineScores: g?.home_line_scores });
    }
    return out;
  }, [rows, lineRows, games, computed]);

  async function handleSyncLines() {
    const targets = games.filter((g) => !g.completed && g.home_classification === "fbs" && g.away_classification === "fbs");
    const markets: string[] = [];
    if (syncHalves) markets.push("spreads_h1", "totals_h1", "spreads_h2", "totals_h2");
    if (syncQuarters) for (const q of [1, 2, 3, 4]) markets.push(`spreads_q${q}`, `totals_q${q}`);
    if (targets.length === 0) {
      setSyncMsg("No unplayed FBS-vs-FBS games this week.");
      return;
    }
    const perGame = markets.length + (syncTeamTotals ? 1 : 0);
    if (perGame === 0) return;
    if (!window.confirm(`Sync current lines for up to ${targets.length} game(s), week ${week}?\n\nEstimated cost up to ${targets.length * perGame} credits (${perGame} per game: 1 per market). Games not yet posted cost less.`)) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      let periodSaved = 0;
      let ttRows = 0;
      if (markets.length > 0) {
        const events = await fetchUpcomingEvents();
        const byPair = new Map<string, string>();
        for (const e of events) {
          const h = matchSchoolMascotName(e.homeTeam);
          const a = matchSchoolMascotName(e.awayTeam);
          if (h && a) byPair.set([h, a].sort().join("|"), e.id);
        }
        const gameByEvent = new Map<string, GameWithLines>();
        for (const g of targets) {
          const id = byPair.get([g.home_team, g.away_team].sort().join("|"));
          if (id) gameByEvent.set(id, g);
        }
        if (gameByEvent.size > 0) {
          const { results, quota } = await fetchLivePeriodLines(Array.from(gameByEvent.keys()), markets);
          const toSave = [] as ReturnType<typeof parseEventOdds>["period"];
          for (const r of results) {
            const g = gameByEvent.get(r.eventId);
            if (!g || r.error) continue;
            const ref: GameRef = { id: g.id, season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team };
            toSave.push(...parseEventOdds({ timestamp: null, homeTeam: r.homeTeam, awayTeam: r.awayTeam, bookmakers: r.bookmakers, quota }, ref, false).period);
          }
          if (toSave.length > 0) periodSaved = (await savePeriodMarketLines(toSave, true)).saved;
        }
      }
      if (syncTeamTotals) ttRows = (await syncTeamTotalsNow(targets, season)).rows;
      setSyncMsg(`Saved ${periodSaved} period line rows and ${ttRows} team-total rows.`);
      setReloadTick((n) => n + 1);
    } catch (err: any) {
      setSyncMsg(err.message ?? "Sync failed");
    } finally {
      setSyncing(false);
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

      <div style={{ display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem", fontSize: "0.82rem" }}>
        <button className="menu-btn" onClick={handleSyncLines} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync lines (manual)"}
        </button>
        <label>
          <input type="checkbox" checked={syncHalves} onChange={(e) => setSyncHalves(e.target.checked)} /> 1H/2H
        </label>
        <label>
          <input type="checkbox" checked={syncQuarters} onChange={(e) => setSyncQuarters(e.target.checked)} /> Quarters
        </label>
        <label>
          <input type="checkbox" checked={syncTeamTotals} onChange={(e) => setSyncTeamTotals(e.target.checked)} /> Game team totals
        </label>
        <span style={{ color: "var(--chalk-dim)" }}>Costs 1 credit per market per game; asks first.</span>
        {syncMsg && <span>{syncMsg}</span>}
      </div>

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

      <GradeSection
        title={`Week ${week}: my period projections vs the market's period lines`}
        items={weekGradeItems}
        note="Lines are the median across books. Games that haven't finished stay 'pending'; use Lock week first so the numbers being graded can't change."
      />

      <p style={{ marginTop: "2rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
        Results across past weeks and seasons (including everything pulled in Historical Odds Pull) are in Admin → Period Grading.
      </p>
    </div>
  );
}
