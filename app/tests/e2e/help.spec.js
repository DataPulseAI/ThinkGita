// The Help page: button, role filtering, search, a guide, a deep link.
import { test, expect } from "./support/test.js";
import { signIn } from "./support/auth.js";
import { ASSESSOR_EMAIL } from "../fixtures/data.js";

const cards = (page) => page.locator("a.help-card");
const SUPER_GUIDE = "Add and remove admins";

test("admin: opens Help, searches and reads a guide", async ({ page }) => {
  await signIn(page, { role: "admin" });
  await page.getByRole("button", { name: "Help guides" }).click();
  await expect(page.getByLabel("Search guides")).toBeVisible();
  await expect(cards(page).first()).toBeVisible();
  await expect(cards(page).filter({ hasText: SUPER_GUIDE })).toHaveCount(0);
  await page.getByLabel("Search guides").fill("host key");
  expect(await cards(page).count()).toBeGreaterThan(0);
  await cards(page).first().click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Print or save as PDF/ })).toBeVisible();
});

test("super admin also sees the super admin guides", async ({ page }) => {
  await signIn(page, { role: "super" });
  await page.goto("./#/Help");
  await expect(cards(page).filter({ hasText: SUPER_GUIDE })).toHaveCount(1);
});

test("facilitator Help lists only facilitator guides", async ({ page }) => {
  await signIn(page, { role: "facilitator" });
  await page.goto("./#/Help");
  await expect(cards(page).first()).toBeVisible();
  await expect(cards(page).filter({ hasText: SUPER_GUIDE })).toHaveCount(0);
  await expect(cards(page).filter({ hasText: /Find your circle/ }).first()).toBeVisible();
});

test("assessor Help deep link opens a guide with screenshots", async ({ page }) => {
  await signIn(page, { role: "assessor", email: ASSESSOR_EMAIL });
  await page.goto("./#/Help/ass-score");
  await expect(page.getByRole("heading", { name: /Score the five criteria/ }).first()).toBeVisible();
  await expect(page.getByText(/Guide \d+ of \d+/)).toBeVisible();
  await expect(page.locator("figure.help-shot img").first()).toBeVisible();
});
