// Add games and Manage games tabs. Add games: every game of a YCPR week in a table you can filter, sort and
// multi-select, then one settings block (picked from a strategy) for all of them. Games already watched are greyed
// out with a link to Manage games, which applies one change (a strategy, a cap, venues, pause/resume) to many
// watched games at once. Uses app.js helpers (api, data, load, esc, num, signed, when, usd, VENUES, VNAME, VSHORT,
// setView, openGame, renderDrawer).

let picker = null; // /api/data?part=picker payload
let pickerBusy = false;
const PK_DEF = { search: "", conf: "", day: "", minEdge: "", venues: [], hideWatched: true, hideStarted: true, sort: "edge" };
let pk = (() => { try { return { ...PK_DEF, ...JSON.parse(localStorage.getItem("botpicker") || "{}") }; } catch { return { ...PK_DEF }; } })();
const savePk = () => { try { localStorage.setItem("botpicker", JSON.stringify(pk)); } catch {} };
let pkWeek = null; // { season, week } being shown; null = current
const pkSel = new Map(); // game_id → { pick, override }
let pkMsg = "";
const mgSel = new Set(); // watchlist ids selected in Manage games
let mgShowDone = false;
let mgMsg = "";

// ---------- Strategies as presets

/** The settings a strategy fills in. "Bot defaults" = the watchlist's column defaults. */
const BOT_DEFAULTS = { id: "", name: "Bot defaults", pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.03, edge_step: 0.01, max_worst_case_loss: 5, per_rung_cap: 1, ycpr_weight: null, stop_minutes_before: 30, shape: false, market_floor: null, against_limit: null, blowout_margin: null };
const PRESET_KEYS = ["pro_edge", "anti_edge", "take_edge", "edge_step", "max_worst_case_loss", "per_rung_cap", "ycpr_weight", "stop_minutes_before", "shape", "market_floor", "against_limit", "blowout_margin"];
const presets = () => [BOT_DEFAULTS, ...((picker?.strategies ?? data?.strategies) || [])];
const presetById = (id) => presets().find((p) => String(p.id) === String(id ?? "")) ?? null;
const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9);
/** A preset key's value for comparing: shape off and unset are the same. */
const pv = (x, k) => (k === "shape" ? !!x[k] : x[k]);
/** "Patient", "Patient · edited", "Bot defaults" or "Custom" for a watched game. */
function presetLabel(w) {
  const p = w.strategy_preset != null ? presetById(w.strategy_preset) : null;
  if (p) return PRESET_KEYS.every((k) => same(pv(w, k), pv(p, k))) ? p.name : `${p.name} · edited`;
  return PRESET_KEYS.every((k) => same(pv(w, k), pv(BOT_DEFAULTS, k))) ? "Bot defaults" : "Custom";
}

