// Scores tab: ESPN live scores for the watched games with your P&L on each, in two views. "Now playing" = games in
// progress; "This week" = the whole week (final games settled, live games projected, upcoming games expected).
// Per game: P&L if it ended now, projected final P&L (expected, chance of profit, likely range) and the live cover %
// of every line held. Live projections use the TV score bug's model (src/lib/liveScore.ts, bundled to
// live/score.js): score so far + the pregame line for the time left, starting from the market's line by default.
// Data: /api/data?part=week about once a minute, ?part=scores every 15 s while games are on. Uses app.js's api().
import { liveMargin, marginProbs } from "./live/score.js";
import { positions, pnlAt, marginPmf, marketMargin, oursOf, worstBest } from "./live/model.js";

const pane = document.querySelector('[data-pane="scores"]');
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let mode = ls.get("botscores", "now") === "week" ? "week" : "now";
let base = ls.get("botscorebase", "market") === "yc" ? "yc" : "market";
let book = null; // null = Board, else a lab strategy id
let weekSel = null;
let wk = null; // part=week payload
let scores = {}; // game_id → ESPN game
let scoresAt = 0;
let err = "";
let shown = false;
let tWeek = null, tScores = null;
const openLines = new Set(); // game_ids whose "Lines held" is expanded (kept across the 15 s redraws)

const e2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (x) => (x == null || !Number.isFinite(x) ? "–" : (x < -0.004 ? "−$" : x > 0.004 ? "+$" : "$") + Math.abs(x).toFixed(2));
const tone = (x) => (x == null || Math.abs(x) < 0.005 ? "" : x > 0 ? "ok" : "bad");
const sgn = (x) => (x == null || !Number.isFinite(x) ? "–" : Math.abs(x) < 0.05 ? "PK" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1));
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
const lineLabel = (team, k) => `${team} ${k >= 0 ? "−" : "+"}${Math.abs(Number(k))}`;

// ---------- Data

async function loadWeek() {
  try {
    wk = await api(`/api/data?part=week${weekSel ? `&week=${weekSel}` : ""}`);
    weekSel = wk.week;
    err = "";
  } catch (e) {
    if (e.message !== "unauthorized") err = `Couldn't load the week: ${e.message}`;
  }
  render();
  loadScores();
}

/** Games whose score can still change: kicked off (or within the hour) and not stored as final. */
function liveCandidates() {
  if (!wk) return [];
  const fin = new Map(wk.finals.map((f) => [String(f.id), f]));
  return wk.games.filter((w) => w.kickoff && ms(w.kickoff) < Date.now() + 3600e3 && ms(w.kickoff) > Date.now() - 2 * 86400e3 && !(fin.get(w.game_id)?.completed && scores[w.game_id]?.state !== "in"));
}

async function loadScores() {
  clearTimeout(tScores);
  const c = liveCandidates();
  if (c.length && !document.hidden) {
    try {
      const r = await api(`/api/data?part=scores&ids=${c.map((w) => w.game_id).join(",")}&kickoffs=${c.map((w) => encodeURIComponent(w.kickoff)).join(",")}`);
      scores = { ...scores, ...r.scores };
      scoresAt = Date.now();
    } catch (e) {
      if (e.message !== "unauthorized") err = `Couldn't load scores: ${e.message}`;
    }
    render();
  }
  if (shown) tScores = setTimeout(loadScores, c.length ? 15e3 : 120e3);
}

function show(on) {
  shown = on;
  clearInterval(tWeek);
  clearTimeout(tScores);
  if (!on) return;
  render();
  loadWeek();
  tWeek = setInterval(() => { if (!document.hidden) loadWeek(); }, 60e3);
}
window.scoresTab = { show };

// ---------- Per-game math

