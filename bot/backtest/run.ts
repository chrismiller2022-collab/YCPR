// Backtest YCPR fair prices against Kalshi CFB spread markets.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx bot/backtest/run.ts [season]
//
// Uses only projections frozen BEFORE kickoff (game_projection_locks with
// locked_at <= start_date), so no game is priced with knowledge of its result.
// Kalshi history comes from public endpoints and is cached in bot/backtest/.cache.
// Writes docs/kalshi-backtest-<season>.md. Read-only everywhere.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matchTeamName } from "../../src/lib/teamNameMatch";
import { DEFAULT_MARGIN_MODEL, marginPmf, type MarginModel } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { eventCandles, settledEvents } from "./kalshiHistory";
import { blendProb, clamp, fitBlend, gameBootstrap, logLoss, mid, quoteAt, rng, simulateTaker, type Quote, type Rung } from "./analysis";

const SERIES = "KXNCAAFSPREAD";
const season = Number(process.argv[2]) || 2026;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  process.exit(1);
}

async function rest<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + 999}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

interface GameRow { id: string; week: number; start_date: string; home_team: string; away_team: string; home_points: number; away_points: number }
interface LockRow { game_id: string; my_away_spread: number | null; locked_at: string }
interface LineRow { game_id: string; provider: string; spread: number | null }

const games = await rest<GameRow>(`games?select=id,week,start_date,home_team,away_team,home_points,away_points&season=eq.${season}&completed=is.true&home_classification=eq.fbs&away_classification=eq.fbs&order=id`);
const locks = new Map((await rest<LockRow>(`game_projection_locks?select=game_id,my_away_spread,locked_at&season=eq.${season}&order=game_id`)).map((l) => [String(l.game_id), l]));
const PROVIDER_RANK: Record<string, number> = { market_median: 0, consensus: 1 };
const bookSpread = new Map<string, { rank: number; spread: number }>();
for (const l of await rest<LineRow>(`betting_lines?select=game_id,provider,spread&season=eq.${season}&spread=not.is.null&order=id`)) {
  const rank = PROVIDER_RANK[l.provider] ?? 2;
  const cur = bookSpread.get(String(l.game_id));
  if (!cur || rank < cur.rank) bookSpread.set(String(l.game_id), { rank, spread: l.spread! });
}

// Honest games only: projection frozen at or before kickoff.
const eligible = games.filter((g) => {
  const l = locks.get(String(g.id));
  return l && l.my_away_spread != null && new Date(l.locked_at) <= new Date(g.start_date);
});

const yy = String(season).slice(2);
const events = (await settledEvents(SERIES)).filter((e) => e.event_ticker.startsWith(`${SERIES}-${yy}`));
const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const canon = (name: string) => matchTeamName(name.trim()).matched;

const unmatchedNames = new Set<string>();
const gameByEvent = new Map<string, { game: GameRow; event: (typeof events)[number] }>();
for (const e of events) {
  const m = /-(\d\d)([A-Z]{3})(\d\d)/.exec(e.event_ticker);
  const names = e.title.replace(/:\s*Spread$/i, "").split(/\s+(?:vs\.?|at|@)\s+/i);
  if (!m || names.length !== 2) continue;
  const date = Date.UTC(2000 + Number(m[1]), MONTHS[m[2]], Number(m[3]));
  const [a, b] = names.map(canon);
  names.forEach((n, i) => [a, b][i] == null && unmatchedNames.add(n));
  if (!a || !b) continue;
  const g = eligible.find(
    (g) => new Set([g.home_team, g.away_team]).has(a) && new Set([g.home_team, g.away_team]).has(b) && Math.abs(new Date(g.start_date).getTime() - date) < 2.5 * 86400e3
  );
  if (g) gameByEvent.set(e.event_ticker, { game: g, event: e });
}

