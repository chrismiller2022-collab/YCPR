import { describe, expect, it } from "vitest";
import { botHealth, cutOff, type RunRow } from "./health";

const NOW = Date.parse("2026-10-24T09:56:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60e3).toISOString();
/** A finished run that started `minAgo` minutes ago and took `took` seconds. */
const run = (mode: string, minAgo: number, took = 60, extra: Partial<RunRow> = {}): RunRow => ({
  mode, started_at: at(minAgo), finished_at: new Date(NOW - minAgo * 60e3 + took * 1000).toISOString(), error: null, ...extra,
});
const healthy = (shift = 0): RunRow[] => [
  run("paper", 1 + shift), run("paper", 2.5 + shift), run("paper", 4 + shift),
  run("record", 3 + shift, 45), run("pxtape", 2 + shift, 280), run("hypo", 30 + shift, 50),
];

describe("bot health", () => {
  it("is Live when every job is recent", () => {
    const h = botHealth(healthy(), NOW);
    expect(h.level).toBe("ok");
    expect(h.label).toBe("Live");
    expect(h.jobs.find((j) => j.mode === "espn")!.level).toBe("off");
  });

  it("blames the tower when every job stopped at the same moment (this morning)", () => {
    // Paper, recorder and listener last seen ~58 min ago; the listener's last run never finished.
    const runs = [...healthy(57), { mode: "pxtape", started_at: at(58), finished_at: null, error: null }];
    const h = botHealth(runs, NOW);
    expect(h.level).toBe("bad");
    expect(h.source).toBe("tower");
    expect(h.detail).toMatch(/Tower offline/);
    expect(h.since).not.toBeNull();
    expect(cutOff(runs[runs.length - 1], NOW)).toBe(true);
  });

  it("blames the paper loop when the recorder and listener are still alive", () => {
    const runs = [run("paper", 20), run("record", 2, 45), run("pxtape", 1, 280), run("hypo", 30)];
    const h = botHealth(runs, NOW);
    expect(h.source).toBe("paper");
    expect(h.detail).toMatch(/tower is up/);
  });

  it("names the error when the paper cycle is failing", () => {
    const runs = [run("paper", 8, 5, { error: "Supabase 500" }), run("paper", 9.5, 5, { error: "Supabase 500" }), run("record", 2), run("pxtape", 1)];
    expect(botHealth(runs, NOW).detail).toMatch(/failing: Supabase 500/);
  });

  it("turns amber when cycles are slow, and on a venue error, with the venue named", () => {
    expect(botHealth([run("paper", 4.5), run("record", 2), run("pxtape", 1), run("hypo", 10)], NOW).label).toBe("Slow");
    const v = botHealth([run("paper", 1, 60, { venueErrors: { novig: "Novig 429 on /catalog/markets" } }), run("record", 2), run("pxtape", 1), run("hypo", 10)], NOW);
    expect(v.level).toBe("warn");
    expect(v.source).toBe("venue");
    expect(v.detail).toMatch(/Novig: Novig 429/);
  });

  it("flags another job that stopped while trading is fine", () => {
    const h = botHealth([run("paper", 1), run("record", 2), run("pxtape", 1), run("hypo", 200)], NOW);
    expect(h.level).toBe("warn");
    expect(h.detail).toMatch(/Hypotheticals stopped/);
  });

  it("treats an unfinished run as running until its time limit, then as cut off", () => {
    expect(cutOff({ mode: "paper", started_at: at(1), finished_at: null, error: null }, NOW)).toBe(false);
    expect(cutOff({ mode: "paper", started_at: at(7), finished_at: null, error: null }, NOW)).toBe(true);
    expect(cutOff({ mode: "hypo", started_at: at(70), finished_at: at(1), error: "timed out" }, NOW)).toBe(true);
  });
});

describe("bot health with hosts", () => {
  const tagged = (mode: string, minAgo: number, host: string, took = 60): RunRow => ({ ...run(mode, minAgo, took), host });

  it("is Live when the tower made the last cycle", () => {
    const h = botHealth([tagged("paper", 1, "tower"), tagged("record", 2, "tower", 45), tagged("pxtape", 1, "tower", 200), tagged("hypo", 20, "tower")], NOW, { towerLast: at(0.5) });
    expect(h.level).toBe("ok");
    expect(h.lastCycleHost).toBe("tower");
  });

  it("says Backup, not Live, right after a GitHub cycle while the tower is down", () => {
    const runs = [tagged("paper", 1, "github"), tagged("record", 0.5, "github", 20), tagged("hypo", 0.2, "github", 10)];
    const h = botHealth(runs, NOW, { towerLast: at(5300) });
    expect(h.level).toBe("warn");
    expect(h.label).toBe("Backup");
    expect(h.source).toBe("tower");
    expect(h.since).toBe(at(5300));
    expect(h.detail).toMatch(/Tower offline for 3\.7 days\. Trading on backups only: the last cycle ran on GitHub/);
  });

  it("is Down since the tower's last run once the backup cycle is old too", () => {
    const h = botHealth([tagged("paper", 90, "vercel"), tagged("record", 89, "vercel")], NOW, { towerLast: at(5300) });
    expect(h.level).toBe("bad");
    expect(h.since).toBe(at(5300));
    expect(h.detail).toMatch(/last cycle ran on Vercel 89 min ago/);
    expect(h.jobs.find((j) => j.mode === "paper")!.note).toMatch(/last run on Vercel/);
  });

  it("falls back to the old rules for runs from before hosts were saved", () => {
    expect(botHealth(healthy(), NOW, { towerLast: null }).level).toBe("ok");
  });
});
