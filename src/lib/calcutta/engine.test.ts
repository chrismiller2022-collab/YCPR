import { describe, expect, it } from "vitest";
import {
  addParticipant,
  addTransfer,
  autoHotkey,
  bundleLots,
  highBid,
  lotHoldings,
  lotsFromField,
  minNextBid,
  newAuction,
  openLot,
  ownerSummaries,
  passCurrent,
  placeBid,
  potTotal,
  reopenLot,
  sellCurrent,
  tick,
  undoLastBid,
  remainingMs,
} from "./engine";
import { emptyNflSeedSlots, nflFieldFromSlots, payoutTotalPct } from "./formats";
import type { CalcuttaAuction } from "./types";

const AFC = ["KC", "BUF", "BAL", "HOU", "DEN", "PIT", "LAC"];
const NFC = ["DET", "PHI", "LAR", "TB", "MIN", "GB", "WSH"];

function setup(): CalcuttaAuction {
  let a = newAuction("Test", "nfl_playoffs", 0);
  const slots = emptyNflSeedSlots().map((s) => ({ ...s, abbr: (s.conf === "AFC" ? AFC : NFC)[s.seed - 1] }));
  a = { ...a, field: nflFieldFromSlots(slots) };
  a = { ...a, lots: lotsFromField(a.field, "seed") };
  for (const n of ["Chris", "Kal", "Ethan"]) a = addParticipant(a, n, 0).auction;
  return a;
}
const pid = (a: CalcuttaAuction, name: string) => a.participants.find((p) => p.name === name)!.id;