function buildRungs(model: MarginModel): { rungs: Rung[]; skippedMarkets: number } {
  const rungs: Rung[] = [];
  let skippedMarkets = 0;
  for (const { game: g, event: e } of gameByEvent.values()) {
    const lock = locks.get(String(g.id))!;
    const pmf = marginPmf(Number(lock.my_away_spread), model);
    const line = bookSpread.get(String(g.id));
    const bookPmf = line ? marginPmf(-line.spread, model) : null;
    const candles = candleCache.get(e.event_ticker);
    for (const mk of e.markets) {
      const team = canon(mk.yes_sub_title.replace(/\s+wins by over.*$/i, ""));
      const side = team === g.home_team ? "home" : team === g.away_team ? "away" : null;
      if (!side || (mk.result !== "yes" && mk.result !== "no")) {
        skippedMarkets++;
        continue;
      }
      const idx = candles?.market_tickers.indexOf(mk.ticker) ?? -1;
      const quotes: Quote[] = [];
      for (const c of idx >= 0 ? candles!.market_candlesticks[idx] : []) {
        const bid = Number(c.yes_bid?.close_dollars ?? 0);
        const ask = Number(c.yes_ask?.close_dollars ?? 1);
        if (bid > 0 && ask < 1 && ask > bid) quotes.push({ t: c.end_period_ts, bid, ask });
      }
      rungs.push({
        gameId: String(g.id),
        week: g.week,
        ticker: mk.ticker,
        kickoff: Math.floor(new Date(g.start_date).getTime() / 1000),
        result: mk.result === "yes" ? 1 : 0,
        fair: kalshiSpreadYesProb(pmf, side, mk.floor_strike),
        bookFair: bookPmf ? kalshiSpreadYesProb(bookPmf, side, mk.floor_strike) : null,
        quotes,
      });
    }
  }
  return { rungs, skippedMarkets };
}

// Fetch hourly candles for each matched event, from its earliest market open to kickoff.
const candleCache = new Map<string, Awaited<ReturnType<typeof eventCandles>>>();
let done = 0;
for (const { game: g, event: e } of gameByEvent.values()) {
  const start = Math.floor(Math.min(...e.markets.map((m) => new Date(m.open_time).getTime())) / 1000);
  const end = Math.floor(new Date(g.start_date).getTime() / 1000);
  if (end > start) candleCache.set(e.event_ticker, await eventCandles(SERIES, e.event_ticker, start, end));
  if (++done % 50 === 0) console.error(`candles ${done}/${gameByEvent.size}`);
}

const { rungs, skippedMarkets } = buildRungs(DEFAULT_MARGIN_MODEL);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const c2 = (x: number) => (x * 100).toFixed(2);
const ci = (b: { mean: number; lo: number; hi: number }, f = c2) => `${f(b.mean)} [${f(b.lo)}, ${f(b.hi)}]`;
const lines: string[] = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};

out(`# Kalshi CFB spread backtest: ${season}`);
out();
out(`Generated ${new Date().toISOString()} by \`bot/backtest/run.ts\`. Read-only: no orders were placed.`);
out();
out("## Coverage");
out(`- FBS-vs-FBS completed games: ${games.length}; with a projection frozen before kickoff: ${eligible.length}.`);
out(`- Settled Kalshi ${SERIES} events for ${season}: ${events.length}; matched to an eligible game: ${gameByEvent.size}.`);
out(`- Rungs (markets) on matched games: ${rungs.length} (skipped ${skippedMarkets} void/unmapped); with a two-sided quote at kickoff: ${rungs.filter((r) => quoteAt(r)).length}.`);
if (unmatchedNames.size) out(`- Kalshi team names not mapped by matchTeamName: ${[...unmatchedNames].sort().join(", ")}.`);
out();