/** One settings block (Add games bar, Manage games bar): a strategy select plus the fields it fills. Blank = unchanged when `keepBlank`. */
function settingsBlock(prefix, keepBlank) {
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  const def = Math.round((num(data?.state?.default_ycpr_weight) ?? 1) * 100);
  return `<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
    <label class="field" style="grid-column:span 2">Strategy<select id="${prefix}Preset">${keepBlank ? opt("keep", "Keep each game's") : ""}${presets().map((p) => opt(p.id, p.name + (p.enabled === false ? " (off in lab)" : ""))).join("")}${opt("custom", "Custom")}</select></label>
    <label class="field">Trust<select id="${prefix}Trust">${keepBlank ? opt("keep", "Keep") : ""}${opt("", `Use default (${def}%)`)}${opt("1", "100%")}${opt("0.75", "75%")}${opt("0.5", "50%")}${opt("0.25", "25%")}</select></label>
    <label class="field">Max loss ($)<input id="${prefix}Max" type="number" step="0.5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Contracts / number<input id="${prefix}Cap" type="number" step="1" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Pro-pick edge (¢)<input id="${prefix}Pro" type="number" step="0.5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Sell-back edge (¢)<input id="${prefix}Anti" type="number" step="0.5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Take edge (¢)<input id="${prefix}Take" type="number" step="0.5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Extra / contract (¢)<input id="${prefix}Step" type="number" step="0.5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Stop (min before)<input id="${prefix}Stop" type="number" step="5" ${keepBlank ? 'placeholder="keep"' : ""}></label>
    <label class="field">Shape<select id="${prefix}Shape">${keepBlank ? opt("keep", "Keep") : ""}${opt("", "Off")}${opt("1", "On")}</select></label>
    <label class="field">Min P&amp;L at market ($)<input id="${prefix}Floor" type="number" step="0.5" placeholder="${keepBlank ? "keep" : "0"}"></label>
    <label class="field">Max loss moderately against ($)<input id="${prefix}Against" type="number" step="0.5" placeholder="${keepBlank ? "keep" : "10% of max loss"}"></label>
    <label class="field">Blowout margin (pts)<input id="${prefix}Blowout" type="number" step="1" placeholder="${keepBlank ? "keep" : "10"}"></label>
  </div>`;
}
const FIELD_MAP = [["Max", "max_worst_case_loss", 1], ["Cap", "per_rung_cap", 1], ["Pro", "pro_edge", 100], ["Anti", "anti_edge", 100], ["Take", "take_edge", 100], ["Step", "edge_step", 100], ["Stop", "stop_minutes_before", 1],
  ["Floor", "market_floor", 1], ["Against", "against_limit", 1], ["Blowout", "blowout_margin", 1]];

/** Fill a settings block from a strategy (or blank it for "keep"). */
function fillBlock(prefix, presetId) {
  const sel = $(`${prefix}Preset`);
  if (!sel) return;
  sel.value = presetId;
  if (presetId === "custom") return; // keep whatever is typed
  const p = presetById(presetId);
  for (const [f, k, mult] of FIELD_MAP) $(`${prefix}${f}`).value = p && p[k] != null ? Math.round(Number(p[k]) * mult * 100) / 100 : "";
  $(`${prefix}Shape`).value = p ? (p.shape ? "1" : "") : presetId === "keep" ? "keep" : $(`${prefix}Shape`).value;
  $(`${prefix}Trust`).value = p ? (p.ycpr_weight == null ? "" : String(Number(p.ycpr_weight))) : presetId === "keep" ? "keep" : $(`${prefix}Trust`).value;
}

/** The settings a block holds; fields left blank are omitted. */
function readBlock(prefix) {
  const out = {};
  for (const [f, k, mult] of FIELD_MAP) {
    const v = $(`${prefix}${f}`).value;
    if (v !== "") out[k] = Number(v) / mult;
  }
  const t = $(`${prefix}Trust`).value;
  if (t !== "keep") out.ycpr_weight = t === "" ? null : Number(t);
  const sh = $(`${prefix}Shape`).value;
  if (sh !== "keep") out.shape = sh === "1";
  const p = $(`${prefix}Preset`).value;
  if (p !== "keep") out.strategy_preset = p === "custom" || p === "" ? null : Number(p);
  // A strategy's unset shape limits mean "use the default", so they're copied as unset rather than kept.
  if (presetById(p) && p !== "keep") for (const k of ["market_floor", "against_limit", "blowout_margin"]) if (!(k in out)) out[k] = null;
  return out;
}

// ---------- Add games

async function loadPicker() {
  if (pickerBusy) return;
  pickerBusy = true;
  try {
    const qs = pkWeek ? `&season=${pkWeek.season}&week=${pkWeek.week}` : "";
    picker = await api(`/api/data?part=picker${qs}`);
    pkWeek = { season: picker.season, week: picker.week };
  } catch (e) {
    if (e.message !== "unauthorized") pkMsg = `Couldn't load games: ${e.message}`;
  } finally {
    pickerBusy = false;
    renderAdd();
  }
}

