// The shadow report (BOT_REBUILD_HANDOFF.md §12): before the rebuilt logic is trusted, put its numbers next to the existing
// strategies' on the same recorded history, and measure the live paper fills the way §5.4 asks.
//
//  1. Live paper fills: claimed edge vs what the market did after (markouts at 1 / 15 / 60 minutes and to close), per book and kind.
//  2. Calibration against the lines the bot could actually trade (PM median at entry vs close): beta and CLV by gap size.
//  3. Shadow replay: every strategy and the rebuilt methods replayed over the same recorded games with the same paper fill rules.
//  4. P&L by how the game landed against the closing line, per method (the shape).
//
// Pure aggregation functions at the top (tested); runReport() loads from Supabase and saves the markdown to bot_reports.

import { db } from "../runner/io";
import { markout } from "./markouts";

// ---------- 1. Fills

export interface FillRow {
  id: number;
  game_id: string;
  venue: string;
  strategy_id: number | null;
  action: "buy" | "sell";
  price: number;
  count: number;
  fee: number;
  fair_at_fill: number | null;
  mid_at_fill: number | null;
  close_mid: number | null;
  result: number | null;
  mid_1m: number | null;
  mid_15m: number | null;
  mid_60m: number | null;
  kind: "take" | "quote" | null;
}

export interface FillStats {
  fills: number;
  contracts: number;
  /** Contract-weighted averages, dollars per contract (null when no fill has the input). */
  claimedEdge: number | null;
  vsMidAtFill: number | null;
  mo1: number | null;
  mo15: number | null;
  mo60: number | null;
  moClose: number | null;
  fee: number | null;
  realized: number | null;
  nClose: number;
  nSettled: number;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function wavg(rows: FillRow[], f: (r: FillRow) => number | null): number | null {
  let s = 0;
  let w = 0;
  for (const r of rows) {
    const v = f(r);
    if (v == null || !Number.isFinite(v)) continue;
    s += v * r.count;
    w += r.count;
  }
  return w ? s / w : null;
}

export function fillStats(rows: FillRow[]): FillStats {
  const dir = (r: FillRow) => (r.action === "buy" ? 1 : -1);
  const mid0 = (r: FillRow) => num(r.mid_at_fill);
  return {
    fills: rows.length,
    contracts: rows.reduce((s, r) => s + r.count, 0),
    claimedEdge: wavg(rows, (r) => (r.fair_at_fill == null ? null : dir(r) * (Number(r.fair_at_fill) - Number(r.price)))),
    vsMidAtFill: wavg(rows, (r) => markout(r.action, Number(r.price), mid0(r))),
    mo1: wavg(rows, (r) => markout(r.action, Number(r.price), num(r.mid_1m))),
    mo15: wavg(rows, (r) => markout(r.action, Number(r.price), num(r.mid_15m))),
    mo60: wavg(rows, (r) => markout(r.action, Number(r.price), num(r.mid_60m))),
    moClose: wavg(rows, (r) => markout(r.action, Number(r.price), num(r.close_mid))),
    fee: wavg(rows, (r) => Number(r.fee) / r.count),
    realized: wavg(rows, (r) => (r.result == null ? null : dir(r) * (Number(r.result) - Number(r.price)) - Number(r.fee) / r.count)),
    nClose: rows.filter((r) => r.close_mid != null).length,
    nSettled: rows.filter((r) => r.result != null).length,
  };
}

// ---------- 2. Calibration against entry lines

export interface GameLine {
  gameId: string;
  /** YC's line as a home margin (HOME − AWAY). */
  yc: number;
  /** PM median home margin at entry and at the close. */
  entry: number;
  close: number;
  /** Final home margin. */
  final: number;
}

/** Regression through the origin of y on x, with its standard error. */
export function olsThroughOrigin(x: number[], y: number[]): { beta: number; se: number; n: number } {
  const n = x.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += x[i] * y[i];
    sxx += x[i] * x[i];
  }
  if (!n || sxx === 0) return { beta: NaN, se: NaN, n };
  const beta = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - beta * x[i]) ** 2;
  return { beta, se: n > 1 ? Math.sqrt(sse / (n - 1)) / Math.sqrt(sxx) : NaN, n };
}

