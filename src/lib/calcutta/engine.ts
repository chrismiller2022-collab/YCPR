import { formatDef } from "./formats";
import { scored } from "./scoring";
import type { Bid, CalcuttaAuction, CalcuttaSettings, FieldTeam, FormatKey, Lot, LiveState, Participant } from "./types";
export type { FieldTeam };

// Pure auction logic. Every function takes an auction and returns a new one
// (never mutates), plus an error string when the action was refused, so
// the Stage can flash the reason ("Below minimum $55") instead of silently
// doing nothing. All timing takes `now` as an argument so it's testable.

export interface Result {
  auction: CalcuttaAuction;
  error?: string;
}

const ok = (auction: CalcuttaAuction): Result => ({ auction });
const fail = (auction: CalcuttaAuction, error: string): Result => ({ auction, error });

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const DEFAULT_SETTINGS: CalcuttaSettings = {
  openingMin: 10,
  increments: [
    { upTo: 100, step: 5 },
    { upTo: 500, step: 10 },
    { upTo: null, step: 25 },
  ],
  timerStart: 30,
  timerReset: 15,
  goingOnceAt: 10,
  goingTwiceAt: 5,
  autoSell: false,
  noBidAction: "requeue",
  rakePct: 0,
  sound: true,
};

export const PARTICIPANT_COLORS = [
  "#e4572e", "#29a3d9", "#f2b134", "#4caf50", "#a463f2", "#ef6fa8", "#17bebb", "#ff8c42",
  "#7d8cf0", "#c0ca33", "#ff5d73", "#5bc0be", "#d4a373", "#9b5de5", "#00bbf9", "#f15bb5",
];

const IDLE: LiveState = { lotId: null, phase: "idle", endsAt: null, remainingMs: null };

export function newAuction(name: string, format: FormatKey, now: number): CalcuttaAuction {
  const def = formatDef(format);
  return {
    id: uid("cal_"),
    name,
    format,
    status: "setup",
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, increments: DEFAULT_SETTINGS.increments.map((t) => ({ ...t })), maxTeams: def.defaultMaxTeams ?? 0 },
    payouts: { ...def.defaultPayouts, roundPct: { ...def.defaultPayouts.roundPct }, props: def.defaultPayouts.props.map((p) => ({ ...p, id: uid("prop_"), teamIds: [] })) },
    participants: [],
    field: [],
    lots: [],
    bids: [],
    transfers: [],
    results: {},
    live: { ...IDLE },
  };
}

const touch = (a: CalcuttaAuction, now: number, patch: Partial<CalcuttaAuction>): CalcuttaAuction => ({ ...a, ...patch, updatedAt: now });

// ---- participants ----------------------------------------------------------

/** First free letter of the name, else the first free letter of the alphabet. */
/** Lots this attendee has won so far (a bundle counts as one). */
export function teamsWon(a: CalcuttaAuction, participantId: string): number {
  return a.lots.filter((l) => l.status === "sold" && l.winnerId === participantId).length;
}

/** True once an attendee has hit the max-teams rule (if one is set). */
export function atTeamCap(a: CalcuttaAuction, participantId: string): boolean {
  const cap = a.settings.maxTeams || 0;
  return cap > 0 && teamsWon(a, participantId) >= cap;
}

/** Keys an attendee can be bound to: a letter or a digit. */
export const HOTKEY_RE = /^[a-z0-9]$/;

/** Bow an attendee out of (or back into) the lot on the block. The high bidder can't bow out. */
export function toggleOut(a: CalcuttaAuction, participantId: string, now: number): Result {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live" || a.live.phase === "sold") return fail(a, "No lot is open");
  const p = participantById(a, participantId);
  if (!p) return fail(a, "Unknown bidder");
  const out = a.live.outIds ?? [];
  if (out.includes(participantId)) return ok(touch(a, now, { live: { ...a.live, outIds: out.filter((x) => x !== participantId) } }));
  if (highBid(a, lot.id)?.participantId === participantId) return fail(a, `${p.name} has the high bid — undo it first`);
  return ok(touch(a, now, { live: { ...a.live, outIds: [...out, participantId] } }));
}

