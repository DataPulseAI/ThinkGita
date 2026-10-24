import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap, openSection, card, sec } from "./lib.js";
import { NAMES } from "../fixtures/data.js";

test("attendees", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Attendees" });
  const main = page.locator("main");
  await page.locator(".at-page h2").waitFor();
  await snap(page, "attendees-1-page", { clip: main, hl: page.getByLabel("Circle"), pad: 0, top: true });
  await page.locator(".at-row", { hasText: "Olu Example" }).click();
  await snap(page, "attendees-2-open", { clip: page.locator(".at-item", { hasText: "Olu Example" }), hl: page.locator(".at-open"), pad: 16 });
  await page.getByRole("tab", { name: /Needs matching/ }).click();
  await page.locator(".at-match-row").first().waitFor();
  await snap(page, "attendees-3-match", { clip: main, hl: page.locator(".at-match-row", { hasText: "Rosa Example" }).locator(".at-match-actions"), pad: 0, top: true });

  await page.goto("/#/Circles");
  await page.getByLabel("Show").selectOption("all");
  await page.locator("table.table tbody tr", { has: page.locator("td", { hasText: NAMES.c01 }) }).locator("td").first().click();
  await page.locator(".drawer").first().waitFor();
  await snap(page, "attendees-6-top", { clip: [page.locator(".drawer-head"), page.locator(".at-when")], hl: page.locator(".at-when").getByRole("button", { name: "Copy sign-up link" }), pad: 16 });
  await openSection(page, "Attendees");
  await snap(page, "attendees-4-panel", { clip: sec(page, "Attendees"), hl: sec(page, "Attendees").getByRole("button", { name: "Copy sign-up link" }), pad: 16 });
  await snap(page, "zoomreg-1-panel", { clip: page.locator(".at-zoomreg"), hl: page.locator(".at-zoomreg button"), pad: 20 });

  await page.goto("/#/Settings");
  await page.reload();
  const c = card(page, "Circle attendees");
  await c.waitFor();
  await snap(page, "attendees-5-settings", { clip: c, hl: c.getByRole("button", { name: "Import sign-ups from Tally" }), pad: 16 });
});

test("facilitator attendees", async ({ page }) => {
  await signIn(page, { role: "facilitator" });
  await page.getByRole("tablist", { name: "Portal view" }).getByRole("tab", { name: /Attendees/ }).click();
  const pane = page.getByRole("region", { name: "Attendees" });
  await pane.getByRole("button", { name: /Mira Example/ }).click();
  await snap(page, "fac-attendees-1", { clip: [page.locator(".fac-views"), pane], hl: page.locator(".fac-views"), pad: 16 });
});
