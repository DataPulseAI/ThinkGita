// Demo build only (npm run build:demo). Answers every request the dashboard makes to Supabase from the made-up data in
// tests/fixtures/data.js, inside the browser. Nothing reaches the real database, and no emails, Zoom, Tally or website
// changes happen. Changes last until the page is reloaded.
import { buildFixtures, NOW, ADMIN_EMAIL, FACILITATOR_EMAIL, ASSESSOR_EMAIL } from "../../tests/fixtures/data.js";
import { createMockCore, parseRequest } from "./mockCore.js";

export const DEMO_USERS = [
  { key: "super", label: "Super admin", email: ADMIN_EMAIL },
  { key: "admin", label: "Admin", email: ADMIN_EMAIL },
  { key: "assessor", label: "Assessor", email: ASSESSOR_EMAIL },
  { key: "facilitator", label: "Facilitator", email: FACILITATOR_EMAIL },
];
const ROLE_KEY = "tg-demo-role";
export const demoRole = () => {
  try { return DEMO_USERS.find((u) => u.key === localStorage.getItem(ROLE_KEY)) ?? DEMO_USERS[0]; } catch { return DEMO_USERS[0]; }
};
export function switchDemoRole(key) {
  try { localStorage.setItem(ROLE_KEY, key); } catch { /* private window: stays as is */ }
  location.hash = "";
  location.reload();
}

// The made-up data is dated around Wednesday 7 October 2026, 11:00 UK time, so the demo clock starts there and runs on.
function fixClock() {
  const RealDate = Date;
  const offset = RealDate.parse(NOW) - RealDate.now();
  class DemoDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = DemoDate;
}

const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fakeSession(email) {
  const exp = 4102444800;
  const user = { id: `user-${email}`, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {} };
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email, exp, role: "authenticated", aud: "authenticated" })}.demo`,
    refresh_token: "demo", token_type: "bearer", expires_in: 3600, expires_at: exp, user,
  };
}

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export function installDemo(supabaseUrl) {
  fixClock();
  // Some places that host the demo (a Claude artifact, for one) never show browser dialogs, so "Are you sure?" would
  // always be No. In the demo nothing is real, so every confirmation is a yes.
  try { window.confirm = () => true; window.alert = () => {}; } catch { /* read-only: keep the browser's own */ }
  const role = demoRole();
  const db = buildFixtures();
  for (const a of db.admin_emails) if (a.email === ADMIN_EMAIL) a.is_super = role.key === "super";
  const user = { email: role.email };
  const core = createMockCore({ db, user });
  // Signed in as the chosen demo person (supabase-js reads the session from here).
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  try { localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(fakeSession(role.email))); } catch { /* private window */ }

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = (() => { try { return new URL(url, location.href).hostname; } catch { return ""; } })();
    if (!host.endsWith(".supabase.co")) return realFetch(input, init);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    let raw = init.body ?? null;
    if (raw && typeof raw !== "string") raw = null; // file uploads: the content isn't needed
    const req = parseRequest(url, method, raw, headers.get("accept") ?? "");
    if (method === "OPTIONS") return new Response(null, { status: 204 });
    const r = await core.handle(req, null);
    if (r.image) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    const hasBody = r.status !== 204 && method !== "HEAD" && r.body !== undefined && r.body !== null;
    return new Response(hasBody ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(r.headers ?? {}) },
    });
  };
  return role;
}