export interface Calibration {
  n: number;
  /** (final − entry line) on (yc − entry line). */
  betaEntry: { beta: number; se: number };
  /** (final − closing line) on (yc − closing line). */
  betaClose: { beta: number; se: number };
  /** Residual stddev of the final margin around the entry line. */
  sigmaEntry: number;
  /** CLV by raw gap to the entry line: points the line moved toward YC's side, and the share of games it moved that way. */
  buckets: { label: string; n: number; clv: number | null; movedToward: number | null; atsEntry: number | null }[];
  clvAll: number | null;
}

export function calibration(games: GameLine[]): Calibration {
  const gx = games.map((g) => g.yc - g.entry);
  const gy = games.map((g) => g.final - g.entry);
  const cx = games.map((g) => g.yc - g.close);
  const cy = games.map((g) => g.final - g.close);
  const sd = (a: number[]) => {
    if (a.length < 2) return NaN;
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };
  const clv = (g: GameLine) => Math.sign(g.yc - g.entry) * (g.close - g.entry);
  const bounds: [number, number, string][] = [[0, 2, "0-2"], [2, 4, "2-4"], [4, 6, "4-6"], [6, Infinity, "6+"]];
  const buckets = bounds.map(([lo, hi, label]) => {
    const g = games.filter((x) => Math.abs(x.yc - x.entry) >= lo && Math.abs(x.yc - x.entry) < hi);
    const moved = g.filter((x) => clv(x) > 0).length;
    const decided = g.filter((x) => Math.sign(x.yc - x.entry) * (x.final - x.entry) !== 0);
    return {
      label,
      n: g.length,
      clv: g.length ? g.reduce((s, x) => s + clv(x), 0) / g.length : null,
      movedToward: g.length ? moved / g.length : null,
      atsEntry: decided.length ? decided.filter((x) => Math.sign(x.yc - x.entry) * (x.final - x.entry) > 0).length / decided.length : null,
    };
  });
  return {
    n: games.length,
    betaEntry: olsThroughOrigin(gx, gy),
    betaClose: olsThroughOrigin(cx, cy),
    sigmaEntry: sd(gy),
    buckets,
    clvAll: games.length ? games.reduce((s, g) => s + clv(g), 0) / games.length : null,
  };
}

// ---------- 3 / 4. Shadow replay and the shape

export interface MethodGame {
  gameId: string;
  method: string;
  fills: number;
  contracts: number;
  fees: number;
  worst: number;
  best: number;
  /** P&L at the final margin, after fees; null before the game is final. */
  settled: number | null;
  clv: number | null;
}

export interface MethodTotals {
  method: string;
  games: number;
  gamesTraded: number;
  contracts: number;
  fees: number;
  pnl: number;
  pnlPerContract: number | null;
  /** Largest loss on any one game (worst settled). */
  worstGame: number | null;
  clv: number | null;
  /** Mean of per-game worst-case loss while open. */
  avgWorstCase: number | null;
}

export function methodTotals(rows: MethodGame[], onlyGames?: Set<string>): MethodTotals[] {
  const by = new Map<string, MethodGame[]>();
  for (const r of rows) {
    if (onlyGames && !onlyGames.has(r.gameId)) continue;
    (by.get(r.method) ?? by.set(r.method, []).get(r.method)!).push(r);
  }
  return [...by].map(([method, g]) => {
    const traded = g.filter((x) => x.fills > 0);
    const settled = traded.filter((x) => x.settled != null);
    const contracts = traded.reduce((s, x) => s + x.contracts, 0);
    const pnl = settled.reduce((s, x) => s + (x.settled ?? 0), 0);
    const clvRows = traded.filter((x) => x.clv != null);
    const clvW = clvRows.reduce((s, x) => s + x.contracts, 0);
    return {
      method,
      games: g.length,
      gamesTraded: traded.length,
      contracts,
      fees: traded.reduce((s, x) => s + x.fees, 0),
      pnl,
      pnlPerContract: settled.length && contracts ? pnl / settled.reduce((s, x) => s + x.contracts, 0) : null,
      worstGame: settled.length ? Math.min(...settled.map((x) => x.settled ?? 0)) : null,
      clv: clvW ? clvRows.reduce((s, x) => s + (x.clv ?? 0) * x.contracts, 0) / clvW : null,
      avgWorstCase: traded.length ? traded.reduce((s, x) => s + x.worst, 0) / traded.length : null,
    };
  });
}

