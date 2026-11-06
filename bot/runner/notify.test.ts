import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgStub, type Row } from "./pgStub";

const HOOK = "https://discord.test/api/webhooks/bot";
const USAGE_HOOK = "https://discord.test/api/webhooks/usage";
let posts: { url: string; content: string }[];
let db: Record<string, Row[]>;
const summary = (bytes: number) => ({
  bytes,
  jobs: [{ job: "record", runs: 144, bytes: bytes * 0.8, requests: 3000 }, { job: "paper", runs: 960, bytes: bytes * 0.2, requests: 6000 }],
  tables: [{ tbl: "bot_mkt_snaps", bytes: bytes * 0.6 }],
});

beforeEach(() => {
  vi.resetModules();
  process.env.BOT_CACHE_DIR = mkdtempSync(join(tmpdir(), "notify-test-"));
  process.env.SUPABASE_URL = "http://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.DISCORD_WEBHOOK_URL = HOOK;
  process.env.DISCORD_USAGE_WEBHOOK_URL = USAGE_HOOK;
  posts = [];
  db = { bot_runs: [] };
  const sb = pgStub(db).fetchStub;
  vi.stubGlobal("fetch", async (url: string, init: any = {}) => {
    if (url.startsWith("https://discord.test/")) {
      posts.push({ url, content: JSON.parse(init.body).content });
      return { ok: true, status: 204, text: async () => "" };
    }
    if (url.includes("/rpc/bot_egress_summary")) {
      const { p_from, p_to } = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify(summary(p_from === p_to ? 12e6 : 60e6)) };
    }
    return sb(url, init);
  });
});

describe("Discord alerts", () => {
  it("sends nothing without a webhook", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_USAGE_WEBHOOK_URL;
    const { notifyErrors, maybeUsageReport } = await import("./notify");
    expect(await notifyErrors("paper", ["boom"])).toBe(0);
    expect(await maybeUsageReport(Date.UTC(2026, 10, 7, 15))).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("groups a job's errors into one message and repeats a problem at most every 30 minutes", async () => {
    const { notifyErrors, errorLines } = await import("./notify");
    const t0 = Date.UTC(2026, 10, 7, 15);
    const lines = errorLines({ gameErrors: ["Supabase 402 on bot_runs"], venueErrors: { kalshi: "Kalshi 500 on /markets" } });
    expect(await notifyErrors("paper", lines, t0)).toBe(2);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(HOOK);
    expect(posts[0].content).toContain("Supabase 402 on bot_runs");
    expect(posts[0].content).toContain("kalshi: Kalshi 500 on /markets");
    // Same problems (numbers differ) 10 minutes later, in a fresh process: skipped.
    vi.resetModules();
    const again = await import("./notify");
    expect(await again.notifyErrors("paper", ["Supabase 503 on bot_runs"], t0 + 10 * 60e3)).toBe(0);
    // A new problem still goes out, and the old one does again after 30 minutes.
    expect(await again.notifyErrors("paper", ["ESPN finals: timeout"], t0 + 11 * 60e3)).toBe(1);
    expect(await again.notifyErrors("paper", ["Supabase 402 on bot_runs"], t0 + 31 * 60e3)).toBe(1);
    expect(posts).toHaveLength(3);
  });

  it("posts yesterday's usage to #usage once, after 9am Eastern", async () => {
    const { maybeUsageReport } = await import("./notify");
    const eightAmEt = Date.UTC(2026, 10, 7, 13); // November: Eastern = UTC-5
    expect(await maybeUsageReport(eightAmEt)).toBe(false);
    const tenAmEt = Date.UTC(2026, 10, 7, 15);
    expect(await maybeUsageReport(tenAmEt)).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(USAGE_HOOK);
    expect(posts[0].content).toContain("Fri, Nov 6:** 12 MB (7% of the ~164 MB/day free-plan budget)");
    expect(posts[0].content).toContain("record: 9.6 MB in 144 runs");
    expect(posts[0].content).toContain("Month so far (bot only): 60 MB");
    expect(db.bot_runs.some((r) => r.mode === "usage-report-2026-11-06")).toBe(true);
    // Later the same day, even in a fresh process on another host (no local state): not sent again.
    vi.resetModules();
    process.env.BOT_CACHE_DIR = mkdtempSync(join(tmpdir(), "notify-test-"));
    expect(await (await import("./notify")).maybeUsageReport(tenAmEt + 3600e3)).toBe(false);
    expect(posts).toHaveLength(1);
  });
});
