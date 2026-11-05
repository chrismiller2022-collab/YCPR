import { useEffect, useMemo, useState } from "react";
import "../styles/calcutta.css";
import { NFL_TEAMS } from "../data/nflTeams";
import {
  addParticipant,
  addTransfer,
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
      <button className="back-link" onClick={auction ? () => select(null) : onBack}>
        ‹ {auction ? "All auctions" : "Pools"}
      </button>
      {auction ? <AuctionEditor auction={auction} /> : <AuctionList onOpen={select} />}
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

type Tab = "setup" | "attendees" | "field" | "owners" | "log";

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

function AuctionEditor({ auction: a }: { auction: CalcuttaAuction }) {
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
          <button className="cal-btn" onClick={() => saveToCloud(a.id)}>
            Save to cloud
          </button>
          <button className="cal-btn" onClick={() => openDeskWindow(a.id)} disabled={a.format !== "nfl_playoffs" || a.field.length < 14} title="Private model — keep it on the monitor you don't share">
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
    </>
  );
}

function ReadinessChecklist({ a, onGo }: { a: CalcuttaAuction; onGo: (t: Tab) => void }) {
  if (a.status !== "setup") return null;
  const total = payoutTotalPct(a.format, a.payouts, a.field);
  const items: [boolean, string, Tab][] = [
    [Math.abs(total - 100) < 0.01, `Payouts add to 100% (now ${total}%)`, "setup"],
    [a.participants.length >= 2, "At least 2 attendees", "attendees"],
    [a.field.length === 14, `Full field: 14 teams (now ${a.field.length})`, "field"],
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
                    <NumField value={pct} step={0.5} onCommit={(v) => setPay({ roundPct: { ...a.payouts.roundPct, [r.key]: v } })} suffix="%" width={64} />
                  </td>
                  <td className="r">× {slots}</td>
                  <td className="r">{Math.round(pct * slots * 100) / 100}%</td>
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
              <td className={`r ${Math.abs(total - 100) < 0.01 ? "good" : "bad"}`}>
                <b>{total}%</b>
              </td>
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
    for (const x of all) for (const p of x.participants) names.add(p.name);
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
    if (!/^[a-z]$/.test(k)) return;
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
      <div className="cal-note">The hotkey is the letter you press on the Stage to bid for that person. Use the same name each year so bidding history lines up.</div>
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
  const stale = a.lots.filter((l) => l.teamIds.some((id) => !a.field.some((t) => t.id === id)));

  return (
    <>
      {a.format === "nfl_playoffs" && (
        <section className="cal-card">
          <h2>Playoff field</h2>
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

      <section className="cal-card">
        <h2>Lots &amp; auction order</h2>
        <div className="cal-row">
          <span className="cal-note">Build one lot per team:</span>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("seed")}>
            By seed (1s first)
          </button>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("seed_desc")}>
            By seed (7s first)
          </button>
          <button className="cal-btn" disabled={started || a.field.length === 0} onClick={() => build("random")}>
            Random
          </button>
        </div>
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

const NFL_RESULT_OPTIONS = [
  { rounds: 0, elim: false, label: "Alive — Wild Card" },
  { rounds: 0, elim: true, label: "Lost Wild Card" },
  { rounds: 1, elim: false, label: "Alive — Divisional" },
  { rounds: 1, elim: true, label: "Lost Divisional" },
  { rounds: 2, elim: false, label: "Alive — Conf. Championship" },
  { rounds: 2, elim: true, label: "Lost Conf. Championship" },
  { rounds: 3, elim: false, label: "In Super Bowl" },
  { rounds: 3, elim: true, label: "Lost Super Bowl" },
  { rounds: 4, elim: false, label: "Champion" },
];

function OwnersTab({ a, act, patch }: { a: CalcuttaAuction; act: Act; patch: Patch }) {
  const summaries = ownerSummaries(a).filter((s) => s.owed || s.lots.length || s.participant.paid);
  const pot = potTotal(a);
  const np = netPot(a);
  const soldLots = sortedLots(a).filter((l) => l.status === "sold");
  const paidOut = summaries.reduce((s, x) => s + x.earned, 0);

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

      <section className="cal-card">
        <h2>Results</h2>
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
                const res = a.results[t.id] ?? { roundsCleared: t.bye ? 1 : 0, eliminated: false };
                const earned = teamEarned(a, t.id);
                const pct = earned.reduce((s, e) => s + e.pct, 0);
                const lot = a.lots.find((l) => l.teamIds.includes(t.id));
                const holders = lot ? lotHoldings(a, lot) : [];
                const opts = NFL_RESULT_OPTIONS.filter((o) => !t.bye || o.rounds >= 1);
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
                        value={`${res.roundsCleared}:${res.eliminated ? 1 : 0}`}
                        onChange={(e) => {
                          const [r, el] = e.target.value.split(":").map(Number);
                          patch((x) => ({ results: { ...x.results, [t.id]: { roundsCleared: r, eliminated: !!el } } }));
                        }}
                      >
                        {opts.map((o) => (
                          <option key={o.label} value={`${o.rounds}:${o.elim ? 1 : 0}`}>
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
              const winners = propWinners(p);
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
                  </div>
                  <div className="cal-prop-teams">
                    {[...a.field]
                      .sort((x, y) => x.group.localeCompare(y.group) || (x.seed ?? 0) - (y.seed ?? 0))
                      .map((t) => (
                        <label key={t.id} className={`cal-prop-team ${winners.includes(t.id) ? "on" : ""}`} title={t.name}>
                          <input type="checkbox" checked={winners.includes(t.id)} onChange={() => toggle(t.id)} />
                          <TeamBadge team={t} size={18} /> {t.abbr}
                        </label>
                      ))}
                  </div>
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