// ---- 1. Forecast quality: our fair vs Kalshi's price, scored on settlement.
function scoreSection(label: string, at: (r: Rung) => number, maxSpread: number | null) {
  const rows = rungs
    .map((r) => ({ r, q: quoteAt(r, at(r)) }))
    .filter((x): x is { r: Rung; q: Quote } => x.q != null && (maxSpread == null || x.q.ask - x.q.bid <= maxSpread));
  const diff = gameBootstrap(rows.map(({ r, q }) => ({ gameId: r.gameId, v: logLoss(mid(q), r.result) - logLoss(r.fair, r.result) })));
  const ours = rows.reduce((s, { r }) => s + logLoss(r.fair, r.result), 0) / rows.length;
  const mkt = rows.reduce((s, { r, q }) => s + logLoss(mid(q), r.result), 0) / rows.length;
  const withBook = rows.filter(({ r }) => r.bookFair != null);
  const book = withBook.reduce((s, { r }) => s + logLoss(r.bookFair!, r.result), 0) / withBook.length;
  const mktB = withBook.reduce((s, { r, q }) => s + logLoss(mid(q), r.result), 0) / withBook.length;
  out(`| ${label} | ${rows.length} | ${diff.games} | ${ours.toFixed(4)} | ${mkt.toFixed(4)} | ${ci(diff, (x) => (x * 1000).toFixed(1))} | ${book.toFixed(4)} (vs ${mktB.toFixed(4)}) |`);
  return rows;
}
out("## 1. Is our fair price closer to the result than Kalshi's?");
out();
out("Log loss per rung (lower is better). **Edge** = Kalshi log loss − ours, ×1000, mean [90% interval resampling whole games]. Positive = we forecast better than the market.");
out("The last column prices the same rung with our distribution centered on the **sportsbook closing spread**: a check that the distribution shape agrees with Kalshi.");
out();
out("| Quote used | Rungs | Games | Ours | Kalshi mid | Edge ×1000 | Book-centered (Kalshi) |");
out("|---|---|---|---|---|---|---|");
const closeRows = scoreSection("Last quote before kickoff, all", (r) => r.kickoff, null);
scoreSection("Last quote before kickoff, spread ≤ 4¢", (r) => r.kickoff, 0.04);
scoreSection("24h before kickoff, all", (r) => r.kickoff - 86400, null);
scoreSection("24h before kickoff, spread ≤ 4¢", (r) => r.kickoff - 86400, 0.04);
out();

// ---- 2. Does our number add information on top of the market?
out("## 2. Does YCPR add information the Kalshi price lacks?");
out();
const blendRows = closeRows.map(({ r, q }) => ({ gameId: r.gameId, week: r.week, market: mid(q), model: r.fair, y: r.result }));
const b = fitBlend(blendRows);
const gameIds = [...new Set(blendRows.map((x) => x.gameId))];
const rand = rng(11);
const b2s: number[] = [];
for (let rep = 0; rep < 300; rep++) {
  const pick = new Map<string, number>();
  for (let i = 0; i < gameIds.length; i++) {
    const g = gameIds[Math.floor(rand() * gameIds.length)];
    pick.set(g, (pick.get(g) ?? 0) + 1);
  }
  const sample = blendRows.flatMap((x) => Array(pick.get(x.gameId) ?? 0).fill(x));
  b2s.push(fitBlend(sample)[2]);
}
b2s.sort((x, y) => x - y);
const weeks = [...new Set(blendRows.map((x) => x.week))].sort((x, y) => x - y);
let cvBlend = 0;
let cvMkt = 0;
for (const w of weeks) {
  const fit = fitBlend(blendRows.filter((x) => x.week !== w));
  for (const x of blendRows.filter((x) => x.week === w)) {
    cvBlend += logLoss(blendProb(fit, x.market, x.model), x.y);
    cvMkt += logLoss(x.market, x.y);
  }
}
out(`Logistic fit on the last pre-kickoff quote: P(YES) = σ(${b[0].toFixed(3)} + ${b[1].toFixed(3)}·logit(Kalshi) + ${b[2].toFixed(3)}·logit(YCPR)).`);
out(`- YCPR weight: **${b[2].toFixed(3)}**, 90% interval [${b2s[15].toFixed(3)}, ${b2s[284].toFixed(3)}] (games resampled). Above 0 = our number moves the forecast in the right direction even after the market price is known.`);
out(`- Leave-one-week-out log loss: blend ${(cvBlend / blendRows.length).toFixed(4)} vs Kalshi alone ${(cvMkt / blendRows.length).toFixed(4)} (${blendRows.length} rungs, ${weeks.length} weeks).`);
out();

