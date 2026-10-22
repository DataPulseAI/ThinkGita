import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap } from "./lib.js";

test("common: sign in", async ({ page }) => {
  await page.goto("/");
  const card = page.locator(".login-card");
  await card.waitFor();
  await page.locator(".login-card input[type=email]").fill("esha.specimen@example.org");
  await snap(page, "signin-1-login", { clip: card, hl: page.getByRole("button", { name: "Sign in" }), pad: 40 });
  await page.getByRole("button", { name: "Forgot or never set a password?" }).click();
  await page.locator(".login-card input[type=email]").fill("esha.specimen@example.org");
  await snap(page, "signin-2-reset", { clip: card, hl: page.getByRole("button", { name: "Email me a reset link" }), pad: 40 });
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await snap(page, "signin-3-link", { clip: card, hl: page.getByRole("button", { name: "Email me a sign-in link" }).first(), pad: 40 });
});

test("common: choose password", async ({ page }) => {
  await signIn(page, { role: "facilitator", hash: "&type=invite" });
  const modal = page.locator(".modal");
  await modal.waitFor();
  await page.getByLabel("New password").fill("Gita");
  await snap(page, "signin-4-password", { clip: modal, hl: modal.locator("ul.rules"), pad: 30 });
});
