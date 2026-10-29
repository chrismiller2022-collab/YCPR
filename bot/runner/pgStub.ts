export type Row = Record<string, any>;
const FK: Record<string, { table: string; col: string }> = { "bot_fills.bot_orders": { table: "bot_orders", col: "order_id" } };

/**
 * Just enough PostgREST for the hub's API files in tests: GET with select (aliases, ->, one embed), eq/in/gt/gte/lt/
 * is/not.is filters, or=(), order, limit and Range; PATCH (filters, returns the changed rows); POST (insert, or upsert
 * with on_conflict + resolution=merge-duplicates).
 */
export function pgStub(db: Record<string, Row[]>) {
  const calls: string[] = [];
  const parseVal = (v: string) => v.replace(/^"|"$/g, "");
  const test = (row: Row, col: string, expr: string): boolean => {
    const neg = expr.startsWith("not.");
    if (neg) return !test(row, col, expr.slice(4));
    const i = expr.indexOf(".");
    const op = expr.slice(0, i), raw = expr.slice(i + 1);
    const v = row[col];
    const cmp = (x: any) => (typeof v === "number" ? Number(x) : x);
    switch (op) {
      case "eq": return String(v) === raw;
      case "is": return raw === "null" ? v == null : String(v) === raw;
      case "in": return raw.slice(1, -1).split(",").map(parseVal).includes(String(v));
      case "gt": return v != null && v > cmp(raw);
      case "gte": return v != null && v >= cmp(raw);
      case "lt": return v != null && v < cmp(raw);
      case "lte": return v != null && v <= cmp(raw);
    }
    throw new Error(`stub: op ${op}`);
  };
  const fetchStub = async (url: string, init: any = {}) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop()!;
    calls.push(`${table}?${decodeURIComponent(u.search.slice(1))}`);
    const method = init.method ?? "GET";
    if (method === "POST") {
      const items: Row[] = [].concat(JSON.parse(init.body));
      const keys = u.searchParams.get("on_conflict")?.split(",") ?? [];
      const tbl = (db[table] ??= []);
      const out = items.map((it) => {
        const hit = keys.length ? tbl.find((r) => keys.every((k) => String(r[k]) === String(it[k]))) : null;
        if (hit) return Object.assign(hit, it);
        const row = { id: tbl.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1, ...it };
        tbl.push(row);
        return row;
      });
      return { ok: true, status: 201, text: async () => JSON.stringify(out) };
    }
    let rows = [...(db[table] ?? [])];
    if (method === "PATCH") {
      for (const [k, v] of u.searchParams) rows = rows.filter((r) => test(r, k, v));
      const patch = JSON.parse(init.body);
      for (const r of rows) Object.assign(r, patch);
      return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
    }
    let select = "*", order = "", limit = Infinity;
    for (const [k, v] of u.searchParams) {
      if (k === "select") select = v;
      else if (k === "order") order = v;
      else if (k === "limit") limit = Number(v);
      else if (k === "or") {
        const parts = v.slice(1, -1).split(",").map((p) => { const j = p.indexOf("."); return [p.slice(0, j), p.slice(j + 1)]; });
        rows = rows.filter((r) => parts.some(([c, e]) => test(r, c, e)));
      } else rows = rows.filter((r) => test(r, k, v));
    }
    if (order) {
      const keys = order.split(",").map((o) => { const [c, dir] = o.split("."); return { c, desc: dir === "desc" }; });
      rows.sort((a, b) => { for (const { c, desc } of keys) { if (a[c] === b[c]) continue; if (a[c] == null) return 1; if (b[c] == null) return -1; return (a[c] < b[c] ? -1 : 1) * (desc ? -1 : 1); } return 0; });
    }
    const range = init.headers?.Range as string | undefined;
    if (range) { const [a, b] = range.split("-").map(Number); rows = rows.slice(a, b + 1); }
    rows = rows.slice(0, Math.min(limit, 1000));
    const cols = select.match(/[^,(]+(\([^)]*\))?/g)!;
    const out = rows.map((r) => {
      if (select === "*") return { ...r };
      const o: Row = {};
      for (const c of cols) {
        const embed = /^(?:(\w+):)?(\w+)\(([^)]*)\)$/.exec(c);
        if (embed) {
          const [, alias, tbl, sub] = embed;
          const fk = FK[`${table}.${tbl}`];
          const t = (db[fk.table] ?? []).find((x) => x.id === r[fk.col]);
          o[alias || tbl] = t ? Object.fromEntries(sub.split(",").map((s) => [s, t[s]])) : null;
          continue;
        }
        const [alias, path] = c.includes(":") ? c.split(":") : [null, c];
        const [col, key] = path.split("->");
        o[alias || key || col] = key ? r[col]?.[key] ?? null : r[col];
      }
      return o;
    });
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  return { fetchStub, calls };
}

