import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { atTeamCap, buyInLeft, currentLot, highBid, lotBids, lotName, lotTeams, minNextBid, participantById, pendingLots, potTotal, sortedLots, spentBy, teamsWon } from "./engine";
import { formatDef } from "./formats";
import type { CalcuttaAuction } from "./types";

// Live room: everyone bids from their own device.
//
//   room page  → POST /api/pool-save {pool: "calcutta-room", action: "bid"}
//              → a row in calcutta_bid_requests
//   Stage      → reads new requests (Realtime + a 1s poll), applies each
//                through the same engine rules as a keyboard bid, in order
//              → publishes a compact live state to calcutta_live
//   room pages → subscribe to calcutta_live (Realtime + a 2s poll)
//
// The Stage stays the only writer of the auction, so two phones bidding the
// same amount can't both win it: the first one in counts, the second gets
// "too late, the bid is $X now".

export interface RoomOutcome {
  requestId: number;
  participantId: string;
  ok: boolean;
  text: string;
}

export interface LiveRoomState {
  v: 1;
  roomOpen: boolean;
  hostNow: number;
  name: string;
  format: string;
  status: string;
  phase: string;
  endsAt: number | null;
  remainingMs: number | null;
  goingOnceAt: number;
  goingTwiceAt: number;
  minNext: number;
  pot: number;
  lot: { id: string; order: number; name: string; total: number; teams: { name: string; seed: number | null; group: string; logo: string | null }[] } | null;
  high: { participantId: string; name: string; amount: number; color: string } | null;
  trail: { name: string; amount: number; color: string }[];
  outIds: string[];
  participants: { id: string; name: string; color: string; spent: number; teams: number; buyInLeft: number; capped: boolean }[];
  sold: { name: string; winner: string; color: string; price: number }[];
  upNext: string[];
  increments: { upTo: number | null; step: number }[];
  maxTeams: number;
  outcomes: RoomOutcome[];
}

export function buildLiveState(a: CalcuttaAuction, outcomes: RoomOutcome[], now: number): LiveRoomState {
  const lot = currentLot(a);
  const high = highBid(a, lot?.id);
  const hp = participantById(a, high?.participantId);
  return {
    v: 1,
    roomOpen: !!a.room?.enabled,
    hostNow: now,
    name: a.name,
    format: formatDef(a.format).label,
    status: a.status,
    phase: a.live.phase,
    endsAt: a.live.endsAt,
    remainingMs: a.live.remainingMs,
    goingOnceAt: a.settings.goingOnceAt,
    goingTwiceAt: a.settings.goingTwiceAt,
    minNext: minNextBid(a),
    pot: potTotal(a),
    lot: lot
      ? { id: lot.id, order: lot.order, name: lotName(a, lot), total: a.lots.length, teams: lotTeams(a, lot).map((t) => ({ name: t.name, seed: t.seed, group: t.group, logo: t.logo })) }
      : null,
    high: high && hp ? { participantId: hp.id, name: hp.name, amount: high.amount, color: hp.color } : null,
    trail: lotBids(a, lot?.id)
      .slice(-6)
      .reverse()
      .map((b) => {
        const p = participantById(a, b.participantId);
        return { name: p?.name ?? "?", amount: b.amount, color: p?.color ?? "#888" };
      }),
    outIds: a.live.outIds ?? [],
    participants: a.participants
      .filter((p) => !p.bot)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, spent: spentBy(a, p.id), teams: teamsWon(a, p.id), buyInLeft: buyInLeft(a, p.id), capped: atTeamCap(a, p.id) })),
    sold: sortedLots(a)
      .filter((l) => l.status === "sold")
      .sort((x, y) => (y.soldAt ?? 0) - (x.soldAt ?? 0))
      .slice(0, 5)
      .map((l) => {
        const p = participantById(a, l.winnerId);
        return { name: lotName(a, l), winner: p?.name ?? "?", color: p?.color ?? "#888", price: l.price ?? 0 };
      }),
    upNext: pendingLots(a)
      .slice(0, 3)
      .map((l) => lotName(a, l)),
    increments: a.settings.increments,
    maxTeams: a.settings.maxTeams || 0,
    outcomes: outcomes.slice(-30),
  };
}

