// Hypotheticals tab: every recorded game × method × venue set, replayed over recorded market
// history (same engine and fill rules as paper). Self-contained: its own data (/api/hypo),
// controls and drawer; nothing here touches the Board, Fills or Strategy lab.
// Uses app.js helpers (api, esc, usd, c, cls, signed, when, VENUES, VNAME, VSHORT, curveSvg).

let hypo = null; // /api/hypo payload
let hypoGame = null; // { game_id, results } for the drawer
let hypoBusy = "";
const HDEF = {
  venues: { kalshi: true, novig: true, prophetx: true },
  shared: true,
  methods: null, // null = all built-ins + lab
  metric: "auto",
  minEdge: 0,
  status: "all",
  sort: "edge",
  excluded: [],
  search: "",
  custom: { pro_edge: 2, anti_edge: 4, take_edge: 3, edge_step: 1, max_worst_case_loss: 10, per_rung_cap: 1, ycpr_weight: 100, stop_minutes_before: 30 },
};
let H = (() => {
  try { return { ...HDEF, ...JSON.parse(localStorage.getItem("bothypo") || "{}") }; } catch { return { ...HDEF }; }
})();
let customRes = null; // { label, byGame: { [game_id]: summary-like } }
const saveH = () => { try { localStorage.setItem("bothypo", JSON.stringify(H)); } catch {} };

async function loadHypo() {
  try {
    hypo = await api("/api/hypo");
    renderHypo();
  } catch (e) {
    if (e.message !== "unauthorized") document.querySelector('[data-pane="hypo"]').innerHTML = `<p class="err">Couldn't load Hypotheticals: ${esc(e.message)}</p>`;
  }
}

/** Which saved venue sets the current venue choice reads: the joint "all" (one shared cap) or each single venue (separate caps). */
function hypoSets() {
  const on = VENUES.filter((v) => H.venues[v]);
  if (on.length === 3 && H.shared) return ["all"];
  return on;
}

/** Combine one game × method across the chosen venue sets. */
function combine(list) {
  const rows = list.filter(Boolean);
  if (!rows.length) return null;
  const n = rows.reduce((a, r) => a + (r.contracts || 0), 0);
  const clvRows = rows.filter((r) => r.clv != null);
  const cn = clvRows.reduce((a, r) => a + r.contracts, 0);
  return {
    pick: rows.find((r) => r.pick)?.pick ?? null,
    fills: rows.reduce((a, r) => a + (r.fills || 0), 0),
    contracts: n,
    fees: rows.reduce((a, r) => a + (r.fees || 0), 0),
    worst: rows.reduce((a, r) => a + (r.worst || 0), 0), // separate caps: worst cases add up (conservative)
    best: rows.reduce((a, r) => a + (r.best || 0), 0),
    expected: rows.reduce((a, r) => a + (r.expected || 0), 0),
    marketExpected: rows.some((r) => r.marketExpected != null) ? rows.reduce((a, r) => a + (r.marketExpected || 0), 0) : null,
    settled: rows.every((r) => r.settled != null) ? rows.reduce((a, r) => a + r.settled, 0) : null,
    clv: cn ? clvRows.reduce((a, r) => a + r.clv * r.contracts, 0) / cn : null,
    curve: rows.every((r) => r.curve) ? rows[0].curve.map((_, i) => rows.reduce((a, r) => a + r.curve[i], 0)) : null,
  };
}

function hypoIndex() {
  const idx = new Map();
  for (const r of hypo.results) idx.set(`${r.game_id}|${r.method}|${r.venues}`, r);
  return idx;
}

function valueOf(s, g) {
  if (!s) return null;
  switch (H.metric) {
    case "expected": return s.expected;
    case "market": return s.marketExpected;
    case "settled": return s.settled;
    case "worst": return s.worst;
    default: return g.final != null ? s.settled : s.expected; // auto
  }
}

const METRICS = { auto: "Settled if final, else expected", expected: "Expected · your number", market: "Expected · market's number", settled: "Settled only", worst: "Worst case" };

function filteredGames() {
  const q = H.search.trim().toLowerCase();
  let list = hypo.games.filter((g) => {
    if (q && !`${g.away_team} ${g.home_team}`.toLowerCase().includes(q)) return false;
    if (H.status === "upcoming" && g.final != null) return false;
    if (H.status === "settled" && g.final == null) return false;
    if (H.minEdge > 0 && !(g.edge != null && Math.abs(g.edge) >= H.minEdge)) return false;
    return true;
  });
  const key = H.sort;
  list = [...list].sort((a, b) =>
    key === "kickoff" ? new Date(a.kickoff) - new Date(b.kickoff) :
    key === "edge" ? Math.abs(b.edge ?? -1) - Math.abs(a.edge ?? -1) :
    0);
  return list;
}