export const SHAPE_BINS: [number, number, string][] = [
  [-Infinity, -10, "≤ −10"], [-10, -3, "−10…−3"], [-3, 0, "−3…0"], [0, 3, "0…3"], [3, 10, "3…10"], [10, Infinity, "≥ 10"],
];

/**
 * P&L by how the game landed against the closing line, from the side YC leans to: rel = lean · (final − closing line).
 * Right on the market line is 0, past it toward YC positive. Returns, per bin, games and mean P&L per game.
 */
export function shapeByMargin(pnls: { rel: number; pnl: number }[]): { label: string; n: number; mean: number | null }[] {
  return SHAPE_BINS.map(([lo, hi, label]) => {
    const g = pnls.filter((p) => p.rel >= lo && p.rel < hi);
    return { label, n: g.length, mean: g.length ? g.reduce((s, p) => s + p.pnl, 0) / g.length : null };
  });
}

// ---------- Rendering

const c = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(d)}¢`);
const usd = (v: number | null) => (v == null || !Number.isFinite(v) ? "–" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`);
const f2 = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d));
const pc = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(0)}%`);
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function renderFillTable(groups: { label: string; stats: FillStats }[]): string {
  return table(
    ["Book", "Fills", "Claimed edge", "vs mid at fill", "+1 min", "+15 min", "+60 min", "To close", "Fee", "Realized", "Settled"],
    groups.map(({ label, stats: s }) => [label, String(s.fills), c(s.claimedEdge), c(s.vsMidAtFill), c(s.mo1), c(s.mo15), c(s.mo60), `${c(s.moClose)} (n ${s.nClose})`, c(s.fee), c(s.realized), String(s.nSettled)])
  );
}

export function renderCalibration(cal: Calibration): string {
  const b = (x: { beta: number; se: number }) => `${f2(x.beta)} ± ${f2(x.se)}`;
  return [
    `Games: ${cal.n}. Entry = PM median 24 h before kickoff (earliest recorded if later), close = PM median at the stop time.`,
    `- beta vs entry line: **${b(cal.betaEntry)}**; vs closing line: ${b(cal.betaClose)}; residual σ around the entry line: ${f2(cal.sigmaEntry, 1)}`,
    `- CLV (points the PM median moved toward YC's side between entry and close): **${f2(cal.clvAll)}** over all games`,
    table(["Raw gap to entry", "Games", "CLV pts", "Moved toward YC", "YC side ATS vs entry"], cal.buckets.map((x) => [x.label, String(x.n), f2(x.clv), pc(x.movedToward), pc(x.atsEntry)])),
  ].join("\n\n");
}

export function renderMethodTable(rows: MethodTotals[], names: Record<string, string>): string {
  return table(
    ["Method", "Games traded", "Contracts", "Fees", "P&L (settled)", "Per contract", "Worst game", "Avg worst case", "CLV"],
    rows.map((r) => [names[r.method] ?? r.method, `${r.gamesTraded}/${r.games}`, String(r.contracts), usd(r.fees), usd(r.pnl), c(r.pnlPerContract, 1), usd(r.worstGame), usd(r.avgWorstCase), c(r.clv, 1)])
  );
}

export function renderShape(byMethod: { label: string; bins: ReturnType<typeof shapeByMargin> }[]): string {
  return table(["Method", ...SHAPE_BINS.map(([, , l]) => l)], byMethod.map((m) => [m.label, ...m.bins.map((b) => (b.n ? `${usd(b.mean)} (${b.n})` : "–"))]));
}

// ---------- Loading and saving

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2) : null;
};

/** PM median home margin at time t (unix s) from a game's implied-margin history [{venue, t, margin}] sorted by t. */
export function pmAt(history: { venue: string; t: number; margin: number | null }[], t: number): number | null {
  const last = new Map<string, number>();
  for (const h of history) {
    if (h.t > t) break;
    if (h.margin != null) last.set(h.venue, h.margin);
  }
  return median([...last.values()]);
}

