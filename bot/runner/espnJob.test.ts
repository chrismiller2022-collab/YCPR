import { afterEach, describe, expect, it, vi } from "vitest";
import { pgStub, type Row } from "./pgStub";

vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://db";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});
const runCycle = vi.fn(async () => ({ games: 3, espnFinals: 2 }));
const syncEspnFinals = vi.fn(async () => ({ pending: 4, saved: 1 }));
vi.mock("./paper", () => ({ runCycle }));
vi.mock("./espnFinals", () => ({ syncEspnFinals }));
const { runEspnJob } = await import("./espnJob");

const NOW = Date.parse("2026-10-24T18:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60e3).toISOString();
function setup(paperFinishedMinAgo: number | null) {
  const db: Record<string, Row[]> = {
    bot_runs: paperFinishedMinAgo == null ? [] : [{ id: 1, mode: "paper", started_at: ago(paperFinishedMinAgo + 1), finished_at: ago(paperFinishedMinAgo), error: null }],
  };
  vi.stubGlobal("fetch", pgStub(db).fetchStub);
  return db;
}

describe("ESPN backup + failover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    runCycle.mockClear();
    syncEspnFinals.mockClear();
  });

  it("only saves ESPN finals while the tower is cycling", async () => {
    const db = setup(2);
    const onFailover = vi.fn();
    const r = await runEspnJob({ now: () => NOW, onFailover });
    expect(r).toMatchObject({ failover: false, pending: 4, saved: 1, quietMin: 2 });
    expect(runCycle).not.toHaveBeenCalled();
    expect(onFailover).not.toHaveBeenCalled();
    const row = db.bot_runs.find((x) => x.mode === "espn")!;
    expect(row.finished_at).toBeTruthy();
    expect(row.summary).toMatchObject({ failover: false, saved: 1 });
  });

  it("runs a full paper cycle (and starts the recorder) when no cycle finished for 10+ minutes", async () => {
    setup(58);
    const onFailover = vi.fn();
    const r = await runEspnJob({ now: () => NOW, onFailover });
    expect(r).toMatchObject({ failover: true, saved: 2, games: 3, quietMin: 58 });
    expect(runCycle).toHaveBeenCalledOnce();
    expect(onFailover).toHaveBeenCalledOnce();
    expect(syncEspnFinals).not.toHaveBeenCalled();
  });

  it("fails over when there's never been a cycle, and skips while another backup run is in progress", async () => {
    const db = setup(null);
    expect((await runEspnJob({ now: () => NOW })).failover).toBe(true);
    db.bot_runs.push({ id: 9, mode: "espn", started_at: new Date().toISOString(), finished_at: null, error: null });
    expect(await runEspnJob()).toMatchObject({ overlapped: true });
  });
});
