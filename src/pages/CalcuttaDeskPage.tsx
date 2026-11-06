import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/calcutta.css";
import { NFL_COMPOSITE_WEEK9_TEXT } from "../data/nflCompositeRatings";
import { restorePasskeySession } from "../lib/adminAuth";
import { buyInLeft, currentLot, highBid, lotName, lotTeams, minNextBid, participantById, remainingMs } from "../lib/calcutta/engine";
import type { Lot } from "../lib/calcutta/types";
import { formatDef, propKind, type Sport } from "../lib/calcutta/formats";
import { useSiteCfb } from "../lib/calcutta/siteCfb";
import { scored } from "../lib/calcutta/scoring";
import { DEFAULT_SIM, fairShares, payoutMatrix, simulateBracket, validateField, type SimOutput, type SimPropKind } from "../lib/calcutta/bracketSim";
import { RATINGS_IMAGE_PROMPT, parseFieldRatings, parseRatings, type ParseResult } from "../lib/calcutta/ratings";
import { fetchCloudAuction, useAuction, writeAuction } from "../lib/calcutta/store";
import type { CalcuttaAuction } from "../lib/calcutta/types";
import { LotLogos, NumField, fmt$, seedLabel } from "../lib/calcutta/ui";
import { TIER_LABEL, lotValues, portfolio, projectPot, roomMarkup, roomTracker, type LotValue } from "../lib/calcutta/value";

// The private Desk (/calcutta/desk/:id): your ratings → playoff sim → fair
// share, projected pot, max bid, room markup and your portfolio. Opened in
// its own window on the monitor you DON'T share. It reads the same live
// auction doc as the Stage, so it re-prices on every bid and sale; nothing
// here is ever written into the auction doc (which is public-readable), it
// stays in this browser's localStorage.

interface DeskState {
  ratingsText: string;
  /** CFB: "site" = this site's latest power ratings (+ per-team home field); "paste" = the box. */
  ratingSource: "site" | "paste";
  /** Pasted ratings are spread-style (−7 = 7 points better). */
  lowerIsBetter: boolean;
  /** Multiply pasted ratings (0.68 turns KenPom/Torvik AdjEM per 100 possessions into points). */
  scale: number;
  hfa: number;
  marginSd: number;
  ratingNoise: number;
  useSourceSd: boolean;
  sims: number;
  edgePct: number;
  potPrior: number | null;
  meId: string | null;
}

import { deskKey, ratingsKey } from "../lib/calcutta/deskStorage";

