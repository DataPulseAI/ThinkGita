// A fake Supabase backend for the end-to-end tests. Every request the app makes to *.supabase.co is answered here
// from an in-memory copy of tests/fixtures/data.js, so nothing ever reaches the real database, Zoom, email or Framer.
//
//   const mock = await mockBackend(page, { "fn provision-circle cancel": fail("Zoom said no", 500) });
//   mock.db.circles.push(...)                    change data before the page loads
//   mock.handle("DELETE circles", () => [])      answer one kind of request differently (return undefined to fall through)
//   mock.rest("circles", "PATCH")                every PATCH the UI sent to /rest/v1/circles: [{ method, query, body }]
//   mock.fn("provision-circle", "cancel")        every body POSTed to that edge function (optionally one action)
//
// Handler keys: "<METHOD> <table>" for REST tables, "rpc <name>", "fn <function>" or "fn <function> <action>",
// "auth <path>" (for example "auth token"). A handler gets the parsed request and returns plain data (sent as 200 JSON),
// reply(status, body) for anything else, or undefined to use the default behaviour below.
import { buildFixtures, ADMIN_EMAIL } from "../../fixtures/data.js";

const REPLY = Symbol("reply");
export const reply = (status, body, headers = {}) => ({ [REPLY]: true, status, body, headers });
// An error in the shape both PostgREST (message) and the edge functions (error) use.
export const fail = (message, status = 400) => reply(status, { message, error: message, code: "P0001", details: null, hint: null });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const mocks = new WeakMap();
export const mockFor = (page) => mocks.get(page);

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

// PostgREST filters used by the app: eq, neq, is, in, not.in, like, gt/gte/lt/lte.
function matches(row, query) {
  for (const [col, raw] of Object.entries(query)) {
    if (RESERVED.has(col)) continue;
    const v = row[col];
    const s = v == null ? null : String(v);
    let m;
    if ((m = raw.match(/^not\.in\.\((.*)\)$/))) { if (m[1].split(",").includes(s)) return false; }
    else if ((m = raw.match(/^in\.\((.*)\)$/))) { if (!m[1].split(",").includes(s)) return false; }
    else if ((m = raw.match(/^eq\.(.*)$/s))) { if (s !== m[1]) return false; }
    else if ((m = raw.match(/^neq\.(.*)$/s))) { if (s === m[1]) return false; }
    else if ((m = raw.match(/^is\.(.*)$/))) { if (m[1] === "null" ? v != null : String(v) !== m[1]) return false; }
    else if ((m = raw.match(/^like\.(.*)$/))) {
      const re = new RegExp(`^${m[1].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`);
      if (!re.test(s ?? "")) return false;
    } else if ((m = raw.match(/^(gt|gte|lt|lte)\.(.*)$/))) {
      if (s == null) return false;
      const [a, b] = [s, m[2]];
      if (m[1] === "gt" && !(a > b)) return false;
      if (m[1] === "gte" && !(a >= b)) return false;
      if (m[1] === "lt" && !(a < b)) return false;
      if (m[1] === "lte" && !(a <= b)) return false;
    }
  }
  return true;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(",").map((p) => { const [col, dir] = p.split("."); return { col, desc: dir === "desc" }; });
  return [...rows].sort((a, b) => {
    for (const { col, desc } of keys) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : 1;
      return desc ? -c : c;
    }
    return 0;
  });
}