function adminPassword(): string {
  try {
    return sessionStorage.getItem("admin_password") ?? "";
  } catch {
    return "";
  }
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/pool-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

// ---- host (Stage / admin) ---------------------------------------------------

export function publishLive(auctionId: string, state: LiveRoomState) {
  return post({ password: adminPassword(), pool: "calcutta", action: "live", auctionId, state });
}

export function fetchRoomMembers(auctionId: string): Promise<{ members: { participant_id: string; claimed_at: string; locked_until: string | null }[] }> {
  return post({ password: adminPassword(), pool: "calcutta", action: "roomMembers", auctionId });
}

export function resetRoomPin(auctionId: string, participantId: string) {
  return post({ password: adminPassword(), pool: "calcutta", action: "resetPin", auctionId, participantId });
}

export interface BidRequestRow {
  id: number;
  participant_id: string;
  lot_id: string | null;
  kind: "bid" | "out";
  amount: number | null;
  created_at: string;
}

export async function fetchBidRequests(auctionId: string, afterId: number): Promise<BidRequestRow[]> {
  const { data, error } = await supabase
    .from("calcutta_bid_requests")
    .select("id, participant_id, lot_id, kind, amount, created_at")
    .eq("auction_id", auctionId)
    .gt("id", afterId)
    .order("id")
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, id: Number(r.id), amount: r.amount == null ? null : Number(r.amount) }));
}

/** Calls `onNew` whenever new bid requests may exist (Realtime insert, or every second as a fallback). */
export function useBidRequestPing(auctionId: string, enabled: boolean, onNew: () => void) {
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`calcutta-req-${auctionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calcutta_bid_requests", filter: `auction_id=eq.${auctionId}` }, () => cb.current())
      .subscribe();
    const t = window.setInterval(() => cb.current(), 1000);
    cb.current();
    return () => {
      window.clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [auctionId, enabled]);
}

// ---- room page (attendees) ---------------------------------------------------

export function roomStatus(auctionId: string): Promise<{ claimed: string[] }> {
  return post({ pool: "calcutta-room", action: "status", auctionId });
}

export function roomJoin(auctionId: string, participantId: string, pin: string, mode: "claim" | "login"): Promise<{ token: string; participantId: string; name: string }> {
  return post({ pool: "calcutta-room", action: mode, auctionId, participantId, pin });
}

export function roomBid(token: string, lotId: string | null, amount: number | null): Promise<{ requestId: number }> {
  return post({ pool: "calcutta-room", action: "bid", token, lotId, amount });
}

export function roomOut(token: string, lotId: string | null): Promise<{ requestId: number }> {
  return post({ pool: "calcutta-room", action: "out", token, lotId });
}

export async function fetchLive(auctionId: string): Promise<LiveRoomState | null> {
  const { data, error } = await supabase.from("calcutta_live").select("state").eq("auction_id", auctionId).maybeSingle();
  if (error) throw error;
  return (data?.state as LiveRoomState) ?? null;
}

/** The live room state, pushed by Realtime, with a 2s refetch in case the socket drops. `offset` = host clock − this clock. */
export function useLiveRoom(auctionId: string | undefined) {
  const [state, setState] = useState<LiveRoomState | null>(null);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!auctionId) return;
    let cancelled = false;
    let latest = 0;
    const take = (s: LiveRoomState | null) => {
      if (cancelled) return;
      setLoaded(true);
      if (!s || s.hostNow < latest) return;
      latest = s.hostNow;
      setOffset(s.hostNow - Date.now());
      setState(s);
    };
    const load = () =>
      fetchLive(auctionId)
        .then((s) => {
          setError(null);
          take(s);
        })
        .catch((e) => !cancelled && setError(e?.message ?? "Couldn't reach the room"));
    load();
    const channel = supabase
      .channel(`calcutta-live-${auctionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calcutta_live", filter: `auction_id=eq.${auctionId}` }, (payload: any) => take(payload.new?.state ?? null))
      .subscribe();
    const t = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [auctionId]);
  return { state, offset, loaded, error };
}

const tokenKey = (auctionId: string) => `calcutta:room:${auctionId}`;
export function savedRoomLogin(auctionId: string): { token: string; participantId: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(tokenKey(auctionId)) ?? "null");
  } catch {
    return null;
  }
}
export function saveRoomLogin(auctionId: string, v: { token: string; participantId: string; name: string } | null) {
  try {
    if (v) localStorage.setItem(tokenKey(auctionId), JSON.stringify(v));
    else localStorage.removeItem(tokenKey(auctionId));
  } catch {
    // private window — they'll sign in again next time
  }
}

/** Next minimum bid for a given high bid, from the published increment tiers. */
export function nextMin(state: LiveRoomState, high: number | null): number {
  if (high == null) return state.minNext;
  for (const t of state.increments) if (t.upTo == null || high < t.upTo) return high + t.step;
  return high + (state.increments[state.increments.length - 1]?.step ?? 1);
}
