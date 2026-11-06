import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgStub, type Row } from "./pgStub";

const game = { id: "G1", season: 2026, week: 10, home_team: "Colorado", away_team: "Kansas State", neutral_site: false };

let db: Record<string, Row[]>;
let calls: string[];

beforeEach(() => {
  vi.resetModules(); // a fresh in-memory cache per test
  process.env.BOT_CACHE_DIR = mkdtempSync(join(tmpdir(), "ycpr-cache-test-"));
  db = {
    season_weekly_ratings: [
      { id: 1, season: 2026, week_number: 10, team: "Colorado", rating: -5, updated_at: "2026-11-01T15:00:00Z" },
      { id: 2, season: 2026, week_number: 10, team: "Kansas State", rating: -8, updated_at: "2026-11-01T15:00:00Z" },
    ],
    weekly_team_stats: [{ id: 1, team: "Colorado", week: "week9", rating: -4, updated_at: "2026-10-25T15:00:00Z" }],
  };
  const stub = pgStub(db);
  calls = stub.calls;
  vi.stubGlobal("fetch", stub.fetchStub);
  process.env.SUPABASE_URL ??= "http://stub.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "stub";
});

const ratingReads = () => calls.filter((c) => c.includes("select=team,rating")).length;

describe("YCPR ratings cache", () => {
  it("reuses the ratings while nothing has been saved, and refetches once a table changes", async () => {
    const { ycprAwaySpreads } = await import("./ycpr");
    const first = await ycprAwaySpreads([game]);
    expect(ratingReads()).toBe(1);

    // A later run (fresh process): the in-memory copy is gone, the file is reused.
    vi.resetModules();
    const again = await (await import("./ycpr")).ycprAwaySpreads([game]);
    expect(again.get("G1")).toBe(first.get("G1"));
    expect(ratingReads()).toBe(1);

    // Saving new ratings bumps updated_at: the next run refetches and sees the new number.
    db.season_weekly_ratings[0].rating = -1;
    db.season_weekly_ratings[0].updated_at = "2026-11-02T15:00:00Z";
    vi.resetModules();
    const fresh = await (await import("./ycpr")).ycprAwaySpreads([game]);
    expect(ratingReads()).toBe(2);
    expect(fresh.get("G1")).not.toBe(first.get("G1"));
  });
});