export async function runReport(): Promise<{ body: string }> {
  const iso = () => new Date().toISOString();
  const sinceDay = new Date(Date.now() - 14 * 86400e3).toISOString();
  const [strategies, fillsRaw, okOrders, games] = await Promise.all([
    db.select<{ id: number; name: string; method?: string; fair_mode?: string }>("bot_strategies", "select=id,name,method,fair_mode&order=id"),
    db.selectAll<Omit<FillRow, "kind"> & { order_id: number | null }>(
      "bot_fills",
      "select=id,game_id,venue,strategy_id,action,price,count,fee,fair_at_fill,mid_at_fill,close_mid,result,mid_1m,mid_15m,mid_60m,order_id&mode=eq.paper&order=id"
    ),
    db.selectAll<{ id: number; kind: "take" | "quote" }>("bot_orders", "select=id,kind&mode=eq.paper&status=eq.filled&order=id"),
    db.selectAll<{ game_id: string; kickoff: string; ycpr_home_margin: number | null }>("bot_mkt_games", `select=game_id,kickoff,ycpr_home_margin&kickoff=gte.${sinceDay}&order=game_id`),
  ]);
  const kindOf = new Map(okOrders.map((o) => [o.id, o.kind]));
  const fills: FillRow[] = fillsRaw.map((f) => ({ ...f, price: Number(f.price), fee: Number(f.fee), kind: f.order_id == null ? null : kindOf.get(f.order_id) ?? null }));
  const nameOf = (id: number | null) => (id == null ? "Board" : strategies.find((s) => s.id === id)?.name ?? `Lab ${id}`);

  // 1. Live fills.
  const books = [...new Set(fills.map((f) => f.strategy_id ?? -1))].sort((a, b) => a - b);
  const fillGroups: { label: string; stats: FillStats }[] = [];
  for (const b of books)
    for (const kind of ["take", "quote"] as const) {
      const rows = fills.filter((f) => (f.strategy_id ?? -1) === b && f.kind === kind);
      if (rows.length) fillGroups.push({ label: `${nameOf(b === -1 ? null : b)} · ${kind}`, stats: fillStats(rows) });
    }
  const venueGroups = ["kalshi", "novig", "prophetx"].map((v) => ({ label: v, stats: fillStats(fills.filter((f) => f.venue === v && f.kind === "take")) }));
  const [rec] = [await db.select<{ started_at: string }>("bot_runs", "select=started_at&mode=eq.record&order=started_at.desc&limit=40")];
  const gaps = rec.slice(0, -1).map((r, i) => (new Date(r.started_at).getTime() - new Date(rec[i + 1].started_at).getTime()) / 60e3);
  const cadence = median(gaps);

  // 2. Calibration against entry lines, from the recorded games that are over.
  const ids = games.map((g) => g.game_id);
  const finals = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 150) {
    for (const g of await db.select<{ id: string; completed: boolean; home_points: number | null; away_points: number | null }>("games", `select=id,completed,home_points,away_points&id=in.(${ids.slice(i, i + 150).join(",")})`))
      if (g.completed && g.home_points != null && g.away_points != null) finals.set(String(g.id), g.home_points - g.away_points);
  }
  const lines: GameLine[] = [];
  const closeLine = new Map<string, number>();
  for (const g of games) {
    const final = finals.get(g.game_id);
    if (final == null || g.ycpr_home_margin == null) continue;
    const hist = (await db.selectAll<{ venue: string; t: string; margin: number | null }>("bot_mkt_implied", `select=venue,t,margin&game_id=eq.${g.game_id}&order=t`)).map((h) => ({ venue: h.venue, t: Math.floor(new Date(h.t).getTime() / 1000), margin: h.margin == null ? null : Number(h.margin) }));
    if (!hist.length) continue;
    const ko = Math.floor(new Date(g.kickoff).getTime() / 1000);
    const close = pmAt(hist, ko - 30 * 60);
    const entry = pmAt(hist, Math.max(ko - 24 * 3600, hist[0].t)) ?? pmAt(hist, hist[0].t + 3600);
    if (close == null || entry == null) continue;
    closeLine.set(g.game_id, close);
    lines.push({ gameId: g.game_id, yc: Number(g.ycpr_home_margin), entry, close, final });
  }
  const cal = calibration(lines);

  // 3 / 4. Shadow replay (all venues combined) on the same games.
  const hy = await db.selectAll<{ game_id: string; method: string; fills: number; contracts: number; fees: number; worst: number; best: number; settled: number | null; clv: number | null }>(
    "bot_hypo_results",
    "select=game_id,method,fills:summary->fills,contracts:summary->contracts,fees:summary->fees,worst:summary->worst,best:summary->best,settled:summary->settled,clv:summary->clv&venues=eq.all&order=game_id,method"
  );
  const rows: MethodGame[] = hy.map((r) => ({ gameId: r.game_id, method: r.method, fills: Number(r.fills), contracts: Number(r.contracts), fees: Number(r.fees), worst: Number(r.worst), best: Number(r.best), settled: r.settled == null ? null : Number(r.settled), clv: r.clv == null ? null : Number(r.clv) }));
  const finalGames = new Set([...finals.keys()]);
  const totals = methodTotals(rows, finalGames);
  const labName = (m: string) => (m.startsWith("lab") ? `Lab · ${strategies.find((s) => s.id === Number(m.slice(3)))?.name ?? m}` : m);
  const names: Record<string, string> = Object.fromEntries(totals.map((t) => [t.method, labName(t.method)]));
  Object.assign(names, { ladder: "Ladder (current default)", shrunk: "Shrunk ladder (rebuild)", target: "Target positions (rebuild)", shaped: "Shaped", early: "Straight bet · early", late: "Straight bet · near kickoff" });
  const shapeFor = (method: string) => {
    const pn: { rel: number; pnl: number }[] = [];
    for (const r of rows) {
      if (r.method !== method || r.settled == null || r.fills === 0) continue;
      const g = lines.find((l) => l.gameId === r.gameId);
      if (!g) continue;
      pn.push({ rel: Math.sign(g.yc - g.close) * (g.final - g.close), pnl: r.settled });
    }
    return shapeByMargin(pn);
  };
  const focus = ["ladder", "lab1", "lab2", "lab3", "lab4", "shaped", "shrunk", "target"].filter((m) => totals.some((t) => t.method === m));
  const order = (t: MethodTotals) => (focus.includes(t.method) ? focus.indexOf(t.method) : 99);
  const sorted = [...totals].sort((a, b) => order(a) - order(b) || a.method.localeCompare(b.method));

  const body = [
    `# Shadow report · ${iso().slice(0, 16).replace("T", " ")} UTC`,
    "Paper only. Everything here is simulated or paper-filled; nothing touched an exchange. All numbers are after fees unless a column says otherwise.",
    "## 1. Live paper fills: claimed edge vs what the market did next",
    `Per contract. "Claimed edge" is what the bot's own fair value said at the fill; the markout columns are what the same market's mid did afterward (positive = the market moved our way); "vs mid at fill" is the half-spread paid. Recorder cadence is about ${f2(cadence, 1)} min, so +1 min mostly equals the mid at the fill.`,
    renderFillTable(fillGroups),
    "By venue (takes only):",
    renderFillTable(venueGroups),
    "## 2. Calibration against the lines the bot could trade",
    renderCalibration(cal),
    "## 3. Shadow replay on the same recorded games (all venues combined)",
    `${finalGames.size} recorded games are over; each method is replayed on the same snapshots with the same paper fill rules. The rebuilt methods are the two rows marked (rebuild).`,
    renderMethodTable(sorted, names),
    "## 4. P&L by how the game landed against the closing line",
    "Mean P&L per game (games in brackets), by lean · (final margin − closing PM median): 0 = it landed on the market line, positive = past it toward YC.",
    renderShape(focus.map((m) => ({ label: names[m] ?? m, bins: shapeFor(m) }))),
  ].join("\n\n");

  await db.upsert("bot_reports", [{ id: "shadow", updated_at: iso(), title: "Shadow report", body, data: { calibration: cal, totals: sorted, fills: fillGroups, games: lines.length, cadenceMin: cadence } }], "id");
  return { body };
}