describe("calcutta engine", () => {
  it("default NFL playoff payouts sum to 100%", () => {
    const a = setup();
    expect(payoutTotalPct(a.format, a.payouts, a.field)).toBe(100);
    expect(a.payouts.props.length).toBe(4);
    expect(payoutTotalPct(a.format, { ...a.payouts, byeCountsAsWin: true }, a.field)).toBe(106);
  });

  it("assigns unique hotkeys", () => {
    expect(autoHotkey("Chris", [])).toBe("c");
    expect(autoHotkey("Chris", ["c"])).toBe("h");
    const a = setup();
    expect(new Set(a.participants.map((p) => p.hotkey)).size).toBe(3);
  });

  it("enforces opening min, increments, typed jumps, and no self-raise", () => {
    let a = openLot(setup(), null, 1000).auction;
    expect(a.live.phase).toBe("ready");
    expect(minNextBid(a)).toBe(10);
    expect(placeBid(a, pid(a, "Kal"), 5, 1000).error).toMatch(/Minimum/);
    a = placeBid(a, pid(a, "Kal"), null, 1000).auction;
    expect(highBid(a, a.live.lotId)!.amount).toBe(10);
    expect(placeBid(a, pid(a, "Kal"), null, 1000).error).toMatch(/already/);
    a = placeBid(a, pid(a, "Chris"), 98, 1000).auction;
    expect(minNextBid(a)).toBe(103); // $5 steps under $100
    a = placeBid(a, pid(a, "Ethan"), null, 1000).auction;
    expect(minNextBid(a)).toBe(113); // $10 steps from $100
  });

  it("resets the clock on a bid, expires to a prompt, and sells on confirm", () => {
    let a = openLot(setup(), null, 0).auction;
    a = placeBid(a, pid(a, "Kal"), null, 0).auction;
    expect(remainingMs(a.live, 0)).toBe(30000); // first bid keeps the full opening clock
    a = placeBid(a, pid(a, "Chris"), null, 25000).auction;
    expect(remainingMs(a.live, 25000)).toBe(15000); // bumped back up to the reset
    a = tick(a, 40000).auction;
    expect(a.live.phase).toBe("expired");
    a = placeBid(a, pid(a, "Kal"), null, 41000).auction; // late bid reopens
    expect(a.live.phase).toBe("running");
    a = tick(a, 60000).auction;
    a = sellCurrent(a, 60000).auction;
    expect(a.lots.find((l) => l.id === a.live.lotId)!.winnerId).toBe(pid(a, "Kal"));
    expect(potTotal(a)).toBe(20);
  });

  it("auto-sells when the setting is on", () => {
    let a = setup();
    a = { ...a, settings: { ...a.settings, autoSell: true } };
    a = openLot(a, null, 0).auction;
    a = placeBid(a, pid(a, "Kal"), null, 0).auction;
    a = tick(a, 31000).auction;
    expect(a.live.phase).toBe("sold");
  });

  it("undo voids the last bid and keeps it in the log", () => {
    let a = openLot(setup(), null, 0).auction;
    a = placeBid(a, pid(a, "Kal"), null, 0).auction;
    a = placeBid(a, pid(a, "Chris"), null, 0).auction;
    a = undoLastBid(a, 0).auction;
    expect(highBid(a, a.live.lotId)!.participantId).toBe(pid(a, "Kal"));
    expect(a.bids.length).toBe(2);
  });

  it("requeues a no-bid lot once, then leaves it unsold", () => {
    let a = openLot(setup(), null, 0).auction;
    const first = a.live.lotId!;
    a = passCurrent(a, 0).auction;
    const lot = a.lots.find((l) => l.id === first)!;
    expect(lot.status).toBe("pending");
    expect(lot.order).toBe(14);
    a = openLot(a, first, 0).auction;
    a = passCurrent(a, 0).auction;
    expect(a.lots.find((l) => l.id === first)!.status).toBe("unsold");
  });

  it("reopens a sold lot", () => {
    let a = openLot(setup(), null, 0).auction;
    a = placeBid(a, pid(a, "Kal"), null, 0).auction;
    a = sellCurrent(a, 0).auction;
    a = reopenLot(a, a.live.lotId!, 0).auction;
    expect(a.live.phase).toBe("paused");
    expect(potTotal(a)).toBe(0);
  });

  it("bundles lots", () => {
    const a = setup();
    const ids = a.lots.slice(-2).map((l) => l.id);
    const b = bundleLots(a, ids, "Long shots", 0).auction;
    expect(b.lots.length).toBe(13);
    expect(b.lots.find((l) => l.label === "Long shots")!.teamIds.length).toBe(2);
  });

  it("splits ownership and pays out by share", () => {
    let a = openLot(setup(), null, 0).auction; // AFC 1 seed (KC) — has a bye
    const lotId = a.live.lotId!;
    a = placeBid(a, pid(a, "Kal"), 200, 0).auction;
    a = sellCurrent(a, 0).auction;
    a = addTransfer(a, { lotId, fromId: pid(a, "Kal"), toId: pid(a, "Chris"), pct: 50, price: 100 }, 1).auction;
    expect(addTransfer(a, { lotId, fromId: pid(a, "Kal"), toId: pid(a, "Ethan"), pct: 60, price: 0 }, 2).error).toMatch(/only own 50/);
    const lot = a.lots.find((l) => l.id === lotId)!;
    expect(lotHoldings(a, lot).map((h) => [h.pct, h.cost])).toEqual([
      [50, 100],
      [50, 100],
    ]);
    // KC wins the Super Bowl off a bye: div (5) + conf (10) + SB (17) = 32%, plus half of a
    // tied 6% side prize (3%) = 35% of a $200 pot = $70, split 50/50 → $35 each.
    const props = a.payouts.props.map((p, i) => (i === 1 ? { ...p, teamIds: ["KC", "DET"] } : p));
    a = { ...a, results: { KC: { roundsCleared: 4, eliminated: false } }, payouts: { ...a.payouts, props } };
    const s = ownerSummaries(a);
    const kal = s.find((x) => x.participant.name === "Kal")!;
    expect(kal.earned).toBeCloseTo(35);
    expect(kal.owed).toBe(200);
  });

  it("minimum buy-in: pot floor, top-ups owed, unused buy-in counts as cost", () => {
    let a = setup();
    a = { ...a, settings: { ...a.settings, minBuyIn: 50 } };
    expect(potTotal(a)).toBe(150); // 3 attendees × $50 before anything sells
    a = openLot(a, null, 0).auction;
    a = placeBid(a, pid(a, "Kal"), 80, 0).auction;
    a = sellCurrent(a, 0).auction;
    a = openLot(a, null, 0).auction;
    a = placeBid(a, pid(a, "Chris"), 20, 0).auction;
    a = sellCurrent(a, 0).auction;
    // Kal 80 (over the minimum), Chris 20 → tops up 30, Ethan nothing → 50
    expect(potTotal(a)).toBe(80 + 50 + 50);
    const s = ownerSummaries(a);
    const get = (n: string) => s.find((x) => x.participant.name === n)!;
    expect(get("Kal").owed).toBe(80);
    expect(get("Chris").owed).toBe(50);
    expect(get("Chris").cost).toBe(50);
    expect(get("Ethan").owed).toBe(50);
    expect(get("Ethan").net).toBe(-50);
  });
});

