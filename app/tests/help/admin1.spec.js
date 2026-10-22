import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap } from "./lib.js";

const topbar = (page) => page.locator("header.topbar");

test("admin: tour", async ({ page }) => {
  await signIn(page, { role: "super" });
  await page.locator("button.stat").first().waitFor();
  await snap(page, "tour-admin-1-top", { clip: [topbar(page), page.locator("nav.tabs")], hl: [page.locator("nav.tabs")], pad: 10 });
  const nav = page.locator("nav.tabs");
  await nav.getByRole("button", { name: /^Circles/ }).click();
  await snap(page, "tour-admin-2-menu", { clip: [nav, page.getByRole("menuitem", { name: /^Change requests/ })], hl: page.getByRole("menuitem", { name: /^Facilitators/ }), pad: 20 });
  await page.keyboard.press("Escape");
  await page.mouse.click(900, 600);
  await snap(page, "tour-admin-3-stats", { clip: page.locator(".stats"), hl: page.locator(".stats"), pad: 16 });
  await snap(page, "tour-admin-4-header", { clip: topbar(page), hl: page.locator(".who"), pad: 6 });
  await snap(page, "tour-admin-5-overview", { full: false });
});

test("admin: process and queue", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Queue" });
  await page.getByRole("heading", { name: /^Queue/ }).waitFor();
  const rows = page.locator(".row");
  await snap(page, "queue-1-list", { clip: page.locator("main section.card").first(), hl: page.getByRole("heading", { name: /^Queue/ }), pad: 12 });
  await snap(page, "queue-2-sort", { clip: [page.getByRole("heading", { name: /^Queue/ }), rows.first()], hl: page.getByRole("button", { name: "Newest" }), pad: 16 });
  await snap(page, "queue-3-row", { clip: rows.nth(1), hl: [rows.nth(1).getByRole("button", { name: "Approve + create Zoom" })], pad: 14 });
  await rows.nth(1).getByRole("button", { name: "Approve + create Zoom" }).click();
  const dlg = page.locator(".modal").first();
  await dlg.waitFor();
  await snap(page, "queue-4-approve", { clip: dlg, hl: dlg.getByRole("button", { name: "Approve + create Zoom" }), pad: 30 });
  await dlg.getByLabel("WhatsApp group link").fill("https://chat.whatsapp.com/EXAMPLE-NEW");
  await snap(page, "queue-5-approve-filled", { clip: dlg, hl: dlg.getByLabel("WhatsApp group link"), pad: 30 });
});

test("admin: clash", async ({ page, mock }) => {
  mock.handle("rpc suggest_slots", () => [{ start_time: "20:00:00", licence_label: "Zoom 02" }, { start_time: "20:30:00", licence_label: "Zoom 03" }]);
  await signIn(page, { role: "super", hash: "/Queue" });
  const clash = page.locator(".row.row-warn").first();
  await clash.waitFor();
  await snap(page, "clash-1-row", { clip: clash, hl: clash, pad: 14 });
  await clash.getByRole("button", { name: "Suggest times" }).click();
  await page.waitForTimeout(500);
  await snap(page, "clash-2-suggest", { clip: page.locator("main section.card").first(), hl: clash.getByRole("button", { name: "Suggest times" }), pad: 12 });
  await snap(page, "clash-3-recheck", { clip: page.locator("main section.card .card-head").first(), hl: page.getByRole("button", { name: /^Re-check all clashes/ }), pad: 14 });
});
