import { describe, expect, it } from "vitest";
import { NFL_COMPOSITE_WEEK9_TEXT } from "../../data/nflCompositeRatings";
import { addParticipant, lotsFromField, newAuction, openLot, passCurrent, placeBid, potTotal, sellCurrent, startClock, tick, highBid } from "./engine";
import { emptyNflSeedSlots, nflFieldFromSlots } from "./formats";
import { cfbFieldFromSeeds } from "./fields";
import { parseRatings } from "./ratings";
import { addBots, botBaseRatings, botMax, chooseBotBid, practiceCopy, resetForReplay, simulatePlayoffGames } from "./bots";
import { deriveFromGames } from "./scoring";
import type { CalcuttaAuction } from "./types";

const AFC = ["BUF", "JAX", "NE", "KC", "CIN", "DEN", "HOU"];
const NFC = ["LAR", "CHI", "SEA", "DET", "SF", "MIN", "DAL"];

function base(): CalcuttaAuction {
  let a = newAuction("Real", "nfl_playoffs", 0);
  const slots = emptyNflSeedSlots().map((s) => ({ ...s, abbr: (s.conf === "AFC" ? AFC : NFC)[s.seed - 1] }));
  a = { ...a, field: nflFieldFromSlots(slots) };
  a = { ...a, lots: lotsFromField(a.field, "seed") };
  a = addParticipant(a, "Chris", 0).auction;
  return a;
}

function practice(): CalcuttaAuction {
  let a = practiceCopy(base(), "Chris", 0);
  a = { ...a, practice: { enabled: true, autoAdvance: true, expectedPot: 1000 } };
  return addBots(a, 6, botBaseRatings(a, parseRatings(NFL_COMPOSITE_WEEK9_TEXT).ratings), 0).auction;
}

