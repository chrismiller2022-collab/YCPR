import { beforeAll, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Supabase tables the room endpoint touches.
const tables: Record<string, any[]> = { calcutta_auctions: [], calcutta_room_members: [], calcutta_bid_requests: [], calcutta_live: [] };
let nextId = 1;
function query(table: string) {
  const filters: [string, any][] = [];
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: any = null;
  let cols = "*";
  let returnRow = false;
  const rows = () => tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
  const project = (r: any) => (cols.startsWith("open:") ? { open: r.state?.roomOpen } : cols === "doc" ? { doc: r.doc } : cols === "id" ? { id: r.id } : { ...r });
  const run = () => {
    if (op === "insert") {
      const t = tables[table];
      if (table === "calcutta_room_members" && t.some((r) => r.auction_id === payload.auction_id && r.participant_id === payload.participant_id)) return { data: null, error: { code: "23505" } };
      const row = { id: nextId++, ...payload };
      t.push(row);
      return { data: returnRow ? { id: row.id } : null, error: null };
    }
    if (op === "update") {
      for (const r of rows()) Object.assign(r, payload);
      return { data: null, error: null };
    }
    if (op === "delete") {
      tables[table] = tables[table].filter((r) => !filters.every(([k, v]) => r[k] === v));
      return { data: null, error: null };
    }
    if (op === "upsert") {
      const i = tables[table].findIndex((r) => r.auction_id === payload.auction_id);
      if (i >= 0) tables[table][i] = payload;
      else tables[table].push(payload);
      return { data: null, error: null };
    }
    return { data: rows().map(project), error: null };
  };
  const b: any = {
    select(c = "*") {
      cols = c;
      if (op === "insert") returnRow = true;
      return b;
    },
    insert(p: any) {
      op = "insert";
      payload = p;
      return b;
    },
    update(p: any) {
      op = "update";
      payload = p;
      return b;
    },
    delete() {
      op = "delete";
      return b;
    },
    upsert(p: any) {
      op = "upsert";
      payload = p;
      return b;
    },
    eq(k: string, v: any) {
      filters.push([k, v]);
      return b;
    },
    maybeSingle: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
    },
    single: async () => run(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => query(t) }) }));

let handler: any;
beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin";
  process.env.VITE_SUPABASE_URL = "http://fake";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  handler = (await import("../../../api/pool-save")).default;
  tables.calcutta_auctions.push({ id: "cal_room1", doc: { participants: [{ id: "p_kal", name: "Kal" }, { id: "p_bot", name: "Bot", bot: {} }] } });
});

async function call(body: any) {
  let status = 200;
  let json: any = null;
  const res = { status: (s: number) => ((status = s), res), json: (j: any) => ((json = j), res), setHeader: () => res };
  await handler({ method: "POST", body }, res);
  return { status, json };
}
const room = (b: any) => call({ pool: "calcutta-room", ...b });

describe("live room endpoint", () => {
  let token = "";

  it("claims a name with a 4-digit PIN, refuses a second claim and bots", async () => {
    expect((await room({ action: "claim", auctionId: "cal_room1", participantId: "p_kal", pin: "12a4" })).status).toBe(400);
    const r = await room({ action: "claim", auctionId: "cal_room1", participantId: "p_kal", pin: "1234" });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("Kal");
    token = r.json.token;
    expect(tables.calcutta_room_members[0].pin_hash).not.toContain("1234");
    expect((await room({ action: "claim", auctionId: "cal_room1", participantId: "p_kal", pin: "9999" })).status).toBe(409);
    expect((await room({ action: "claim", auctionId: "cal_room1", participantId: "p_bot", pin: "1111" })).status).toBe(404);
    expect((await room({ action: "status", auctionId: "cal_room1" })).json.claimed).toEqual(["p_kal"]);
  });

  it("signs in with the right PIN and locks after 5 wrong ones", async () => {
    expect((await room({ action: "login", auctionId: "cal_room1", participantId: "p_kal", pin: "1234" })).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await room({ action: "login", auctionId: "cal_room1", participantId: "p_kal", pin: "0000" })).status).toBe(401);
    const fifth = await room({ action: "login", auctionId: "cal_room1", participantId: "p_kal", pin: "0000" });
    expect(fifth.json.error).toMatch(/locked/);
    expect((await room({ action: "login", auctionId: "cal_room1", participantId: "p_kal", pin: "1234" })).status).toBe(429);
    tables.calcutta_room_members[0].locked_until = null;
  });

  it("only takes bids while the room is open, from a valid token", async () => {
    expect((await room({ action: "bid", token, lotId: "lot_1", amount: 50 })).status).toBe(409); // no live state yet
    // host publishes (admin action) → room open
    expect((await call({ password: "test-admin", pool: "calcutta", action: "live", auctionId: "cal_room1", state: { roomOpen: true } })).status).toBe(200);
    const ok = await room({ action: "bid", token, lotId: "lot_1", amount: 50 });
    expect(ok.status).toBe(200);
    expect(tables.calcutta_bid_requests[0]).toMatchObject({ auction_id: "cal_room1", participant_id: "p_kal", lot_id: "lot_1", kind: "bid", amount: 50 });
    expect((await room({ action: "out", token, lotId: "lot_1" })).json.ok).toBe(true);
    expect((await room({ action: "bid", token: token.slice(0, -2) + "00", lotId: "lot_1", amount: 60 })).status).toBe(401);
    expect((await call({ password: "wrong", pool: "calcutta", action: "live", auctionId: "cal_room1", state: {} })).status).toBe(401);
  });

  it("a PIN reset signs the old device out", async () => {
    expect((await call({ password: "test-admin", pool: "calcutta", action: "resetPin", auctionId: "cal_room1", participantId: "p_kal" })).status).toBe(200);
    const r = await room({ action: "bid", token, lotId: "lot_1", amount: 70 });
    expect(r.status).toBe(401);
  });
});