function loadDesk(id: string, a: CalcuttaAuction): DeskState {
  const def = formatDef(a.format);
  let saved: Partial<DeskState> = {};
  let ratingsText = def.sport === "nfl" ? NFL_COMPOSITE_WEEK9_TEXT : "";
  try {
    saved = JSON.parse(localStorage.getItem(deskKey(id)) ?? "{}");
    ratingsText = localStorage.getItem(ratingsKey(def.sport)) ?? ratingsText;
  } catch {
    // defaults
  }
  return {
    ratingsText: saved.ratingsText ?? ratingsText,
    ratingSource: saved.ratingSource ?? (def.sport === "cfb" ? "site" : "paste"),
    lowerIsBetter: saved.lowerIsBetter ?? false,
    scale: saved.scale ?? 1,
    hfa: saved.hfa ?? def.sim.hfa,
    marginSd: saved.marginSd ?? def.sim.marginSd,
    ratingNoise: saved.ratingNoise ?? def.sim.ratingNoise,
    useSourceSd: saved.useSourceSd ?? DEFAULT_SIM.useSourceSd,
    sims: saved.sims ?? DEFAULT_SIM.sims,
    edgePct: saved.edgePct ?? 10,
    potPrior: saved.potPrior ?? null,
    meId: saved.meId ?? null,
  };
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

export default function CalcuttaDeskPage() {
  const { id } = useParams();
  const [authed] = useState(() => {
    try {
      return sessionStorage.getItem("admin_authed") === "1" || restorePasskeySession();
    } catch {
      return false;
    }
  });
  const auction = useAuction(id);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!id || auction || !authed) return;
    fetchCloudAuction(id)
      .then((doc) => (doc ? writeAuction(doc, { cloud: false }) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [id, auction, authed]);
  useEffect(() => {
    document.title = auction ? `${auction.name} · Desk` : "Calcutta Desk";
  }, [auction?.name]);

  if (!authed) return <div className="cal-desk cal-desk-empty">Sign in to Admin in this browser first, then open the Desk from the Calcutta page.</div>;
  if (!auction) return <div className="cal-desk cal-desk-empty">{missing ? "Auction not found." : "Loading…"}</div>;
  if (!formatDef(auction.format).available || !formatDef(auction.format).rounds.length) return <div className="cal-desk cal-desk-empty">No Desk model for this format yet.</div>;
  return <Desk a={auction} />;
}

function Desk({ a }: { a: CalcuttaAuction }) {
  const def = formatDef(a.format);
  const [st, setSt] = useState<DeskState>(() => loadDesk(a.id, a));
  const [showInputs, setShowInputs] = useState(false);
  const now = useNow(250);
  const set = (p: Partial<DeskState>) =>
    setSt((s) => {
      const next = { ...s, ...p };
      try {
        localStorage.setItem(deskKey(a.id), JSON.stringify(next));
        if (p.ratingsText != null) localStorage.setItem(ratingsKey(def.sport), p.ratingsText);
      } catch {
        // storage full / disabled
      }
      return next;
    });

  const fieldKey = JSON.stringify(a.field.map((t) => [t.id, t.group, t.seed]));
  const pasted: ParseResult = useMemo(
    () => (def.sport === "nfl" ? parseRatings(st.ratingsText) : parseFieldRatings(st.ratingsText, a.field, { lowerIsBetter: st.lowerIsBetter, scale: st.scale })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st.ratingsText, st.lowerIsBetter, st.scale, fieldKey, def.sport],
  );
  // CFB: the site's own power ratings (spread-style, lower = better, flipped) + its Team HFA blend.
  const siteCfb = useSiteCfb(a.field, def.sport === "cfb");
  const site = def.sport === "cfb" && st.ratingSource === "site" ? siteCfb : null;
  const parsed: ParseResult = site ? { ratings: Object.fromEntries(Object.entries({ ...pasted.ratings, ...site.ratings }).map(([k, v]) => [k, { abbr: k, line: 0, ...v }])) as any, unmatched: [], duplicates: [] } : pasted;
  const fieldErr = validateField(a.format, a.field, a.regions);
  const effResults = scored(a).results;
  const resultsKey = JSON.stringify(effResults);
  const ratingsKeyStr = JSON.stringify(parsed.ratings) + JSON.stringify(site?.hfaByTeam ?? {});

  const sim: SimOutput | null = useMemo(() => {
    if (fieldErr) return null;
    return simulateBracket({
      format: a.format,
      field: a.field,
      regions: a.regions,
      ratings: parsed.ratings,
      hfa: st.hfa,
      hfaByTeam: site?.hfaByTeam,
      marginSd: st.marginSd,
      ratingNoise: st.ratingNoise,
      useSourceSd: st.useSourceSd,
      sims: st.sims,
      results: effResults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, resultsKey, ratingsKeyStr, st.hfa, st.marginSd, st.ratingNoise, st.useSourceSd, st.sims, fieldErr, a.regions?.join("|")]);

  const payoutKey = JSON.stringify(a.payouts) + fieldKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matrix = useMemo(() => (sim ? payoutMatrix(sim, a) : null), [sim, payoutKey]);
  const shares = useMemo(() => (sim && matrix ? fairShares(sim, matrix) : {}), [sim, matrix]);
  // The recap judges prices at auction time: a second run that ignores any results already in.
  const hasResults = Object.keys(effResults).length > 0;
  const preShares = useMemo(() => {
    if (!hasResults || fieldErr) return null;
    const pre = simulateBracket({
      format: a.format,
      field: a.field,
      regions: a.regions,
      ratings: parsed.ratings,
      hfa: st.hfa,
      hfaByTeam: site?.hfaByTeam,
      marginSd: st.marginSd,
      ratingNoise: st.ratingNoise,
      useSourceSd: st.useSourceSd,
      sims: Math.min(st.sims, 20000),
    });
    return fairShares(pre, payoutMatrix(pre, a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults, fieldKey, ratingsKeyStr, st.hfa, st.marginSd, st.ratingNoise, st.useSourceSd, st.sims, payoutKey]);

  if (fieldErr || !sim || !matrix) return <div className="cal-desk cal-desk-empty">Finish the playoff field on the Calcutta page first ({fieldErr}).</div>;

  const rake = (a.settings.rakePct || 0) / 100;
  const prior = st.potPrior ?? Math.max(100, a.participants.length * 150);
  const pot = projectPot(a, shares, prior);
  const netPot = pot.projected * (1 - rake);
  const values = lotValues(a, shares, netPot, st.edgePct);
  const valueById = new Map(values.map((v) => [v.lot.id, v]));
  const mk = roomMarkup(a, shares, netPot);
  const me = participantById(a, st.meId);
  const lot = currentLot(a);
  const live = lot ? valueById.get(lot.id) ?? null : null;
  const high = highBid(a, lot?.id);
  const ratingsLabel = site
    ? `YCPR power ratings (${siteCfb.week ?? "loading"})`
    : def.sport === "nfl"
      ? st.ratingsText.split(/\r?\n/).find((l) => l.trim() && !/^\d/.test(l.trim()))?.trim() || "Pasted ratings"
      : "Pasted ratings";
  const missingRatings = a.field.filter((t) => !parsed.ratings[t.id]);
  const openRatings = () => {
    setShowInputs(true);
    setTimeout(() => document.getElementById("cal-desk-inputs")?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const fmtRating = (id: string) => {
    const r = parsed.ratings[id]?.rating;
    return r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
  };
  const myPort = me ? portfolio(a, sim, matrix, me.id, netPot) : null;
  const customProps = a.payouts.props.filter((p) => propKind(p) === "custom" && p.pct > 0);
  const tracker = roomTracker(a, values);
  const remaining = values.filter((v) => v.lot.status === "pending" || v.lot.status === "live");
  const targets = [...remaining].sort((x, y) => y.fair / Math.max(1, y.expected) - x.fair / Math.max(1, x.expected) || y.fair - x.fair).slice(0, 5);

  return (
    <div className="cal-desk">
      <header className="cal-desk-top">
        <div>
          <div className="cal-stage-eyebrow">Desk · private — don't share this window</div>
          <div className="cal-desk-title">{a.name}</div>
        </div>
        <div className="cal-desk-kpis">
          <button className="cal-kpi cal-kpi-btn" onClick={openRatings} title="Edit ratings & model settings">
            <div className="cal-stage-eyebrow">Ratings ✎</div>
            <div className="cal-kpi-v">{Object.keys(parsed.ratings).filter((id) => a.field.some((t) => t.id === id)).length}/{a.field.length}</div>
            <div className="cal-kpi-sub">{ratingsLabel}</div>
          </button>
          <Kpi label="Sold" value={fmt$(pot.sold)} sub={`${pct(pot.soldShare, 0)} of value`} />
          <Kpi label="Projected pot" value={fmt$(pot.projected)} sub={pot.roomPace ? `room pace ${fmt$(pot.roomPace)}` : `prior ${fmt$(prior)}`} big />
          <Kpi label="Room vs fair" value={pot.soldShare > 0 ? `${Math.round(mk.overall * 100)}%` : "—"} sub={(["fav", "mid", "long"] as const).map((t) => `${TIER_LABEL[t].split(" ")[0]} ${mk.byTier[t].n ? Math.round(mk.byTier[t].markup * 100) + "%" : "—"}`).join(" · ")} />
          <div className="cal-kpi">
            <div className="cal-stage-eyebrow">Me</div>
            <select className="cal-dinput" value={st.meId ?? ""} onChange={(e) => set({ meId: e.target.value || null })}>
              <option value="">Pick yourself…</option>
              {a.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {myPort && (
              <div className="cal-kpi-sub">
                spent {fmt$(myPort.cost)} · EV {fmt$(myPort.ev)}
              </div>
            )}
          </div>
        </div>
      </header>

      {missingRatings.length > 0 && (
        <button className="cal-desk-banner" onClick={openRatings}>
          ⚠ No rating for {missingRatings.length} team{missingRatings.length === 1 ? "" : "s"} ({missingRatings.slice(0, 6).map((t) => t.name).join(", ")}
          {missingRatings.length > 6 ? "…" : ""}) — they're treated as an average team. Click to add ratings.
        </button>
      )}
      <div className="cal-desk-grid">
        <LiveCard a={a} live={live} high={high} meId={st.meId} now={now} sim={sim} matrix={matrix} netPot={netPot} edgePct={st.edgePct} fmtRating={fmtRating} />
        <PortfolioCard a={a} port={myPort} me={me?.name ?? null} />
      </div>

      <div className="cal-desk-grid">
        <section className="cal-dcard">
          <div className="cal-dcard-head">
            <h3>Best value left</h3>
            <span className="dim">fair ÷ expected price</span>
          </div>
          {targets.map((v) => (
            <div key={v.lot.id} className="cal-side-row">
              <LotLogos auction={a} lot={v.lot} size={22} />
              <span className="grow">{lotName(a, v.lot)}</span>
              <span className="dim">exp {fmt$(v.expected)}</span>
              <span className="money">max {fmt$(v.max)}</span>
              <span className={`cal-ratio ${v.fair >= v.expected ? "good" : "bad"}`}>{(v.fair / Math.max(1, v.expected)).toFixed(2)}×</span>
            </div>
          ))}
          {targets.length === 0 && <div className="dim">Nothing left.</div>}
          <div className="cal-desk-note">Until a few lots sell, expected price = fair price, so this ranks by fair value. It sharpens as the room shows which tiers it overpays.</div>
        </section>
        <section className="cal-dcard">
          <div className="cal-dcard-head">
            <h3>Room</h3>
            <span className="dim">paid ÷ fair</span>
          </div>
          {tracker
            .sort((x, y) => y.spent - x.spent)
            .map((r) => (
              <div key={r.p.id} className="cal-side-row">
                <span style={{ color: r.p.color, fontWeight: 800 }} className="grow">
                  {r.p.name}
                  {r.leading ? " ●" : ""}
                </span>
                <span className="dim">
                  {r.teams} {r.teams === 1 ? "team" : "teams"}
                </span>
                <span className="money">{fmt$(r.spent)}</span>
                <span className={`cal-ratio ${r.ratio == null ? "" : r.ratio > 1.1 ? "bad" : r.ratio < 0.9 ? "good" : ""}`}>{r.ratio == null ? "—" : `${Math.round(r.ratio * 100)}%`}</span>
              </div>
            ))}
        </section>
      </div>

      <ValueTable a={a} values={values} sim={sim} fmtRating={fmtRating} />

      {a.lots.some((l) => l.status === "sold") && (
        <RecapCard a={a} values={preShares ? lotValues(a, preShares, netPot, st.edgePct) : values} meId={st.meId} preTournament={!!preShares} />
      )}

      <section className="cal-dcard" id="cal-desk-inputs">
        <div className="cal-dcard-head">
          <h3>Model inputs</h3>
          <button className="cal-cbtn" onClick={() => setShowInputs((x) => !x)}>
            {showInputs ? "Hide" : "Edit ratings & settings"}
          </button>
        </div>
        <div className="cal-desk-settings">
          <label>
            Expected pot <NumField value={prior} onCommit={(v) => set({ potPrior: Math.max(0, v) })} suffix="$" width={90} />
          </label>
          <label>
            Required edge <NumField value={st.edgePct} onCommit={(v) => set({ edgePct: Math.max(0, Math.min(90, v)) })} suffix="%" width={60} />
          </label>
          <span className="dim">
            {Object.keys(parsed.ratings).length} ratings · {sim.sims.toLocaleString()} sims in {Math.round(sim.ms)}ms · HFA {st.hfa} · rating noise {st.ratingNoise}
            {st.useSourceSd ? " + source SD" : ""}
          </span>
        </div>
        {(sim.warnings.length > 0 || !!site?.error || customProps.length > 0 || parsed.unmatched.length > 0 || parsed.duplicates.length > 0) && (
          <div className="cal-desk-warn">
            {site?.error && <div>⚠ Couldn't load the YCPR power ratings ({site.error}) — switch to pasted ratings or try again.</div>}
            {sim.warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
            {customProps.map((p) => (
              <div key={p.id}>⚠ "{p.label}" isn't modeled — priced as an even split across all 14 teams.</div>
            ))}
            {parsed.unmatched.length > 5 ? (
              <div className="dim">{parsed.unmatched.length} pasted lines didn't match a team in the field — fine if you pasted a full ratings list.</div>
            ) : (
              parsed.unmatched.map((u) => (
                <div key={u.line}>
                  ⚠ Line {u.line} not read: {u.text}
                </div>
              ))
            )}
            {parsed.duplicates.length > 0 && <div>⚠ Listed twice (last one used): {parsed.duplicates.join(", ")}</div>}
          </div>
        )}
        {showInputs && (
          <div className="cal-desk-inputs">
            <div>
              {def.sport === "cfb" && (
                <div className="cal-row tight">
                  <label className="cal-toggle">
                    <input type="radio" checked={st.ratingSource === "site"} onChange={() => set({ ratingSource: "site" })} /> YCPR power ratings ({siteCfb.week ?? (siteCfb.loading ? "loading" : "none found")}) + the site's Team HFA
                  </label>
                  <label className="cal-toggle">
                    <input type="radio" checked={st.ratingSource === "paste"} onChange={() => set({ ratingSource: "paste" })} /> Pasted ratings
                  </label>
                </div>
              )}
              {(def.sport !== "cfb" || st.ratingSource === "paste") && (
                <>
                  <textarea className="cal-dtext" value={st.ratingsText} onChange={(e) => set({ ratingsText: e.target.value })} spellCheck={false} placeholder={def.sport === "cbb" ? "Duke 38.2\nAuburn 35.9\n…" : "Team rating"} />
                  {def.sport === "nfl" ? (
                    <>
                      <div className="cal-row tight">
                        <button className="cal-cbtn" onClick={() => navigator.clipboard?.writeText(RATINGS_IMAGE_PROMPT)}>
                          Copy screenshot prompt for Claude
                        </button>
                        <button className="cal-cbtn" onClick={() => set({ ratingsText: NFL_COMPOSITE_WEEK9_TEXT })}>
                          Reset to Week 9 composite
                        </button>
                      </div>
                      <div className="cal-desk-note">
                        Paste one team per line — "1 Los Angeles Rams 5.5 1.1", "LAR 5.5" or a full row of the composite table all work. The first number after the team is the rating (points vs an
                        average team); the second is the sources' std dev. To read a screenshot, paste it into any Claude chat with the copied prompt and paste the reply here.
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cal-row tight">
                        <label className="cal-toggle">
                          <input type="checkbox" checked={st.lowerIsBetter} onChange={(e) => set({ lowerIsBetter: e.target.checked })} /> Lower is better (spread-style, −7 = 7 pts better)
                        </label>
                        {def.sport === "cbb" && (
                          <label className="cal-toggle">
                            <input type="checkbox" checked={Math.abs(st.scale - 0.68) < 1e-9} onChange={(e) => set({ scale: e.target.checked ? 0.68 : 1 })} /> Per 100 possessions (KenPom / Torvik AdjEM → × 0.68)
                          </label>
                        )}
                      </div>
                      <div className="cal-desk-note">
                        One team per line with its name as in the field ("Iowa St." = "Iowa State"); the first number after the name is the rating. Ranks before the name and extra columns after are
                        fine. For a screenshot, ask any Claude chat to "list each team and its rating, one per line" and paste the reply.
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="cal-desk-form">
              <label>{def.sport === "cfb" && st.ratingSource === "site" ? "Home field if a team has none (pts)" : "Home field (pts)"}</label>
              <NumField value={st.hfa} step={0.25} onCommit={(v) => set({ hfa: v })} width={70} />
              <label>Game margin SD (pts)</label>
              <NumField value={st.marginSd} step={0.5} onCommit={(v) => set({ marginSd: Math.max(1, v) })} width={70} />
              <label>Rating noise per sim (pts)</label>
              <NumField value={st.ratingNoise} step={0.25} onCommit={(v) => set({ ratingNoise: Math.max(0, v) })} width={70} />
              <label>Add sources' std dev</label>
              <input type="checkbox" checked={st.useSourceSd} onChange={(e) => set({ useSourceSd: e.target.checked })} />
              <label>Sims</label>
              <select className="cal-dinput" value={st.sims} onChange={(e) => set({ sims: Number(e.target.value) })}>
                {[5000, 20000, 50000, 100000].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </select>
              <div className="cal-desk-note" style={{ gridColumn: "1 / -1" }}>
                {def.sport === "cbb" ? "Every game neutral." : def.sport === "cfb" ? (a.format === "cfb_playoff12" ? "First round on campus, then neutral bowls." : "Higher seed hosts until a neutral title game.") : "Super Bowl neutral."} Results entered on the Owners &amp; Results tab (or auto-scored games) are locked in.
              </div>
              <RatingsCheck a={a} ratings={parsed.ratings} hfa={site?.hfaByTeam} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="cal-kpi">
      <div className="cal-stage-eyebrow">{label}</div>
      <div className={`cal-kpi-v ${big ? "big" : ""}`}>{value}</div>
      {sub && <div className="cal-kpi-sub">{sub}</div>}
    </div>
  );
}

function LiveCard({
  a,
  live,
  high,
  meId,
  now,
  sim,
  matrix,
  netPot,
  edgePct,
  fmtRating,
}: {
  fmtRating: (id: string) => string;
  a: CalcuttaAuction;
  live: LotValue | null;
  high: ReturnType<typeof highBid>;
  meId: string | null;
  now: number;
  sim: SimOutput;
  matrix: Float32Array;
  netPot: number;
  edgePct: number;
}) {
  if (!live || a.live.phase === "idle") {
    return (
      <section className="cal-dcard cal-live">
        <div className="dim">No lot on the block. The Desk follows the Stage automatically.</div>
      </section>
    );
  }
  const lot = live.lot;
  const bid = high?.amount ?? null;
  const bidder = participantById(a, high?.participantId);
  const mine = !!meId && high?.participantId === meId;
  const secs = Math.ceil(remainingMs(a.live, now) / 1000);
  const sold = a.live.phase === "sold";
  // Unused minimum buy-in is owed either way, so the first `left` dollars of a bid cost nothing extra.
  const left = meId ? buyInLeft(a, meId) : 0;
  const myMax = live.max + left;
  const myFair = live.fair + left;
  const freeNote = left > 0 ? ` (incl. ${fmt$(left)} unused buy-in)` : "";
  let signal: { cls: string; text: string };
  if (sold) signal = { cls: mine ? "good" : "", text: mine ? `Bought at ${fmt$(bid)}` : `Sold ${fmt$(bid)} — ${pct((bid ?? 0) / Math.max(1, live.fair), 0)} of fair` };
  else if (mine) signal = { cls: "good", text: "You're the high bidder" };
  else if (bid == null || bid < myMax) signal = { cls: "good", text: `BID — up to ${fmt$(myMax)}${freeNote}` };
  else if (bid < myFair) signal = { cls: "warn", text: `Thin — ${fmt$(myFair - bid)} under fair, below your ${edgePct}% edge` };
  else signal = { cls: "bad", text: `PASS — ${fmt$(bid - myFair)} over fair${freeNote}` };

  const teams = lotTeams(a, lot);
  const rounds = formatDef(a.format).rounds;
  const anyPlayIn = teams.some((t) => sim.playInWin[t.id] != null);
  const KIND_LABEL: Record<SimPropKind, string> = { biggest_upset: "Upset", worst_loss: "Worst L", cinderella: "Cind.", best_ats: "ATS", lowest_f4_seed: "Low F4" };
  const kinds = [...new Set(a.payouts.props.filter((p) => p.pct > 0).map(propKind))]
    .filter((k): k is SimPropKind => k !== "custom")
    .map((k) => ({ k, label: KIND_LABEL[k] }));
  const atBid = bid != null && !sold ? live.fair - Math.max(0, bid - left) : null;

  return (
    <section className={`cal-dcard cal-live ${signal.cls}`}>
      <div className="cal-live-head">
        <LotLogos auction={a} lot={lot} size={54} />
        <div className="grow">
          <div className="cal-stage-eyebrow">
            On the block · {teams.map(seedLabel).join(" · ")} · {TIER_LABEL[live.tier]} · rating {teams.map((t) => fmtRating(t.id)).join(" / ")}
          </div>
          <div className="cal-live-name">{lotName(a, lot)}</div>
        </div>
        <div className="cal-live-clock">{sold ? "SOLD" : a.live.phase === "running" ? `${secs}s` : a.live.phase}</div>
      </div>
      <div className="cal-live-nums">
        <Kpi label="Current bid" value={bid == null ? "—" : fmt$(bid)} sub={bidder?.name ?? "no bids"} />
        <Kpi label="Fair" value={fmt$(live.fair)} sub={`${live.share.toFixed(2)}% of pot`} />
        <Kpi label={`Max (−${edgePct}%)`} value={fmt$(live.max)} />
        <Kpi label="Room expects" value={fmt$(live.expected)} />
        <Kpi label="Edge at bid" value={atBid == null ? "—" : fmt$(atBid)} sub={atBid == null || !bid ? "" : `${pct(atBid / Math.max(1, bid - left), 0)} ROI${left > 0 ? " on new money" : ""}`} />
      </div>
      <div className={`cal-signal ${signal.cls}`}>{signal.text}</div>
      {meId && !sold && <WhatIf a={a} lot={lot} fair={live.fair} defaultPrice={mine ? bid ?? 0 : minNextBid(a)} meId={meId} sim={sim} matrix={matrix} netPot={netPot} />}
      <table className="cal-dtable">
        <thead>
          <tr>
            <th>Team</th>
            {anyPlayIn && <th className="r">FF</th>}
            {rounds.map((r) => (
              <th key={r.key} className="r">
                {r.short}
              </th>
            ))}
            {kinds.map((k) => (
              <th key={k.k} className="r">
                {k.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const r = sim.reach[t.id];
            return (
              <tr key={t.id}>
                <td>{t.name}</td>
                {anyPlayIn && <td className="r">{sim.playInWin[t.id] != null ? pct(sim.playInWin[t.id]) : ""}</td>}
                {rounds.map((rd, i) => (
                  <td key={rd.key} className="r">
                    {i === 0 && t.bye ? "bye" : pct(r[i])}
                  </td>
                ))}
                {kinds.map((k) => (
                  <td key={k.k} className="r">
                    {pct(sim.propProb[k.k][t.id])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PortfolioCard({ a, port, me }: { a: CalcuttaAuction; port: ReturnType<typeof portfolio> | null; me: string | null }) {
  return (
    <section className="cal-dcard">
      <div className="cal-dcard-head">
        <h3>My portfolio{me ? ` · ${me}` : ""}</h3>
      </div>
      {!port ? (
        <div className="dim">Pick yourself under "Me" at the top.</div>
      ) : port.pieces.length === 0 ? (
        <div className="dim">No teams yet.</div>
      ) : (
        <>
          <div className="cal-live-nums">
            <Kpi label="Cost" value={fmt$(port.cost)} />
            <Kpi label="EV" value={fmt$(port.ev)} sub={port.cost ? pct(port.ev / port.cost - 1, 0) + " ROI" : ""} />
            <Kpi label="P(profit)" value={pct(port.pProfit, 0)} />
            <Kpi label="10th / 50th / 90th" value={`${fmt$(port.p10)} / ${fmt$(port.p50)} / ${fmt$(port.p90)}`} />
          </div>
          {port.pieces.map((p) => (
            <div key={p.lot.id} className="cal-side-row">
              <LotLogos auction={a} lot={p.lot} size={22} />
              <span className="grow">
                {lotName(a, p.lot)}
                {p.pct < 100 ? ` (${Math.round(p.pct)}%)` : ""}
              </span>
              <span className="dim">paid {fmt$(p.cost)}</span>
              <span className="money">EV {fmt$(p.ev)}</span>
              <span className={`cal-ratio ${p.ev >= p.cost ? "good" : "bad"}`}>{p.cost ? `${Math.round((p.ev / p.cost) * 100)}%` : ""}</span>
            </div>
          ))}
          <div className="cal-desk-note">EV and the 10th/50th/90th-percentile payouts use the projected pot and the full sim, so teams that knock each other out are handled.</div>
        </>
      )}
    </section>
  );
}

function ValueTable({ a, values, sim, fmtRating }: { a: CalcuttaAuction; values: LotValue[]; sim: SimOutput; fmtRating: (id: string) => string }) {
  const curId = a.live.lotId;
  return (
    <section className="cal-dcard">
      <div className="cal-dcard-head">
        <h3>Value board</h3>
        <span className="dim">fair = share × projected pot after rake</span>
      </div>
      <table className="cal-dtable">
        <thead>
          <tr>
            <th>#</th>
            <th>Lot</th>
            <th>Seed</th>
            <th className="r">Rating</th>
            <th className="r">{formatDef(a.format).rounds.slice(-1)[0]?.short ?? "Title"}</th>
            <th className="r">Share</th>
            <th className="r">Fair</th>
            <th className="r">Max</th>
            <th className="r">Expected</th>
            <th>Status</th>
            <th className="r">Paid</th>
            <th className="r">Paid/fair</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => {
            const teams = lotTeams(a, v.lot);
            const sb = teams.reduce((s, t) => s + (sim.reach[t.id]?.[sim.rounds - 1] ?? 0), 0);
            const owner = participantById(a, v.lot.winnerId);
            return (
              <tr key={v.lot.id} className={`${v.lot.id === curId ? "cur" : ""} ${v.lot.status === "sold" ? "done" : ""}`}>
                <td>{v.lot.order}</td>
                <td>
                  <span className="cal-row tight">
                    <LotLogos auction={a} lot={v.lot} size={18} /> {lotName(a, v.lot)}
                  </span>
                </td>
                <td className="dim">{teams.map(seedLabel).join(", ")}</td>
                <td className="r">{teams.map((t) => fmtRating(t.id)).join(" / ")}</td>
                <td className="r">{pct(sb)}</td>
                <td className="r">{v.share.toFixed(2)}%</td>
                <td className="r money">{fmt$(v.fair)}</td>
                <td className="r">{fmt$(v.max)}</td>
                <td className="r dim">{v.lot.status === "sold" ? "" : fmt$(v.expected)}</td>
                <td>{v.lot.status === "sold" ? <span style={{ color: owner?.color, fontWeight: 700 }}>{owner?.name}</span> : <span className="dim">{v.lot.status}</span>}</td>
                <td className="r">{v.lot.status === "sold" ? fmt$(v.lot.price) : ""}</td>
                <td className={`r ${v.paidRatio == null ? "" : v.paidRatio > 1 ? "bad" : "good"}`}>{v.paidRatio == null ? "" : `${Math.round(v.paidRatio * 100)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RatingsCheck({ a, ratings, hfa }: { a: CalcuttaAuction; ratings: Record<string, { rating: number; sd: number | null }>; hfa?: Record<string, number> }) {
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div className="cal-stage-eyebrow" style={{ marginTop: 8 }}>
        Field ratings
      </div>
      <div className="cal-desk-chips">
        {[...a.field]
          .sort((x, y) => x.group.localeCompare(y.group) || (x.seed ?? 0) - (y.seed ?? 0))
          .map((t) => {
            const r = ratings[t.id];
            return (
              <span key={t.id} className={`cal-desk-chip ${r ? "" : "bad"}`}>
                {seedLabel(t)} {t.abbr} {r ? (r.rating > 0 ? "+" : "") + r.rating.toFixed(1) : "missing"}
                {r?.sd != null ? ` ±${r.sd}` : ""}
                {hfa?.[t.id] != null ? ` · HFA ${hfa[t.id].toFixed(1)}` : ""}
              </span>
            );
          })}
      </div>
    </div>
  );
}

/**
 * "If I win this": your portfolio now vs with the lot on the block at a
 * price (defaults to the next bid you'd have to make). Uses the same sims,
 * so overlap with teams you already own — e.g. two AFC teams that can only
 * have one Super Bowl run between them — shows up in EV and the spread.
 */
function WhatIf({
  a,
  lot,
  fair,
  defaultPrice,
  meId,
  sim,
  matrix,
  netPot,
}: {
  a: CalcuttaAuction;
  lot: Lot;
  fair: number;
  defaultPrice: number;
  meId: string;
  sim: SimOutput;
  matrix: Float32Array;
  netPot: number;
}) {
  const [typed, setTyped] = useState<string>("");
  useEffect(() => setTyped(""), [lot.id]);
  const price = typed.trim() !== "" && Number.isFinite(Number(typed)) ? Number(typed) : defaultPrice;
  const docKey = a.updatedAt;
  const before = useMemo(() => portfolio(a, sim, matrix, meId, netPot), [docKey, sim, matrix, meId, netPot]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => portfolio(a, sim, matrix, meId, netPot, { lot, price }), [docKey, sim, matrix, meId, netPot, lot.id, price]); // eslint-disable-line react-hooks/exhaustive-deps

  const lotConfs = new Set(lotTeams(a, lot).map((t) => t.group).filter(Boolean));
  const overlap = before.pieces.filter((p) => lotTeams(a, p.lot).some((t) => t.group && lotConfs.has(t.group)));
  const groupWord = a.format === "march_madness" ? "region" : "conference";
  const finalWord = a.format === "march_madness" ? "Final Four" : "Super Bowl";
  const delta = (x: number, y: number, f: (v: number) => string, neutral = false) => {
    const d = y - x;
    return (
      <span className={neutral ? "" : d > 0 ? "good" : d < 0 ? "bad" : "dim"}>
        {f(x)} → {f(y)}
      </span>
    );
  };
  const p0 = (v: number) => `${Math.round(v * 100)}%`;
  const evGain = fair - price;

  return (
    <div className="cal-whatif">
      <div className="cal-whatif-head">
        <span className="cal-stage-eyebrow">If I win it at</span>
        <span className="cal-num">
          <span className="cal-suffix">$</span>
          <input type="number" value={typed} placeholder={String(defaultPrice)} onChange={(e) => setTyped(e.target.value)} style={{ width: 90 }} />
        </span>
        <span className={evGain >= 0 ? "good" : "bad"}>
          <b>{evGain >= 0 ? "+" : ""}
          {fmt$(evGain)}</b> EV
        </span>
      </div>
      <div className="cal-whatif-grid">
        <span className="dim">Cost</span>
        {delta(before.cost, after.cost, (v) => fmt$(v), true)}
        <span className="dim">EV</span>
        {delta(before.ev, after.ev, (v) => fmt$(v))}
        <span className="dim">P(profit)</span>
        {delta(before.pProfit, after.pProfit, p0)}
        <span className="dim">10th pct</span>
        {delta(before.p10, after.p10, (v) => fmt$(v))}
        <span className="dim">90th pct</span>
        {delta(before.p90, after.p90, (v) => fmt$(v))}
      </div>
      {overlap.length > 0 && (
        <div className="cal-desk-note warn">
          Same {groupWord} as your {overlap.map((p) => lotName(a, p.lot)).join(", ")} — they can't both make the {finalWord}, so this adds less upside than its EV alone suggests.
        </div>
      )}
    </div>
  );
}

/**
 * After the fact: every sold team against YOUR fair value — who got steals,
 * who overpaid, who they beat, and your own top bid on it.
 */
function RecapCard({ a, values, meId, preTournament }: { a: CalcuttaAuction; values: LotValue[]; meId: string | null; preTournament: boolean }) {
  const [sort, setSort] = useState<"value" | "order">("value");
  const sold = values.filter((v) => v.lot.status === "sold");
  const rows = sold.map((v) => {
    const bids = a.bids.filter((b) => b.lotId === v.lot.id && !b.voided);
    const runner = [...bids].reverse().find((b) => b.participantId !== v.lot.winnerId);
    const mine = meId ? Math.max(0, ...bids.filter((b) => b.participantId === meId).map((b) => b.amount)) : 0;
    return { v, price: v.lot.price ?? 0, diff: v.fair - (v.lot.price ?? 0), runner, mine, bids: bids.length };
  });
  rows.sort((x, y) => (sort === "value" ? y.diff - x.diff : x.v.lot.order - y.v.lot.order));
  const paid = rows.reduce((s, r) => s + r.price, 0);
  const fair = rows.reduce((s, r) => s + r.v.fair, 0);
  const csv = () => {
    const lines = [["Lot", "Team", "Winner", "Price", "My fair", "Fair - price", "Paid/fair", "Runner-up", "Runner-up bid", "My top bid", "Bids"]];
    for (const r of rows)
      lines.push([
        String(r.v.lot.order),
        lotName(a, r.v.lot),
        participantById(a, r.v.lot.winnerId)?.name ?? "",
        String(r.price),
        r.v.fair.toFixed(2),
        r.diff.toFixed(2),
        r.v.paidRatio != null ? r.v.paidRatio.toFixed(2) : "",
        participantById(a, r.runner?.participantId)?.name ?? "",
        r.runner ? String(r.runner.amount) : "",
        r.mine ? String(r.mine) : "",
        String(r.bids),
      ]);
    const blob = new Blob([lines.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${a.name}-recap.csv`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="cal-dcard">
      <div className="cal-dcard-head">
        <h3>Recap vs your fair{preTournament ? " (before any games)" : ""}</h3>
        <span className="cal-row tight">
          <span className="dim">
            {sold.length} sold · room paid {fmt$(paid)} for {fmt$(fair)} of your fair value ({fair ? `${Math.round((paid / fair) * 100)}%` : "—"})
          </span>
          <select className="cal-dinput" value={sort} onChange={(e) => setSort(e.target.value as "value" | "order")}>
            <option value="value">Best buys first</option>
            <option value="order">Auction order</option>
          </select>
          <button className="cal-cbtn" onClick={csv}>
            CSV
          </button>
        </span>
      </div>
      <table className="cal-dtable">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Winner</th>
            <th className="r">Price</th>
            <th className="r">My fair</th>
            <th className="r">Fair − price</th>
            <th className="r">Paid/fair</th>
            <th>Beat</th>
            <th className="r">My top bid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = participantById(a, r.v.lot.winnerId);
            const ru = participantById(a, r.runner?.participantId);
            return (
              <tr key={r.v.lot.id}>
                <td>{r.v.lot.order}</td>
                <td>
                  <span className="cal-row tight">
                    <LotLogos auction={a} lot={r.v.lot} size={18} /> {lotName(a, r.v.lot)}
                  </span>
                </td>
                <td style={{ color: w?.color, fontWeight: 700 }}>{w?.id === meId ? `⭐ ${w?.name}` : w?.name}</td>
                <td className="r">{fmt$(r.price)}</td>
                <td className="r money">{fmt$(r.v.fair)}</td>
                <td className={`r ${r.diff >= 0 ? "good" : "bad"}`}>
                  {r.diff >= 0 ? "+" : ""}
                  {fmt$(r.diff)}
                </td>
                <td className={`r ${r.v.paidRatio == null ? "" : r.v.paidRatio > 1 ? "bad" : "good"}`}>{r.v.paidRatio == null ? "" : `${Math.round(r.v.paidRatio * 100)}%`}</td>
                <td className="dim">{ru ? `${ru.name} ${fmt$(r.runner!.amount)}` : "no other bids"}</td>
                <td className="r">{r.mine ? fmt$(r.mine) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
