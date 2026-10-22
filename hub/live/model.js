// Live desk math, run in the browser. Same conventions as the bot: margins are home − away (which is also the
// away spread), and a rung's YES pays when its side wins by more than its strike. marginPmf is a port of
// bot/fairPrice/marginDistribution.ts with the fitted key-number weights (bot/runner/liveDesk.test.ts keeps them equal).

export const SIGMA = 15.31;
export const KEY_WEIGHTS = {
  1: 0.872, 2: 0.861, 3: 2.842, 4: 0.953, 5: 0.628, 6: 0.925, 7: 2.453, 8: 0.843, 9: 0.399, 10: 1.411, 11: 0.658, 12: 0.542,
  13: 0.611, 14: 1.399, 15: 0.617, 16: 0.408, 17: 1.547, 18: 0.876, 19: 0.64, 20: 0.763, 21: 1.665, 22: 0.704, 23: 0.594,
  24: 1.5, 25: 0.954, 26: 0.627, 27: 1.079, 28: 1.808, 29: 0.683, 30: 0.418, 31: 1.593, 32: 1.327, 33: 0.702, 34: 1.404, 35: 1.792,
};
const MAX = 80;

export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function rawPmf(mean) {
  const probs = new Array(2 * MAX + 1).fill(0);
  let total = 0;
  for (let m = -MAX; m <= MAX; m++) {
    if (m === 0) continue;
    const lo = m === -MAX ? 0 : normalCdf((m - 0.5 - mean) / SIGMA);
    const hi = m === MAX ? 1 : normalCdf((m + 0.5 - mean) / SIGMA);
    const p = Math.max(0, hi - lo) * (KEY_WEIGHTS[Math.abs(m)] ?? 1);
    probs[m + MAX] = p;
    total += p;
  }
  return probs.map((p) => p / total);
}
const meanOf = (probs) => probs.reduce((s, p, i) => s + (i - MAX) * p, 0);

const cache = new Map();
/** P(home margin = m) for whole m in [−80, 80], with mean = projectedHomeMargin. */
export function marginPmf(projectedHomeMargin) {
  const key = Math.round(projectedHomeMargin * 100);
  if (cache.has(key)) return cache.get(key);
  let center = projectedHomeMargin;
  let probs = rawPmf(center);
  for (let i = 0; i < 25; i++) {
    const err = projectedHomeMargin - meanOf(probs);
    if (Math.abs(err) < 1e-6) break;
    center += err;
    probs = rawPmf(center);
  }
  const pmf = { maxMargin: MAX, probs };
  if (cache.size > 200) cache.clear();
  cache.set(key, pmf);
  return pmf;
}

/** P(a rung's YES): `side` wins by more than `strike`. */
export function yesProb(pmf, side, strike) {
  let s = 0;
  for (let i = 0; i < pmf.probs.length; i++) {
    const m = i - pmf.maxMargin;
    if ((side === "home" ? m : -m) > strike) s += pmf.probs[i];
  }
  return s;
}

/** Net position per rung from fills (YES contracts, dollars paid incl. fees). */
export function positions(fills) {
  const m = new Map();
  for (const f of fills) {
    const k = `${f.venue || "kalshi"}|${f.ticker}`;
    const p = m.get(k) || { venue: f.venue || "kalshi", ticker: f.ticker, side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    p.yes += d;
    p.cost += d * Number(f.price) + Number(f.fee);
    m.set(k, p);
  }
  return [...m.values()];
}

export const pnlAt = (pos, m) => pos.reduce((s, p) => s + p.yes * ((p.side === "home" ? m : -m) > p.strike ? 1 : 0) - p.cost, 0);

/** P&L at each whole final home margin in [lo, hi] (no ties in college football). */
export function curve(pos, lo = -35, hi = 35) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (m !== 0) out.push({ m, v: pnlAt(pos, m) });
  return out;
}

/** Worst and best outcome over every margin (P&L is flat beyond the outermost strikes). */
export function worstBest(pos) {
  if (!pos.length) return { worst: 0, best: 0 };
  const vals = curve(pos, -MAX, MAX).map((p) => p.v);
  return { worst: Math.min(...vals), best: Math.max(...vals) };
}

/** Expected P&L at settlement when the final margin follows `pmf`. */
export function expectedPnl(pos, pmf) {
  if (!pos.length || !pmf) return 0;
  let e = 0;
  for (let i = 0; i < pmf.probs.length; i++) if (pmf.probs[i]) e += pmf.probs[i] * pnlAt(pos, i - pmf.maxMargin);
  return e;
}

/** A rung seen from the pick's side: "pick wins by more than k". The other team's rung is its NO. */
export function pickRung(r, pick) {
  if (r.side === pick) return { k: Number(r.strike), bid: r.bid == null ? null : Number(r.bid), ask: r.ask == null ? null : Number(r.ask), flip: false };
  return { k: -Number(r.strike), bid: r.ask == null ? null : 1 - Number(r.ask), ask: r.bid == null ? null : 1 - Number(r.bid), flip: true };
}

/** Pick-oriented home margin: positive = the pick team wins by that much. */
export const pickMargin = (pick, homeMargin) => (homeMargin == null ? null : pick === "home" ? homeMargin : -homeMargin);

/** The market line a game is compared against: Kalshi's implied margin, else Novig's, else ProphetX's. */
export function marketMargin(w) {
  const vm = w?.venue_margins || {};
  const n = (x) => (x == null || x === "" ? null : Number(x));
  return n(vm.kalshi) ?? n(w?.kalshi_home_margin) ?? n(vm.novig) ?? n(vm.prophetx);
}
export const oursOf = (w) => (w?.my_home_margin != null ? Number(w.my_home_margin) : w?.ycpr_home_margin != null ? Number(w.ycpr_home_margin) : null);

/**
 * Status pill, in priority order: Final (kicked off), Stopped (past the stop time), Paused (turned off),
 * Near cap (≥ 80% of the loss cap used), No edge (the market is at or past your number for the pick),
 * Thin edge (|yours − market| < 1 pt), Quoting (orders resting), else Waiting.
 */
export function gameStatus({ w, used, resting, now = Date.now() }) {
  const kick = w.kickoff ? new Date(w.kickoff).getTime() : null;
  if (kick != null && now >= kick) return { label: "Final", tone: "info" };
  if (kick != null && now >= kick - (w.stop_minutes_before ?? 30) * 60e3) return { label: "Stopped", tone: "mut" };
  if (!w.enabled) return { label: "Paused", tone: "mut" };
  if (used >= 0.8) return { label: "Near cap", tone: "bad" };
  const ours = oursOf(w), mkt = marketMargin(w);
  if (ours != null && mkt != null) {
    if (!(w.pick === "home" ? ours > mkt : ours < mkt)) return { label: "No edge", tone: "bad" };
    if (Math.abs(ours - mkt) < 1) return { label: "Thin edge", tone: "warn" };
  }
  return resting ? { label: "Quoting", tone: "ok" } : { label: "Waiting", tone: "mut" };
}