/** True when nobody but the high bidder is still in (everyone else bowed out). */
export function onlyHighBidderLeft(a: CalcuttaAuction, extraOut: string[] = []): boolean {
  const high = highBid(a, a.live.lotId);
  if (!high) return false;
  const out = new Set([...(a.live.outIds ?? []), ...extraOut]);
  return a.participants.every((p) => p.id === high.participantId || out.has(p.id));
}

/** Rebind every attendee: letters from their names, or 1–9 then 0 in list order. */
export function rebindHotkeys(a: CalcuttaAuction, mode: "letters" | "numbers", now: number): Result {
  const taken: string[] = [];
  const digits = "1234567890";
  const participants = a.participants.map((p, i) => {
    const key = mode === "numbers" ? digits[i] ?? autoHotkey(p.name, taken) : autoHotkey(p.name, taken);
    taken.push(key);
    return { ...p, hotkey: key };
  });
  return ok(touch(a, now, { participants }));
}

export function autoHotkey(name: string, taken: string[]): string {
  const used = new Set(taken.map((k) => k.toLowerCase()));
  for (const ch of name.toLowerCase()) if (/[a-z]/.test(ch) && !used.has(ch)) return ch;
  for (const ch of "abcdefghijklmnopqrstuvwxyz") if (!used.has(ch)) return ch;
  return "";
}