export async function mockBackend(page, overrides = {}) {
  const db = buildFixtures();
  const handlers = new Map(Object.entries(overrides));
  const log = [];          // every request to Supabase
  const errorUrls = new Set(); // URLs answered with an error status on purpose (their console noise is expected)
  let seq = 1000;

  const mock = {
    db,
    log,
    errorUrls,
    user: { email: ADMIN_EMAIL },
    unhandled: [],
    handle(key, fn) { handlers.set(key, fn); return mock; },
    // Write requests (and RPCs) sent to a REST table, optionally of one method.
    rest(table, method) { return log.filter((r) => r.kind === "rest" && r.table === table && r.method !== "GET" && r.method !== "HEAD" && (!method || r.method === method)); },
    rpc(name) { return log.filter((r) => r.kind === "rpc" && r.name === name).map((r) => r.body); },
    fn(name, action) { return log.filter((r) => r.kind === "fn" && r.name === name && (!action || r.body?.action === action)).map((r) => r.body); },
    writes() { return log.filter((r) => (r.kind === "rest" && !["GET", "HEAD"].includes(r.method)) || r.kind === "fn" || r.kind === "rpc"); },
    uploads() { return log.filter((r) => r.kind === "storage" && r.method !== "GET").map((r) => r.path); },
  };
  mocks.set(page, mock);

  const lic = (id) => { const l = db.licences.find((x) => x.id === id); return l ? { label: l.label, is_mock: l.is_mock, host_key: l.host_key } : null; };
  const fac = (id) => db.facilitators.find((f) => f.id === id) ?? null;
  // The joins the app asks for in its selects.
  function expand(table, rows, select = "") {
    if (table === "circles" && /facilitator:/.test(select)) {
      return rows.map((c) => ({
        ...c,
        facilitator: fac(c.facilitator_id),
        cofacilitators: db.circle_cofacilitators.filter((x) => x.circle_id === c.id).map((x) => ({ facilitator: fac(x.facilitator_id) })),
        licence: lic(c.licence_id),
      }));
    }
    if (table === "change_requests" && /circle:/.test(select)) {
      return rows.map((r) => ({ ...r, circle: { name: db.circles.find((c) => c.id === r.circle_id)?.name ?? null } }));
    }
    return rows;
  }

  function myCircles() {
    const me = db.facilitators.find((f) => f.email === mock.user.email);
    const s = db.settings[0];
    return sortRows(db.circles.filter((c) => me && (c.facilitator_id === me.id || db.circle_cofacilitators.some((x) => x.circle_id === c.id && x.facilitator_id === me.id))), "weekday.asc,start_time.asc")
      .map((c) => ({
        id: c.id, name: c.name, weekday: c.weekday, start_time: c.start_time, duration_min: c.duration_min, timezone: c.timezone, status: c.status,
        join_url: c.join_url, zoom_meeting_id: c.zoom_meeting_id, passcode: c.passcode, host_key: c.status === "live" ? lic(c.licence_id)?.host_key ?? null : null,
        starts_on: c.starts_on, ends_on: c.ends_on, whatsapp_group_link: c.whatsapp_group_link,
        participant_signup_link: c.participant_signup_link ?? s.participant_signup_link?.replace("{circle_code}", c.id.slice(0, 8)) ?? null,
        youtube_playlist_link: c.youtube_playlist_link ?? s.youtube_playlist_link, drive_folder_link: c.drive_folder_link ?? s.drive_folder_link,
      }));
  }

  // Default answers for each kind of request.
  function restDefault(req) {
    const { method, table, query, body, single } = req;
    if (!(table in db)) { mock.unhandled.push(`${method} ${table}`); db[table] = []; }
    const rows = db[table];
    const hit = rows.filter((r) => matches(r, query));
    const out = (list) => {
      if (single) return list.length === 1 ? list[0] : reply(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return query.select || method === "GET" ? list : reply(204, null);
    };
    if (method === "HEAD") return reply(200, null, { "content-range": hit.length ? `0-${hit.length - 1}/${hit.length}` : "*/0" });
    if (method === "GET") {
      let list = sortRows(hit, query.order);
      const offset = Number(query.offset ?? 0);
      if (query.limit) list = list.slice(offset, offset + Number(query.limit));
      return out(expand(table, list, query.select));
    }
    if (method === "PATCH") {
      for (const r of hit) Object.assign(r, body);
      return out(expand(table, hit, query.select));
    }
    if (method === "DELETE") {
      db[table] = rows.filter((r) => !hit.includes(r));
      return out(hit);
    }
    if (method === "POST") {
      const dbDefaults = table === "change_requests" ? { status: "open", requested_by: mock.user.email } : {};
      const items = (Array.isArray(body) ? body : [body]).map((b) => ({ ...(table === "email_templates" || table === "admin_emails" ? {} : { id: `${table}-${++seq}` }), created_at: new Date().toISOString(), ...dbDefaults, ...b }));
      for (const it of items) {
        const key = table === "email_templates" ? "key" : table === "admin_emails" ? "email" : "id";
        const i = rows.findIndex((r) => r[key] === it[key]);
        if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push(it);
      }
      return out(items);
    }
    return reply(405, { message: `mock: ${method} not supported` });
  }

  function rpcDefault({ name, body }) {
    switch (name) {
      case "my_circles_v2": return myCircles();
      case "update_my_profile": {
        const me = db.facilitators.find((f) => f.email === mock.user.email);
        if (!me) return reply(400, { code: "P0001", message: "not_a_facilitator: no facilitator profile for this sign-in" });
        const v = (x) => (String(x ?? "").trim() || null);
        Object.assign(me, { initiated_name: v(body.p_initiated_name), first_name: v(body.p_first_name), last_name: v(body.p_last_name), phone: v(body.p_phone), photo_url: v(body.p_photo_url) });
        return me;
      }
      case "allocate_circle": {
        const c = db.circles.find((x) => x.id === body.p_circle);
        if (c && c.status === "pending" && !c.licence_id) c.licence_id = db.licences[0].id;
        return { status: c?.status === "conflict" ? "conflict" : "pending" };
      }
      case "suggest_slots": case "slot_holders": case "free_licences_for_circle": return [];
      case "recheck_conflicts": return 0;
      case "save_settings": return null;
      default: mock.unhandled.push(`rpc ${name}`); return null;
    }
  }

  function fnDefault({ name, body }) {
    const a = body?.action;
    if (name === "framer-sync") {
      if (a === "snapshot") return db.framer_items;
      if (a === "preview") return db.framer_preview;
      if (a === "set_item") return { ok: true, published: true };
      if (a === "publish") return { published: true };
      return { created: 0, updated: 0, hidden: 0, skipped: 0, errors: [], published: false };
    }
    if (name === "provision-circle") {
      const c = db.circles.find((x) => x.id === body.circle_id);
      switch (a) {
        case "provision":
          if (c) c.status = "live";
          return { ok: true, mock: false, email: body.notify === false ? "not sent (approved without email)" : "sent", invite: body.notify === false ? undefined : "invited" };
        case "cancel": if (c) c.status = "ended"; return { ok: true };
        case "move_licence": { const l = db.licences.find((x) => x.id === body.licence_id); if (c) c.licence_id = body.licence_id; return { licence: l?.label, email: "sent" }; }
        case "reschedule": if (c) Object.assign(c, body.patch); return { email: "sent" };
        case "resend": case "handover": return { email: "sent" };
        case "test_email": return { to: mock.user.email };
        case "invite_admin": return { invite: "invited" };
        case "sync_attendance": return { sessions_added: 0, more: false, problems: [] };
        case "list_zoom_meetings": return { accounts: [] };
        case "set_host_key": return { label: "Zoom 03", host_key: "654321" };
        case "sync_licences": return { licensed: 3, zoom_users: 4, results: [] };
        default: return {};
      }
    }
    mock.unhandled.push(`fn ${name}`);
    return {};
  }

  async function answer(route, req, fallback) {
    const keys = req.kind === "fn" ? [`fn ${req.name} ${req.body?.action ?? ""}`.trim(), `fn ${req.name}`]
      : req.kind === "rpc" ? [`rpc ${req.name}`]
      : req.kind === "auth" ? [`auth ${req.name}`]
      : [`${req.method} ${req.table}`];
    let res;
    for (const k of keys) {
      const h = handlers.get(k);
      if (h === undefined) continue;
      res = typeof h === "function" ? await h(req, mock) : h;
      if (res !== undefined) break;
    }
    if (res === undefined) res = fallback(req);
    const r = res && res[REPLY] ? res : reply(200, res);
    if (r.status >= 400) errorUrls.add(req.url);
    const hasBody = r.status !== 204 && req.method !== "HEAD" && r.body !== undefined;
    return route.fulfill({
      status: r.status,
      headers: { ...CORS, ...(hasBody ? { "content-type": "application/json" } : {}), ...r.headers },
      body: hasBody ? JSON.stringify(r.body) : "",
    });
  }

  // Everything that would leave the machine is answered here; the app itself (localhost) is served normally.
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS, body: "" });
    if (!url.hostname.endsWith(".supabase.co")) {
      // External assets (fonts, photos on the website preview): answer harmlessly so nothing is fetched.
      if (request.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      if (request.resourceType() === "stylesheet") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      return route.fulfill({ status: 204, body: "" });
    }
    const raw = request.postData();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const query = Object.fromEntries(url.searchParams.entries());
    const accept = request.headers()["accept"] ?? "";
    const p = url.pathname;
    let req;
    if (p.startsWith("/rest/v1/rpc/")) req = { kind: "rpc", name: p.slice("/rest/v1/rpc/".length), method, query, body, url: request.url() };
    else if (p.startsWith("/rest/v1/")) req = { kind: "rest", table: p.slice("/rest/v1/".length), method, query, body, single: accept.includes("vnd.pgrst.object"), url: request.url() };
    else if (p.startsWith("/functions/v1/")) req = { kind: "fn", name: p.slice("/functions/v1/".length), method, body, url: request.url() };
    else if (p.startsWith("/auth/v1/")) req = { kind: "auth", name: p.slice("/auth/v1/".length), method, query, body, url: request.url() };
    else if (p.startsWith("/storage/v1/object/")) req = { kind: "storage", path: p.slice("/storage/v1/object/".length), method, url: request.url() };
    else req = { kind: "other", method, url: request.url() };
    log.push(req);

    if (req.kind === "rest") return answer(route, req, restDefault);
    if (req.kind === "rpc") return answer(route, req, rpcDefault);
    if (req.kind === "fn") return answer(route, req, fnDefault);
    if (req.kind === "storage") {
      // Public photo URLs load as a tiny PNG; uploads succeed unless a test says otherwise.
      if (method === "GET") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      const h = handlers.get(`storage ${method}`);
      const res = h === undefined ? { Key: req.path, Id: `obj-${++seq}` } : typeof h === "function" ? await h(req, mock) : h;
      const r = res && res[REPLY] ? res : reply(200, res);
      if (r.status >= 400) errorUrls.add(req.url);
      return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(r.body) });
    }
    if (req.kind === "auth") {
      return answer(route, req, ({ name }) => {
        if (name === "logout") return reply(204, null);
        if (name === "user") return { id: "user-1", email: mock.user.email, aud: "authenticated", role: "authenticated" };
        mock.unhandled.push(`auth ${name}`);
        return reply(400, { error: "unsupported", error_description: "mock: not supported" });
      });
    }
    mock.unhandled.push(`${method} ${p}`);
    return route.fulfill({ status: 404, headers: CORS, body: "" });
  });

  return mock;
}

