import { afterEach, describe, expect, it, vi } from "vitest";
import { espnDate, finalsFrom, syncEspnFinals } from "./espnFinals";

// bot/runner/io.ts reads these when it loads.
vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://db";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

const ev = (id: string, home: [string, string], away: [string, string], completed = true) => ({
  id,
  status: { type: { completed } },
  competitions: [{ competitors: [
    { homeAway: "home", score: home[1], team: { location: home[0], displayName: home[0] } },
    { homeAway: "away", score: away[1], team: { location: away[0], displayName: away[0] } },
  ] }],
});
const g = (id: string, home_team: string, away_team: string) => ({ id, start_date: "2026-10-17T19:30:00Z", home_team, away_team });

describe("ESPN finals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ESPN's day is the US Eastern date", () => {
    expect(espnDate("2026-10-18T02:30:00Z")).toBe("20261017"); // 10:30 PM Saturday ET
    expect(espnDate("2026-10-17T19:30:00Z")).toBe("20261017");
  });

  it("takes completed events for pending games, flips a swapped home/away, skips a mismatch", () => {
    const pending = [g("1", "Georgia", "Auburn"), g("2", "Texas", "Oklahoma"), g("3", "Alabama", "LSU"), g("4", "Ohio State", "Michigan")];
    const events = [
      ev("1", ["Georgia", "24"], ["Auburn", "27"]),
      ev("2", ["Oklahoma", "10"], ["Texas", "31"]), // ESPN lists it the other way round
      ev("3", ["Alabama", "14"], ["LSU", "7"], false), // still playing
      ev("4", ["Penn State", "20"], ["Michigan", "17"]), // names disagree: leave it to CFBD
      ev("9", ["Iowa", "3"], ["Iowa State", "0"]), // not one of ours
    ];
    expect(finalsFrom(events, pending)).toEqual([
      { id: "1", home_points: 24, away_points: 27 },
      { id: "2", home_points: 31, away_points: 10 },
    ]);
  });

  it("only calls ESPN when a game should be over, and saves only still-open rows", async () => {
    const calls: string[] = [];
    let pending = [g("1", "Georgia", "Auburn")];
    vi.stubGlobal("fetch", async (url: string, init: any = {}) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      const body = url.startsWith("http://db/rest/v1/games?select") ? pending : init.method === "PATCH" ? [{}] : { events: [ev("1", ["Georgia", "24"], ["Auburn", "27"])] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    expect(await syncEspnFinals()).toEqual({ pending: 1, saved: 1 });
    const patch = calls.find((c) => c.startsWith("PATCH"))!;
    expect(patch).toContain("id=eq.1&completed=not.is.true");
    expect(calls.filter((c) => c.includes("espn.com"))).toHaveLength(2); // FBS and FCS for one day
    pending = [];
    calls.length = 0;
    expect(await syncEspnFinals()).toEqual({ pending: 0, saved: 0 });
    expect(calls.some((c) => c.includes("espn.com"))).toBe(false);
  });
});