const awayMkt = (g) => (g.home_spread == null ? null : -g.home_spread); // the sportsbook reference line
/** What the gap is measured against: the prediction-market median once the venues list the game, else the sportsbook line. */
const refOf = (g) => g.lines?.pm ?? awayMkt(g);
/** The side YC favors versus that market (the bot's usual lean). */
const autoPick = (g) => (g.yc_away_spread != null && refOf(g) != null && g.yc_away_spread > refOf(g) ? "home" : "away");
const edgeOf = (g) => (g.yc_away_spread == null || refOf(g) == null ? null : Math.abs(g.yc_away_spread - refOf(g)));

// ---------- Weekly workflow (one button; the work is /api/admin weeklyWorkflow)
let wfBusy = false;
let wfResult = null;
function workflowPanel() {
  const r = wfResult;
  const list = (title, xs) => (xs?.length ? `<p style="margin:6px 0 0;font-size:.82rem"><b>${title} (${xs.length}):</b> <span class="muted">${esc(xs.slice(0, 12).join(", "))}${xs.length > 12 ? ` and ${xs.length - 12} more` : ""}</span></p>` : "");
  const out = !r ? "" : r.error
    ? `<p class="err" style="margin:10px 0 0">${esc(r.error)}</p>`
    : `<div style="margin-top:10px;border-top:1px solid var(--a-line);padding-top:8px">
        <p style="margin:0;font-size:.86rem">Week ${r.week}: <b>${r.added}</b> game${r.added === 1 ? "" : "s"} added · ${r.alreadyWatched} already watched · YC lines synced on ${r.synced} · books on: ${esc((r.books || []).join(", "))}</p>
        ${list("No market on any venue yet", r.noVenue)}${list("No YC line (ratings missing)", r.noYc)}
        <p class="muted" style="margin:6px 0 0;font-size:.78rem">${esc(r.note || "")}</p></div>`;
  return `<div class="panel" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
      <div><h3 style="margin:0 0 4px">Weekly workflow · week ${picker.week}</h3>
        <p class="muted" style="font-size:.82rem;margin:0;max-width:780px">One button: adds every game of the week that isn't being traded yet, syncs YC's lines (each game keeps your original line), and turns on the Shrunk and Target books. From then on each game is traded from its trading line (PM median + beta × the capped gap, following the market every cycle), sized from its own edge, inside the loss caps. Games with no edge get no size. Add games by hand below if you want the original strategies on a game too.</p></div>
      <button class="btn primary" type="button" id="wfRun" ${wfBusy ? "disabled" : ""}>${wfBusy ? "Running…" : `Run for week ${picker.week}`}</button>
    </div>${out}</div>`;
}
const dayOf = (g) => (g.start_date ? new Date(g.start_date).toLocaleDateString([], { weekday: "short" }) : "TBD");
const started = (g) => g.start_date && new Date(g.start_date).getTime() <= Date.now();

function pickerRows() {
  const s = pk.search.trim().toLowerCase();
  const min = pk.minEdge === "" ? null : Number(pk.minEdge);
  const rows = picker.games.filter((g) => {
    if (pk.hideWatched && g.watch && !pkSel.has(g.id)) return false;
    if (pk.hideStarted && started(g)) return false;
    if (s && !`${g.away_team} ${g.home_team}`.toLowerCase().includes(s)) return false;
    if (pk.conf && g.home_conference !== pk.conf && g.away_conference !== pk.conf) return false;
    if (pk.day && dayOf(g) !== pk.day) return false;
    if (min != null && !(edgeOf(g) >= min)) return false;
    if (pk.venues.length && !pk.venues.every((v) => (g.venue_margins?.[v] ?? g.ro_margins?.[v]) != null)) return false;
    return true;
  });
  const by = {
    edge: (a, b) => (edgeOf(b) ?? -1) - (edgeOf(a) ?? -1),
    kickoff: (a, b) => String(a.start_date).localeCompare(String(b.start_date)),
    yc: (a, b) => Math.abs(a.yc_away_spread ?? 99) - Math.abs(b.yc_away_spread ?? 99),
  }[pk.sort];
  return rows.sort(by);
}