describe("practice bots", () => {
  it("makes a practice copy with just you, fast clock, nothing sold", () => {
    const a = practiceCopy(base(), "Chris", 0);
    expect(a.participants.map((p) => p.name)).toEqual(["Chris"]);
    expect(a.practice?.enabled).toBe(true);
    expect(a.settings.timerStart).toBe(15);
    expect(a.lots.every((l) => l.status === "pending")).toBe(true);
  });

  it("adds one bot per personality, each with its own valuation", () => {
    const a = practice();
    const bots = a.participants.filter((p) => p.bot);
    expect(bots.map((b) => b.bot!.style)).toEqual(["balanced", "aggressive", "bargain", "fan", "longshot", "budget"]);
    for (const b of bots) expect(Object.values(b.bot!.values).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 0);
    expect(bots[0].bot!.values.LAR).not.toBe(bots[1].bot!.values.LAR); // they disagree
    expect(new Set(a.participants.map((p) => p.hotkey)).size).toBe(7);
  });

  it("personalities change the price: bargain < balanced, fan way over on pets", () => {
    let a = practice();
    // Same valuation and pot guess for the two being compared, so only personality differs.
    const bal = a.participants.find((p) => p.bot?.style === "balanced")!;
    a = { ...a, participants: a.participants.map((p) => (p.bot?.style === "bargain" ? { ...p, bot: { ...p.bot, values: bal.bot!.values, potGuess: bal.bot!.potGuess, seed: bal.bot!.seed } } : p)) };
    const by = (s: string) => a.participants.find((p) => p.bot?.style === s)!;
    const lot = a.lots[0];
    expect(botMax(a, by("bargain"), lot)).toBeLessThan(botMax(a, by("balanced"), lot) * 0.85);
    const fan = by("fan");
    const pet = a.lots.find((l) => fan.bot!.favorites.includes(l.teamIds[0]))!;
    const petMax = botMax(a, fan, pet);
    const fair = (fan.bot!.values[pet.teamIds[0]] / 100) * fan.bot!.potGuess;
    expect(petMax).toBeGreaterThan(fair * 1.4);
  });

  it("bots run a whole auction by themselves and the pot lands near the expected pot", () => {
    let a = practice();
    let now = 0;
    for (let guard = 0; guard < 20000 && a.status !== "complete"; guard++) {
      if (a.live.phase === "idle" || a.live.phase === "sold") {
        const r = openLot(a, null, now);
        if (r.error) break;
        a = startClock(r.auction, now).auction;
        continue;
      }
      if (a.live.phase === "expired") {
        a = highBid(a, a.live.lotId) ? sellCurrent(a, now).auction : passCurrent(a, now).auction;
        continue;
      }
      const lastTs = a.bids.filter((b) => b.lotId === a.live.lotId && !b.voided).slice(-1)[0]?.ts;
      const since = now - (lastTs ?? now - 5000);
      const bid = chooseBotBid(a, now, since, () => 0.5);
      if (bid) a = placeBid(a, bid.participantId, bid.amount, now).auction;
      now += 250;
      a = tick(a, now).auction;
    }
    const sold = a.lots.filter((l) => l.status === "sold").length;
    expect(sold).toBeGreaterThanOrEqual(12);
    expect(potTotal(a)).toBeGreaterThan(500);
    expect(potTotal(a)).toBeLessThan(2000);
    // budget bot respects its cap
    const betty = a.participants.find((p) => p.bot?.style === "budget")!;
    const bettySpent = a.lots.filter((l) => l.winnerId === betty.id).reduce((s, l) => s + (l.price ?? 0), 0);
    expect(bettySpent).toBeLessThanOrEqual(betty.bot!.budget! + 1);
    // replay keeps the bots, clears everything else
    const r = resetForReplay(a, now);
    expect(r.bids.length).toBe(0);
    expect(r.lots.every((l) => l.status === "pending")).toBe(true);
    expect(r.participants.filter((p) => p.bot).length).toBe(6);
  });

  it("a bot never outbids itself or bids above its max", () => {
    let a = practice();
    a = openLot(a, null, 0).auction;
    a = startClock(a, 0).auction;
    const human = a.participants.find((p) => !p.bot)!;
    a = placeBid(a, human.id, 100000, 0).auction; // way above everyone
    expect(chooseBotBid(a, 1000, 10000)).toBeNull();
  });

  it("sims the playoffs round by round into real-looking games that settle everything", () => {
    let a = practice();
    const base = botBaseRatings(a, parseRatings(NFL_COMPOSITE_WEEK9_TEXT).ratings);
    a = simulatePlayoffGames(a, base, "round", 0).auction;
    expect(a.games!.length).toBe(6); // Wild Card weekend
    expect(a.games!.every((g) => g.final && g.homeScore !== g.awayScore && g.homeSpread != null)).toBe(true);
    a = simulatePlayoffGames(a, base, "round", 1).auction;
    expect(a.games!.length).toBe(10);
    a = simulatePlayoffGames(a, base, "rest", 2).auction;
    expect(a.games!.length).toBe(13);
    expect(simulatePlayoffGames(a, base, "rest", 3).error).toMatch(/Every game/);
    const d = deriveFromGames(a);
    expect(d.championId).not.toBeNull();
    expect(Object.values(d.props).every((p) => p.final)).toBe(true);
    // the 1 seeds played only from the Divisional round on
    expect(a.games!.filter((g) => g.round === 0 && (g.homeId === "BUF" || g.awayId === "BUF")).length).toBe(0);
  });

  it("no bot hogs the field: 20 bots-only auctions per format, NFL and CFB 12", () => {
    const worst: number[] = [];
    for (const fmt of ["nfl", "cfb"] as const) {
      for (let run = 0; run < 20; run++) {
        let a: CalcuttaAuction;
        if (fmt === "nfl") a = practice();
        else {
          let b = newAuction("CFB", "cfb_playoff12", 0);
          const field = cfbFieldFromSeeds("cfb_playoff12", ["Indiana", "Ohio State", "Georgia", "Texas Tech", "Oregon", "Ole Miss", "Texas A&M", "Oklahoma", "Alabama", "Miami", "Tulane", "James Madison"]);
          b = { ...b, field, lots: lotsFromField(field, "seed") };
          b = addParticipant(b, "Chris", 0).auction;
          b = practiceCopy(b, "Chris", 0);
          b = { ...b, practice: { ...b.practice!, expectedPot: 1000 } };
          a = addBots(b, 6, botBaseRatings(b, null), 0).auction;
        }
        a = runBotsOnly(a);
        const counts = a.participants.map((p) => a.lots.filter((l) => l.winnerId === p.id).length);
        worst.push(Math.max(...counts) / a.lots.length);
      }
    }
    worst.sort((x, y) => y - x);
    // Real rooms have a big buyer, but nobody should take half the field.
    expect(worst[0]).toBeLessThan(0.5);
  });

  it("max teams per person is enforced for people and bots", () => {
    let a = practice();
    a = { ...a, settings: { ...a.settings, maxTeams: 2 } };
    a = runBotsOnly(a);
    for (const p of a.participants) expect(a.lots.filter((l) => l.winnerId === p.id).length).toBeLessThanOrEqual(2);
    let b = openLot({ ...practice(), settings: { ...practice().settings, maxTeams: 1 } }, null, 0).auction;
    const me = b.participants.find((p) => !p.bot)!;
    b = sellCurrent(placeBid(b, me.id, 50, 0).auction, 0).auction;
    b = openLot(b, null, 0).auction;
    expect(placeBid(b, me.id, 50, 0).error).toMatch(/max 1 teams/);
  });
});

function runBotsOnly(a: CalcuttaAuction): CalcuttaAuction {
  let now = 0;
  for (let guard = 0; guard < 40000 && a.status !== "complete"; guard++) {
    if (a.live.phase === "idle" || a.live.phase === "sold") {
      const r = openLot(a, null, now);
      if (r.error) break;
      a = startClock(r.auction, now).auction;
      continue;
    }
    if (a.live.phase === "expired") {
      a = highBid(a, a.live.lotId) ? sellCurrent(a, now).auction : passCurrent(a, now).auction;
      continue;
    }
    const lastTs = a.bids.filter((b) => b.lotId === a.live.lotId && !b.voided).slice(-1)[0]?.ts;
    const bid = chooseBotBid(a, now, now - (lastTs ?? now - 5000));
    if (bid) a = placeBid(a, bid.participantId, bid.amount, now).auction;
    now += 250;
    a = tick(a, now).auction;
  }
  return a;
}

