import { describe, expect, it } from "vitest";
import { isQuietHours } from "./quietHours";

// November: Eastern = UTC-5.
const et = (hour: number) => new Date(Date.UTC(2026, 10, 7, (hour + 5) % 24, 30));

describe("quiet hours", () => {
  it("is quiet 9pm-9am Eastern by default", () => {
    expect(isQuietHours(et(20), "21-9")).toBe(false);
    expect(isQuietHours(et(21), "21-9")).toBe(true);
    expect(isQuietHours(et(2), "21-9")).toBe(true);
    expect(isQuietHours(et(8), "21-9")).toBe(true);
    expect(isQuietHours(et(9), "21-9")).toBe(false);
    expect(isQuietHours(et(15), "21-9")).toBe(false);
  });
  it("can be changed or turned off", () => {
    expect(isQuietHours(et(23), "off")).toBe(false);
    expect(isQuietHours(et(23), "22-8")).toBe(true);
    expect(isQuietHours(et(21), "22-8")).toBe(false);
    expect(isQuietHours(et(13), "12-14")).toBe(true);
    expect(isQuietHours(et(13), "nonsense")).toBe(false);
  });
});