function renderAdd() {
  const pane = document.querySelector('[data-pane="add"]');
  if (!picker) { pane.innerHTML = `<p class="muted">${pkMsg ? esc(pkMsg) : "Loading games…"}</p>`; return; }
  const keepFocus = document.activeElement?.closest?.('[data-pane="add"]') ? document.activeElement.id : null;
  const rows = pickerRows();
  const confs = [...new Set(picker.games.flatMap((g) => [g.home_conference, g.away_conference]).filter(Boolean))].sort();
  const days = [...new Set(picker.games.map(dayOf))];
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
  const sel = [...pkSel.keys()].map((id) => picker.games.find((g) => g.id === id)).filter(Boolean);
  const needLine = sel.filter((g) => g.yc_away_spread == null && num(pkSel.get(g.id).override) == null);
  const noEdge = sel.filter((g) => {
    const p = pkSel.get(g.id), ours = num(p.override) ?? g.yc_away_spread, mkt = refOf(g);
    return ours != null && mkt != null && !(p.pick === "home" ? ours > mkt : ours < mkt);
  });
  const watchedN = picker.games.filter((g) => g.watch).length;
  pane.innerHTML = `
    ${workflowPanel()}
    <div class="panel" style="margin-bottom:12px">
      <div class="hc-row" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        <label class="field">Week<select id="pkWeek">${picker.weeks.map((w) => opt(w, `Week ${w}${w === picker.current ? " (current)" : ""}`, picker.week)).join("")}</select></label>
        <label class="field">Search<input id="pkSearch" value="${esc(pk.search)}" placeholder="Team"></label>
        <label class="field">Conference<select id="pkConf">${opt("", "All", pk.conf)}${confs.map((c) => opt(c, c, pk.conf)).join("")}</select></label>
        <label class="field">Day<select id="pkDay">${opt("", "Any", pk.day)}${days.map((d) => opt(d, d, pk.day)).join("")}</select></label>
        <label class="field">Min edge (pts)<input id="pkMin" type="number" step="0.5" min="0" value="${esc(pk.minEdge)}" placeholder="any"></label>
        <label class="field">Sort<select id="pkSort">${opt("edge", "Biggest edge", pk.sort)}${opt("kickoff", "Kickoff", pk.sort)}${opt("yc", "Closest YC line", pk.sort)}</select></label>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <span class="muted" style="font-size:.78rem">Market on:</span>
        ${VENUES.map((v) => `<label class="chk"><input type="checkbox" class="pkVenue" value="${v}" ${pk.venues.includes(v) ? "checked" : ""}> ${VNAME[v]}</label>`).join("")}
        <label class="chk"><input type="checkbox" id="pkHideW" ${pk.hideWatched ? "checked" : ""}> Hide games I'm trading (${watchedN})</label>
        <label class="chk"><input type="checkbox" id="pkHideS" ${pk.hideStarted ? "checked" : ""}> Hide started</label>
        <span class="muted" style="font-size:.78rem;margin-left:auto">${rows.length} of ${picker.games.length} games · market lines from the recorder (next 8 days)</span>
      </div>
    </div>
    <div class="panel" style="padding:8px 10px;margin-bottom:12px"><div class="scroll"><table class="pk">
      <tr><th><input type="checkbox" id="pkAll" aria-label="Select all shown" ${rows.length && rows.filter((g) => !g.watch && !started(g)).every((g) => pkSel.has(g.id)) ? "checked" : ""}></th><th style="text-align:left">Game</th><th>Kickoff</th><th title="Your YC line as first synced">YC</th><th title="PM median + beta x the capped gap">Trade</th><th title="Median of the venues' implied margins">PM</th><th title="Sportsbook reference, not used for pricing">Book</th><th title="YC minus the PM median (the sportsbook when no venue lists it)">Gap</th><th>Venues</th><th style="text-align:left">Lean</th><th>Your line</th></tr>
      ${rows.map((g) => {
        const off = !!g.watch || started(g);
        const s = pkSel.get(g.id);
        const e = edgeOf(g);
        const lean = s?.pick ?? autoPick(g);
        return `<tr class="${off ? "off" : ""}" data-pk="${esc(g.id)}">
          <td>${off ? "" : `<input type="checkbox" class="pkPick" ${s ? "checked" : ""} aria-label="Select ${esc(g.away_team)} at ${esc(g.home_team)}">`}</td>
          <td style="text-align:left"><b>${esc(g.away_team)} @ ${esc(g.home_team)}</b><small>${esc([g.away_conference, g.home_conference].filter(Boolean).join(" · "))}${g.neutral_site ? " · neutral" : ""}</small></td>
          <td>${g.start_date ? when(g.start_date) : "TBD"}</td>
          <td>${signed(g.yc_away_spread)}</td>
          <td><b>${signed(g.lines?.shrunk)}</b></td>
          <td>${signed(g.lines?.pm)}</td>
          <td class="muted">${signed(awayMkt(g))}</td>
          <td class="${e >= 3 ? "ok" : ""}">${e == null ? "–" : e.toFixed(1)}</td>
          <td>${VENUES.filter((v) => (g.venue_margins?.[v] ?? g.ro_margins?.[v]) != null).map((v) => `<span class="pill" title="${VNAME[v]} implies ${esc(g.away_team)} ${signed(Number(g.venue_margins?.[v] ?? g.ro_margins?.[v]))}${g.venue_margins?.[v] == null ? " (read-only)" : ""}">${VSHORT[v]}</span>`).join(" ") || '<span class="muted">–</span>'}</td>
          <td style="text-align:left">${g.watch ? `<span class="pill ${g.watch.enabled ? "ok" : ""}">${g.watch.enabled ? "Trading" : "Paused"}</span> <button type="button" class="btn" data-manage="${g.watch.id}" style="padding:2px 8px">Edit</button>`
            : started(g) ? '<span class="muted">Started</span>'
            : s ? `<div class="seg"><button type="button" data-lean="away" class="${lean === "away" ? "on" : ""}">${esc(g.away_team)}</button><button type="button" data-lean="home" class="${lean === "home" ? "on" : ""}">${esc(g.home_team)}</button></div>`
            : `<span class="muted">${esc(lean === "home" ? g.home_team : g.away_team)}</span>`}</td>
          <td>${s ? `<input class="pkOverride" type="number" step="0.5" value="${esc(s.override ?? "")}" placeholder="${g.yc_away_spread == null ? "needed" : "YC"}" aria-label="Your away spread" style="width:76px;padding:4px 6px;border:1px solid var(--a-field-line);border-radius:6px;background:var(--a-field)">` : ""}</td>
        </tr>`;
      }).join("") || '<tr><td colspan="12" class="muted">No games match these filters.</td></tr>'}
    </table></div></div>
    <form class="panel pk-bar" id="pkForm">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:8px"><h3 style="margin:0">Settings for ${sel.length || "the selected"} game${sel.length === 1 ? "" : "s"}</h3><span class="muted" style="font-size:.78rem">Pick a strategy to fill these in; change any field to make it custom.</span></div>
      <div ${sel.length ? "" : "hidden"}>${settingsBlock("pk", false)}</div>
      ${sel.length ? "" : '<p class="muted" style="margin:0">Tick games above to add them.</p>'}
      ${needLine.length ? `<p class="err" style="margin:10px 0 0">${needLine.length} selected game${needLine.length > 1 ? "s have" : " has"} no YC number: enter your line to add ${needLine.length > 1 ? "them" : "it"}.</p>` : ""}
      ${noEdge.length ? `<div class="callout" style="margin:10px 0 0">${noEdge.map((g) => esc(`${g.away_team} @ ${g.home_team}`)).join(", ")}: your number isn't better than the market for the lean you picked, so the bot won't add exposure there until it is.</div>` : ""}
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" ${!sel.length || needLine.length ? "disabled" : ""}>Add ${sel.length || ""} game${sel.length === 1 ? "" : "s"}</button>
        ${sel.length ? '<button class="btn" type="button" id="pkClear">Clear selection</button>' : ""}
        <span class="muted" id="pkMsgEl">${esc(pkMsg)}</span>
      </div>
    </form>`;
  // Keep the settings the user typed across redraws.
  const prev = renderAdd.block;
  if (prev) { for (const [id, v] of Object.entries(prev)) if ($(id)) $(id).value = v; }
  else fillBlock("pk", "");
  if (keepFocus && $(keepFocus)) { const el = $(keepFocus); el.focus(); if (el.setSelectionRange && el.type === "text") el.setSelectionRange(el.value.length, el.value.length); }
}
renderAdd.block = null;
const snapBlock = (prefix) => Object.fromEntries([...document.querySelectorAll(`[id^="${prefix}"]`)].filter((el) => /^(INPUT|SELECT)$/.test(el.tagName) && el.closest("form")).map((el) => [el.id, el.value]));

