import { useEffect, useMemo, useState } from "react";
import "../styles/calcutta.css";
import { NFL_TEAMS } from "../data/nflTeams";
import {
  addParticipant,
  addTransfer,
  HOTKEY_RE,
  rebindHotkeys,
  bundleBySeed,
  bundleLots,
  lotHoldings,
  lotName,
  lotsFromField,
  lotTeams,
  moveLot,
  netPot,
  newAuction,
  ownerSummaries,
  participantById,
  potTotal,
  propWinners,
  removeTransfer,
  reopenLot,
  sortedLots,
  teamEarned,
  uid,
  unbundleLot,
  type Result,
} from "../lib/calcutta/engine";
import { FORMATS, emptyNflSeedSlots, formatDef, nflFieldFromSlots, payoutTotalPct, roundSlots, type NflSeedSlot } from "../lib/calcutta/formats";
import {
  deleteCloudAuction,
  deleteLocalAuction,
  dispatch as storeDispatch,
  fetchCloudAuction,
  listCloudAuctions,
  saveToCloud,
  useAuction,
  useLocalAuctions,
  useSyncState,
  writeAuction,
  type CloudAuctionMeta,
} from "../lib/calcutta/store";
import type { CalcuttaAuction, CalcuttaSettings, FormatKey, Participant, PayoutRules } from "../lib/calcutta/types";
import { NFL_ESPN_WEEK_ROUND, deriveFromGames, guessFirstFour, madnessGameDays, mergeEspnGames, scored } from "../lib/calcutta/scoring";
import { validateField, regionOrder, simulateBracket, payoutMatrix, fairShares } from "../lib/calcutta/bracketSim";
import { BOT_STYLES, addBots, botBaseRatings, practiceCopy, resetForReplay, simulatePlayoffGames } from "../lib/calcutta/bots";
import { savedRatings } from "../lib/calcutta/deskStorage";
import { lotShare, portfolio, projectPot } from "../lib/calcutta/value";
import { useSiteCfb } from "../lib/calcutta/siteCfb";
import { cfbFieldFromSeeds, madnessFieldFromEspn, madnessFieldToText, parseMadnessField, seedNamesFromField } from "../lib/calcutta/fields";
import { TEAMS } from "../data/teams";
import { deriveBracketSeeds } from "../lib/bracketSeeds";
import { fetchMonteCarloRun, fetchMonteCarloRuns } from "../lib/api/monteCarlo";
import type { FieldTeam, TeamResult } from "../lib/calcutta/types";
import { fetchScoreboard } from "../lib/overlay";
import type { PlayoffGame } from "../lib/calcutta/types";
import { LotLogos, NumField, TeamBadge, downloadCsv, fmt$, fmtPayout, fmtTime, seedLabel } from "../lib/calcutta/ui";

// Admin → Pools → Calcutta. Setup, attendees, field/lots, results and the
// bid log live here; the live auction itself runs on the Stage window
// (/calcutta/stage/:id), which is what gets screen-shared. Both read the
// same localStorage doc, so edits here show on the Stage instantly.

const SELECTED_KEY = "calcutta:selected";

export function openStageWindow(id: string) {
  window.open(`/calcutta/stage/${id}`, `calcutta-stage-${id}`, "popup=yes,width=1600,height=900");
}

export function openDeskWindow(id: string) {
  window.open(`/calcutta/desk/${id}`, `calcutta-desk-${id}`, "popup=yes,width=1600,height=1000");
}

