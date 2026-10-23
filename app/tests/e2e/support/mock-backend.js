// A fake Supabase backend for the end-to-end tests. Every request the app makes to *.supabase.co is answered here
// from an in-memory copy of tests/fixtures/data.js, so nothing ever reaches the real database, Zoom, email or Framer.
// The answers themselves come from src/demo/mockCore.js (shared with the demo build); this file plugs it into Playwright.
//
//   const mock = await mockBackend(page, { "fn provision-circle cancel": fail("Zoom said no", 500) });
//   mock.db.circles.push(...)                    change data before the page loads
//   mock.handle("DELETE circles", () => [])      answer one kind of request differently (return undefined to fall through)
//   mock.rest("circles", "PATCH")                every PATCH the UI sent to /rest/v1/circles: [{ method, query, body }]
//   mock.fn("provision-circle", "cancel")        every body POSTed to that edge function (optionally one action)
//
// Handler keys: "<METHOD> <table>" for REST tables, "rpc <name>", "fn <function>" or "fn <function> <action>",
// "auth <path>" (for example "auth token"). A handler gets the parsed request and returns plain data (sent as 200 JSON),
// reply(status, body) for anything else, or undefined to use the default behaviour.
import { buildFixtures, ADMIN_EMAIL } from "../../fixtures/data.js";
import { createMockCore, parseRequest, reply, fail } from "../../../src/demo/mockCore.js";

export { reply, fail };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const mocks = new WeakMap();
export const mockFor = (page) => mocks.get(page);

export async function mockBackend(page, overrides = {}) {
  const db = buildFixtures();
  const handlers = new Map(Object.entries(overrides));
  const log = [];          // every request to Supabase
  const errorUrls = new Set(); // URLs answered with an error status on purpose (their console noise is expected)
  const user = { email: ADMIN_EMAIL };
  const unhandled = [];

  const mock = {
    db,
    log,
    errorUrls,
    user,
    unhandled,
    handle(key, fn) { handlers.set(key, fn); return mock; },
    // Write requests (and RPCs) sent to a REST table, optionally of one method.
    rest(table, method) { return log.filter((r) => r.kind === "rest" && r.table === table && r.method !== "GET" && r.method !== "HEAD" && (!method || r.method === method)); },
    rpc(name) { return log.filter((r) => r.kind === "rpc" && r.name === name).map((r) => r.body); },
    fn(name, action) { return log.filter((r) => r.kind === "fn" && r.name === name && (!action || r.body?.action === action)).map((r) => r.body); },
    writes() { return log.filter((r) => (r.kind === "rest" && !["GET", "HEAD"].includes(r.method)) || r.kind === "fn" || r.kind === "rpc"); },
    uploads() { return log.filter((r) => r.kind === "storage" && r.method !== "GET").map((r) => r.path); },
  };
  mocks.set(page, mock);
  const core = createMockCore({ db, user, handlers, unhandled });

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
    const req = parseRequest(request.url(), method, request.postData(), request.headers()["accept"] ?? "");
    log.push(req);
    if (req.kind === "other") {
      unhandled.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 404, headers: CORS, body: "" });
    }
    const r = await core.handle(req, mock);
    if (r.image) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (r.status >= 400) errorUrls.add(req.url);
    const hasBody = r.status !== 204 && req.method !== "HEAD" && r.body !== undefined;
    return route.fulfill({
      status: r.status,
      headers: { ...CORS, ...(hasBody ? { "content-type": "application/json" } : {}), ...r.headers },
      body: hasBody ? JSON.stringify(r.body) : "",
    });
  });

  return mock;
}