const addPane = document.querySelector('[data-pane="add"]');
addPane.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "pkSearch") { pk.search = t.value; savePk(); renderAdd(); }
  else if (t.id === "pkMin") { pk.minEdge = t.value; savePk(); renderAdd(); }
  else if (t.classList.contains("pkOverride")) { pkSel.get(t.closest("[data-pk]").dataset.pk).override = t.value; }
  else if (t.closest("#pkForm") && t.id !== "pkPreset") { if ($("pkPreset").value !== "custom") $("pkPreset").value = "custom"; renderAdd.block = snapBlock("pk"); }
});
addPane.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "pkWeek") { pkWeek = { season: picker.season, week: Number(t.value) }; pkSel.clear(); picker = null; renderAdd(); loadPicker(); return; }
  if (t.id === "pkPreset") { fillBlock("pk", t.value); renderAdd.block = snapBlock("pk"); return; }
  if (t.closest("#pkForm")) { renderAdd.block = snapBlock("pk"); return; }
  const map = { pkConf: "conf", pkDay: "day", pkSort: "sort" };
  if (map[t.id]) pk[map[t.id]] = t.value;
  if (t.id === "pkHideW") pk.hideWatched = t.checked;
  if (t.id === "pkHideS") pk.hideStarted = t.checked;
  if (t.classList.contains("pkVenue")) pk.venues = [...document.querySelectorAll(".pkVenue:checked")].map((x) => x.value);
  if (t.classList.contains("pkPick")) {
    const id = t.closest("[data-pk]").dataset.pk;
    const g = picker.games.find((x) => x.id === id);
    if (t.checked) pkSel.set(id, { pick: autoPick(g), override: "" }); else pkSel.delete(id);
  }
  if (t.id === "pkAll") for (const g of pickerRows().filter((x) => !x.watch && !started(x))) t.checked ? pkSel.has(g.id) || pkSel.set(g.id, { pick: autoPick(g), override: "" }) : pkSel.delete(g.id);
  savePk();
  renderAdd();
});
addPane.addEventListener("click", (e) => {
  const lean = e.target.closest("[data-lean]");
  if (lean) { pkSel.get(lean.closest("[data-pk]").dataset.pk).pick = lean.dataset.lean; renderAdd(); return; }
  const m = e.target.closest("[data-manage]");
  if (m) { mgSel.clear(); mgSel.add(Number(m.dataset.manage)); setView("manage"); return; }
  if (e.target.id === "pkClear") { pkSel.clear(); renderAdd(); }
  if (e.target.id === "wfRun" && !wfBusy) runWorkflow();
});
async function runWorkflow() {
  wfBusy = true;
  wfResult = null;
  renderAdd();
  try {
    wfResult = await api("/api/admin", { action: "weeklyWorkflow", season: picker.season, week: picker.week });
    await load();
    wfBusy = false;
    await loadPicker();
  } catch (err) {
    wfResult = { error: err.message };
  }
  wfBusy = false;
  renderAdd();
}
addPane.addEventListener("submit", async (e) => {
  if (e.target.id !== "pkForm") return;
  e.preventDefault();
  const settings = readBlock("pk");
  const games = [...pkSel.entries()].map(([game_id, s]) => ({ game_id, pick: s.pick, my_home_margin: s.override === "" || s.override == null ? null : Number(s.override) }));
  try {
    pkMsg = "Saving…";
    renderAdd.block = snapBlock("pk");
    renderAdd();
    const r = await api("/api/admin", { action: "addWatches", games, settings: { ...settings, enabled: true } });
    pkMsg = `Added ${r.watch.length} game${r.watch.length === 1 ? "" : "s"}. The bot picks them up on its next run.`;
    pkSel.clear();
    await load();
    await loadPicker();
  } catch (err) {
    pkMsg = err.message;
    renderAdd();
  }
});

