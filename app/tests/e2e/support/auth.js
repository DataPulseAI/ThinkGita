// Fake sign-in: puts a session where supabase-js keeps it, so the app starts signed in without calling Supabase Auth.
import { ADMIN_EMAIL, FACILITATOR_EMAIL } from "../../fixtures/data.js";
import { mockFor } from "./mock-backend.js";

export const STORAGE_KEY = "sb-rxvehsmunykipwevtpmb-auth-token";
const EXPIRES = 4102444800; // 2100-01-01, so the session never needs refreshing

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function fakeSession(email) {
  const user = { id: `user-${email}`, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {} };
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email, exp: EXPIRES, role: "authenticated", aud: "authenticated" })}.fakesig`,
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: EXPIRES,
    user,
  };
}

/**
 * Signs in as an admin ("admin"), a super admin ("super") or a facilitator, then opens the app.
 * `hash` opens a page directly, e.g. "/Circles" or "/Website". Call after mockBackend (the test fixture does that).
 */
export async function signIn(page, { role = "super", hash = "", email } = {}) {
  const mock = mockFor(page);
  const address = email ?? (role === "facilitator" ? FACILITATOR_EMAIL : ADMIN_EMAIL);
  if (mock) {
    mock.user.email = address;
    const row = mock.db.admin_emails.find((a) => a.email === address);
    if (row && role !== "facilitator") row.is_super = role === "super";
  }
  const session = fakeSession(address);
  await page.addInitScript(([key, value]) => {
    // Only on the first load: a later sign out must stick across reloads.
    if (!sessionStorage.getItem("e2e-signed-in")) {
      sessionStorage.setItem("e2e-signed-in", "1");
      localStorage.setItem(key, value);
    }
  }, [STORAGE_KEY, JSON.stringify(session)]);
  await page.goto(hash ? `./#${hash}` : "./");
  if (role === "facilitator") await page.getByRole("heading", { name: "Your circles" }).waitFor();
  else await page.locator("nav.tabs").waitFor();
}
