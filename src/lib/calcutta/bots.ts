import { simulateBracket, fairShares, payoutMatrix, validateField } from "./bracketSim";
import { PARTICIPANT_COLORS, autoHotkey, currentLot, highBid, incrementFor, lotBids, minNextBid, remainingMs, sortedLots, uid, type Result } from "./engine";
import { formatDef } from "./formats";
import { lotShare, lotTiers, projectPot } from "./value";
import type { BotProfile, BotStyle, CalcuttaAuction, FieldTeam, Lot, Participant } from "./types";

// Practice-mode bots.
//
// Each bot values the field with its OWN noisy copy of the ratings (so bots
// disagree with each other and with you, like a real room), turns that into
// a max price per lot with its personality, and bids the minimum while the
// price is under that max — after a human-ish pause, some only late.
//
//   balanced    ~fair value, a little noise
//   aggressive  overpays on favorites, sometimes jumps the bid
//   bargain     only well under value, waits for "going once"
//   fan         way over on 2 pet teams, a bit under on the rest
//   longshot    overpays on low seeds / bundles, under on favorites
//   budget      ~fair, but stops at a spending cap
//
// Each bot's pot guess drifts with the room's actual pace (same projection
// the Desk uses), so a hot room makes the bots pay more too.

export const BOT_STYLES: { style: BotStyle; name: string; blurb: string }[] = [
  { style: "balanced", name: "Steady Eddie", blurb: "Bids close to fair value" },
  { style: "aggressive", name: "Big Spender", blurb: "Overpays for favorites, jumps bids" },
  { style: "bargain", name: "Bargain Bill", blurb: "Only buys at a discount, bids late" },
  { style: "fan", name: "Homer Hank", blurb: "Way overpays for two pet teams" },
  { style: "longshot", name: "Longshot Lou", blurb: "Loves low seeds and bundles" },
  { style: "budget", name: "Budget Betty", blurb: "Fair-ish, stops at a spending cap" },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 0–1 number for (seed, key) — per-bot, per-lot mood that doesn't change between ticks. */
function hash01(seed: number, key: string): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
  return mulberry32(h >>> 0)();
}

const SEED_CURVES: Record<string, (seed: number) => number> = {
  nfl_playoffs: (s) => [7, 5, 4, 1.5, 3.5, 2.5, 1][s - 1] ?? 0,
  cfb_playoff12: (s) => 20 - 0.8 * (s - 1),
  cfb_playoff24: (s) => 20 - 0.6 * (s - 1),
  march_madness: (s) => [24, 20, 18, 16.5, 15, 14.5, 13.5, 12.5, 12, 11.5, 11, 10.5, 8.5, 6.5, 4.5, 1][s - 1] ?? 0,
};

/** Ratings the bots start from: yours if you have them, else typical-by-seed. */
export function botBaseRatings(a: CalcuttaAuction, yours: Record<string, { rating: number }> | null): Record<string, { rating: number; sd: null }> {
  const curve = SEED_CURVES[a.format] ?? (() => 0);
  return Object.fromEntries(a.field.map((t: FieldTeam) => [t.id, { rating: yours?.[t.id]?.rating ?? curve(t.seed ?? 1), sd: null }]));
}

const NOISE: Record<string, number> = { nfl_playoffs: 2, cfb_playoff12: 3, cfb_playoff24: 3, march_madness: 2.5 };

/** One bot's own fair shares, from the base ratings plus its own noise. */
export function botValues(a: CalcuttaAuction, base: Record<string, { rating: number; sd: null }>, seed: number): Record<string, number> {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const noise = NOISE[a.format] ?? 2;
  const ratings = Object.fromEntries(Object.entries(base).map(([id, r]) => [id, { rating: r.rating + noise * gauss(), sd: null }]));
  const def = formatDef(a.format);
  const sim = simulateBracket({ format: a.format, field: a.field, regions: a.regions, ratings, hfa: def.sim.hfa, marginSd: def.sim.marginSd, ratingNoise: def.sim.ratingNoise, useSourceSd: false, sims: 4000, seed });
  return fairShares(sim, payoutMatrix(sim, a));
}

/** Add `count` bots (styles cycle so every personality shows up). Needs a complete field. */
export function addBots(a: CalcuttaAuction, count: number, base: Record<string, { rating: number; sd: null }>, now: number, styles?: BotStyle[]): Result {
  const bad = validateField(a.format, a.field, a.regions);
  if (bad) return { auction: a, error: `Finish the field first (${bad})` };
  const expected = a.practice?.expectedPot ?? Math.max(200, (a.participants.length + count) * 150);
  const order = styles ?? BOT_STYLES.map((b) => b.style);
  const participants = [...a.participants];
  const used = new Set(participants.map((p) => p.name));
  for (let i = 0; i < count; i++) {
    const style = order[i % order.length];
    const meta = BOT_STYLES.find((b) => b.style === style)!;
    let name = meta.name;
    for (let n = 2; used.has(name); n++) name = `${meta.name} ${n}`;
    used.add(name);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const rand = mulberry32(seed);
    const pick = [...a.field].sort(() => rand() - 0.5);
    const bot: BotProfile = {
      style,
      values: botValues(a, base, seed),
      potGuess: expected * (0.75 + 0.5 * rand()),
      favorites: style === "fan" ? pick.slice(0, 2).map((t) => t.id) : [],
      budget: style === "budget" ? Math.round((expected / Math.max(1, a.participants.length + count)) * (1.1 + 0.4 * rand())) : null,
      seed,
    };
    const p: Participant = {
      id: uid("p_"),
      name,
      color: PARTICIPANT_COLORS[participants.length % PARTICIPANT_COLORS.length],
      hotkey: autoHotkey(name, participants.map((x) => x.hotkey)),
      paid: 0,
      bot,
    };
    participants.push(p);
  }
  return { auction: { ...a, participants, updatedAt: now } };
}