/** P&L distribution summary over a margin distribution: expected, chance of profit, 10th–90th percentile. */
function summarize(pos, dist) {
  const pts = [];
  let e = 0, win = 0;
  for (let i = 0; i < dist.probs.length; i++) {
    const p = dist.probs[i];
    if (!p) continue;
    const v = pnlAt(pos, i - dist.maxMargin);
    e += p * v;
    if (v > 0.005) win += p;
    pts.push([v, p]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const q = (f) => { let c = 0; for (const [v, p] of pts) { c += p; if (c >= f) return v; } return pts.at(-1)?.[0] ?? 0; };
  return { expected: e, win, lo: q(0.1), hi: q(0.9) };
}

const coverIn = (dist, side, strike) => dist.probs.reduce((s, p, i) => s + ((side === "home" ? i - dist.maxMargin : dist.maxMargin - i) > strike ? p : 0), 0);

function gameView(w) {
  const fills = wk.fills.filter((f) => f.game_id === w.game_id && (f.strategy_id ?? null) === book);
  const pos = positions(fills);
  const vegas = w.home_spread == null ? null : -Number(w.home_spread);
  const ours = oursOf(w), mkt = marketMargin(w) ?? vegas;
  const pregame = base === "yc" ? ours ?? mkt : mkt ?? ours;
  const sb = scores[w.game_id] ?? null;
  const fin = wk.finals.find((f) => String(f.id) === w.game_id);
  let status = "upcoming", dist = null, now = null;
  if (sb?.state === "post" || (fin?.completed && sb?.state !== "in")) {
    status = "final";
    const m = sb?.state === "post" ? sb.home.score - sb.away.score : fin.home_points - fin.away_points;
    now = m;
    dist = marginProbs(m, 0);
  } else if (sb?.state === "in" && pregame != null) {
    const lm = liveMargin(sb, pregame);
    status = "live";
    now = lm.now;
    dist = marginProbs(lm.mean, lm.sd);
  } else {
    status = w.kickoff && ms(w.kickoff) < Date.now() ? "started" : "upcoming";
    dist = pregame == null ? null : marginPmf(pregame);
  }
  const sum = dist ? summarize(pos, dist) : null;
  const nowPnl = status === "live" || status === "final" ? pnlAt(pos, now) : null;
  const held = pos.filter((p) => p.yes !== 0).map((p) => ({ ...p, cover: dist ? coverIn(dist, p.side, p.strike) : null }));
  return { w, pos, fills, sb, fin, status, dist, now, nowPnl, sum, held, pregame, ours, mkt };
}

// ---------- Render

function miniChart(v) {
  const { w, pos } = v;
  const W = 320, H = 64, pad = 2;
  const pickSign = w.pick === "home" ? 1 : -1;
  const pts = [];
  for (let p = -28; p <= 28; p++) if (p !== 0) pts.push({ p, v: pnlAt(pos, pickSign * p) });
  const max = Math.max(0.01, ...pts.map((x) => Math.abs(x.v)));
  const bw = (W - 2 * pad) / pts.length, y0 = H / 2;
  const x = (p) => pad + (pts.findIndex((q) => q.p >= p) < 0 ? pts.length : pts.findIndex((q) => q.p >= p)) * bw;
  let s = pts.map((q, i) => {
    const h = (Math.abs(q.v) / max) * (y0 - 3);
    return `<rect x="${(pad + i * bw).toFixed(1)}" y="${(q.v >= 0 ? y0 - h : y0).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${q.v >= 0 ? "var(--c-ok)" : "var(--c-err)"}" opacity=".8"/>`;
  }).join("");
  s += `<line x1="${pad}" x2="${W - pad}" y1="${y0}" y2="${y0}" stroke="var(--a-line)"/>`;
  if (v.now != null) s += `<line x1="${x(pickSign * v.now)}" x2="${x(pickSign * v.now)}" y1="0" y2="${H}" stroke="var(--a-ink)" stroke-width="2"><title>Now: ${e2(v.now === 0 ? "tied" : `${v.now > 0 ? w.home_team : w.away_team} by ${Math.abs(v.now)}`)}</title></line>`;
  if (v.status === "live" && v.sum) {
    const mean = v.dist.probs.reduce((a, p, i) => a + p * (i - v.dist.maxMargin), 0);
    s += `<line x1="${x(pickSign * mean)}" x2="${x(pickSign * mean)}" y1="0" y2="${H}" stroke="var(--c-info)" stroke-dasharray="3 2" stroke-width="1.5"><title>Projected finish</title></line>`;
  }
  const pick = w.pick === "home" ? w.home_team : w.away_team, other = w.pick === "home" ? w.away_team : w.home_team;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="P&amp;L by final margin">${s}</svg><div class="sc-axis"><span>← ${e2(other)} by 28</span><span>P&amp;L by final margin</span><span>${e2(pick)} by 28 →</span></div>`;
}

const VS = { kalshi: "Kalshi", novig: "Novig", prophetx: "ProphetX" };

/** "JMU −11.5": a home margin as the favored team's spread, using ESPN's short names when we have them. */
function favLabel(m, w, sb) {
  if (m == null) return "–";
  if (Math.abs(m) < 0.05) return "PK";
  const team = m > 0 ? sb?.home?.abbrev || w.home_team : sb?.away?.abbrev || w.away_team;
  return `${team} −${Math.abs(m).toFixed(1)}`;
}

/** Thin bar from the 10th to the 90th percentile result, a mark at $0 and a dot at the projection. */
function rangeStrip(v) {
  const { worst, best } = worstBest(v.pos);
  const lo = Math.min(worst, v.sum.lo, 0), hi = Math.max(best, v.sum.hi, 0);
  const at = (x) => (hi - lo < 1e-9 ? 50 : ((x - lo) / (hi - lo)) * 100);
  return `<div class="sc-range" aria-label="Likely range ${money(v.sum.lo)} to ${money(v.sum.hi)}">
      <div class="track"><span class="band" style="left:${at(v.sum.lo).toFixed(1)}%;width:${Math.max(1, at(v.sum.hi) - at(v.sum.lo)).toFixed(1)}%"></span><span class="zero" style="left:${at(0).toFixed(1)}%"></span><span class="dot ${tone(v.sum.expected)}" style="left:${at(v.sum.expected).toFixed(1)}%"></span></div>
      <div class="ends"><span>${money(v.sum.lo)}</span><span>likely range</span><span>${money(v.sum.hi)}</span></div>
    </div>`;
}

function card(v) {
  const { w, sb } = v;
  const team = (side) => {
    const t = sb?.[side];
    const name = side === "home" ? w.home_team : w.away_team;
    const score = sb && sb.state !== "pre" ? t?.score : v.fin?.completed ? (side === "home" ? v.fin.home_points : v.fin.away_points) : null;
    const ball = sb?.state === "in" && sb.possession && t?.espnId && String(sb.possession) === String(t.espnId);
    const lead = v.now != null && (side === "home" ? v.now > 0 : v.now < 0);
    return `<div class="sc-team ${lead ? "lead" : ""}" title="${e2(name)}">${t?.logo ? `<img src="${e2(t.logo)}" alt="" width="20" height="20" loading="lazy">` : '<span class="sc-dot"></span>'}<span class="nm">${t?.rank ? `<small>${t.rank}</small> ` : ""}${e2(t?.name || name)}${ball ? ' <span class="sc-ball" title="Has the ball">●</span>' : ""}</span><b>${score ?? ""}</b></div>`;
  };
  const when = w.kickoff ? new Date(w.kickoff).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "TBD";
  const head = v.status === "live" ? `<span class="sc-live">${e2(sb.detail || "Live")}</span>`
    : v.status === "final" ? `<span><b>Final</b>${v.fin?.score_source === "espn" ? ' <span class="muted" title="Saved from ESPN; a CFBD sync confirms it">· ESPN final</span>' : ""}</span>`
    : v.status === "started" ? '<span class="warn-t">Started · no score yet</span>'
    : `<span><b>${e2(when)}</b></span>`;
  const dd = v.status === "live" && (sb.downDistance || sb.redZone) ? `<div class="sc-sub">${e2(sb.downDistance || "")}${sb.redZone ? `${sb.downDistance ? " · " : ""}<b class="bad">red zone</b>` : ""}</div>` : "";
  const lines = `<div class="sc-sub">${v.status === "final" ? "Closed mkt" : "Mkt"} ${e2(favLabel(v.mkt, w, sb))} · YC ${e2(favLabel(v.ours, w, sb))}${v.status === "final" && v.now != null ? ` · ${e2(v.now > 0 ? sb?.home?.abbrev || w.home_team : sb?.away?.abbrev || w.away_team)} by ${Math.abs(v.now)}` : ""}</div>`;
  const s = v.sum;
  const stat = (l, val, cls = "") => `<div><small>${l}</small><b class="${cls}">${val}</b></div>`;
  let pnl;
  if (!v.pos.length) pnl = '<p class="sc-none">No position in this book.</p>';
  else if (v.status === "final") {
    const won = v.held.filter((p) => (p.cover > 0.5) === (p.yes > 0)).length;
    const fees = v.fills.reduce((a, f) => a + Number(f.fee), 0);
    pnl = `<div class="sc-pnl">${stat("Settled", money(v.nowPnl), tone(v.nowPnl))}${stat("Lines won", `${won} of ${v.held.length}`)}${stat("Fees", `$${fees.toFixed(2)}`)}</div>`;
  } else if (v.status === "live" && s) {
    pnl = `<div class="sc-pnl">${stat("Ended now", money(v.nowPnl), tone(v.nowPnl))}${stat("Projected", money(s.expected), tone(s.expected))}${stat("To profit", `${Math.round(s.win * 100)}%`)}</div>${rangeStrip(v)}`;
  } else {
    const { worst } = worstBest(v.pos);
    pnl = `<div class="sc-pnl">${stat("Expected", money(s?.expected), tone(s?.expected))}${stat("To profit", s ? `${Math.round(s.win * 100)}%` : "–")}${stat("Worst", money(worst), tone(worst))}</div>`;
  }
  let held = "";
  if (v.held.length) {
    const venues = [...new Set(v.held.map((p) => p.venue))].map((x) => VS[x] || x);
    const sides = new Set(v.held.map((p) => `${p.side}|${Math.sign(p.yes)}`));
    const ks = v.held.map((p) => Number(p.strike)).sort((a, b) => a - b);
    const one = sides.size === 1 ? v.held[0] : null;
    const span = one ? ` · ${e2(lineLabel(one.side === "home" ? w.home_team : w.away_team, ks[0]))}${ks.length > 1 ? ` to ${ks.at(-1) >= 0 ? "−" : "+"}${Math.abs(ks.at(-1))}` : ""}` : "";
    const rows = [...v.held].sort((a, b) => (a.side === b.side ? a.strike - b.strike : a.side === w.pick ? -1 : 1)).map((p) => {
      const c = p.cover, paid = p.yes ? Math.abs(p.cost / p.yes) : null;
      const res = c == null ? "–" : v.status === "final" ? (c > 0.5 ? "covered" : "missed") : `${Math.round(c * 100)}%`;
      const cls = v.status === "final" ? ((c > 0.5) === (p.yes > 0) ? "ok" : "bad") : "";
      return `<tr><td>${e2(lineLabel(p.side === "home" ? w.home_team : w.away_team, p.strike))} <span class="muted">${p.venue === "kalshi" ? "K" : p.venue === "novig" ? "NV" : "PX"}</span></td><td>${p.yes > 0 ? "+" : "−"}${Math.abs(p.yes)}</td><td>${paid == null ? "–" : `${Math.round(paid * 100)}¢`}</td><td class="${cls}">${res}</td></tr>`;
    }).join("");
    held = `<details class="sc-held" data-held="${e2(w.game_id)}" ${openLines.has(w.game_id) ? "open" : ""}>
      <summary><span>Lines held · ${v.held.length} on ${e2(venues.join(", "))}${span}</span></summary>
      ${miniChart(v)}
      <div class="sc-lines-wrap"><table class="sc-lines"><tr><th>Line</th><th>Held</th><th>Paid</th><th>${v.status === "final" ? "Result" : "Cover"}</th></tr>${rows}</table></div>
    </details>`;
  }
  return `<article class="sc-card ${v.status}">
    <div class="sc-head">${head}<span class="muted">${e2(sb?.network || "")}${w.enabled ? "" : " · paused"}</span></div>
    <div class="sc-teams">${team("away")}${team("home")}</div>
    ${dd}${lines}
    ${pnl}
    ${held}
  </article>`;
}

function render() {
  if (!pane || !shown) return;
  // Don't redraw under an open dropdown.
  if (document.activeElement?.tagName === "SELECT" && pane.contains(document.activeElement)) return;
  if (!wk) { pane.innerHTML = `<p class="muted">${err ? e2(err) : "Loading…"}</p>`; return; }
  const views = wk.games.map(gameView);
  const live = views.filter((v) => v.status === "live");
  const fin = views.filter((v) => v.status === "final");
  const up = views.filter((v) => v.status === "upcoming" || v.status === "started");
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  const settled = sum(fin, (v) => v.nowPnl);
  const liveNow = sum(live, (v) => v.nowPnl);
  const liveProj = sum(live, (v) => v.sum?.expected);
  const upExp = sum(up, (v) => v.sum?.expected);
  const opt = (v, l, cur) => `<option value="${e2(v)}" ${String(cur) === String(v) ? "selected" : ""}>${e2(l)}</option>`;
  const tile = (l, v, d) => `<div class="stat"><div class="l">${l}</div><div class="v ${tone(v)}">${money(v)}</div><div class="d">${d}</div></div>`;
  const next = up.filter((v) => v.w.kickoff).sort((a, b) => ms(a.w.kickoff) - ms(b.w.kickoff))[0];
  const tiles = mode === "now"
    ? `${tile("If they ended now", live.length ? liveNow : null, `${live.length} game${live.length === 1 ? "" : "s"} in progress`)}${tile("Projected final", live.length ? liveProj : null, "the same games, as they're heading")}${tile("Settled this week", fin.length ? settled : null, `${fin.length} final`)}`
    : `${tile("Settled", fin.length ? settled : null, `${fin.length} final`)}${tile("Live now", live.length ? liveNow : null, `${live.length} in progress, if they ended now`)}${tile("Live projected", live.length ? liveProj : null, "where those games are heading")}${tile("Upcoming expected", up.length ? upExp : null, `${up.length} not started`)}${tile("Week projected", settled + liveProj + upExp, "settled + live projected + upcoming")}`;
  const section = (title, xs) => (xs.length ? `<h3 class="sc-h">${title}</h3><div class="sc-grid">${xs.map(card).join("")}</div>` : "");
  const body = mode === "now"
    ? live.length ? `<div class="sc-grid">${live.map(card).join("")}</div>` : `<div class="empty">No watched games are playing right now.${next ? ` Next: ${e2(next.w.away_team)} @ ${e2(next.w.home_team)}, ${e2(new Date(next.w.kickoff).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}.` : ""}</div>`
    : section("Live", live) + section("Upcoming", up) + section("Final", fin) || '<div class="empty">No watched games this week.</div>';
  pane.innerHTML = `
    <div class="sc-bar">
      <div class="seg" role="group" aria-label="View"><button type="button" data-mode="now" class="${mode === "now" ? "on" : ""}">Now playing</button><button type="button" data-mode="week" class="${mode === "week" ? "on" : ""}">This week</button></div>
      <label class="field">Week<select id="scWeek">${wk.weeks.map((x) => opt(x, `Week ${x}`, wk.week)).join("")}</select></label>
      <label class="field">Book<select id="scBook">${opt("", "Board", book ?? "")}${wk.strategies.map((s) => opt(s.id, `Lab · ${s.name}`, book ?? "")).join("")}</select></label>
      <label class="field">Live projections start from<select id="scBase">${opt("market", "Market line", base)}${opt("yc", "Your YC number", base)}</select></label>
      <span class="muted" style="font-size:.78rem;margin-left:auto">${scoresAt ? `Scores from ESPN, updated ${Math.max(0, Math.round((Date.now() - scoresAt) / 1000))}s ago` : liveCandidates().length ? "Loading scores…" : "No games on right now"}</span>
    </div>
    ${err ? `<p class="err">${e2(err)}</p>` : ""}
    <div class="stats">${tiles}</div>
    ${body}
    <p class="muted" style="font-size:.76rem;margin:12px 0 0">Live projections use the TV score bug's model: the score so far plus the pregame line for the time left, the range narrowing as the clock runs. Expected and range are after fees, held to settlement. Paper positions only.</p>`;
}

// "Lines held" open/closed survives the redraws ("toggle" doesn't bubble, so listen while capturing).
pane?.addEventListener("toggle", (e) => {
  const d = e.target.closest?.("[data-held]");
  if (d) d.open ? openLines.add(d.dataset.held) : openLines.delete(d.dataset.held);
}, true);
pane?.addEventListener("click", (e) => {
  const m = e.target.closest("[data-mode]");
  if (m) { mode = m.dataset.mode; ls.set("botscores", mode); render(); }
});
pane?.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "scWeek") { weekSel = Number(t.value); scores = {}; loadWeek(); }
  if (t.id === "scBook") { book = t.value === "" ? null : Number(t.value); render(); }
  if (t.id === "scBase") { base = t.value; ls.set("botscorebase", base); render(); }
});

if (typeof view !== "undefined" && view === "scores") show(true);