export default function CalcuttaPanel({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const auction = useAuction(selected);
  const select = (id: string | null) => {
    setSelected(id);
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="cal-admin">
      <div className="cal-nav">
        <button className="cal-btn sm" onClick={onBack}>
          ‹ Pools
        </button>
        {auction && (
          <button className="cal-btn sm" onClick={() => select(null)}>
            ‹ All Calcutta auctions
          </button>
        )}
      </div>
      {auction ? <AuctionEditor auction={auction} onOpen={select} /> : <AuctionList onOpen={select} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List / create
// ---------------------------------------------------------------------------

function AuctionList({ onOpen }: { onOpen: (id: string) => void }) {
  const local = useLocalAuctions();
  const [cloud, setCloud] = useState<CloudAuctionMeta[] | null>(null);
  const [cloudErr, setCloudErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<FormatKey>("nfl_playoffs");

  useEffect(() => {
    listCloudAuctions()
      .then(setCloud)
      .catch((e) => setCloudErr(e?.message ?? "Couldn't load saved auctions"));
  }, []);

  const create = () => {
    const a = newAuction(name.trim() || `${formatDef(format).label} Calcutta ${new Date().getFullYear()}`, format, Date.now());
    writeAuction(a);
    onOpen(a.id);
  };

  const loadCloud = async (id: string) => {
    const doc = await fetchCloudAuction(id);
    if (doc) {
      writeAuction(doc, { cloud: false });
      onOpen(doc.id);
    }
  };

  const remove = async (a: CalcuttaAuction) => {
    if (!window.confirm(`Delete "${a.name}" from this computer and the cloud? This can't be undone.`)) return;
    deleteLocalAuction(a.id);
    try {
      await deleteCloudAuction(a.id);
      setCloud((c) => c?.filter((x) => x.id !== a.id) ?? c);
    } catch {
      // Not in the cloud (or table missing) — local delete is what matters.
    }
  };

  const cloudOnly = (cloud ?? []).filter((c) => !local.some((l) => l.id === c.id));

  return (
    <>
      <h1 className="cal-h1">Calcutta</h1>
      <p className="cal-sub">Run a live team auction: set it up here, then open the Stage window and share that window on Zoom.</p>

      <section className="cal-card">
        <h2>New auction</h2>
        <div className="cal-row">
          <input className="cal-input" placeholder="Name (e.g. 2027 NFL Playoff Calcutta)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 280 }} />
          <select className="cal-input" value={format} onChange={(e) => setFormat(e.target.value as FormatKey)}>
            {FORMATS.map((f) => (
              <option key={f.key} value={f.key} disabled={!f.available}>
                {f.label}
                {f.available ? "" : " (coming soon)"}
              </option>
            ))}
          </select>
          <button className="cal-btn primary" onClick={create}>
            Create
          </button>
        </div>
        <div className="cal-note">{formatDef(format).blurb}</div>
      </section>

      <section className="cal-card">
        <h2>Auctions</h2>
        {local.length === 0 && cloudOnly.length === 0 && <div className="cal-note">None yet.</div>}
        {local.length > 0 && (
          <table className="cal-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Format</th>
                <th>Status</th>
                <th className="r">Sold</th>
                <th className="r">Pot</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {local.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button className="cal-link" onClick={() => onOpen(a.id)}>
                      {a.name}
                    </button>
                  </td>
                  <td>{formatDef(a.format).label}</td>
                  <td>
                    <span className={`cal-pill ${a.status}`}>{a.status}</span>
                    {a.practice?.enabled && <span className="cal-pill"> practice</span>}
                  </td>
                  <td className="r">
                    {a.lots.filter((l) => l.status === "sold").length}/{a.lots.length}
                  </td>
                  <td className="r">{fmt$(potTotal(a))}</td>
                  <td>{new Date(a.updatedAt).toLocaleString()}</td>
                  <td className="r">
                    <button className="cal-btn sm" onClick={() => openStageWindow(a.id)}>
                      Stage ↗
                    </button>{" "}
                    <button className="cal-btn sm danger" onClick={() => remove(a)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cloudOnly.length > 0 && (
          <>
            <h3>Saved in the cloud (not on this computer)</h3>
            <table className="cal-table">
              <tbody>
                {cloudOnly.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{formatDef(c.format as FormatKey).label}</td>
                    <td>{c.status}</td>
                    <td>{new Date(c.updated_at).toLocaleString()}</td>
                    <td className="r">
                      <button className="cal-btn sm" onClick={() => loadCloud(c.id)}>
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {cloudErr && <div className="cal-note warn">Cloud list unavailable ({cloudErr}). Auctions still save on this computer.</div>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

type Tab = "setup" | "attendees" | "field" | "owners" | "log" | "practice";

function useAct(id: string) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 4000);
    return () => clearTimeout(t);
  }, [err]);
  const act = (fn: (a: CalcuttaAuction, now: number) => Result) => {
    const e = storeDispatch(id, fn);
    setErr(e ?? null);
    return !e;
  };
  /** Plain patch (settings edits etc.). */
  const patch = (fn: (a: CalcuttaAuction) => Partial<CalcuttaAuction>) => act((a, now) => ({ auction: { ...a, ...fn(a), updatedAt: now } }));
  return { act, patch, err };
}

function SyncBadge({ id }: { id: string }) {
  const s = useSyncState(id);
  const text =
    s.state === "saved"
      ? `Saved to cloud ${s.at ? fmtTime(s.at) : ""}`
      : s.state === "saving" || s.state === "pending"
        ? "Saving…"
        : s.state === "error"
          ? "Saved on this computer only"
          : "Saved on this computer";
  return (
    <span className={`cal-sync ${s.state}`} title={s.message ?? ""}>
      ● {text}
    </span>
  );
}

function AuctionEditor({ auction: a, onOpen }: { auction: CalcuttaAuction; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => (a.participants.length === 0 ? "setup" : a.status === "setup" ? "field" : "owners"));
  const { act, patch, err } = useAct(a.id);
  const sync = useSyncState(a.id);
  const sold = a.lots.filter((l) => l.status === "sold").length;

  return (
    <>
      <div className="cal-head">
        <div>
          <input className="cal-title-input" defaultValue={a.name} key={a.name} onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && patch(() => ({ name: e.target.value.trim() }))} />
          <div className="cal-sub">
            {formatDef(a.format).label} · <span className={`cal-pill ${a.status}`}>{a.status}</span> · {a.participants.length} attendees · {sold}/{a.lots.length} sold · pot{" "}
            <b>{fmt$(potTotal(a))}</b> · <SyncBadge id={a.id} />
          </div>
          {sync.state === "error" && <div className="cal-note warn">{sync.message}</div>}
        </div>
        <div className="cal-row">
          {!a.practice?.enabled && (
            <button className="cal-btn" onClick={() => saveToCloud(a.id)}>
              Save to cloud
            </button>
          )}
          <button className="cal-btn" onClick={() => openDeskWindow(a.id)} disabled={!!validateField(a.format, a.field, a.regions)} title="Private model — keep it on the monitor you don't share">
            Open Desk ↗
          </button>
          <button className="cal-btn primary" onClick={() => openStageWindow(a.id)} disabled={a.lots.length === 0 || a.participants.length === 0}>
            Open Stage window ↗
          </button>
        </div>
      </div>

      <ReadinessChecklist a={a} onGo={setTab} />

      <div className="cal-tabs">
        {(
          [
            ["setup", "Rules & Payouts"],
            ["attendees", `Attendees (${a.participants.length})`],
            ["field", `Field & Lots (${a.lots.length})`],
            ["owners", "Owners & Results"],
            ["log", `Bid Log (${a.bids.length})`],
            ["practice", a.practice?.enabled ? "Practice 🤖" : "Practice"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={`cal-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {err && <div className="cal-error">{err}</div>}

      {tab === "setup" && <SetupTab a={a} patch={patch} />}
      {tab === "attendees" && <AttendeesTab a={a} act={act} patch={patch} />}
      {tab === "field" && <FieldTab a={a} act={act} patch={patch} />}
      {tab === "owners" && <OwnersTab a={a} act={act} patch={patch} />}
      {tab === "log" && <LogTab a={a} />}
      {tab === "practice" && <PracticeTab a={a} act={act} patch={patch} onOpen={onOpen} />}
    </>
  );
}

function ReadinessChecklist({ a, onGo }: { a: CalcuttaAuction; onGo: (t: Tab) => void }) {
  if (a.status !== "setup") return null;
  const total = payoutTotalPct(a.format, a.payouts, a.field);
  const items: [boolean, string, Tab][] = [
    [Math.abs(total - 100) < 0.05, `Payouts add to 100% (now ${total}%)`, "setup"],
    [a.participants.length >= 2, "At least 2 attendees", "attendees"],
    [!validateField(a.format, a.field, a.regions), validateField(a.format, a.field, a.regions) ?? `Full field (${a.field.length} teams)`, "field"],
    [a.lots.length > 0 && a.field.every((t) => a.lots.some((l) => l.teamIds.includes(t.id))), "Lots built for every team", "field"],
  ];
  return (
    <div className="cal-checklist">
      {items.map(([okay, label, t]) => (
        <button key={label} className={`cal-check ${okay ? "ok" : ""}`} onClick={() => onGo(t)}>
          {okay ? "✓" : "○"} {label}
        </button>
      ))}
    </div>
  );
}

type Patch = (fn: (a: CalcuttaAuction) => Partial<CalcuttaAuction>) => boolean;
type Act = (fn: (a: CalcuttaAuction, now: number) => Result) => boolean;

// ---------------------------------------------------------------------------
// Rules & payouts
// ---------------------------------------------------------------------------

function SetupTab({ a, patch }: { a: CalcuttaAuction; patch: Patch }) {
  const s = a.settings;
  const set = (p: Partial<CalcuttaSettings>) => patch((x) => ({ settings: { ...x.settings, ...p } }));
  const setPay = (p: Partial<PayoutRules>) => patch((x) => ({ payouts: { ...x.payouts, ...p } }));
  const def = formatDef(a.format);
  const total = payoutTotalPct(a.format, a.payouts, a.field);
  const np = netPot(a);

  return (
    <div className="cal-grid2">
      <section className="cal-card">
        <h2>Bidding</h2>
        <div className="cal-form">
          <label>Opening minimum</label>
          <NumField value={s.openingMin} onCommit={(v) => set({ openingMin: Math.max(0, v) })} suffix="$" />
          <label>Increments</label>
          <div>
            {s.increments.map((t, i) => (
              <div key={i} className="cal-row tight">
                <span className="cal-note">{i === s.increments.length - 1 ? "Above that" : "Under"}</span>
                {i < s.increments.length - 1 && (
                  <NumField
                    value={t.upTo ?? 0}
                    onCommit={(v) => set({ increments: s.increments.map((x, j) => (j === i ? { ...x, upTo: v } : x)) })}
                    suffix="$"
                    width={70}
                  />
                )}
                <span className="cal-note">step</span>
                <NumField value={t.step} onCommit={(v) => set({ increments: s.increments.map((x, j) => (j === i ? { ...x, step: Math.max(1, v) } : x)) })} suffix="$" width={60} />
                {s.increments.length > 1 && (
                  <button
                    className="cal-btn sm"
                    onClick={() => {
                      const next = s.increments.filter((_, j) => j !== i);
                      next[next.length - 1] = { ...next[next.length - 1], upTo: null };
                      set({ increments: next });
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              className="cal-btn sm"
              onClick={() => {
                const prev = s.increments.slice(0, -1);
                const last = s.increments[s.increments.length - 1];
                const ceiling = (prev[prev.length - 1]?.upTo ?? 0) * 2 || 1000;
                set({ increments: [...prev, { upTo: ceiling, step: last.step }, { upTo: null, step: last.step * 2 }] });
              }}
            >
              + tier
            </button>
          </div>
          <label>Clock when a lot opens</label>
          <NumField value={s.timerStart} onCommit={(v) => set({ timerStart: Math.max(3, v) })} suffix="sec" />
          <label>Each bid resets clock to at least</label>
          <NumField value={s.timerReset} onCommit={(v) => set({ timerReset: Math.max(3, v) })} suffix="sec" />
          <label>"Going once" / "going twice" at</label>
          <span className="cal-row tight">
            <NumField value={s.goingOnceAt} onCommit={(v) => set({ goingOnceAt: v })} suffix="sec" width={60} />
            <NumField value={s.goingTwiceAt} onCommit={(v) => set({ goingTwiceAt: v })} suffix="sec" width={60} />
          </span>
          <label>When the clock hits 0</label>
          <select className="cal-input" value={s.autoSell ? "auto" : "confirm"} onChange={(e) => set({ autoSell: e.target.value === "auto" })}>
            <option value="confirm">Show SOLD? — I confirm (Enter)</option>
            <option value="auto">Sell automatically</option>
          </select>
          <label>Lot with no bids</label>
          <select className="cal-input" value={s.noBidAction} onChange={(e) => set({ noBidAction: e.target.value as CalcuttaSettings["noBidAction"] })}>
            <option value="requeue">Back of the line once, then unsold</option>
            <option value="unsold">Unsold right away</option>
          </select>
          <label>Minimum buy-in</label>
          <span>
            <NumField value={s.minBuyIn ?? 0} onCommit={(v) => set({ minBuyIn: Math.max(0, v) })} suffix="$ each" />
            <span className="cal-note"> 0 = off. Spend less and the difference goes into the pot anyway.</span>
          </span>
          <label>Max teams per person</label>
          <span>
            <NumField value={s.maxTeams ?? 0} onCommit={(v) => set({ maxTeams: Math.max(0, Math.round(v)) })} suffix="teams" />
            <span className="cal-note"> 0 = no limit. A bundle counts as one. Bidders at the max grey out.</span>
          </span>
          <label>Rake (host cut)</label>
          <NumField value={s.rakePct} onCommit={(v) => set({ rakePct: Math.min(100, Math.max(0, v)) })} suffix="%" />
          <label>Stage sounds</label>
          <label className="cal-toggle">
            <input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} /> Beeps at going once/twice + gavel on sold
          </label>
        </div>
        <div className="cal-note">Turn on "Share sound" in Zoom if you want the room to hear them.</div>
      </section>

      <section className="cal-card">
        <h2>Payouts</h2>
        <table className="cal-table">
          <thead>
            <tr>
              <th>Event</th>
              <th className="r">% per team</th>
              <th className="r">Teams</th>
              <th className="r">Total</th>
              <th className="r" title="What a team has collected in all once it wins this round">Team's running total</th>
              <th className="r">{np > 0 ? "$ each now" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {def.rounds.map((r) => {
              const pct = a.payouts.roundPct[r.key] ?? 0;
              const slots = roundSlots(a.format, r.key, a.payouts, a.field);
              return (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="r">
                    <NumField value={pct} step={0.5} onCommit={(v) => setPay({ roundPct: { ...a.payouts.roundPct, [r.key]: v } })} suffix="%" width={72} />
                  </td>
                  <td className="r">× {slots}</td>
                  <td className="r">{Math.round(pct * slots * 100) / 100}%</td>
                  <td className="r cal-note">{Math.round(def.rounds.slice(0, def.rounds.indexOf(r) + 1).reduce((x, y) => x + (a.payouts.roundPct[y.key] ?? 0), 0) * 100) / 100}%</td>
                  <td className="r">{np > 0 ? fmtPayout((pct / 100) * np) : ""}</td>
                </tr>
              );
            })}
            {a.payouts.props.map((p) => (
              <tr key={p.id}>
                <td>
                  <input className="cal-input" value={p.label} onChange={(e) => setPay({ props: a.payouts.props.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)) })} />
                  <input
                    className="cal-input cal-rule"
                    placeholder="Rule / tiebreak shown to the room"
                    value={p.rule ?? ""}
                    onChange={(e) => setPay({ props: a.payouts.props.map((x) => (x.id === p.id ? { ...x, rule: e.target.value } : x)) })}
                  />
                </td>
                <td className="r">
                  <NumField value={p.pct} step={0.5} onCommit={(v) => setPay({ props: a.payouts.props.map((x) => (x.id === p.id ? { ...x, pct: v } : x)) })} suffix="%" width={64} />
                </td>
                <td className="r">× 1</td>
                <td className="r">{p.pct}%</td>
                <td />
                <td className="r">
                  <button className="cal-btn sm" onClick={() => setPay({ props: a.payouts.props.filter((x) => x.id !== p.id) })}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <button className="cal-btn sm" onClick={() => setPay({ props: [...a.payouts.props, { id: uid("prop_"), label: "Side prize", pct: 0, teamIds: [], rule: "" }] })}>
                  + side prize
                </button>{" "}
                <button
                  className="cal-btn sm"
                  onClick={() => {
                    if (!window.confirm("Replace the payouts and side prizes with the recommended defaults?")) return;
                    const d = formatDef(a.format).defaultPayouts;
                    setPay({ roundPct: { ...d.roundPct }, byeCountsAsWin: d.byeCountsAsWin, props: d.props.map((p) => ({ ...p, id: uid("prop_"), teamIds: [] })) });
                  }}
                >
                  Reset to recommended
                </button>
              </td>
              <td className={`r ${Math.abs(total - 100) < 0.05 ? "good" : "bad"}`}>
                <b>{total}%</b>
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
        {a.format === "nfl_playoffs" && (
          <label className="cal-toggle">
            <input type="checkbox" checked={a.payouts.byeCountsAsWin} onChange={(e) => setPay({ byeCountsAsWin: e.target.checked })} /> #1 seeds' bye pays as a Wild Card win
          </label>
        )}
        <div className="cal-note">
          Percentages are of the pot after rake, paid to each team that clears the round. Side prizes (biggest blowout, etc.) are awarded on the Owners & Results tab.
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

function AttendeesTab({ a, act, patch }: { a: CalcuttaAuction; act: Act; patch: Patch }) {
  const [name, setName] = useState("");
  const all = useLocalAuctions();
  const known = useMemo(() => {
    const names = new Set<string>();
    for (const x of all) if (!x.practice?.enabled) for (const p of x.participants) if (!p.bot) names.add(p.name);
    for (const p of a.participants) names.delete(p.name);
    return [...names].sort();
  }, [all, a.participants]);
  const summaries = ownerSummaries(a);

  const add = (n: string) => {
    if (act((x, now) => addParticipant(x, n, now))) setName("");
  };
  const update = (id: string, p: Partial<Participant>) => patch((x) => ({ participants: x.participants.map((q) => (q.id === id ? { ...q, ...p } : q)) }));
  const setHotkey = (id: string, raw: string) => {
    const k = raw.slice(-1).toLowerCase();
    if (!HOTKEY_RE.test(k)) return;
    patch((x) => ({
      // Swap with whoever had that key so keys stay unique.
      participants: x.participants.map((q) => (q.id === id ? { ...q, hotkey: k } : q.hotkey === k ? { ...q, hotkey: x.participants.find((z) => z.id === id)!.hotkey } : q)),
    }));
  };

  return (
    <section className="cal-card">
      <h2>Attendees</h2>
      <div className="cal-row">
        <input
          className="cal-input"
          placeholder="Name"
          list="cal-known-names"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(name)}
        />
        <datalist id="cal-known-names">
          {known.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <button className="cal-btn primary" onClick={() => add(name)}>
          Add
        </button>
        {known.length > 0 && <span className="cal-note">Past attendees:</span>}
        {known.slice(0, 12).map((n) => (
          <button key={n} className="cal-btn sm" onClick={() => add(n)}>
            + {n}
          </button>
        ))}
      </div>
      <div className="cal-row">
        <span className="cal-note">Bid keys (the key you press on the Stage to bid for someone — any letter or number):</span>
        <button className="cal-btn sm" onClick={() => act((x, now) => rebindHotkeys(x, "letters", now))}>
          Letters from names
        </button>
        <button className="cal-btn sm" onClick={() => act((x, now) => rebindHotkeys(x, "numbers", now))}>
          Numbers 1–9, 0
        </button>
      </div>
      <div className="cal-note">
        Click a key box and press a new key to change it (keys swap if taken). With number keys, hold <b>Shift</b> while typing a jump amount on the Stage. Use the same name each year so bidding
        history lines up.
      </div>
      <table className="cal-table">
        <thead>
          <tr>
            <th>Color</th>
            <th>Name</th>
            <th>Key</th>
            <th className="r">Owes pot</th>
            <th className="r">Paid</th>
            <th className="r">Balance</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {a.participants.map((p) => {
            const s = summaries.find((x) => x.participant.id === p.id)!;
            const hasBids = a.bids.some((b) => b.participantId === p.id);
            const bal = s.owed - (p.paid || 0);
            return (
              <tr key={p.id}>
                <td>
                  <input type="color" value={p.color} onChange={(e) => update(p.id, { color: e.target.value })} />
                </td>
                <td>
                  <input className="cal-input" defaultValue={p.name} key={p.name} onBlur={(e) => e.target.value.trim() && update(p.id, { name: e.target.value.trim() })} />
                </td>
                <td>
                  <input className="cal-input cal-key" value={p.hotkey.toUpperCase()} onChange={(e) => setHotkey(p.id, e.target.value)} />
                </td>
                <td className="r">{fmt$(s.owed)}</td>
                <td className="r">
                  <NumField value={p.paid || 0} onCommit={(v) => update(p.id, { paid: v })} suffix="$" />
                </td>
                <td className={`r ${bal > 0 ? "bad" : bal < 0 ? "warn" : "good"}`}>{s.owed === 0 && !p.paid ? "" : bal > 0 ? `owes ${fmt$(bal)}` : bal < 0 ? `over ${fmt$(-bal)}` : "paid ✓"}</td>
                <td className="r">
                  <button
                    className="cal-btn sm danger"
                    disabled={hasBids}
                    title={hasBids ? "Has bids — can't remove" : ""}
                    onClick={() => patch((x) => ({ participants: x.participants.filter((q) => q.id !== p.id) }))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Field & lots
// ---------------------------------------------------------------------------

function slotsFromField(a: CalcuttaAuction): NflSeedSlot[] {
  return emptyNflSeedSlots().map((s) => ({ ...s, abbr: a.field.find((t) => t.group === s.conf && t.seed === s.seed)?.id ?? null }));
}

function FieldTab({ a, act, patch }: { a: CalcuttaAuction; act: Act; patch: Patch }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [bundleLabel, setBundleLabel] = useState("");
  const started = a.lots.some((l) => l.status !== "pending") || a.bids.length > 0;
  const slots = slotsFromField(a);

  const [standingsBusy, setStandingsBusy] = useState(false);
  const [standingsMsg, setStandingsMsg] = useState<string | null>(null);
  // ESPN's current playoff seeds (1–7 per conference, with its tiebreakers).
  const fillFromStandings = async () => {
    setStandingsBusy(true);
    setStandingsMsg(null);
    try {
      const res = await fetch("/api/odds-feed?mode=standings");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const teams: { abbr: string; seed: number | null; wins: number | null; losses: number | null; ties: number | null; clincher: string | null }[] = body.teams ?? [];
      const next = emptyNflSeedSlots().map((s) => {
        const t = teams.find((x) => {
          const team = NFL_TEAMS.find((n) => n.abbr === (x.abbr === "WAS" ? "WSH" : x.abbr));
          return team?.conf === s.conf && x.seed === s.seed;
        });
        return { ...s, abbr: t ? (t.abbr === "WAS" ? "WSH" : t.abbr) : null };
      });
      const found = next.filter((s) => s.abbr).length;
      if (!found) throw new Error("ESPN didn't return playoff seeds");
      patch(() => ({ field: nflFieldFromSlots(next) }));
      const rec = (abbr: string) => {
        const t = teams.find((x) => (x.abbr === "WAS" ? "WSH" : x.abbr) === abbr);
        return t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}${t.clincher ? ` ${t.clincher}` : ""}` : "";
      };
      setStandingsMsg(
        `Filled ${found}/14 seeds from ESPN's standings as of today (${body.season ?? "current"} season): ` +
          next.map((s) => `${s.conf} ${s.seed} ${s.abbr ?? "?"} ${s.abbr ? rec(s.abbr) : ""}`.trim()).join(" · ") +
          ". Re-run after Week 18 for the final bracket.",
      );
    } catch (e: any) {
      setStandingsMsg(`Couldn't load standings: ${e?.message ?? e}`);
    } finally {
      setStandingsBusy(false);
    }
  };

  const setSlot = (conf: "AFC" | "NFC", seed: number, abbr: string | null) => {
    const next = slots.map((s) => (s.conf === conf && s.seed === seed ? { ...s, abbr } : s.abbr === abbr && abbr ? { ...s, abbr: null } : s));
    patch(() => ({ field: nflFieldFromSlots(next) }));
  };

  const build = (order: "seed" | "seed_desc" | "random") => {
    if (a.lots.length && !window.confirm("Rebuild all lots? This replaces the current order and bundles.")) return;
    patch((x) => ({ lots: lotsFromField(x.field, order) }));
    setPicked([]);
  };

  const missing = a.field.filter((t) => !a.lots.some((l) => l.teamIds.includes(t.id)));
  const maxSeed = Math.max(2, ...a.field.map((t) => t.seed ?? 0));
  const [bundleMin, setBundleMin] = useState(() => (a.format === "march_madness" ? 13 : a.format === "cfb_playoff24" ? 21 : maxSeed));
  const stale = a.lots.filter((l) => l.teamIds.some((id) => !a.field.some((t) => t.id === id)));

  return (
    <>
      {a.format === "nfl_playoffs" && (
        <section className="cal-card">
          <div className="cal-row" style={{ justifyContent: "space-between" }}>
            <h2>Playoff field</h2>
            <button className="cal-btn" onClick={fillFromStandings} disabled={standingsBusy || started}>
              {standingsBusy ? "Loading…" : "Fill from current NFL standings"}
            </button>
          </div>
          {standingsMsg && <div className="cal-note">{standingsMsg}</div>}
          {started && <div className="cal-note warn">Bidding has started — changing the field now won't touch lots already sold.</div>}
          <div className="cal-grid2">
            {(["AFC", "NFC"] as const).map((conf) => (
              <div key={conf}>
                <h3>{conf}</h3>
                {slots
                  .filter((s) => s.conf === conf)
                  .map((s) => (
                    <div key={s.seed} className="cal-row tight">
                      <span className="cal-seed">{s.seed}</span>
                      <select className="cal-input" value={s.abbr ?? ""} onChange={(e) => setSlot(conf, s.seed, e.target.value || null)} style={{ minWidth: 220 }}>
                        <option value="">—</option>
                        {NFL_TEAMS.filter((t) => t.conf === conf).map((t) => (
                          <option key={t.abbr} value={t.abbr}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      {s.seed === 1 && <span className="cal-note">bye</span>}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {(a.format === "cfb_playoff12" || a.format === "cfb_playoff24") && <CfbFieldEditor a={a} patch={patch} started={started} />}
      {a.format === "march_madness" && <MadnessFieldEditor a={a} patch={patch} started={started} />}

      <section className="cal-card">
        <h2>Lots &amp; auction order</h2>
        <div className="cal-row">
          <span className="cal-note">Build one lot per team:</span>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("seed")}>
            By seed (1s first)
          </button>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("seed_desc")}>
            By seed (lowest seeds first)
          </button>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("random")}>
            Random
          </button>
        </div>
        {a.format !== "nfl_playoffs" && a.lots.length > 0 && (
          <div className="cal-row">
            <span className="cal-note">Bundle long shots: every team seeded</span>
            <select className="cal-input" value={bundleMin} onChange={(e) => setBundleMin(Number(e.target.value))}>
              {Array.from({ length: maxSeed - 1 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
            {a.format === "march_madness" ? (
              <>
                <button className="cal-btn" disabled={started} onClick={() => act((x, now) => bundleBySeed(x, bundleMin, "region", now))}>
                  One bundle per region
                </button>
                <button className="cal-btn" disabled={started} onClick={() => act((x, now) => bundleBySeed(x, bundleMin, "line", now))}>
                  One bundle per seed line
                </button>
              </>
            ) : (
              <button className="cal-btn" disabled={started} onClick={() => act((x, now) => bundleBySeed(x, bundleMin, "region", now))}>
                Bundle them
              </button>
            )}
          </div>
        )}
        {(missing.length > 0 || stale.length > 0) && a.lots.length > 0 && (
          <div className="cal-note warn">
            Lots don't match the field
            {missing.length > 0 && ` — not in any lot: ${missing.map((t) => t.abbr).join(", ")}`}
            {stale.length > 0 && ` — lots with teams no longer in the field: ${stale.length}`}. Rebuild the lots.
          </div>
        )}
        {picked.length >= 2 && (
          <div className="cal-row">
            <input className="cal-input" placeholder="Bundle name (optional)" value={bundleLabel} onChange={(e) => setBundleLabel(e.target.value)} />
            <button
              className="cal-btn primary"
              onClick={() => {
                if (act((x, now) => bundleLots(x, picked, bundleLabel, now))) {
                  setPicked([]);
                  setBundleLabel("");
                }
              }}
            >
              Bundle {picked.length} lots
            </button>
          </div>
        )}
        <table className="cal-table">
          <thead>
            <tr>
              <th />
              <th>#</th>
              <th>Lot</th>
              <th>Seed</th>
              <th>Status</th>
              <th>Owner</th>
              <th className="r">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedLots(a).map((l) => {
              const teams = lotTeams(a, l);
              const winner = participantById(a, l.winnerId);
              return (
                <tr key={l.id}>
                  <td>
                    {l.status === "pending" && (
                      <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />
                    )}
                  </td>
                  <td>{l.order}</td>
                  <td>
                    <span className="cal-row tight">
                      <LotLogos auction={a} lot={l} />
                      {lotName(a, l)}
                    </span>
                  </td>
                  <td>{teams.map(seedLabel).join(", ")}</td>
                  <td>
                    <span className={`cal-pill ${l.status}`}>{l.status}</span>
                  </td>
                  <td>{winner && <span style={{ color: winner.color, fontWeight: 600 }}>{winner.name}</span>}</td>
                  <td className="r">{fmt$(l.price)}</td>
                  <td className="r">
                    {l.status === "pending" && (
                      <>
                        <button className="cal-btn sm" onClick={() => act((x, now) => moveLot(x, l.id, -1, now))}>
                          ↑
                        </button>
                        <button className="cal-btn sm" onClick={() => act((x, now) => moveLot(x, l.id, 1, now))}>
                          ↓
                        </button>
                      </>
                    )}
                    {l.status === "pending" && l.teamIds.length > 1 && (
                      <button className="cal-btn sm" onClick={() => act((x, now) => unbundleLot(x, l.id, now))}>
                        Split
                      </button>
                    )}
                    {l.status === "sold" && (
                      <button
                        className="cal-btn sm"
                        title="Undo the sale and put it back up (bids kept)"
                        onClick={() => window.confirm(`Re-open ${lotName(a, l)}? The sale is undone and bidding resumes on the Stage.`) && act((x, now) => reopenLot(x, l.id, now))}
                      >
                        Re-open
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="cal-note">Tick two or more lots to bundle them (e.g. the 6 and 7 seeds as one lot). The Stage auctions lots top to bottom.</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Owners, ownership splits, results
// ---------------------------------------------------------------------------

interface ResultOption {
  value: string;
  label: string;
  result: TeamResult;
}

function isPlayInTeam(a: CalcuttaAuction, t: FieldTeam): boolean {
  return !!t.group && a.field.filter((x) => x.group === t.group && x.seed === t.seed).length === 2;
}

/** Status menu for one team, from the format's rounds (byes start one round in; First Four teams get play-in options). */
function resultOptions(a: CalcuttaAuction, t: FieldTeam): ResultOption[] {
  const rounds = formatDef(a.format).rounds;
  const pi = isPlayInTeam(a, t);
  const out: ResultOption[] = [];
  if (pi) {
    out.push({ value: "pi:alive", label: "Alive — First Four", result: { roundsCleared: 0, eliminated: false, playIn: null } });
    out.push({ value: "pi:lost", label: "Lost First Four", result: { roundsCleared: 0, eliminated: true, playIn: "lost" } });
  }
  const playIn = pi ? ("won" as const) : null;
  for (let r = t.bye ? 1 : 0; r < rounds.length; r++) {
    out.push({ value: `${r}:0`, label: `${r === rounds.length - 1 ? "In" : "Alive —"} ${rounds[r].game}`, result: { roundsCleared: r, eliminated: false, playIn } });
    out.push({ value: `${r}:1`, label: `Lost ${rounds[r].game}`, result: { roundsCleared: r, eliminated: true, playIn } });
  }
  out.push({ value: `${rounds.length}:0`, label: "Champion", result: { roundsCleared: rounds.length, eliminated: false, playIn } });
  return out;
}

function resultValue(a: CalcuttaAuction, t: FieldTeam, res: TeamResult): string {
  if (isPlayInTeam(a, t)) {
    if (res.playIn === "lost") return "pi:lost";
    if (res.playIn !== "won" && res.roundsCleared === 0 && !res.eliminated) return "pi:alive";
  }
  return `${res.roundsCleared}:${res.eliminated ? 1 : 0}`;
}

function OwnersTab({ a, act, patch }: { a: CalcuttaAuction; act: Act; patch: Patch }) {
  const summaries = ownerSummaries(a).filter((s) => s.owed || s.lots.length || s.participant.paid);
  const pot = potTotal(a);
  const np = netPot(a);
  const soldLots = sortedLots(a).filter((l) => l.status === "sold");
  const paidOut = summaries.reduce((s, x) => s + x.earned, 0);
  const auto = !!a.autoScore && (a.games ?? []).length > 0;
  const eff = scored(a);
  const derived = auto ? deriveFromGames(a) : null;

  return (
    <>
      <div className="cal-stats">
        <Stat label="Pot" value={fmt$(pot)} />
        <Stat label={`After ${a.settings.rakePct}% rake`} value={fmt$(np)} />
        <Stat label="Won so far" value={fmt$(paidOut, 2)} />
        <Stat label="Collected" value={`${fmt$(a.participants.reduce((s, p) => s + (p.paid || 0), 0))} / ${fmt$(pot)}`} />
      </div>

      <section className="cal-card">
        <div className="cal-row" style={{ justifyContent: "space-between" }}>
          <h2>Owners</h2>
          <button
            className="cal-btn sm"
            onClick={() =>
              downloadCsv(`${a.name}-owners.csv`, [
                ["Owner", "Teams", "Owes pot", "Paid", "Cost after splits", "Won", "Net"],
                ...summaries.map((s) => [
                  s.participant.name,
                  s.lots.map((x) => `${lotName(a, x.lot)}${x.pct < 100 ? ` (${x.pct}%)` : ""}`).join("; "),
                  s.owed,
                  s.participant.paid || 0,
                  s.cost,
                  s.earned.toFixed(2),
                  s.net.toFixed(2),
                ]),
              ])
            }
          >
            Export CSV
          </button>
        </div>
        <table className="cal-table">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Teams</th>
              <th className="r">Cost</th>
              <th className="r">Won</th>
              <th className="r">Net</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.participant.id}>
                <td style={{ color: s.participant.color, fontWeight: 700 }}>{s.participant.name}</td>
                <td>
                  {s.lots.map((x) => (
                    <span key={x.lot.id} className="cal-chip">
                      <LotLogos auction={a} lot={x.lot} size={16} /> {lotName(a, x.lot)}
                      {x.pct < 100 ? ` ${Math.round(x.pct * 10) / 10}%` : ""}
                    </span>
                  ))}
                </td>
                <td className="r">{fmt$(s.cost)}</td>
                <td className="r">{fmt$(s.earned, 2)}</td>
                <td className={`r ${s.net >= 0 ? "good" : "bad"}`}>{fmt$(s.net, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SplitsCard a={a} act={act} />

      {a.practice?.enabled && a.lots.some((l) => l.status === "sold") && <SimPlayoffsSection a={a} act={act} patch={patch} />}

      <GamesCard a={a} patch={patch} />

      <section className="cal-card">
        <h2>Results</h2>
        {auto && <div className="cal-note">Auto-scoring from the game log — turn it off on the Games card to set results by hand.</div>}
        <table className="cal-table">
          <thead>
            <tr>
              <th>Seed</th>
              <th>Team</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Paid events</th>
              <th className="r">%</th>
              <th className="r">$</th>
            </tr>
          </thead>
          <tbody>
            {[...a.field]
              .sort((x, y) => x.group.localeCompare(y.group) || (x.seed ?? 0) - (y.seed ?? 0))
              .map((t) => {
                const res = eff.results[t.id] ?? { roundsCleared: t.bye ? 1 : 0, eliminated: false };
                const earned = teamEarned(a, t.id);
                const pct = earned.reduce((s, e) => s + e.pct, 0);
                const lot = a.lots.find((l) => l.teamIds.includes(t.id));
                const holders = lot ? lotHoldings(a, lot) : [];
                const opts = resultOptions(a, t);
                return (
                  <tr key={t.id} className={res.eliminated ? "dim" : ""}>
                    <td>{seedLabel(t)}</td>
                    <td>
                      <span className="cal-row tight">
                        <TeamBadge team={t} size={18} /> {t.name}
                      </span>
                    </td>
                    <td>
                      {holders.map((h) => {
                        const p = participantById(a, h.participantId);
                        return (
                          <span key={h.participantId} style={{ color: p?.color, fontWeight: 600, marginRight: 6 }}>
                            {p?.name}
                            {h.pct < 100 ? ` ${Math.round(h.pct * 10) / 10}%` : ""}
                          </span>
                        );
                      })}
                    </td>
                    <td>
                      <select
                        className="cal-input"
                        disabled={auto}
                        value={resultValue(a, t, res)}
                        onChange={(e) => {
                          const o = opts.find((x) => x.value === e.target.value)!;
                          patch((x) => ({ results: { ...x.results, [t.id]: o.result } }));
                        }}
                      >
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="cal-note">{earned.map((e) => e.label).join(", ")}</td>
                    <td className="r">{pct ? `${pct}%` : ""}</td>
                    <td className="r">{pct ? fmt$((pct / 100) * np, 2) : ""}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {a.payouts.props.length > 0 && (
          <>
            <h3>Side prizes</h3>
            <div className="cal-note">Tick the winner. Tick more than one for a tie — the prize splits evenly.</div>
            {a.payouts.props.map((p) => {
              const autoSt = auto ? derived?.props[p.id] : undefined;
              const winners = autoSt ? (autoSt.final ? autoSt.winners : []) : propWinners(p);
              const toggle = (teamId: string) =>
                patch((x) => ({
                  payouts: {
                    ...x.payouts,
                    props: x.payouts.props.map((q) => {
                      if (q.id !== p.id) return q;
                      const cur = propWinners(q);
                      return { ...q, teamId: null, teamIds: cur.includes(teamId) ? cur.filter((t) => t !== teamId) : [...cur, teamId] };
                    }),
                  },
                }));
              return (
                <div key={p.id} className="cal-prop">
                  <div>
                    <b>{p.label}</b> · {p.pct}% {np > 0 && <span className="cal-note">({fmtPayout((p.pct / 100) * np)})</span>}
                    {p.rule && <div className="cal-note">{p.rule}</div>}
                    {autoSt && (
                      <div className={`cal-note ${autoSt.final ? "good" : ""}`}>
                        {autoSt.final ? "Settled: " : autoSt.winners.length ? "Leader so far: " : ""}
                        {autoSt.detail ?? "No games yet"}
                        {autoSt.blocker ? ` · ${autoSt.blocker}` : ""}
                      </div>
                    )}
                  </div>
                  {!autoSt && <div className="cal-prop-teams">
                    {[...a.field]
                      .sort((x, y) => x.group.localeCompare(y.group) || (x.seed ?? 0) - (y.seed ?? 0))
                      .map((t) => (
                        <label key={t.id} className={`cal-prop-team ${winners.includes(t.id) ? "on" : ""}`} title={t.name}>
                          <input type="checkbox" checked={winners.includes(t.id)} onChange={() => toggle(t.id)} />
                          <TeamBadge team={t} size={18} /> {t.abbr}
                        </label>
                      ))}
                  </div>}
                </div>
              );
            })}
          </>
        )}
        {soldLots.length === 0 && <div className="cal-note">Nothing sold yet.</div>}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cal-stat">
      <div className="cal-stat-v">{value}</div>
      <div className="cal-stat-l">{label}</div>
    </div>
  );
}

function SplitsCard({ a, act }: { a: CalcuttaAuction; act: Act }) {
  const soldLots = sortedLots(a).filter((l) => l.status === "sold");
  const [lotId, setLotId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [pct, setPct] = useState("50");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const lot = soldLots.find((l) => l.id === lotId);
  const holders = lot ? lotHoldings(a, lot).filter((h) => h.pct > 0) : [];

  useEffect(() => {
    if (lot && !holders.some((h) => h.participantId === fromId)) setFromId(holders[0]?.participantId ?? "");
    if (lot && price === "" && lot.price) setPrice(String(((lot.price ?? 0) * Number(pct || 0)) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId]);

  const submit = () => {
    if (act((x, now) => addTransfer(x, { lotId, fromId, toId, pct: Number(pct), price: Number(price || 0), note: note || null }, now))) {
      setPrice("");
      setNote("");
    }
  };

  return (
    <section className="cal-card">
      <h2>Partners &amp; buybacks</h2>
      <div className="cal-note">
        Record a share of a team changing hands — a partner buying in, or a buyback. The winning bidder still owes the full price to the pot; the share price is paid between
        the two people, and payouts split by ownership %.
      </div>
      <div className="cal-row">
        <select className="cal-input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">Team…</option>
          {soldLots.map((l) => (
            <option key={l.id} value={l.id}>
              {lotName(a, l)} ({fmt$(l.price)})
            </option>
          ))}
        </select>
        <span className="cal-note">from</span>
        <select className="cal-input" value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={!lot}>
          {holders.map((h) => (
            <option key={h.participantId} value={h.participantId}>
              {participantById(a, h.participantId)?.name} ({Math.round(h.pct * 10) / 10}%)
            </option>
          ))}
        </select>
        <span className="cal-note">to</span>
        <select className="cal-input" value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Person…</option>
          {a.participants
            .filter((p) => p.id !== fromId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <input
          className="cal-input"
          type="number"
          value={pct}
          style={{ width: 70 }}
          onChange={(e) => {
            setPct(e.target.value);
            if (lot?.price) setPrice(String(Math.round(((lot.price ?? 0) * Number(e.target.value || 0)) / 100 * 100) / 100));
          }}
        />
        <span className="cal-note">% for $</span>
        <input className="cal-input" type="number" value={price} style={{ width: 90 }} onChange={(e) => setPrice(e.target.value)} />
        <input className="cal-input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="cal-btn primary" disabled={!lot || !fromId || !toId} onClick={submit}>
          Add
        </button>
      </div>
      {a.transfers.length > 0 && (
        <table className="cal-table">
          <tbody>
            {a.transfers.map((t) => {
              const l = a.lots.find((x) => x.id === t.lotId);
              return (
                <tr key={t.id}>
                  <td>{l ? lotName(a, l) : "?"}</td>
                  <td>
                    {participantById(a, t.fromId)?.name} → {participantById(a, t.toId)?.name}
                  </td>
                  <td className="r">{t.pct}%</td>
                  <td className="r">{fmt$(t.price, 2)}</td>
                  <td className="cal-note">{t.note}</td>
                  <td className="r">
                    <button className="cal-btn sm" onClick={() => act((x, now) => removeTransfer(x, t.id, now))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bid log + per-attendee history
// ---------------------------------------------------------------------------

function LogTab({ a }: { a: CalcuttaAuction }) {
  const lotById = new Map(a.lots.map((l) => [l.id, l]));
  const rows = [...a.bids].reverse();
  const perPerson = a.participants.map((p) => {
    const bids = a.bids.filter((b) => b.participantId === p.id && !b.voided);
    const won = a.lots.filter((l) => l.status === "sold" && l.winnerId === p.id);
    const lotsBidOn = new Set(bids.map((b) => b.lotId)).size;
    return { p, bids: bids.length, lotsBidOn, won: won.length, spent: won.reduce((s, l) => s + (l.price ?? 0), 0), maxBid: Math.max(0, ...bids.map((b) => b.amount)) };
  });

  return (
    <>
      <section className="cal-card">
        <h2>By attendee</h2>
        <table className="cal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="r">Bids</th>
              <th className="r">Lots bid on</th>
              <th className="r">Won</th>
              <th className="r">Spent</th>
              <th className="r">Biggest bid</th>
            </tr>
          </thead>
          <tbody>
            {perPerson.map((x) => (
              <tr key={x.p.id}>
                <td style={{ color: x.p.color, fontWeight: 700 }}>{x.p.name}</td>
                <td className="r">{x.bids}</td>
                <td className="r">{x.lotsBidOn}</td>
                <td className="r">{x.won}</td>
                <td className="r">{fmt$(x.spent)}</td>
                <td className="r">{x.maxBid ? fmt$(x.maxBid) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="cal-card">
        <div className="cal-row" style={{ justifyContent: "space-between" }}>
          <h2>Every bid</h2>
          <button
            className="cal-btn sm"
            onClick={() =>
              downloadCsv(`${a.name}-bids.csv`, [
                ["Time", "Lot", "Teams", "Bidder", "Amount", "Undone", "Winning bid"],
                ...a.bids.map((b) => {
                  const l = lotById.get(b.lotId);
                  const winning = l?.status === "sold" && l.winnerId === b.participantId && l.price === b.amount && !b.voided;
                  return [
                    new Date(b.ts).toISOString(),
                    l?.order ?? "",
                    l ? lotTeams(a, l).map((t) => t.abbr).join("+") : "",
                    participantById(a, b.participantId)?.name ?? "",
                    b.amount,
                    b.voided ? "yes" : "",
                    winning ? "yes" : "",
                  ];
                }),
              ])
            }
          >
            Export CSV
          </button>
        </div>
        <table className="cal-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Lot</th>
              <th>Bidder</th>
              <th className="r">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const l = lotById.get(b.lotId);
              const p = participantById(a, b.participantId);
              return (
                <tr key={b.id} className={b.voided ? "dim strike" : ""}>
                  <td>{fmtTime(b.ts)}</td>
                  <td>{l ? lotName(a, l) : "?"}</td>
                  <td style={{ color: p?.color, fontWeight: 600 }}>{p?.name}</td>
                  <td className="r">{fmt$(b.amount)}</td>
                  <td className="cal-note">{b.voided ? "undone" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Game log + ESPN sync (auto-scoring)
// ---------------------------------------------------------------------------


function GamesCard({ a, patch }: { a: CalcuttaAuction; patch: Patch }) {
  const roundLabels = [...(a.format === "march_madness" ? ["First Four"] : []), ...formatDef(a.format).rounds.map((r) => r.game)];
  const roundOffset = a.format === "march_madness" ? 1 : 0; // First Four is round −1
  const espn = true;
  const [firstFour, setFirstFour] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [season, setSeason] = useState("");
  const [draft, setDraft] = useState({ round: 0, homeId: "", awayId: "" });
  const games = [...(a.games ?? [])].sort((x, y) => x.round - y.round || (x.start ?? "").localeCompare(y.start ?? ""));
  const team = (id: string) => a.field.find((t) => t.id === id);
  const setGames = (fn: (g: PlayoffGame[]) => PlayoffGame[]) => patch((x) => ({ games: fn(x.games ?? []) }));
  const update = (id: string, p: Partial<PlayoffGame>) => setGames((gs) => gs.map((g) => (g.id === id ? { ...g, ...p } : g)));

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let added = 0;
      let updated = 0;
      let skipped = 0;
      const extra = /^\d{4}$/.test(season.trim()) ? `&season=${season.trim()}` : "";
      const merge = (list: any[], round: number | null, neutral: boolean | null) => {
        let res: ReturnType<typeof mergeEspnGames> | null = null;
        patch((x) => {
          res = mergeEspnGames(x, round, list, neutral);
          return { games: res.games, autoScore: x.autoScore ?? true };
        });
        added += res?.added ?? 0;
        updated += res?.updated ?? 0;
        skipped += res?.skipped ?? 0;
      };
      if (a.format === "nfl_playoffs") {
        for (const [week, round] of Object.entries(NFL_ESPN_WEEK_ROUND)) {
          const { games: list } = await fetchScoreboard(`league=nfl&seasontype=3&week=${week}${extra}`);
          merge(list, round, round === 3);
        }
      } else if (a.format === "march_madness") {
        const { games: list } = await fetchScoreboard(`league=cbb&dates=${madnessDays(season, firstFour).join(",")}`);
        merge(list, null, null);
      } else {
        const { games: list } = await fetchScoreboard(`league=cfbpost${extra}`);
        merge(list, null, null);
      }
      setMsg(`ESPN: ${added} new, ${updated} updated${skipped ? `, ${skipped} not in this field` : ""} · ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setMsg(`ESPN sync failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!autoSync) return;
    void sync();
    const t = setInterval(() => void sync(), 120_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

  const addManual = () => {
    if (!draft.homeId || !draft.awayId || draft.homeId === draft.awayId) return;
    setGames((gs) => [
      ...gs,
      { id: uid("g_"), round: draft.round, homeId: draft.homeId, awayId: draft.awayId, homeScore: null, awayScore: null, final: false, homeSpread: null, neutral: a.format === "march_madness" || draft.round === formatDef(a.format).rounds.length - 1, start: null, espnId: null, lineManual: false },
    ]);
    setDraft({ round: draft.round, homeId: "", awayId: "" });
  };

  const missingLines = games.filter((g) => g.final && g.homeSpread == null).length;

  return (
    <section className="cal-card">
      <div className="cal-row" style={{ justifyContent: "space-between" }}>
        <h2>Games</h2>
        <div className="cal-row tight">
          <label className="cal-toggle">
            <input type="checkbox" checked={!!a.autoScore} onChange={(e) => patch(() => ({ autoScore: e.target.checked }))} /> Auto-score results &amp; side prizes from these games
          </label>
        </div>
      </div>
      {espn ? <div className="cal-row">
        <button className="cal-btn primary" onClick={sync} disabled={busy || !!validateField(a.format, a.field, a.regions)}>
          {busy ? "Syncing…" : "Sync from ESPN"}
        </button>
        <label className="cal-toggle">
          <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} /> every 2 min while this page is open
        </label>
        <input
          className="cal-input"
          placeholder={a.format === "march_madness" ? "Tournament year (blank = next/this March)" : "Season it started (blank = current)"}
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          style={{ width: 250 }}
        />
        {a.format === "march_madness" && (
          <input className="cal-input" type="date" title="First Four Tuesday (blank = the Tuesday between March 15–21)" value={firstFour} onChange={(e) => setFirstFour(e.target.value)} />
        )}
        {msg && <span className="cal-note">{msg}</span>}
      </div> : null}
      <div className="cal-note">
        {a.format === "march_madness"
          ? "ESPN fills in every tournament game (First Four through the title) with scores, finals and rounds. "
          : a.format === "nfl_playoffs"
            ? "ESPN fills in scores and finals. "
            : "ESPN fills in every College Football Playoff game with scores, finals and rounds. "}
        Its line (when ESPN has one) is kept from before kickoff as the closing line — ESPN drops it once a game ends, so sync at least once before each game, or type the line in.
        A typed line is never overwritten.
        {missingLines > 0 && <b className="bad"> {missingLines} final game{missingLines === 1 ? "" : "s"} missing a line — Best ATS can't settle.</b>}
      </div>
      {games.length > 0 && (
        <table className="cal-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Away</th>
              <th className="r">Score</th>
              <th>Home</th>
              <th className="r">Score</th>
              <th className="r">Home line</th>
              <th>Final</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const h = team(g.homeId);
              const w = team(g.awayId);
              return (
                <tr key={g.id}>
                  <td>{roundLabels[g.round + roundOffset] ?? g.round}</td>
                  <td>{w ? `${seedLabel(w)} ${w.abbr}` : g.awayId}</td>
                  <td className="r">
                    <NumField value={g.awayScore ?? 0} onCommit={(v) => update(g.id, { awayScore: v })} width={56} />
                  </td>
                  <td>
                    {h ? `${seedLabel(h)} ${h.abbr}` : g.homeId}
                    {g.neutral ? " (neutral)" : ""}
                  </td>
                  <td className="r">
                    <NumField value={g.homeScore ?? 0} onCommit={(v) => update(g.id, { homeScore: v })} width={56} />
                  </td>
                  <td className="r">
                    <input
                      className="cal-input"
                      style={{ width: 70, textAlign: "right" }}
                      defaultValue={g.homeSpread ?? ""}
                      key={String(g.homeSpread)}
                      placeholder="—"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const n = v === "" ? null : Number(v);
                        if (v !== "" && !Number.isFinite(n)) return;
                        if (n !== g.homeSpread) update(g.id, { homeSpread: n, lineManual: n != null });
                      }}
                    />
                    {g.lineManual && <span className="cal-note"> typed</span>}
                  </td>
                  <td>
                    <input type="checkbox" checked={g.final} onChange={(e) => update(g.id, { final: e.target.checked })} />
                  </td>
                  <td className="r">
                    <button className="cal-btn sm" onClick={() => window.confirm("Remove this game?") && setGames((gs) => gs.filter((x) => x.id !== g.id))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="cal-row">
        <span className="cal-note">Add by hand:</span>
        <select className="cal-input" value={draft.round} onChange={(e) => setDraft({ ...draft, round: Number(e.target.value) })}>
          {roundLabels.map((l, i) => (
            <option key={l} value={i - roundOffset}>
              {l}
            </option>
          ))}
        </select>
        <select className="cal-input" value={draft.awayId} onChange={(e) => setDraft({ ...draft, awayId: e.target.value })}>
          <option value="">Away…</option>
          {a.field.map((t) => (
            <option key={t.id} value={t.id}>
              {seedLabel(t)} {t.name}
            </option>
          ))}
        </select>
        <span className="cal-note">at</span>
        <select className="cal-input" value={draft.homeId} onChange={(e) => setDraft({ ...draft, homeId: e.target.value })}>
          <option value="">Home…</option>
          {a.field.map((t) => (
            <option key={t.id} value={t.id}>
              {seedLabel(t)} {t.name}
            </option>
          ))}
        </select>
        <button className="cal-btn" onClick={addManual} disabled={!draft.homeId || !draft.awayId}>
          Add game
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Field editors: CFB playoff (seed list) and March Madness (paste)
// ---------------------------------------------------------------------------

const FBS_NAMES = TEAMS.filter((t) => t.div === "FBS")
  .map((t) => t.team)
  .sort();

function CfbFieldEditor({ a, patch, started }: { a: CalcuttaAuction; patch: Patch; started: boolean }) {
  const def = formatDef(a.format);
  const names = seedNamesFromField(a.format, a.field);
  const [msg, setMsg] = useState<string | null>(null);
  const setSeed = (i: number, raw: string) => {
    const name = FBS_NAMES.find((n) => n.toLowerCase() === raw.trim().toLowerCase()) ?? (raw.trim() || null);
    const next = names.map((n, j) => (j === i ? name : n === name && name ? null : n));
    patch(() => ({ field: cfbFieldFromSeeds(a.format, next) }));
  };
  const fillFromProjection = async () => {
    setMsg("Loading the latest Monte Carlo run…");
    try {
      const now = new Date();
      const season = now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
      const runs = await fetchMonteCarloRuns(season);
      if (!runs.length) return setMsg(`No Monte Carlo runs saved for ${season}.`);
      const run = await fetchMonteCarloRun(runs[0].id);
      const seeds = deriveBracketSeeds((run as any)?.results, def.fieldSize);
      if (seeds.length < def.fieldSize) return setMsg(`That run only projects ${seeds.length} playoff teams.`);
      patch(() => ({ field: cfbFieldFromSeeds(a.format, seeds) }));
      setMsg(`Filled from the week ${runs[0].week} Monte Carlo projection (highest playoff odds, ordered by average seed). Adjust any seed by hand.`);
    } catch (e: any) {
      setMsg(`Couldn't load the projection: ${e?.message ?? e}`);
    }
  };
  const unknown = names.filter((n) => n && !FBS_NAMES.includes(n));
  const half = Math.ceil(def.fieldSize / 2);
  return (
    <section className="cal-card">
      <div className="cal-row" style={{ justifyContent: "space-between" }}>
        <h2>Playoff field</h2>
        <button className="cal-btn" onClick={fillFromProjection} disabled={started}>
          Fill from latest projection
        </button>
      </div>
      {msg && <div className="cal-note">{msg}</div>}
      {started && <div className="cal-note warn">Bidding has started — changing the field now won't touch lots already sold.</div>}
      <datalist id="cal-fbs-teams">
        {FBS_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="cal-grid2">
        {[0, 1].map((col) => (
          <div key={col}>
            {names.slice(col * half, (col + 1) * half).map((n, k) => {
              const i = col * half + k;
              const t = a.field.find((x) => x.seed === i + 1);
              return (
                <div key={i} className="cal-row tight">
                  <span className="cal-seed">{i + 1}</span>
                  <input className="cal-input" list="cal-fbs-teams" defaultValue={n ?? ""} key={n ?? `empty-${i}`} placeholder="Team…" onBlur={(e) => e.target.value.trim() !== (n ?? "") && setSeed(i, e.target.value)} style={{ minWidth: 220 }} />
                  {t && <TeamBadge team={t} size={20} />}
                  <span className="cal-note">
                    {t?.note ?? ""}
                    {i < def.byeCount ? " · bye" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {unknown.length > 0 && <div className="cal-note warn">Not an FBS team name the site knows (no logo or ratings): {unknown.join(", ")}</div>}
    </section>
  );
}

function MadnessFieldEditor({ a, patch, started }: { a: CalcuttaAuction; patch: Patch; started: boolean }) {
  const regions = regionOrder(a.field, a.regions);
  const [text, setText] = useState(() => (a.field.length ? madnessFieldToText(a.field, regions) : ""));
  const parsed = useMemo(() => parseMadnessField(text), [text]);
  const problem = validateField("march_madness", parsed.field, parsed.regions);
  const playIns = parsed.field.filter((t) => parsed.field.filter((x) => x.group === t.group && x.seed === t.seed).length === 2).length / 2;
  const apply = () => patch(() => ({ field: parsed.field, regions: parsed.regions }));
  const [espnBusy, setEspnBusy] = useState(false);
  const [espnMsg, setEspnMsg] = useState<string | null>(null);
  const [espnYear, setEspnYear] = useState("");
  // After Selection Sunday ESPN lists every First Four and Round of 64 game with
  // seeds and regions, so the whole bracket (with ESPN ids and logos) comes from there.
  const fillFromEspn = async () => {
    setEspnBusy(true);
    setEspnMsg(null);
    try {
      const days = madnessDays(espnYear, "").slice(0, 6); // First Four + Round of 64 (+ R32 to catch play-in winners)
      const { games } = await fetchScoreboard(`league=cbb&dates=${days.join(",")}`);
      const built = madnessFieldFromEspn(games as any);
      if (!built.field.length) {
        setEspnMsg("ESPN doesn't have that tournament's games yet — the bracket comes out on Selection Sunday.");
        return;
      }
      patch(() => ({ field: built.field, regions: built.regions }));
      setText(madnessFieldToText(built.field, built.regions));
      setEspnMsg(`Loaded ${built.field.length} teams from ESPN.${built.errors.length ? " " + built.errors.join(" ") : ""} Check the Final Four pairing.`);
    } catch (e: any) {
      setEspnMsg(`ESPN failed: ${e?.message ?? e}`);
    } finally {
      setEspnBusy(false);
    }
  };
  const moveRegion = (i: number, d: -1 | 1) => {
    const next = [...regions];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    patch(() => ({ regions: next }));
  };
  return (
    <section className="cal-card">
      <h2>Bracket</h2>
      {started && <div className="cal-note warn">Bidding has started — changing the field now won't touch lots already sold.</div>}
      <div className="cal-grid2">
        <div>
          <textarea
            className="cal-input"
            style={{ width: "100%", minHeight: 320, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"East\n1 Duke\n16 American\n16 Mount St. Mary's\n8 Mississippi State\n…\n\nor one per line: South 1 Auburn"}
            spellCheck={false}
          />
          <div className="cal-row">
            <button className="cal-btn primary" onClick={apply} disabled={parsed.field.length === 0}>
              Use this bracket ({parsed.field.length} teams, {playIns} First Four)
            </button>
            <button className="cal-btn" onClick={fillFromEspn} disabled={espnBusy || started}>
              {espnBusy ? "Loading ESPN…" : "Fill bracket from ESPN"}
            </button>
            <input className="cal-input" placeholder="Year (blank = upcoming)" value={espnYear} onChange={(e) => setEspnYear(e.target.value)} style={{ width: 150 }} />
          </div>
          {espnMsg && <div className="cal-note">{espnMsg}</div>}
        </div>
        <div>
          <div className="cal-note">
            Paste the bracket: a region name on its own line, then "seed team" lines — or "Region seed team" on every line. Two teams on the same seed line in a region are a First Four pair (they
            sell as one lot). Numbers after a name (ratings, records) are ignored.
          </div>
          {parsed.errors.map((e) => (
            <div key={e} className="cal-note warn">
              {e}
            </div>
          ))}
          {text.trim() && <div className={`cal-note ${problem ? "warn" : "good"}`}>{problem ?? "✓ Full bracket"}</div>}
          {regions.length > 0 && (
            <>
              <h3>Final Four pairing</h3>
              {regions.map((r, i) => (
                <div key={r} className="cal-row tight">
                  <span className="cal-seed">{i + 1}</span>
                  <span style={{ minWidth: 120 }}>{r}</span>
                  <button className="cal-btn sm" onClick={() => moveRegion(i, -1)}>
                    ↑
                  </button>
                  <button className="cal-btn sm" onClick={() => moveRegion(i, 1)}>
                    ↓
                  </button>
                </div>
              ))}
              <div className="cal-note">Region 1 plays region 2, region 3 plays region 4.</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Practice against bots
// ---------------------------------------------------------------------------

function PracticeTab({ a, act, patch, onOpen }: { a: CalcuttaAuction; act: Act; patch: Patch; onOpen: (id: string) => void }) {
  const fieldErr = validateField(a.format, a.field, a.regions);
  const human = a.participants.find((p) => !p.bot);
  const [meName, setMeName] = useState(human?.name ?? "Me");
  const [count, setCount] = useState(6);
  const [secrets, setSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const sport = formatDef(a.format).sport;
  const siteCfb = useSiteCfb(a.field, sport === "cfb");

  // The bots (and the report) start from YOUR ratings: the site's power ratings
  // for CFB, the Desk's pasted ones otherwise, or typical-by-seed if you have none.
  const yours = useMemo(() => {
    if (sport === "cfb" && Object.keys(siteCfb.ratings).length) return siteCfb.ratings;
    return savedRatings(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.field, siteCfb.ratings, sport]);
  const ratingSource =
    sport === "cfb" && Object.keys(siteCfb.ratings).length
      ? `the site's power ratings (${siteCfb.week ?? "latest"})`
      : yours
        ? "your Desk ratings"
        : sport === "cfb" && siteCfb.loading
          ? "the site's power ratings (loading…)"
          : "typical ratings by seed (no ratings found)";

  if (!a.practice?.enabled) {
    return (
      <section className="cal-card">
        <h2>Practice against bots</h2>
        <p className="cal-note">
          Makes a separate practice auction with this one's rules, payouts, field and lots — just you plus bot bidders. Your real auction isn't touched, and practice auctions stay on this
          computer (no cloud, not in bidding history).
        </p>
        {fieldErr && <div className="cal-note warn">Finish the field first: {fieldErr}</div>}
        <div className="cal-row">
          <span className="cal-note">You bid as</span>
          <input className="cal-input" value={meName} onChange={(e) => setMeName(e.target.value)} />
          <button
            className="cal-btn primary"
            disabled={!!fieldErr || a.lots.length === 0 || busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => {
                const now = Date.now();
                let copy = practiceCopy(a, meName.trim() || "Me", now);
                copy = addBots(copy, count, botBaseRatings(copy, yours), now).auction;
                copy = { ...copy, practice: { ...copy.practice!, expectedPot: Math.max(200, (count + 1) * 150) } };
                writeAuction(copy, { cloud: false });
                setBusy(false);
                onOpen(copy.id);
              }, 20);
            }}
          >
            {busy ? "Building bots…" : `Create practice auction with ${count} bots`}
          </button>
          <select className="cal-input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n} bots
              </option>
            ))}
          </select>
        </div>
        <div className="cal-note">Bots value teams from {ratingSource}, each with its own noise, so they disagree with you and with each other.</div>
      </section>
    );
  }

  const bots = a.participants.filter((p) => p.bot);
  const meId = human?.id ?? null;
  const reroll = () => {
    setBusy(true);
    setTimeout(() => {
      act((x, now) => {
        const base = resetForReplay({ ...x, participants: x.participants.filter((p) => !p.bot) }, now);
        return addBots(base, bots.length || count, botBaseRatings(base, yours), now);
      });
      setBusy(false);
    }, 20);
  };

  return (
    <>
      <section className="cal-card">
        <div className="cal-row" style={{ justifyContent: "space-between" }}>
          <h2>Practice auction</h2>
          <div className="cal-row tight">
            <button className="cal-btn primary" onClick={() => openStageWindow(a.id)}>
              Open Stage ↗
            </button>
            <button className="cal-btn" onClick={() => openDeskWindow(a.id)}>
              Open Desk ↗
            </button>
          </div>
        </div>
        <ol className="cal-steps">
          <li>Open the Stage and the Desk (pick yourself under "Me" on the Desk).</li>
          <li>
            Press <b>Enter</b> on the Stage to open the first lot. Bid for yourself with your key ({human?.hotkey.toUpperCase()}).
          </li>
          <li>
            {(a.practice.botMode ?? "call") === "call"
              ? "Bots call out their bids (on screen and out loud) — enter each one with that bot's key, typing the amount first if they jump. Miss the window and it's logged."
              : "Bots place their own bids."}{" "}
            {a.practice.autoAdvance ? "Auto-advance starts the clock, sells and opens the next lot for you." : "You start (Space), sell (Enter) and open the next lot (Enter) yourself."}
          </li>
          <li>When it's done, the report below shows who overpaid and how your portfolio would do.</li>
        </ol>
        <div className="cal-form" style={{ maxWidth: 640 }}>
          <label>Bots</label>
          <span className="cal-row tight">
            <select className="cal-input" value={a.practice.botMode ?? "call"} onChange={(e) => patch((x) => ({ practice: { ...x.practice!, botMode: e.target.value as "call" | "auto" } }))}>
              <option value="call">Call out bids — I enter them (auctioneer practice)</option>
              <option value="auto">Bid by themselves (bidding practice)</option>
            </select>
            {(a.practice.botMode ?? "call") === "call" && (
              <>
                <label className="cal-toggle">
                  <input type="checkbox" checked={a.practice.speak !== false} onChange={(e) => patch((x) => ({ practice: { ...x.practice!, speak: e.target.checked } }))} /> Say bids out loud
                </label>
                <span className="cal-note">window</span>
                <NumField value={a.practice.callWindow ?? 4} onCommit={(v) => patch((x) => ({ practice: { ...x.practice!, callWindow: Math.max(1, Math.min(15, v)) } }))} suffix="sec" width={56} />
              </>
            )}
          </span>
          {a.practice.stats && (
            <>
              <label>Your entry</label>
              <span>
                {a.practice.stats.entered}/{a.practice.stats.calls} called bids entered · avg{" "}
                {a.practice.stats.entered ? (a.practice.stats.reactionMsTotal / a.practice.stats.entered / 1000).toFixed(1) : "—"}s · {a.practice.stats.wrongAmount} wrong amount ·{" "}
                {a.practice.stats.wrongBidder} wrong bidder · {a.practice.stats.missed} missed{" "}
                <button className="cal-btn sm" onClick={() => patch((x) => ({ practice: { ...x.practice!, stats: undefined } }))}>
                  Reset
                </button>
              </span>
            </>
          )}
          <label>Auto-advance</label>
          <label className="cal-toggle">
            <input type="checkbox" checked={a.practice.autoAdvance} onChange={(e) => patch((x) => ({ practice: { ...x.practice!, autoAdvance: e.target.checked } }))} /> Start clock, sell at 0:00 and open the next lot automatically
          </label>
          <label>Room size the bots expect</label>
          <span>
            <NumField
              value={a.practice.expectedPot}
              onCommit={(v) => patch((x) => ({ practice: { ...x.practice!, expectedPot: Math.max(50, v) }, participants: x.participants.map((p) => (p.bot ? { ...p, bot: { ...p.bot, potGuess: p.bot.potGuess * (Math.max(50, v) / Math.max(1, x.practice!.expectedPot)) } } : p)) }))}
              suffix="$ pot"
              width={90}
            />
            <span className="cal-note"> each bot guesses ±25% around this, then follows the room's pace</span>
          </span>
          <label>Clock</label>
          <span className="cal-note">
            {a.settings.timerStart}s to open, {a.settings.timerReset}s after each bid (change on Rules &amp; Payouts)
          </span>
        </div>
        <div className="cal-row">
          <button className="cal-btn" onClick={() => window.confirm("Start over with the same bots? Every bid and sale is cleared.") && act((x, now) => ({ auction: resetForReplay(x, now) }))}>
            Replay with the same bots
          </button>
          <button className="cal-btn" disabled={busy} onClick={() => window.confirm("Start over with brand-new bots?") && reroll()}>
            {busy ? "Building bots…" : "New bots"}
          </button>
          <span className="cal-note">Bots value teams from {ratingSource}.</span>
        </div>
      </section>

      <section className="cal-card">
        <div className="cal-row" style={{ justifyContent: "space-between" }}>
          <h2>The bots</h2>
          <label className="cal-toggle">
            <input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} /> Show their secrets (pet teams, budgets, pot guesses)
          </label>
        </div>
        <table className="cal-table">
          <tbody>
            {bots.map((p) => {
              const meta = BOT_STYLES.find((b) => b.style === p.bot!.style);
              return (
                <tr key={p.id}>
                  <td style={{ color: p.color, fontWeight: 700 }}>🤖 {p.name}</td>
                  <td>{meta?.blurb}</td>
                  <td className="cal-note">
                    {secrets &&
                      [
                        `pot guess ${fmt$(p.bot!.potGuess)}`,
                        p.bot!.favorites.length ? `pets: ${p.bot!.favorites.map((id) => a.field.find((t) => t.id === id)?.name ?? id).join(", ")}` : null,
                        p.bot!.budget != null ? `budget ${fmt$(p.bot!.budget)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {a.lots.some((l) => l.status === "sold") && (
        <div className="cal-note">🎲 To play the playoffs out and watch the payouts land, use <b>Sim the playoffs</b> on the Owners &amp; Results tab.</div>
      )}
      {a.lots.some((l) => l.status === "sold") && <PracticeReport a={a} meId={meId} yours={yours} />}
    </>
  );
}

function PracticeReport({ a, meId, yours }: { a: CalcuttaAuction; meId: string | null; yours: Record<string, { rating: number }> | null }) {
  const [playout, setPlayout] = useState<number | null>(null);
  const def = formatDef(a.format);
  const soldKey = a.lots.map((l) => `${l.id}:${l.status}:${l.price}:${l.winnerId}`).join("|");
  const sim = useMemo(
    () =>
      simulateBracket({
        format: a.format,
        field: a.field,
        regions: a.regions,
        ratings: botBaseRatings(a, yours),
        hfa: def.sim.hfa,
        marginSd: def.sim.marginSd,
        ratingNoise: def.sim.ratingNoise,
        useSourceSd: false,
        sims: 10000,
        seed: 777,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.id, JSON.stringify(a.field), JSON.stringify(yours)],
  );
  const matrix = useMemo(() => payoutMatrix(sim, a), [sim, a.payouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const shares = useMemo(() => fairShares(sim, matrix), [sim, matrix]);
  void soldKey;
  const pot = potTotal(a);
  const done = a.status === "complete";
  // Mid-auction, value everything at the projected final pot, not the partial one.
  const finalPot = done ? pot : projectPot(a, shares, a.practice?.expectedPot ?? pot).projected;
  const np = finalPot * (1 - (a.settings.rakePct || 0) / 100);
  const T = sim.teamIds.length;
  const col = new Map(sim.teamIds.map((id, i) => [id, i]));
  const rows = a.participants
    .map((p) => {
      const won = a.lots.filter((l) => l.status === "sold" && l.winnerId === p.id);
      const spent = won.reduce((s, l) => s + (l.price ?? 0), 0);
      const fair = won.reduce((s, l) => s + (lotShare(l, shares) / 100) * np, 0);
      const port = portfolio(a, sim, matrix, p.id, np);
      const payout = playout == null ? null : won.reduce((s, l) => s + l.teamIds.reduce((x, id) => x + (matrix[playout * T + (col.get(id) ?? 0)] / 100) * np, 0), 0);
      return { p, won: won.length, spent, fair, port, payout };
    })
    .sort((x, y) => y.port.ev - y.port.cost - (x.port.ev - x.port.cost));
  const champ = playout == null ? null : sim.teamIds.find((id, i) => sim.rc[playout * T + i] === sim.rounds);

  return (
    <section className="cal-card">
      <div className="cal-row" style={{ justifyContent: "space-between" }}>
        <h2>How it went</h2>
        <div className="cal-row tight">
          <button className="cal-btn" onClick={() => setPlayout(Math.floor(Math.random() * sim.sims))}>
            🎲 Play out the tournament
          </button>
          {playout != null && <span className="cal-note">Champion: {a.field.find((t) => t.id === champ)?.name ?? "?"}</span>}
        </div>
      </div>
      <div className="cal-note">
        Pot {fmt$(pot)}
        {done ? "" : ` so far (projected final ${fmt$(finalPot)})`}. "Fair" uses the same ratings the bots started from (before their noise), at the {done ? "final" : "projected"} pot. EV and P(profit) are from {sim.sims.toLocaleString()} simulated tournaments.
      </div>
      <table className="cal-table">
        <thead>
          <tr>
            <th>Bidder</th>
            <th className="r">Teams</th>
            <th className="r">Spent</th>
            <th className="r">Fair value bought</th>
            <th className="r">Paid / fair</th>
            <th className="r">EV</th>
            <th className="r">P(profit)</th>
            {playout != null && <th className="r">This playout</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.p.id} style={r.p.id === meId ? { fontWeight: 700 } : undefined}>
              <td style={{ color: r.p.color }}>
                {r.p.bot ? "🤖 " : "⭐ "}
                {r.p.name}
              </td>
              <td className="r">{r.won}</td>
              <td className="r">{fmt$(r.spent)}</td>
              <td className="r">{fmt$(r.fair)}</td>
              <td className={`r ${r.spent && r.fair ? (r.spent / r.fair > 1 ? "bad" : "good") : ""}`}>{r.spent && r.fair ? `${Math.round((r.spent / r.fair) * 100)}%` : "—"}</td>
              <td className={`r ${r.port.ev >= r.port.cost ? "good" : "bad"}`}>{fmt$(r.port.ev)}</td>
              <td className="r">{r.won ? `${Math.round(r.port.pProfit * 100)}%` : "—"}</td>
              {playout != null && <td className={`r ${(r.payout ?? 0) >= r.spent ? "good" : "bad"}`}>{fmt$(r.payout, 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The tournament's game days: from a First Four date, or the usual Tuesday of the given (or upcoming) March. */
function madnessDays(season: string, firstFour: string): string[] {
  if (/^\d{4}-\d{2}-\d{2}$/.test(firstFour)) return madnessGameDays(new Date(`${firstFour}T00:00:00Z`));
  const now = new Date();
  const year = /^\d{4}$/.test(season.trim()) ? Number(season.trim()) : now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  return madnessGameDays(guessFirstFour(year));
}

/** Practice: play the tournament out round by round and watch the payouts land. */
function SimPlayoffsCard({ a, act, patch, yours, meId }: { a: CalcuttaAuction; act: Act; patch: Patch; yours: Record<string, { rating: number }> | null; meId: string | null }) {
  const def = formatDef(a.format);
  const d = deriveFromGames({ ...a, autoScore: true });
  const games = a.games ?? [];
  const played = games.filter((g) => g.final).length;
  const champ = a.field.find((t) => t.id === d.championId);
  const rows = ownerSummaries(a)
    .filter((s) => s.owed || s.lots.length)
    .sort((x, y) => y.net - x.net);
  const nextRound = (() => {
    for (let r = a.format === "march_madness" ? -1 : 0; r < def.rounds.length; r++) {
      const label = r < 0 ? "First Four" : def.rounds[r].game;
      const done = games.filter((g) => g.round === r && g.final).length;
      const need = r < 0 ? a.field.filter((t) => a.field.filter((x) => x.group === t.group && x.seed === t.seed).length === 2).length / 2 : def.rounds[r].slots;
      if (done < need) return label;
    }
    return null;
  })();
  const sim = (mode: "round" | "rest") => act((x, now) => simulatePlayoffGames(x, botBaseRatings(x, yours), mode, now));
  return (
    <section className="cal-card">
      <div className="cal-row" style={{ justifyContent: "space-between" }}>
        <h2>Sim the playoffs</h2>
        <div className="cal-row tight">
          <button className="cal-btn primary" disabled={!nextRound} onClick={() => sim("round")}>
            {nextRound ? `Sim ${nextRound}` : "All played"}
          </button>
          <button className="cal-btn" disabled={!nextRound} onClick={() => sim("rest")}>
            Sim the rest
          </button>
          <button className="cal-btn" disabled={!games.length} onClick={() => window.confirm("Clear the simulated games?") && patch(() => ({ games: [], results: {} }))}>
            Clear games
          </button>
        </div>
      </div>
      <div className="cal-note">
        Plays games out from the same ratings the bots used, with scores and closing lines, into the game log (auto-scoring on) — so Owners &amp; Results, the Stage board (press /) and
        the payouts below update like the real playoffs. {played ? `${played} games played.` : ""} {champ ? `🏆 ${champ.name} won it all.` : ""}
      </div>
      {played > 0 && (
        <table className="cal-table">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Teams</th>
              <th className="r">Paid</th>
              <th className="r">Won so far</th>
              <th className="r">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.participant.id} style={s.participant.id === meId ? { fontWeight: 700 } : undefined}>
                <td style={{ color: s.participant.color }}>
                  {s.participant.bot ? "🤖 " : "⭐ "}
                  {s.participant.name}
                </td>
                <td>
                  {s.lots.map((x) => {
                    const out = lotTeams(a, x.lot).every((t) => d.results[t.id]?.eliminated);
                    return (
                      <span key={x.lot.id} className="cal-chip" style={out ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                        <LotLogos auction={a} lot={x.lot} size={16} /> {lotName(a, x.lot)}
                        {x.earned > 0 ? ` ${fmt$(x.earned, 2)}` : ""}
                      </span>
                    );
                  })}
                </td>
                <td className="r">{fmt$(s.cost)}</td>
                <td className="r">{fmt$(s.earned, 2)}</td>
                <td className={`r ${s.net >= 0 ? "good" : "bad"}`}>{fmt$(s.net, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Owners & Results (practice auctions): the playoff sim, using the same ratings the bots started from. */
function SimPlayoffsSection({ a, act, patch }: { a: CalcuttaAuction; act: Act; patch: Patch }) {
  const sport = formatDef(a.format).sport;
  const siteCfb = useSiteCfb(a.field, sport === "cfb");
  const yours = useMemo(() => {
    if (sport === "cfb" && Object.keys(siteCfb.ratings).length) return siteCfb.ratings;
    return savedRatings(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.field, siteCfb.ratings, sport]);
  const meId = a.participants.find((p) => !p.bot)?.id ?? null;
  return <SimPlayoffsCard a={a} act={act} patch={patch} yours={yours} meId={meId} />;
}
