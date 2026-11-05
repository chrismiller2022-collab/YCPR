import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/calcutta.css";
import { NFL_COMPOSITE_WEEK9_TEXT } from "../data/nflCompositeRatings";
import { restorePasskeySession } from "../lib/adminAuth";
import { currentLot, highBid, lotName, lotTeams, minNextBid, participantById, remainingMs } from "../lib/calcutta/engine";
import type { Lot } from "../lib/calcutta/types";
import { propKind } from "../lib/calcutta/formats";
import { scored } from "../lib/calcutta/scoring";
import { DEFAULT_SIM, fairShares, payoutMatrix, simulateNflPlayoffs, validateNflField, type SimOutput, type SimPropKind } from "../lib/calcutta/nflPlayoffSim";
import { RATINGS_IMAGE_PROMPT, parseRatings } from "../lib/calcutta/ratings";
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
  hfa: number;
  ratingNoise: number;
  useSourceSd: boolean;
  sims: number;
  edgePct: number;
  potPrior: number | null;
  meId: string | null;
}

const RATINGS_KEY = "calcutta:nfl-ratings-text";
const deskKey = (id: string) => `calcutta:desk:${id}`;

function loadDesk(id: string): DeskState {
  let saved: Partial<DeskState> = {};
  let ratingsText = NFL_COMPOSITE_WEEK9_TEXT;
  try {
    saved = JSON.parse(localStorage.getItem(deskKey(id)) ?? "{}");
    ratingsText = localStorage.getItem(RATINGS_KEY) ?? ratingsText;
  } catch {
    // defaults
  }
  return {
    ratingsText: saved.ratingsText ?? ratingsText,
    hfa: saved.hfa ?? DEFAULT_SIM.hfa,
    ratingNoise: saved.ratingNoise ?? DEFAULT_SIM.ratingNoise,
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
  if (auction.format !== "nfl_playoffs") return <div className="cal-desk cal-desk-empty">The Desk model is NFL Playoffs only for now.</div>;
  return <Desk a={auction} />;
}

function Desk({ a }: { a: CalcuttaAuction }) {
  const [st, setSt] = useState<DeskState>(() => loadDesk(a.id));
  const [showInputs, setShowInputs] = useState(false);
  const now = useNow(250);
  const set = (p: Partial<DeskState>) =>
    setSt((s) => {
      const next = { ...s, ...p };
      try {
        localStorage.setItem(deskKey(a.id), JSON.stringify(next));
        if (p.ratingsText != null) localStorage.setItem(RATINGS_KEY, p.ratingsText);
      } catch {
        // storage full / disabled
      }
      return next;
    });

  const parsed = useMemo(() => parseRatings(st.ratingsText), [st.ratingsText]);
  const fieldErr = validateNflField(a.field);
  const fieldKey = JSON.stringify(a.field.map((t) => [t.id, t.group, t.seed]));
  const effResults = scored(a).results;
  const resultsKey = JSON.stringify(effResults);
  const ratingsKey = JSON.stringify(parsed.ratings);

  const sim: SimOutput | null = useMemo(() => {
    if (fieldErr) return null;
    return simulateNflPlayoffs({
      field: a.field,
      ratings: parsed.ratings,
      hfa: st.hfa,
      marginSd: DEFAULT_SIM.marginSd,
      ratingNoise: st.ratingNoise,
      useSourceSd: st.useSourceSd,
      sims: st.sims,
      results: effResults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, resultsKey, ratingsKey, st.hfa, st.ratingNoise, st.useSourceSd, st.sims, fieldErr]);

  const payoutKey = JSON.stringify(a.payouts) + fieldKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matrix = useMemo(() => (sim ? payoutMatrix(sim, a) : null), [sim, payoutKey]);
  const shares = useMemo(() => (sim && matrix ? fairShares(sim, matrix) : {}), [sim, matrix]);

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

      <div className="cal-desk-grid">
        <LiveCard a={a} live={live} high={high} meId={st.meId} now={now} sim={sim} matrix={matrix} netPot={netPot} edgePct={st.edgePct} />
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

      <ValueTable a={a} values={values} sim={sim} />

      <section className="cal-dcard">
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
        {(sim.warnings.length > 0 || customProps.length > 0 || parsed.unmatched.length > 0 || parsed.duplicates.length > 0) && (
          <div className="cal-desk-warn">
            {sim.warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
            {customProps.map((p) => (
              <div key={p.id}>⚠ "{p.label}" isn't modeled — priced as an even split across all 14 teams.</div>
            ))}
            {parsed.unmatched.map((u) => (
              <div key={u.line}>
                ⚠ Line {u.line} not read: {u.text}
              </div>
            ))}
            {parsed.duplicates.length > 0 && <div>⚠ Listed twice (last one used): {parsed.duplicates.join(", ")}</div>}
          </div>
        )}
        {showInputs && (
          <div className="cal-desk-inputs">
            <div>
              <textarea className="cal-dtext" value={st.ratingsText} onChange={(e) => set({ ratingsText: e.target.value })} spellCheck={false} />
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
            </div>
            <div className="cal-desk-form">
              <label>Home field (pts)</label>
              <NumField value={st.hfa} step={0.25} onCommit={(v) => set({ hfa: v })} width={70} />
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
                Game margin SD {DEFAULT_SIM.marginSd} pts. Super Bowl neutral. Results entered on the Owners &amp; Results tab are locked in.
              </div>
              <RatingsCheck a={a} ratings={parsed.ratings} />
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
}: {
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
  let signal: { cls: string; text: string };
  if (sold) signal = { cls: mine ? "good" : "", text: mine ? `Bought at ${fmt$(bid)}` : `Sold ${fmt$(bid)} — ${pct((bid ?? 0) / Math.max(1, live.fair), 0)} of fair` };
  else if (mine) signal = { cls: "good", text: "You're the high bidder" };
  else if (bid == null || bid < live.max) signal = { cls: "good", text: `BID — up to ${fmt$(live.max)}` };
  else if (bid < live.fair) signal = { cls: "warn", text: `Thin — ${fmt$(live.fair - bid)} under fair, below your ${edgePct}% edge` };
  else signal = { cls: "bad", text: `PASS — ${fmt$(bid - live.fair)} over fair` };

  const teams = lotTeams(a, lot);
  const kinds: { k: SimPropKind; label: string }[] = [
    { k: "biggest_upset", label: "Upset" },
    { k: "worst_loss", label: "Worst L" },
    { k: "cinderella", label: "Cind." },
    { k: "best_ats", label: "ATS" },
  ];
  const atBid = bid != null && !sold ? live.fair - bid : null;

  return (
    <section className={`cal-dcard cal-live ${signal.cls}`}>
      <div className="cal-live-head">
        <LotLogos auction={a} lot={lot} size={54} />
        <div className="grow">
          <div className="cal-stage-eyebrow">
            On the block · {teams.map(seedLabel).join(" · ")} · {TIER_LABEL[live.tier]}
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
        <Kpi label="Edge at bid" value={atBid == null ? "—" : fmt$(atBid)} sub={atBid == null || !bid ? "" : `${pct(atBid / bid, 0)} ROI`} />
      </div>
      <div className={`cal-signal ${signal.cls}`}>{signal.text}</div>
      {meId && !sold && <WhatIf a={a} lot={lot} fair={live.fair} defaultPrice={mine ? bid ?? 0 : minNextBid(a)} meId={meId} sim={sim} matrix={matrix} netPot={netPot} />}
      <table className="cal-dtable">
        <thead>
          <tr>
            <th>Team</th>
            <th className="r">WC</th>
            <th className="r">Div</th>
            <th className="r">Conf</th>
            <th className="r">SB</th>
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
                <td className="r">{t.bye ? "bye" : pct(r[0])}</td>
                <td className="r">{pct(r[1])}</td>
                <td className="r">{pct(r[2])}</td>
                <td className="r">{pct(r[3])}</td>
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

function ValueTable({ a, values, sim }: { a: CalcuttaAuction; values: LotValue[]; sim: SimOutput }) {
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
            <th className="r">SB</th>
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
            const sb = teams.reduce((s, t) => s + (sim.reach[t.id]?.[3] ?? 0), 0);
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

function RatingsCheck({ a, ratings }: { a: CalcuttaAuction; ratings: Record<string, { rating: number; sd: number | null }> }) {
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

  const lotConfs = new Set(lotTeams(a, lot).map((t) => t.group));
  const overlap = before.pieces.filter((p) => lotTeams(a, p.lot).some((t) => lotConfs.has(t.group)));
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
          Same conference as your {overlap.map((p) => lotName(a, p.lot)).join(", ")} — they can't both make the Super Bowl, so this adds less upside than its EV alone suggests.
        </div>
      )}
    </div>
  );
}