function renderHypo() {
  const pane = document.querySelector('[data-pane="hypo"]');
  if (!hypo) { pane.innerHTML = '<p class="muted">Loading…</p>'; return; }
  const methods = hypo.methods;
  const chosen = methods.filter((m) => !H.methods || H.methods.includes(m.key));
  const cols = [...chosen, ...(customRes ? [{ key: "custom", label: customRes.label }] : [])];
  const sets = hypoSets();
  const idx = hypoIndex();
  const games = filteredGames();
  const excluded = new Set(H.excluded);
  const included = games.filter((g) => !excluded.has(g.game_id));
  const cell = (g, m) => (m.key === "custom" ? customRes?.byGame[g.game_id] ?? null : combine(sets.map((s) => idx.get(`${g.game_id}|${m.key}|${s}`))));

  // Method totals over the included games.
  const totals = cols.map((m) => {
    let val = 0, any = false, exp = 0, mexp = 0, settled = 0, settledN = 0, risked = 0, fills = 0, traded = 0, clvSum = 0, clvN = 0, settledRisk = 0;
    for (const g of included) {
      const s = cell(g, m);
      if (!s) continue;
      const v = valueOf(s, g);
      if (v != null) { val += v; any = true; }
      exp += s.expected || 0;
      mexp += s.marketExpected || 0;
      if (s.settled != null && g.final != null) { settled += s.settled; settledN++; settledRisk += -(s.worst || 0); }
      risked += -(s.worst || 0);
      fills += s.fills || 0;
      if (s.fills) traded++;
      if (s.clv != null) { clvSum += s.clv * s.contracts; clvN += s.contracts; }
    }
    return { m, val: any ? val : null, exp, mexp, settled: settledN ? settled : null, settledN, risked, settledRisk, fills, traded, clv: clvN ? clvSum / clvN : null };
  });
  const bestVal = Math.max(...totals.map((t) => t.val ?? -Infinity));
  const asOf = hypo.lastRun?.finished_at || hypo.lastRun?.started_at;
  const settledGames = included.filter((g) => g.final != null).length;
  const venueNote = sets[0] === "all" ? "all venues, one shared loss cap per game" : sets.length > 1 ? `${sets.map((s) => VNAME[s]).join(" + ")}, separate caps (worst cases add up)` : `${VNAME[sets[0]] || "no venue"} only`;

  pane.innerHTML = `
    <div class="callout" style="border-color:var(--c-info);background:var(--c-info-bg)">Every recorded game, replayed with each method over the prices and trades the recorder saved — same engine and fill rules as paper, nothing traded and nothing here touches the Board, Fills or lab. Recording began Oct 21; results update hourly${asOf ? ` (last ${ago(asOf)})` : ""}. Each method risks up to its own cap per game (built-ins $10).</div>
    <div class="panel hypo-controls" style="margin-bottom:14px">
      <div class="hc-row">
        <div class="field">Venues
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;min-height:32px">
            ${VENUES.map((v) => `<label class="chk"><input type="checkbox" data-hv="${v}" ${H.venues[v] ? "checked" : ""}> ${VNAME[v]}</label>`).join("")}
            <label class="chk" title="With all three, one loss cap covers the game across venues"><input type="checkbox" id="hShared" ${H.shared ? "checked" : ""} ${VENUES.every((v) => H.venues[v]) ? "" : "disabled"}> One shared cap</label>
          </div></div>
        <label class="field">Show<select id="hMetric">${Object.entries(METRICS).map(([k, l]) => `<option value="${k}" ${H.metric === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field">Games<select id="hStatus"><option value="all" ${H.status === "all" ? "selected" : ""}>All</option><option value="upcoming" ${H.status === "upcoming" ? "selected" : ""}>Not played yet</option><option value="settled" ${H.status === "settled" ? "selected" : ""}>Final only</option></select></label>
        <label class="field">Sort<select id="hSort"><option value="edge" ${H.sort === "edge" ? "selected" : ""}>Your edge vs market</option><option value="kickoff" ${H.sort === "kickoff" ? "selected" : ""}>Kickoff</option></select></label>
        <label class="field">Min edge (pts)<input id="hMinEdge" type="number" step="0.5" min="0" value="${H.minEdge || ""}" placeholder="0"></label>
        <label class="field">Search<input id="hSearch" value="${esc(H.search)}" placeholder="Team"></label>
      </div>
      <div class="field" style="margin-top:10px">Methods
        <div style="display:flex;gap:6px 14px;flex-wrap:wrap">
          ${methods.map((m) => `<label class="chk"><input type="checkbox" data-hm="${esc(m.key)}" ${!H.methods || H.methods.includes(m.key) ? "checked" : ""}> ${esc(m.label)}</label>`).join("")}
        </div></div>
      <details style="margin-top:10px" ${customRes ? "open" : ""}><summary style="cursor:pointer;font-weight:600;font-size:.82rem">Custom what-if</summary>
        <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-top:8px">
          ${[["pro_edge", "Pro-pick edge ¢", 0.5], ["anti_edge", "Sell-back edge ¢", 0.5], ["take_edge", "Take edge ¢", 0.5], ["edge_step", "Extra per contract ¢", 0.5], ["max_worst_case_loss", "Max loss $", 1], ["per_rung_cap", "Contracts per number", 1], ["ycpr_weight", "Trust %", 5], ["stop_minutes_before", "Stop (min before)", 5]]
            .map(([k, l, st]) => `<label class="field">${l}<input type="number" step="${st}" data-hc="${k}" value="${H.custom[k]}"></label>`).join("")}
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap"><button class="btn primary" id="hRun" type="button" ${hypoBusy ? "disabled" : ""}>Run on ${included.length} game${included.length === 1 ? "" : "s"}</button><span class="muted" id="hMsg">${esc(hypoBusy)}</span>${customRes ? '<button class="btn" id="hClear" type="button">Clear custom</button>' : ""}</div>
      </details>
    </div>

    <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:8px;flex-wrap:wrap"><b style="font-size:.9rem">Methods</b><span class="muted" style="font-size:.8rem">${included.length} games (${settledGames} final) · ${esc(venueNote)}</span></div>
    <div class="panel" style="padding:8px 10px;margin-bottom:14px"><div class="scroll"><table class="hypo-totals">
      <tr><th>Method</th><th>${esc(METRICS[H.metric])}</th><th>Expected · yours</th><th>Expected · market</th><th>Settled</th><th>Return</th><th>CLV</th><th>Fills</th></tr>
      ${totals.map((t) => `<tr class="${t.val != null && t.val === bestVal && cols.length > 1 ? "best" : ""}">
        <td><b>${esc(t.m.label)}</b><small>traded ${t.traded} of ${included.length}</small></td>
        <td class="${cls(t.val)}">${usd(t.val)}</td>
        <td class="${cls(t.exp)}">${usd(t.exp)}</td>
        <td class="${cls(t.mexp)}">${usd(t.mexp)}</td>
        <td class="${cls(t.settled)}">${usd(t.settled)}<small>${t.settledN} final</small></td>
        <td>${t.settled == null || !t.settledRisk ? "–" : ((t.settled / t.settledRisk) * 100).toFixed(1) + "%"}<small>risked ${usd(t.settledRisk || t.risked)}</small></td>
        <td class="${cls(t.clv)}">${c(t.clv)}</td>
        <td>${t.fills}</td>
      </tr>`).join("")}
    </table></div></div>

    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <b style="font-size:.9rem">Games</b><span class="muted" style="font-size:.8rem">${games.length} shown · ${excluded.size} ruled out</span>
      <button class="btn" type="button" id="hInclAll">Include all</button><button class="btn" type="button" id="hExclAll">Rule out all shown</button>
    </div>
    <div class="panel" style="padding:8px 10px"><div class="scroll"><table class="hypo-games">
      <tr><th></th><th>Game</th><th title="Your number minus the market, in points">Edge</th><th>YC / market / final</th>${cols.map((m) => `<th>${esc(m.label)}</th>`).join("")}</tr>
      ${games.map((g) => {
        const off = excluded.has(g.game_id);
        const lean = g.edgeSide ? (g.edgeSide === "home" ? g.home_team : g.away_team) : null;
        return `<tr class="${off ? "off" : ""}">
          <td><input type="checkbox" data-hg="${esc(g.game_id)}" ${off ? "" : "checked"} aria-label="Include ${esc(g.away_team)} at ${esc(g.home_team)}"></td>
          <td><b>${esc(g.away_team)} @ ${esc(g.home_team)}</b><small>${when(g.kickoff)}</small></td>
          <td>${g.edge == null ? "–" : Math.abs(g.edge).toFixed(1)}<small>${lean ? esc(lean) : ""}</small></td>
          <td>${signed(g.ycpr)} / ${signed(g.market)} / ${g.final == null ? "–" : signed(g.final)}</td>
          ${cols.map((m) => {
            const s = cell(g, m);
            const v = valueOf(s, g);
            return `<td class="hcell ${cls(v)}" data-hcell="${esc(g.game_id)}|${esc(m.key)}">${s && s.fills ? usd(v) : '<span class="muted">–</span>'}<small>${s ? `${s.fills} fills` : "no data"}</small></td>`;
          }).join("")}
        </tr>`;
      }).join("") || `<tr><td colspan="${4 + cols.length}" class="muted">No games match. Recording covers every game in the next 8 days with an FBS team.</td></tr>`}
    </table></div></div>
    <p class="muted" style="font-size:.76rem;margin:8px 0 0">Lines are away spreads (negative = away favored). Each method picks the side your number favors versus the market when recording first sees both. Expected = average P&amp;L over final margins under your number (or the market's). Return = settled P&amp;L ÷ worst cases of final games. Click a cell for its P&amp;L by margin.</p>`;
}

async function openHypoCell(gameId, methodKey) {
  openHypo = { gameId, methodKey };
  const g = hypo.games.find((x) => x.game_id === gameId);
  renderHypoDrawer(g, null);
  try {
    if (!hypoGame || hypoGame.game_id !== gameId) hypoGame = await api(`/api/hypo?game=${encodeURIComponent(gameId)}`);
    if (openHypo?.gameId === gameId) renderHypoDrawer(g, hypoGame);
  } catch (e) {
    $("drawerRoot").querySelector(".drawer-body").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function renderHypoDrawer(g, detail) {
  const root = $("drawerRoot");
  if (!openHypo || !g) { root.innerHTML = ""; return; }
  const sets = hypoSets();
  const idx = new Map((detail?.results || []).map((r) => [`${r.method}|${r.venues}`, r]));
  const m = openHypo.methodKey === "custom" ? { key: "custom", label: customRes?.label || "Custom" } : hypo.methods.find((x) => x.key === openHypo.methodKey);
  const s = m.key === "custom" ? customRes?.byGame[g.game_id] : detail ? combine(sets.map((v) => idx.get(`${m.key}|${v}`))) : null;
  const pts = s?.curve ? s.curve.map((v, i) => ({ m: i - 60, v })).filter((p) => p.m !== 0 && p.m >= -45 && p.m <= 45) : [];
  const others = detail ? hypo.methods.map((x) => ({ x, s: combine(sets.map((v) => idx.get(`${x.key}|${v}`))) })) : [];
  root.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Hypothetical">
      <div class="drawer-head"><div><h2>${esc(g.away_team)} @ ${esc(g.home_team)}</h2><div class="muted" style="font-size:.8rem;margin-top:4px">${esc(m.label)} · ${when(g.kickoff)} · ${g.final == null ? "not final" : `final ${signed(g.final)}`}</div></div><button class="xbtn" data-close="1" aria-label="Close">✕</button></div>
      <div class="drawer-body">
        ${!detail && m.key !== "custom" ? '<p class="muted">Loading…</p>' : !s ? '<p class="muted">No replay for this venue choice yet.</p>' : `
        <div class="mini-stats">
          <div class="stat"><div class="l">Leaned</div><div class="v" style="font-size:1rem">${s.pick ? esc(s.pick === "home" ? g.home_team : g.away_team) : "–"}</div><div class="d">YC ${signed(g.ycpr)} · market ${signed(g.market)}</div></div>
          <div class="stat"><div class="l">${g.final != null ? "Settled" : "Expected · yours"}</div><div class="v num ${cls(g.final != null ? s.settled : s.expected)}">${usd(g.final != null ? s.settled : s.expected)}</div><div class="d">market's number ${usd(s.marketExpected)}</div></div>
          <div class="stat"><div class="l">Worst / best</div><div class="v num"><span class="${cls(s.worst)}">${usd(s.worst)}</span></div><div class="d">best ${usd(s.best)}</div></div>
          <div class="stat"><div class="l">Fills</div><div class="v num">${s.fills}</div><div class="d">${s.contracts} contracts · fees ${usd(s.fees)} · CLV ${c(s.clv)}</div></div>
        </div>
        <h3>P&amp;L by final margin</h3>
        ${curveSvg(g, pts)}`}
        ${others.length ? `<h3>Every method on this game</h3><div class="panel" style="padding:10px 12px"><div class="scroll"><table><tr><th>Method</th><th>Fills</th><th>Expected</th><th>Settled</th><th>Worst</th></tr>
          ${others.map(({ x, s: o }) => `<tr class="${x.key === m.key ? "hbest" : ""}"><td>${esc(x.label)}</td><td>${o?.fills ?? "–"}</td><td class="${cls(o?.expected)}">${usd(o?.expected)}</td><td class="${cls(o?.settled)}">${usd(o?.settled)}</td><td class="${cls(o?.worst)}">${usd(o?.worst)}</td></tr>`).join("")}</table></div></div>` : ""}
      </div>
    </aside>`;
}

async function runCustom() {
  const games = filteredGames().filter((g) => !H.excluded.includes(g.game_id)).map((g) => g.game_id);
  if (!games.length) return;
  const p = H.custom;
  const custom = {
    pro_edge: p.pro_edge / 100, anti_edge: p.anti_edge / 100, take_edge: p.take_edge / 100, edge_step: p.edge_step / 100,
    max_worst_case_loss: p.max_worst_case_loss, per_rung_cap: p.per_rung_cap, ycpr_weight: p.ycpr_weight / 100, stop_minutes_before: p.stop_minutes_before,
  };
  const sets = hypoSets();
  const per = {};
  try {
    for (const [i, set] of sets.entries()) {
      // Batches keep each request inside the server's time limit.
      for (let b = 0; b < games.length; b += 25) {
        hypoBusy = `Replaying ${set === "all" ? "all venues" : VNAME[set]}${sets.length > 1 ? ` (${i + 1}/${sets.length})` : ""}: games ${b + 1}–${Math.min(b + 25, games.length)} of ${games.length}…`;
        renderHypo();
        const r = await api("/api/hypo", { custom, venues: set, games: games.slice(b, b + 25) });
        for (const [gid, s] of Object.entries(r.results)) (per[gid] ??= []).push(s);
      }
    }
    const byGame = {};
    for (const [gid, list] of Object.entries(per)) byGame[gid] = combine(list);
    customRes = { label: `Custom (${p.pro_edge}/${p.anti_edge}/${p.take_edge}¢, $${p.max_worst_case_loss}, trust ${p.ycpr_weight}%)`, byGame };
    hypoBusy = "";
  } catch (e) {
    hypoBusy = `Failed: ${e.message}`;
  }
  renderHypo();
}

// ---------- Events
(() => {
  const pane = document.querySelector('[data-pane="hypo"]');
  pane.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.hv) { H.venues[t.dataset.hv] = t.checked; hypoGame = null; }
    else if (t.id === "hShared") H.shared = t.checked;
    else if (t.dataset.hm) {
      const keys = [...pane.querySelectorAll("[data-hm]")].filter((x) => x.checked).map((x) => x.dataset.hm);
      H.methods = keys.length === hypo.methods.length ? null : keys;
    } else if (t.dataset.hg) {
      const set = new Set(H.excluded);
      t.checked ? set.delete(t.dataset.hg) : set.add(t.dataset.hg);
      H.excluded = [...set];
    } else if (t.id === "hMetric") H.metric = t.value;
    else if (t.id === "hStatus") H.status = t.value;
    else if (t.id === "hSort") H.sort = t.value;
    else if (t.id === "hMinEdge") H.minEdge = Number(t.value) || 0;
    else if (t.dataset.hc) { H.custom[t.dataset.hc] = Number(t.value); saveH(); return; }
    else return;
    saveH();
    renderHypo();
  });
  pane.addEventListener("input", (e) => {
    if (e.target.id !== "hSearch") return;
    H.search = e.target.value;
    saveH();
    const pos = e.target.selectionStart;
    renderHypo();
    const el = $("hSearch");
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  pane.addEventListener("click", (e) => {
    if (e.target.id === "hRun") return runCustom();
    if (e.target.id === "hClear") { customRes = null; return renderHypo(); }
    if (e.target.id === "hInclAll") { H.excluded = []; saveH(); return renderHypo(); }
    if (e.target.id === "hExclAll") { H.excluded = [...new Set([...H.excluded, ...filteredGames().map((g) => g.game_id)])]; saveH(); return renderHypo(); }
    const cellEl = e.target.closest("[data-hcell]");
    if (cellEl) {
      const [gid, key] = cellEl.dataset.hcell.split("|");
      openHypoCell(gid, key);
    }
  });
})();
