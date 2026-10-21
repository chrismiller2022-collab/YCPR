import { describe, expect, it } from "vitest";
import { diffOrders, fillFee, paperFills, type RestingOrder } from "./paperFills";

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
});