/** Spent so far (winning bids). */
function spent(a: CalcuttaAuction, pid: string): number {
  return a.lots.reduce((s, l) => s + (l.status === "sold" && l.winnerId === pid ? l.price ?? 0 : 0), 0);
}

/** The most this bot will pay for this lot right now. */
export function botMax(a: CalcuttaAuction, p: Participant, lot: Lot): number {
  const bot = p.bot!;
  const share = lotShare(lot, bot.values);
  // Half its own guess, half the room's pace — enough to react to a hot room
  // without bots chasing each other's overpays upward.
  const pot = (0.5 * bot.potGuess + 0.5 * projectPot(a, bot.values, bot.potGuess).projected) * (1 - (a.settings.rakePct || 0) / 100);
  const fair = (share / 100) * pot;
  const tier = lotTiers(a, bot.values)[lot.id];
  const mood = 0.9 + 0.2 * hash01(bot.seed, lot.id); // ±10% per lot
  let mult = 1;
  switch (bot.style) {
    case "balanced":
      mult = 0.97;
      break;
    case "aggressive":
      mult = tier === "fav" ? 1.3 : 1.05;
      break;
    case "bargain":
      mult = 0.72;
      break;
    case "fan":
      mult = lot.teamIds.some((id) => bot.favorites.includes(id)) ? 1.7 : 0.85;
      break;
    case "longshot":
      mult = tier === "long" ? 1.4 : tier === "fav" ? 0.8 : 1;
      break;
    case "budget":
      mult = 1;
      break;
  }
  let max = fair * mult * mood;
  const done = spent(a, p.id);
  // Unused minimum buy-in is owed anyway, so as lots run out a bot will spend it.
  const left = Math.max(0, (a.settings.minBuyIn || 0) - done);
  if (left > 0) {
    const sold = a.lots.filter((l) => l.status === "sold").length;
    max += left * (sold / Math.max(1, a.lots.length));
  }
  if (bot.budget != null) max = Math.min(max, Math.max(0, bot.budget - done));
  else {
    // Soft spending limit: past ~its share of the room it cools off, then stops.
    const share = bot.potGuess / Math.max(2, a.participants.length);
    const target = share * (bot.style === "aggressive" ? 1.8 : bot.style === "bargain" ? 1.1 : 1.4);
    if (done > target) max *= Math.max(0, 1 - (done - target) / (0.6 * target));
  }
  return Math.floor(max);
}

export interface BotBid {
  participantId: string;
  amount: number;
}

/**
 * Which bot (if any) bids on this tick. `sinceLastMs` = time since the last
 * bid on the lot (or since the clock started). At most one bot acts per
 * tick; each bot waits its own reaction time, shorter as the clock runs out.
 */
export function chooseBotBid(a: CalcuttaAuction, now: number, sinceLastMs: number, rand: () => number = Math.random): BotBid | null {
  const lot = currentLot(a);
  if (!lot || lot.status !== "live" || a.live.phase !== "running") return null;
  const high = highBid(a, lot.id);
  const min = minNextBid(a);
  const left = remainingMs(a.live, now);
  const n = lotBids(a, lot.id).length;
  let best: { p: Participant; wait: number; max: number } | null = null;
  for (const p of a.participants) {
    if (!p.bot || high?.participantId === p.id) continue;
    const max = botMax(a, p, lot);
    if (max < min) continue;
    // Reaction time for this bot on this bid number: 0.6–3.2s, faster when the clock is low.
    let wait = 600 + 2600 * hash01(p.bot.seed, `${lot.id}:${n}`);
    if (left < 4000) wait *= 0.35;
    if (p.bot.style === "bargain" && left > a.settings.goingOnceAt * 1000) continue; // lurks until "going once"
    if (sinceLastMs < wait) continue;
    if (!best || wait < best.wait) best = { p, wait, max };
  }
  if (!best) return null;
  let amount = min;
  const step = incrementFor(a.settings, high?.amount ?? 0);
  if (best.p.bot!.style === "aggressive" && best.max - min > 4 * step && rand() < 0.3) amount = Math.min(best.max, min + 2 * step);
  return { participantId: best.p.id, amount };
}

/** Start over with the same field, rules and bots: every lot back up, no bids. */
export function resetForReplay(a: CalcuttaAuction, now: number): CalcuttaAuction {
  return {
    ...a,
    status: "setup",
    bids: [],
    transfers: [],
    results: {},
    games: [],
    lots: sortedLots(a).map((l, i) => ({ ...l, status: "pending", winnerId: null, price: null, soldAt: null, passCount: 0, order: i + 1 })),
    participants: a.participants.map((p) => ({ ...p, paid: 0 })),
    live: { lotId: null, phase: "idle", endsAt: null, remainingMs: null },
    updatedAt: now,
  };
}

/** A practice copy of an auction: same rules, field and lots; just you as the human. */
export function practiceCopy(a: CalcuttaAuction, meName: string, now: number): CalcuttaAuction {
  const me: Participant = { id: uid("p_"), name: meName || "Me", color: PARTICIPANT_COLORS[0], hotkey: autoHotkey(meName || "Me", []), paid: 0 };
  return resetForReplay(
    {
      ...a,
      id: uid("cal_"),
      name: `${a.name} (practice)`,
      createdAt: now,
      participants: [me],
      practice: { enabled: true, autoAdvance: true, expectedPot: Math.max(200, 8 * 150) },
      settings: { ...a.settings, timerStart: 15, timerReset: 8, goingOnceAt: 5, goingTwiceAt: 3, autoSell: false },
    },
    now,
  );
}
