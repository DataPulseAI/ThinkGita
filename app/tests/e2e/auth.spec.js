import { test, expect, signIn, reply } from "./support/test.js";
import { fakeSession } from "./support/auth.js";
import { ADMIN_EMAIL, FACILITATOR_EMAIL } from "../fixtures/data.js";

test.describe("Sign in", () => {
  test("shows the sign-in screen when signed out", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByText("Circles: sign in to manage or view your circle.")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toHaveCount(1);
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });

  test("a wrong password shows a friendly message", async ({ page, mock }) => {
    mock.handle("auth token", reply(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" }));
    await page.goto("./");
    await page.getByPlaceholder("you@example.com").fill(ADMIN_EMAIL);
    await page.locator("input[type=password]").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is wrong.")).toBeVisible();
  });

  test("signing in with a password opens the admin dashboard on Overview", async ({ page, mock }) => {
    mock.handle("auth token", () => fakeSession(ADMIN_EMAIL));
    await page.goto("./");
    await page.getByPlaceholder("you@example.com").fill(ADMIN_EMAIL.toUpperCase());
    await page.locator("input[type=password]").fill("Correct-Horse-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".topbar .role")).toHaveText("Admin");
    await expect(page.getByRole("heading", { name: "Week at a glance" })).toBeVisible();
    const login = mock.log.find((r) => r.kind === "auth" && r.name === "token");
    expect(login.body).toMatchObject({ email: ADMIN_EMAIL, password: "Correct-Horse-1" });
  });

  test("an admin lands on Overview", async ({ page }) => {
    await signIn(page, { role: "admin" });
    await expect(page.locator(".topbar .role")).toHaveText("Admin");
    await expect(page.locator(".topbar .email")).toHaveText(ADMIN_EMAIL);
    await expect(page.locator("nav.tabs .tab.active")).toHaveText(/Overview/);
    await expect(page.getByRole("heading", { name: "Week at a glance" })).toBeVisible();
  });

  test("someone who is not an admin sees the facilitator portal", async ({ page }) => {
    await signIn(page, { role: "facilitator" });
    await expect(page.locator(".topbar .role")).toHaveText("Facilitator");
    await expect(page.locator(".topbar .email")).toHaveText(FACILITATOR_EMAIL);
    await expect(page.locator("nav.tabs")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your circles" })).toBeVisible();
  });

  test("sign out returns to the sign-in screen and stays signed out after reload", async ({ page, mock }) => {
    await signIn(page, { role: "super" });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(mock.log.some((r) => r.kind === "auth" && r.name.startsWith("logout"))).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