// ---------- Manage games

function renderManage() {
  const pane = document.querySelector('[data-pane="manage"]');
  if (!data) { pane.innerHTML = '<p class="muted">Loading…</p>'; return; }
  const now = Date.now();
  const list = data.watchlist.filter((w) => mgShowDone || !w.kickoff || new Date(w.kickoff).getTime() > now);
  for (const id of [...mgSel]) if (!data.watchlist.some((w) => w.id === id)) mgSel.delete(id);
  const n = mgSel.size;
  const trust = (w) => (w.ycpr_weight == null ? "default" : Math.round(w.ycpr_weight * 100) + "%");
  const cents2 = (x) => +(Number(x) * 100).toFixed(1);
  pane.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <label class="chk"><input type="checkbox" id="mgDone" ${mgShowDone ? "checked" : ""}> Show games that have kicked off</label>
      <span class="muted" style="font-size:.78rem">Click a game's name to edit it alone; tick several to change them together.</span>
    </div>
    <div class="panel" style="padding:8px 10px;margin-bottom:12px"><div class="scroll"><table class="pk">
      <tr><th><input type="checkbox" id="mgAll" aria-label="Select all" ${list.length && list.every((w) => mgSel.has(w.id)) ? "checked" : ""}></th><th style="text-align:left">Game</th><th>Kickoff</th><th style="text-align:left">Strategy</th><th>Max loss</th><th title="pro / sell-back / take / extra per contract">Edges ¢</th><th>Per number</th><th>Trust</th><th>Venues</th><th>Stop</th><th>Status</th></tr>
      ${list.map((w) => `<tr data-mg="${w.id}" class="${w.enabled ? "" : "off"}">
        <td><input type="checkbox" class="mgPick" ${mgSel.has(w.id) ? "checked" : ""} aria-label="Select ${esc(w.away_team)} at ${esc(w.home_team)}"></td>
        <td style="text-align:left"><button type="button" class="linkbtn" data-open="${esc(w.game_id)}"><b>${esc(w.away_team)} @ ${esc(w.home_team)}</b></button><small>lean ${esc(w.pick === "home" ? w.home_team : w.away_team)}</small></td>
        <td>${when(w.kickoff)}</td>
        <td style="text-align:left">${esc(presetLabel(w))}${w.shape ? "<small>shaped</small>" : ""}</td>
        <td>${usd(Number(w.max_worst_case_loss))}</td>
        <td>${[w.pro_edge, w.anti_edge, w.take_edge, w.edge_step].map(cents2).join(" / ")}</td>
        <td>${w.per_rung_cap}</td>
        <td>${trust(w)}</td>
        <td>${(w.venues ?? VENUES).map((v) => VSHORT[v]).join(" ")}</td>
        <td>${w.stop_minutes_before}m</td>
        <td><span class="pill ${w.enabled ? "ok" : ""}">${w.enabled ? "Trading" : "Paused"}</span></td>
      </tr>`).join("") || '<tr><td colspan="11" class="muted">No games. Add some from Add games.</td></tr>'}
    </table></div></div>
    <form class="panel pk-bar" id="mgForm">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:8px"><h3 style="margin:0">Change ${n || "the selected"} game${n === 1 ? "" : "s"}</h3><span class="muted" style="font-size:.78rem">Blank fields stay as each game has them.</span></div>
      ${n ? "" : '<p class="muted" style="margin:0">Tick games above to change them.</p>'}
      <div ${n ? "" : "hidden"}>${settingsBlock("mg", true)}
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <label class="chk"><input type="checkbox" id="mgVenuesOn"> Set venues:</label>
        ${VENUES.map((v) => `<label class="chk"><input type="checkbox" class="mgVenue" value="${v}" checked> ${VNAME[v]}</label>`).join("")}
      </div></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" ${n ? "" : "disabled"}>Apply to ${n || ""} game${n === 1 ? "" : "s"}</button>
        <button class="btn" type="button" data-enable="0" ${n ? "" : "disabled"}>Pause</button>
        <button class="btn" type="button" data-enable="1" ${n ? "" : "disabled"}>Resume</button>
        <span class="muted">${esc(mgMsg)}</span>
      </div>
    </form>`;
  const prev = renderManage.block;
  if (prev) { for (const [id, v] of Object.entries(prev)) if ($(id)) $(id).value = v; }
  else fillBlock("mg", "keep");
}
renderManage.block = null;

const mgPane = document.querySelector('[data-pane="manage"]');
mgPane.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "mgPreset") { fillBlock("mg", t.value); renderManage.block = snapBlock("mg"); return; }
  if (t.closest("#mgForm")) { renderManage.block = snapBlock("mg"); return; }
  if (t.id === "mgDone") mgShowDone = t.checked;
  if (t.classList.contains("mgPick")) { const id = Number(t.closest("[data-mg]").dataset.mg); t.checked ? mgSel.add(id) : mgSel.delete(id); }
  if (t.id === "mgAll") for (const r of document.querySelectorAll("[data-mg]")) t.checked ? mgSel.add(Number(r.dataset.mg)) : mgSel.delete(Number(r.dataset.mg));
  renderManage();
});
mgPane.addEventListener("input", (e) => {
  if (e.target.closest("#mgForm") && e.target.tagName === "INPUT" && e.target.type === "number") {
    if ($("mgPreset").value !== "keep" && $("mgPreset").value !== "custom") $("mgPreset").value = "custom";
    renderManage.block = snapBlock("mg");
  }
});
mgPane.addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open]");
  if (o) { openGame = o.dataset.open; drawerTab = "settings"; renderDrawer(); return; }
  const b = e.target.closest("[data-enable]");
  if (!b) return;
  try {
    await api("/api/admin", { action: "updateWatches", ids: [...mgSel], patch: { enabled: b.dataset.enable === "1" } });
    mgMsg = b.dataset.enable === "1" ? "Resumed." : "Paused: their quotes come down on the next run.";
    await load();
  } catch (err) { mgMsg = err.message; }
  renderManage();
});
mgPane.addEventListener("submit", async (e) => {
  if (e.target.id !== "mgForm") return;
  e.preventDefault();
  const patch = readBlock("mg");
  if ($("mgVenuesOn").checked) patch.venues = [...document.querySelectorAll(".mgVenue:checked")].map((x) => x.value);
  try {
    const r = await api("/api/admin", { action: "updateWatches", ids: [...mgSel], patch });
    mgMsg = `Updated ${r.watch.length} game${r.watch.length === 1 ? "" : "s"}. Applies on the next run.`;
    renderManage.block = null;
    await load();
  } catch (err) { mgMsg = err.message; renderManage(); }
});