export function addParticipant(a: CalcuttaAuction, name: string, now: number): Result {
  const clean = name.trim();
  if (!clean) return fail(a, "Enter a name");
  if (a.participants.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return fail(a, `${clean} is already in`);
  const p: Participant = {
    id: uid("p_"),
    name: clean,
    color: PARTICIPANT_COLORS[a.participants.length % PARTICIPANT_COLORS.length],
    hotkey: autoHotkey(clean, a.participants.map((x) => x.hotkey)),
    paid: 0,
  };
  return ok(touch(a, now, { participants: [...a.participants, p] }));
}

export function participantById(a: CalcuttaAuction, id: string | null | undefined): Participant | undefined {
  return a.participants.find((p) => p.id === id);
}

// ---- lots ------------------------------------------------------------------

/** One lot per team, ordered by seed (interleaving groups) or shuffled. */
export function lotsFromField(field: FieldTeam[], order: "seed" | "seed_desc" | "random"): Lot[] {
  let teams = [...field];
  if (order === "random") {
    for (let i = teams.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [teams[i], teams[j]] = [teams[j], teams[i]];
    }
  } else {
    teams.sort((x, y) => (x.seed ?? 99) - (y.seed ?? 99) || x.group.localeCompare(y.group));
    if (order === "seed_desc") teams = teams.reverse();
  }
  // First Four pairs (same region + seed) always sell together.
  const groups: FieldTeam[][] = [];
  for (const t of teams) {
    const pair = groups.find((g) => t.seed != null && g[0].seed === t.seed && g[0].group === t.group && !!t.group && g.length === 1 && teams.filter((x) => x.group === t.group && x.seed === t.seed).length === 2);
    if (pair) pair.push(t);
    else groups.push([t]);
  }
  return groups.map((g, i) => ({
    id: uid("lot_"),
    teamIds: g.map((t) => t.id),
    label: g.length > 1 ? `${g[0].group} ${g[0].seed}: ${g.map((t) => t.name).join(" / ")}` : null,
    order: i + 1,
    status: "pending",
    winnerId: null,
    price: null,
    soldAt: null,
    passCount: 0,
  }));
}

/**
 * Bundle every pending lot whose teams are all seeded at least `minSeed`:
 * one bundle per region ("East 13–16") or per seed line ("All 16 seeds").
 */
export function bundleBySeed(a: CalcuttaAuction, minSeed: number, mode: "region" | "line", now: number): Result {
  const teamOf = new Map(a.field.map((t) => [t.id, t]));
  const eligible = a.lots.filter((l) => l.status === "pending" && l.teamIds.every((id) => (teamOf.get(id)?.seed ?? 0) >= minSeed));
  const buckets = new Map<string, Lot[]>();
  for (const l of eligible) {
    const t = teamOf.get(l.teamIds[0])!;
    const key = mode === "region" ? t.group || "All" : String(t.seed);
    buckets.set(key, [...(buckets.get(key) ?? []), l]);
  }
  let cur = a;
  let made = 0;
  for (const [key, lots] of buckets) {
    if (lots.length < 2) continue;
    const seeds = lots.flatMap((l) => l.teamIds.map((id) => teamOf.get(id)?.seed ?? 0));
    const lo = Math.min(...seeds);
    const hi = Math.max(...seeds);
    const label = mode === "region" ? `${key === "All" ? "" : key + " "}${lo === hi ? lo : `${lo}–${hi}`} seeds`.trim() : `All ${key} seeds`;
    const r = bundleLots(cur, lots.map((l) => l.id), label, now);
    if (r.error) return r;
    cur = r.auction;
    made++;
  }
  return made ? ok(cur) : fail(a, "Nothing to bundle at that seed");
}

/** Merge pending lots into one bundle (keeps the earliest slot in the order). */
export function bundleLots(a: CalcuttaAuction, lotIds: string[], label: string | null, now: number): Result {
  const picked = a.lots.filter((l) => lotIds.includes(l.id));
  if (picked.length < 2) return fail(a, "Pick at least two lots to bundle");
  if (picked.some((l) => l.status !== "pending")) return fail(a, "Only lots not yet auctioned can be bundled");
  const first = picked.reduce((m, l) => (l.order < m.order ? l : m));
  const merged: Lot = { ...first, teamIds: picked.flatMap((l) => l.teamIds), label: label?.trim() || null };
  const lots = a.lots.filter((l) => !lotIds.includes(l.id) || l.id === first.id).map((l) => (l.id === first.id ? merged : l));
  return ok(touch(a, now, { lots: renumber(lots) }));
}

export function unbundleLot(a: CalcuttaAuction, lotId: string, now: number): Result {
  const lot = a.lots.find((l) => l.id === lotId);
  if (!lot || lot.teamIds.length < 2) return fail(a, "Not a bundle");
  if (lot.status !== "pending") return fail(a, "Already auctioned");
  const parts: Lot[] = lot.teamIds.map((t, i) => ({ ...lot, id: i === 0 ? lot.id : uid("lot_"), teamIds: [t], label: null, order: lot.order + i / 100 }));
  return ok(touch(a, now, { lots: renumber([...a.lots.filter((l) => l.id !== lotId), ...parts]) }));
}

export function moveLot(a: CalcuttaAuction, lotId: string, dir: -1 | 1, now: number): Result {
  const sorted = [...a.lots].sort((x, y) => x.order - y.order);
  const i = sorted.findIndex((l) => l.id === lotId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return ok(a);
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return ok(touch(a, now, { lots: renumber(sorted) }));
}

function renumber(lots: Lot[]): Lot[] {
  return [...lots].sort((x, y) => x.order - y.order).map((l, i) => ({ ...l, order: i + 1 }));
}

export function sortedLots(a: CalcuttaAuction): Lot[] {
  return [...a.lots].sort((x, y) => x.order - y.order);
}

export function pendingLots(a: CalcuttaAuction): Lot[] {
  return sortedLots(a).filter((l) => l.status === "pending");
}

export function lotTeams(a: CalcuttaAuction, lot: Lot | null | undefined): FieldTeam[] {
  if (!lot) return [];
  return lot.teamIds.map((id) => a.field.find((t) => t.id === id)).filter(Boolean) as FieldTeam[];
}

export function lotName(a: CalcuttaAuction, lot: Lot | null | undefined): string {
  if (!lot) return "";
  if (lot.label) return lot.label;
  return lotTeams(a, lot).map((t) => t.name).join(" + ");
}

export function currentLot(a: CalcuttaAuction): Lot | null {
  return a.lots.find((l) => l.id === a.live.lotId) ?? null;
}

// ---- bidding ---------------------------------------------------------------

export function incrementFor(settings: CalcuttaSettings, high: number): number {
  for (const t of settings.increments) if (t.upTo == null || high < t.upTo) return t.step;
  return settings.increments[settings.increments.length - 1]?.step ?? 1;
}

export function lotBids(a: CalcuttaAuction, lotId: string | null | undefined, includeVoided = false): Bid[] {
  return a.bids.filter((b) => b.lotId === lotId && (includeVoided || !b.voided));
}

export function highBid(a: CalcuttaAuction, lotId: string | null | undefined): Bid | null {
  const bids = lotBids(a, lotId);
  return bids.length ? bids[bids.length - 1] : null;
}

export function minNextBid(a: CalcuttaAuction): number {
  const high = highBid(a, a.live.lotId);
  if (!high) return a.settings.openingMin;
  return high.amount + incrementFor(a.settings, high.amount);
}

export function remainingMs(live: LiveState, now: number): number {
  if (live.phase === "running" && live.endsAt != null) return Math.max(0, live.endsAt - now);
  if (live.phase === "expired") return 0;
  return live.remainingMs ?? 0;
}

/**
 * Bid for a participant. `amount` null = the minimum next bid (current high
 * + increment, or the opening minimum). A typed amount must be at least the
 * minimum. The high bidder can't bid against themselves. Every bid puts the
 * clock back up to at least `timerReset` seconds.
 */
export function placeBid(a: CalcuttaAuction, participantId: string, amount: number | null, now: number): Result {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live") return fail(a, "No lot is open");
  if (a.live.phase === "sold") return fail(a, "Already sold");
  const p = participantById(a, participantId);
  if (!p) return fail(a, "Unknown bidder");
  const high = highBid(a, lot.id);
  if (high && high.participantId === participantId) return fail(a, `${p.name} already has the high bid`);
  if (a.live.outIds?.includes(participantId)) return fail(a, `${p.name} bowed out of this one`);
  if (atTeamCap(a, participantId)) return fail(a, `${p.name} already has the max ${a.settings.maxTeams} teams`);
  const min = minNextBid(a);
  const value = amount ?? min;
  if (!Number.isFinite(value) || value < min) return fail(a, `Minimum bid is $${min}`);
  const bid: Bid = { id: uid("b_"), lotId: lot.id, participantId, amount: value, ts: now, voided: false };
  const left = remainingMs(a.live, now);
  const reset = a.settings.timerReset * 1000;
  const nextLeft = Math.max(left, reset);
  return ok(touch(a, now, { bids: [...a.bids, bid], live: { ...a.live, phase: "running", endsAt: now + nextLeft, remainingMs: null } }));
}

/** Retract the latest live bid on the open lot (kept in the log as voided). */
export function undoLastBid(a: CalcuttaAuction, now: number): Result {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live") return fail(a, "Nothing to undo");
  const last = highBid(a, lot.id);
  if (!last) return fail(a, "No bids to undo");
  const bids = a.bids.map((b) => (b.id === last.id ? { ...b, voided: true } : b));
  let live = a.live;
  if (live.phase === "expired") live = { ...live, phase: "paused", endsAt: null, remainingMs: a.settings.timerReset * 1000 };
  return ok(touch(a, now, { bids, live }));
}

// ---- clock -----------------------------------------------------------------

/** Put the next pending lot (or a specific one) up for bidding, clock not yet running. */
export function openLot(a: CalcuttaAuction, lotId: string | null, now: number): Result {
  const cur = currentLot(a);
  if (cur && cur.status === "live") return fail(a, "Finish the current lot first");
  const lot = lotId ? a.lots.find((l) => l.id === lotId) : pendingLots(a)[0];
  if (!lot) return fail(a, "No lots left");
  if (lot.status !== "pending" && lot.status !== "unsold") return fail(a, "That lot was already sold");
  const lots = a.lots.map((l) => (l.id === lot.id ? { ...l, status: "live" as const } : l));
  return ok(
    touch(a, now, {
      lots,
      status: "live",
      live: { lotId: lot.id, phase: "ready", endsAt: null, remainingMs: a.settings.timerStart * 1000, outIds: [] },
    }),
  );
}

export function startClock(a: CalcuttaAuction, now: number): Result {
  const { phase } = a.live;
  if (phase !== "ready" && phase !== "paused") return ok(a);
  return ok(touch(a, now, { live: { ...a.live, phase: "running", endsAt: now + (a.live.remainingMs ?? a.settings.timerStart * 1000), remainingMs: null } }));
}

export function pauseClock(a: CalcuttaAuction, now: number): Result {
  if (a.live.phase !== "running") return ok(a);
  return ok(touch(a, now, { live: { ...a.live, phase: "paused", remainingMs: remainingMs(a.live, now), endsAt: null } }));
}

export function togglePause(a: CalcuttaAuction, now: number): Result {
  return a.live.phase === "running" ? pauseClock(a, now) : startClock(a, now);
}

export function addTime(a: CalcuttaAuction, seconds: number, now: number): Result {
  const { phase } = a.live;
  if (phase === "running") return ok(touch(a, now, { live: { ...a.live, endsAt: (a.live.endsAt ?? now) + seconds * 1000 } }));
  if (phase === "expired") return ok(touch(a, now, { live: { ...a.live, phase: "running", endsAt: now + seconds * 1000, remainingMs: null } }));
  if (phase === "ready" || phase === "paused") return ok(touch(a, now, { live: { ...a.live, remainingMs: (a.live.remainingMs ?? 0) + seconds * 1000 } }));
  return ok(a);
}

/**
 * Called on every Stage tick. When the clock runs out: sell automatically if
 * autoSell is on and someone bid, otherwise switch to the SOLD? / no-bids
 * prompt and wait for the auctioneer.
 */
export function tick(a: CalcuttaAuction, now: number): Result {
  if (a.live.phase !== "running" || a.live.endsAt == null || now < a.live.endsAt) return ok(a);
  if (a.settings.autoSell && highBid(a, a.live.lotId)) return sellCurrent(a, now);
  return ok(touch(a, now, { live: { ...a.live, phase: "expired", endsAt: null, remainingMs: 0 } }));
}

// ---- closing a lot ---------------------------------------------------------

function finishStatus(lots: Lot[]): CalcuttaAuction["status"] {
  return lots.some((l) => l.status === "pending" || l.status === "live") ? "live" : "complete";
}

export function sellCurrent(a: CalcuttaAuction, now: number): Result {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live") return fail(a, "No lot is open");
  const high = highBid(a, lot.id);
  if (!high) return fail(a, "No bids — pass instead");
  const lots = a.lots.map((l) => (l.id === lot.id ? { ...l, status: "sold" as const, winnerId: high.participantId, price: high.amount, soldAt: now } : l));
  return ok(touch(a, now, { lots, status: finishStatus(lots), live: { ...a.live, phase: "sold", endsAt: null, remainingMs: 0 } }));
}

/** Close a lot nobody bid on: back of the queue once (requeue), otherwise unsold. */
export function passCurrent(a: CalcuttaAuction, now: number): Result {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live") return fail(a, "No lot is open");
  if (highBid(a, lot.id)) return fail(a, "There are bids — sell or undo them first");
  const requeue = a.settings.noBidAction === "requeue" && lot.passCount === 0 && pendingLots(a).length > 0;
  const maxOrder = Math.max(...a.lots.map((l) => l.order));
  const lots = a.lots.map((l) =>
    l.id === lot.id ? { ...l, status: requeue ? ("pending" as const) : ("unsold" as const), passCount: l.passCount + 1, order: requeue ? maxOrder + 1 : l.order } : l,
  );
  return ok(touch(a, now, { lots: renumber(lots), status: finishStatus(lots), live: { ...IDLE } }));
}

/** Undo a sale (wrong bidder, late bid): the lot goes back up with its bids intact, clock paused. */
export function reopenLot(a: CalcuttaAuction, lotId: string, now: number): Result {
  const cur = currentLot(a);
  if (cur && cur.status === "live" && cur.id !== lotId) return fail(a, "Finish the current lot first");
  const lot = a.lots.find((l) => l.id === lotId);
  if (!lot || lot.status !== "sold") return fail(a, "That lot isn't sold");
  if (a.transfers.some((t) => t.lotId === lotId)) return fail(a, "Remove its ownership splits first");
  const lots = a.lots.map((l) => (l.id === lotId ? { ...l, status: "live" as const, winnerId: null, price: null, soldAt: null } : l));
  return ok(touch(a, now, { lots, status: "live", live: { lotId, phase: "paused", endsAt: null, remainingMs: a.settings.timerReset * 1000 } }));
}

// ---- money -----------------------------------------------------------------

/** Winning bids only (no buy-in top-ups). */
export function soldTotal(a: CalcuttaAuction): number {
  return a.lots.reduce((s, l) => s + (l.status === "sold" ? l.price ?? 0 : 0), 0);
}

export function spentBy(a: CalcuttaAuction, participantId: string): number {
  return a.lots.reduce((s, l) => s + (l.status === "sold" && l.winnerId === participantId ? l.price ?? 0 : 0), 0);
}

/** What each attendee owes the pot: their winning bids, but never less than the minimum buy-in. */
export function owedBy(a: CalcuttaAuction, participantId: string): number {
  return Math.max(spentBy(a, participantId), a.settings.minBuyIn || 0);
}

/** Buy-in still unused: bids up to this cost the attendee nothing extra. */
export function buyInLeft(a: CalcuttaAuction, participantId: string): number {
  return Math.max(0, (a.settings.minBuyIn || 0) - spentBy(a, participantId));
}

/**
 * The pot: winning bids plus each attendee's buy-in top-up. With a minimum
 * buy-in the pot starts at attendees × minimum and only grows once someone
 * spends past it.
 */
export function potTotal(a: CalcuttaAuction): number {
  if (!(a.settings.minBuyIn || 0)) return soldTotal(a);
  return soldTotal(a) + a.participants.reduce((s, p) => s + buyInLeft(a, p.id), 0);
}

export function netPot(a: CalcuttaAuction): number {
  return potTotal(a) * (1 - (a.settings.rakePct || 0) / 100);
}

export interface Holding {
  participantId: string;
  pct: number;
  /** What this person paid for their piece (winner: price minus what partners paid them). */
  cost: number;
}

/** Who owns how much of a sold lot after every split/buyback. */
export function lotHoldings(a: CalcuttaAuction, lot: Lot): Holding[] {
  if (lot.status !== "sold" || !lot.winnerId) return [];
  const map = new Map<string, Holding>();
  map.set(lot.winnerId, { participantId: lot.winnerId, pct: 100, cost: lot.price ?? 0 });
  for (const t of a.transfers.filter((x) => x.lotId === lot.id).sort((x, y) => x.ts - y.ts)) {
    const from = map.get(t.fromId);
    if (!from) continue;
    const pct = Math.min(t.pct, from.pct);
    from.pct -= pct;
    from.cost -= t.price;
    const to = map.get(t.toId) ?? { participantId: t.toId, pct: 0, cost: 0 };
    to.pct += pct;
    to.cost += t.price;
    map.set(t.toId, to);
  }
  return [...map.values()].filter((h) => h.pct > 0.0001 || Math.abs(h.cost) > 0.0001);
}

export function addTransfer(
  a: CalcuttaAuction,
  t: { lotId: string; fromId: string; toId: string; pct: number; price: number; note?: string | null },
  now: number,
): Result {
  const lot = a.lots.find((l) => l.id === t.lotId);
  if (!lot || lot.status !== "sold") return fail(a, "Pick a sold team");
  if (t.fromId === t.toId) return fail(a, "Pick two different people");
  if (!(t.pct > 0 && t.pct <= 100)) return fail(a, "Share must be between 0 and 100%");
  if (!(t.price >= 0)) return fail(a, "Price can't be negative");
  const from = lotHoldings(a, lot).find((h) => h.participantId === t.fromId);
  if (!from || from.pct + 1e-9 < t.pct) return fail(a, `They only own ${from ? from.pct : 0}% of it`);
  const transfer = { id: uid("tr_"), lotId: t.lotId, fromId: t.fromId, toId: t.toId, pct: t.pct, price: t.price, ts: now, note: t.note ?? null };
  return ok(touch(a, now, { transfers: [...a.transfers, transfer] }));
}

export function removeTransfer(a: CalcuttaAuction, id: string, now: number): Result {
  return ok(touch(a, now, { transfers: a.transfers.filter((t) => t.id !== id) }));
}

// ---- payouts ---------------------------------------------------------------

export interface EarnedEvent {
  key: string;
  label: string;
  pct: number;
}

/** Payout events this team has already cashed, from its result + props. */
export function teamEarned(auction: CalcuttaAuction, teamId: string): EarnedEvent[] {
  const a = scored(auction);
  const def = formatDef(a.format);
  const team = a.field.find((t) => t.id === teamId);
  const res = a.results[teamId] ?? { roundsCleared: team?.bye ? 1 : 0, eliminated: false };
  const out: EarnedEvent[] = [];
  def.rounds.forEach((r, i) => {
    if (res.roundsCleared <= i) return;
    if (i === 0 && team?.bye && !a.payouts.byeCountsAsWin) return;
    const pct = a.payouts.roundPct[r.key] ?? 0;
    if (pct) out.push({ key: r.key, label: i === 0 && team?.bye ? `${r.label} (bye)` : r.label, pct });
  });
  for (const p of a.payouts.props) {
    const winners = propWinners(p);
    if (p.pct && winners.includes(teamId)) out.push({ key: p.id, label: winners.length > 1 ? `${p.label} (split ${winners.length})` : p.label, pct: p.pct / winners.length });
  }
  return out;
}

export function propWinners(p: { teamIds?: string[]; teamId?: string | null }): string[] {
  return p.teamIds ?? (p.teamId ? [p.teamId] : []);
}

export function lotEarnedPct(a: CalcuttaAuction, lot: Lot): number {
  return lot.teamIds.reduce((s, id) => s + teamEarned(a, id).reduce((x, e) => x + e.pct, 0), 0);
}

export interface OwnerSummary {
  participant: Participant;
  /** Owed to the pot: sum of winning bids. */
  owed: number;
  paid: number;
  /** Net cost after splits/buybacks. */
  cost: number;
  earned: number;
  net: number;
  lots: { lot: Lot; pct: number; cost: number; earned: number }[];
}

export function ownerSummaries(a: CalcuttaAuction): OwnerSummary[] {
  const np = netPot(a);
  const by = new Map<string, OwnerSummary>();
  for (const p of a.participants) by.set(p.id, { participant: p, owed: 0, paid: p.paid || 0, cost: 0, earned: 0, net: 0, lots: [] });
  for (const lot of sortedLots(a)) {
    if (lot.status !== "sold") continue;
    const w = by.get(lot.winnerId!);
    if (w) w.owed += lot.price ?? 0;
    const lotDollars = (lotEarnedPct(a, lot) / 100) * np;
    for (const h of lotHoldings(a, lot)) {
      const s = by.get(h.participantId);
      if (!s) continue;
      const earned = (lotDollars * h.pct) / 100;
      s.cost += h.cost;
      s.earned += earned;
      s.lots.push({ lot, pct: h.pct, cost: h.cost, earned });
    }
  }
  // Unused buy-in is money paid in with nothing to show for it.
  for (const s of by.values()) {
    const topUp = buyInLeft(a, s.participant.id);
    s.owed += topUp;
    s.cost += topUp;
    s.net = s.earned - s.cost;
  }
  return [...by.values()];
}