// ---- 3. Taker backtest.
out("## 3. Taking: buy below fair / sell above fair, one contract");
out();
out("At each hourly quote up to 30 min before kickoff, take the first ask that is below our fair by more than the taker fee + min edge (or bid above fair by that much). One trade per market. P&L is after the taker fee; CLV is the move to the last pre-kickoff mid, in cents. 90% intervals resample games.");
out();
out("| Min edge | Mode | Trades | Games | Win % | P&L ¢/contract | CLV ¢ | Total P&L $ |");
out("|---|---|---|---|---|---|---|---|");
for (const minEdge of [0, 0.02, 0.04, 0.06, 0.08, 0.1]) {
  for (const onePerGame of [false, true]) {
    const tr = simulateTaker(rungs, { minEdge, onePerGame });
    if (!tr.length) continue;
    const pnl = gameBootstrap(tr.map((t) => ({ gameId: t.gameId, v: t.pnl })));
    const clv = gameBootstrap(tr.map((t) => ({ gameId: t.gameId, v: t.clv })));
    const wins = tr.filter((t) => t.pnl > 0).length;
    out(`| ${(minEdge * 100).toFixed(0)}¢ | ${onePerGame ? "best rung per game" : "every rung"} | ${tr.length} | ${pnl.games} | ${pct(wins / tr.length)} | ${ci(pnl)} | ${ci(clv)} | ${tr.reduce((s, t) => s + t.pnl, 0).toFixed(2)} |`);
  }
}
out();

// ---- 4. Sensitivity to the outcome spread around our projection.
out("## 4. Sensitivity: σ around our projection");
out();
out("σ = 15.31 was fit around the market's line. Our projection is noisier, so a wider σ may price better. (Same last-quote rungs.)");
out();
out("| σ | Ours | Kalshi mid | Edge ×1000 |");
out("|---|---|---|---|");
for (const sigma of [15.31, 17, 19, 21]) {
  const { rungs: rs } = buildRungs({ ...DEFAULT_MARGIN_MODEL, sigma });
  const rows = rs.map((r) => ({ r, q: quoteAt(r) })).filter((x): x is { r: Rung; q: Quote } => x.q != null);
  const d = gameBootstrap(rows.map(({ r, q }) => ({ gameId: r.gameId, v: logLoss(mid(q), r.result) - logLoss(r.fair, r.result) })));
  const ours = rows.reduce((s, { r }) => s + logLoss(r.fair, r.result), 0) / rows.length;
  const mkt = rows.reduce((s, { r, q }) => s + logLoss(mid(q), r.result), 0) / rows.length;
  out(`| ${sigma} | ${ours.toFixed(4)} | ${mkt.toFixed(4)} | ${ci(d, (x) => (x * 1000).toFixed(1))} |`);
}
out();

// Rough calibration of our fair on the same rungs.
out("## 5. Calibration of our fair (last pre-kickoff rungs)");
out();
out("| Our fair | Rungs | Avg fair | Settled YES | Avg Kalshi mid |");
out("|---|---|---|---|---|");
for (let lo = 0; lo < 1; lo += 0.1) {
  const rs = closeRows.filter(({ r }) => r.fair >= lo && r.fair < lo + 0.1);
  if (!rs.length) continue;
  const avg = (f: (x: (typeof rs)[number]) => number) => rs.reduce((s, x) => s + f(x), 0) / rs.length;
  out(`| ${pct(lo)}–${pct(lo + 0.1)} | ${rs.length} | ${pct(avg((x) => x.r.fair))} | ${pct(avg((x) => x.r.result))} | ${pct(avg((x) => mid(x.q)))} |`);
}

writeFileSync(fileURLToPath(new URL(`../../docs/kalshi-backtest-${season}.md`, import.meta.url)), lines.join("\n") + "\n");
console.error(`Wrote docs/kalshi-backtest-${season}.md`);
void clamp;
