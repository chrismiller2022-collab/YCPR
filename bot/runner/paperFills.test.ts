import { describe, expect, it } from "vitest";
import { capTakes, diffOrders, fillFee, paperFills, type RestingOrder } from "./paperFills";

const order = (over: Partial<RestingOrder>): RestingOrder => ({ id: 1, ticker: "T", action: "buy", price: 0.5, count: 1, placedAt: 100, ...over });

describe("paperFills", () => {
  it("fills a bid only when a later trade prints below it", () => {
    const o = order({});
    expect(paperFills([o], [{ ticker: "T", t: 150, yesPrice: 0.5 }], new Map())).toHaveLength(0); // at our price: queue, not filled
    expect(paperFills([o], [{ ticker: "T", t: 50, yesPrice: 0.45 }], new Map())).toHaveLength(0); // before we placed it
    expect(paperFills([o], [{ ticker: "U", t: 150, yesPrice: 0.45 }], new Map())).toHaveLength(0); // other market
    expect(paperFills([o], [{ ticker: "T", t: 150, yesPrice: 0.49 }], new Map())).toHaveLength(1);
  });

  it("fills an ask when a trade prints above it, or when the book moves through either", () => {
    const sell = order({ action: "sell", price: 0.6 });
    expect(paperFills([sell], [{ ticker: "T", t: 150, yesPrice: 0.61 }], new Map())).toHaveLength(1);
    expect(paperFills([sell], [], new Map([["T", { bid: 0.62, ask: 0.64 }]]))).toHaveLength(1);
    expect(paperFills([order({})], [], new Map([["T", { bid: 0.4, ask: 0.48 }]]))).toHaveLength(1);
    expect(paperFills([order({})], [], new Map([["T", { bid: 0.4, ask: 0.5 }]]))).toHaveLength(0);
  });

  it("charges maker fees on quotes and taker fees on takes", () => {
    expect(fillFee(0.5, 1, "quote")).toBeCloseTo(0.004375, 10);
    expect(fillFee(0.5, 2, "take")).toBeCloseTo(0.035, 10);
  });
});

describe("diffOrders", () => {
  it("keeps identical resting quotes, cancels stale ones, places new ones and every take", () => {
    const resting = [
      { id: 1, ticker: "A", action: "buy", price: 0.5, count: 1 },
      { id: 2, ticker: "B", action: "sell", price: 0.6, count: 1 },
    ];
    const desired = [
      { ticker: "A", action: "buy" as const, price: 0.5, count: 1, kind: "quote" as const },
      { ticker: "B", action: "sell" as const, price: 0.61, count: 1, kind: "quote" as const },
      { ticker: "C", action: "buy" as const, price: 0.3, count: 1, kind: "take" as const },
    ];
    const d = diffOrders(resting, desired);
    expect(d.keep.map((r) => r.id)).toEqual([1]);
    expect(d.cancel.map((r) => r.id)).toEqual([2]);
    expect(d.place.map((p) => p.ticker).sort()).toEqual(["B", "C"]);
  });

  it("with a tolerance, keeps a quote one tick safer than the new price instead of churning it", () => {
    const resting = [
      { id: 1, ticker: "A", action: "buy", price: 0.49, count: 1 },
      { id: 2, ticker: "B", action: "sell", price: 0.6, count: 1 },
      { id: 3, ticker: "C", action: "buy", price: 0.52, count: 1 },
    ];
    const desired = [
      { ticker: "A", action: "buy" as const, price: 0.5, count: 1, kind: "quote" as const }, // resting 1¢ lower: safer, keep
      { ticker: "B", action: "sell" as const, price: 0.59, count: 1, kind: "quote" as const }, // resting 1¢ higher: safer, keep
      { ticker: "C", action: "buy" as const, price: 0.5, count: 1, kind: "quote" as const }, // resting 2¢ HIGHER than wanted: cancel
    ];
    const d = diffOrders(resting, desired, 0.01);
    expect(d.keep.map((r) => r.id)).toEqual([1, 2]);
    expect(d.cancel.map((r) => r.id)).toEqual([3]);
    expect(d.place.map((p) => p.ticker)).toEqual(["C"]);
  });
});

describe("paper fill sizes", () => {
  const buy = (id: number, price: number, count: number): RestingOrder => ({ id, ticker: "T", action: "buy", price, count, placedAt: 100 });

  it("fills only what traded through the price; the rest keeps resting", () => {
    const f = paperFills([buy(1, 0.5, 10)], [{ ticker: "T", t: 150, yesPrice: 0.48, count: 3 }], new Map());
    expect(f).toHaveLength(1);
    expect(f[0].count).toBe(3);
    expect(f[0].remaining).toBe(7);
  });

  it("shares one trade between our orders, best price first, never counting it twice", () => {
    const f = paperFills([buy(1, 0.5, 3), buy(2, 0.52, 3)], [{ ticker: "T", t: 150, yesPrice: 0.47, count: 4 }], new Map());
    expect(f.find((x) => x.id === 2)?.count).toBe(3); // the higher bid gets filled first
    expect(f.find((x) => x.id === 1)?.count).toBe(1);
  });

  it("a crossed book fills up to the size shown at that price", () => {
    const f = paperFills([buy(1, 0.5, 10)], [], new Map([["T", { bid: 0.4, ask: 0.45, askSize: 5 }]]));
    expect(f[0].count).toBe(5);
  });

  it("counts a trade with no reported size as one contract, and adds up fractional trades", () => {
    expect(paperFills([buy(1, 0.5, 10)], [{ ticker: "T", t: 150, yesPrice: 0.48 }], new Map())[0].count).toBe(1);
    const frac = [{ ticker: "T", t: 150, yesPrice: 0.48, count: 0.6 }, { ticker: "T", t: 160, yesPrice: 0.49, count: 0.6 }];
    expect(paperFills([buy(1, 0.5, 10)], frac, new Map())[0].count).toBe(1);
    expect(paperFills([buy(1, 0.5, 10)], frac.slice(0, 1), new Map())).toHaveLength(0);
  });

  it("caps takes at the size shown, shared between takes on the same contract", () => {
    const top = new Map([["T", { bid: 0.4, ask: 0.45, askSize: 4, bidSize: 2 }]]);
    const out = capTakes(
      [{ ticker: "T", action: "buy" as const, count: 3 }, { ticker: "T", action: "buy" as const, count: 3 }, { ticker: "T", action: "sell" as const, count: 5 }, { ticker: "U", action: "buy" as const, count: 5 }],
      (t) => top.get(t)
    );
    expect(out.map((o) => `${o.ticker} ${o.action} ${o.count}`)).toEqual(["T buy 3", "T buy 1", "T sell 2", "U buy 1"]);
  });
});
