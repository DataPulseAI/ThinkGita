// In-memory stand-in for the parts of the Supabase client the edge functions use.
// Supports from(table).select/insert/update/delete with eq, neq, gt, gte, lt, lte, in, is, not, or (ignored),
// order/range/limit (ignored), single/maybeSingle and `.select()` after a write. Also rpc() and auth.
// Every call is recorded in `calls`, so tests can assert on exactly what was written. `triggers` can stand in for
// database triggers on update (e.g. the circle rename).
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function createFakeDb(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const calls = [];
  const rpcCalls = [];
  const errors = {}; // "table.op" -> array of queued errors (consumed one per call)
  const rpcResults = {};
  const triggers = {}; // table -> (row, oldRow) => void, run after each updated row changes (stands in for BEFORE UPDATE triggers)
  let nextId = 1;

  class Query {
    constructor(table) { this.table = table; this.op = null; this.filters = []; this.mode = null; this.returning = false; }
    select(cols) { if (this.op) this.returning = true; else { this.op = "select"; this.cols = cols; } return this; }
    insert(rows) { this.op = "insert"; this.payload = rows; return this; }
    upsert(rows) { this.op = "insert"; this.payload = rows; return this; }
    update(patch) { this.op = "update"; this.payload = patch; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push(["eq", c, v]); return this; }
    neq(c, v) { this.filters.push(["neq", c, v]); return this; }
    gt(c, v) { this.filters.push(["gt", c, v]); return this; }
    gte(c, v) { this.filters.push(["gte", c, v]); return this; }
    lt(c, v) { this.filters.push(["lt", c, v]); return this; }
    lte(c, v) { this.filters.push(["lte", c, v]); return this; }
    in(c, v) { this.filters.push(["in", c, v]); return this; }
    is(c, v) { this.filters.push(["is", c, v]); return this; }
    not(c, op, v) { this.filters.push(["not", c, op, v]); return this; }
    or() { return this; }
    order() { return this; }
    range() { return this; }
    limit() { return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    matches(row) {
      return this.filters.every(([kind, c, a, b]) => {
        const v = row[c];
        switch (kind) {
          case "eq": return v === a;
          case "neq": return v !== a;
          case "gt": return v > a;
          case "gte": return v >= a;
          case "lt": return v < a;
          case "lte": return v <= a;
          case "in": return a.includes(v);
          case "is": return (v ?? null) === a;
          case "not": {
            if (a === "is") return (v ?? null) !== b;
            if (a === "in") return !String(b).replace(/[()]/g, "").split(",").includes(String(v));
            return v !== b;
          }
          default: return true;
        }
      });
    }
    run() {
      const key = `${this.table}.${this.op}`;
      calls.push({ table: this.table, op: this.op, payload: clone(this.payload), filters: clone(this.filters) });
      const queued = errors[key]?.shift();
      if (queued) return { data: null, error: queued };
      const rows = (tables[this.table] ??= []);
      let out;
      if (this.op === "select") out = rows.filter((r) => this.matches(r));
      else if (this.op === "update") {
        out = rows.filter((r) => this.matches(r));
        for (const r of out) {
          const before = clone(r);
          Object.assign(r, clone(this.payload));
          triggers[this.table]?.(r, before);
        }
      } else if (this.op === "insert") {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ id: `row-${nextId++}`, ...clone(r) }));
        rows.push(...list);
        out = list;
      } else if (this.op === "delete") {
        out = rows.filter((r) => this.matches(r));
        tables[this.table] = rows.filter((r) => !out.includes(r));
      }
      const data = this.op === "select" || this.returning ? out.map(clone) : null;
      if (this.mode === "single") {
        if (!data || data.length !== 1) return { data: null, error: { message: `expected one row from ${this.table}, got ${data?.length ?? 0}`, code: "PGRST116" } };
        return { data: data[0], error: null };
      }
      if (this.mode === "maybe") return { data: data?.[0] ?? null, error: null };
      return { data, error: null };
    }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  }

  const client = {
    from: (t) => new Query(t),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args: clone(args) });
      const r = rpcResults[name];
      return typeof r === "function" ? r(args) : (r ?? { data: null, error: null });
    },
    auth: {
      getUser: async () => ({ data: { user: { email: "admin@example.org" } }, error: null }),
      admin: { inviteUserByEmail: async () => ({ data: {}, error: null }) },
    },
  };

  return {
    tables, calls, rpcCalls, errors, rpcResults, triggers, client,
    // Calls for one table and operation, e.g. writes("settings", "update").
    writes: (table, op = "update") => calls.filter((c) => c.table === table && c.op === op),
    row: (table, id) => tables[table]?.find((r) => r.id === id),
    // Make a later call fail: `skip` calls to the same table and operation succeed first.
    failNext(table, op, error, skip = 0) {
      const q = (errors[`${table}.${op}`] ??= []);
      for (let i = 0; i < skip; i++) q.push(null);
      q.push(typeof error === "string" ? { message: error } : error);
    },
  };
}

// Point an edge function's exported `db` client at a fake. Returns the fake.
export function attachFake(db, seed) {
  const fake = createFakeDb(seed);
  db.from = fake.client.from;
  db.rpc = fake.client.rpc;
  db.auth = fake.client.auth;
  return fake;
}
