import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap, openSection, card, sec } from "./lib.js";

const matrixCell = (page, licence, dayIndex) =>
  page.locator("table.matrix tbody tr", { has: page.locator("th.rowhead", { hasText: licence }) }).locator("td").nth(dayIndex);

test("circles list and new circle", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Circles" });
  const main = page.locator("main section.card").first();
  await main.waitFor();
  await snap(page, "circles-1-list", { clip: main, hl: page.getByRole("heading", { name: /^Circles/ }), pad: 12 });
  await snap(page, "newcircle-1-button", { clip: main.locator(".card-head").first(), hl: page.getByRole("button", { name: "Add circle" }), pad: 16 });
  await page.getByRole("button", { name: "Add circle" }).click();
  const drawer = page.locator(".drawer").first();
  await drawer.waitFor();
  await page.waitForTimeout(300);
  await snap(page, "newcircle-2-facilitator", { clip: drawer, hl: drawer.getByRole("button", { name: "Choose facilitator" }), pad: 0 });
  await drawer.getByRole("button", { name: "Choose facilitator" }).click();
  await page.waitForTimeout(300);
  await snap(page, "newcircle-2b-picker", { clip: drawer, pad: 0 });
  await drawer.getByText(/^When \(facilitator/).scrollIntoViewIfNeeded();
  await snap(page, "newcircle-3-when", { clip: [drawer.getByText(/^When \(facilitator/), page.getByLabel("Preferred start")], hl: drawer.getByText(/^When \(facilitator/), pad: 20 });
  await snap(page, "newcircle-4-licence", { clip: [page.getByLabel("Licence"), page.getByLabel("Drive folder")], hl: page.getByLabel("Licence"), pad: 20 });
});

test("manage a circle", async ({ page, mock }) => {
  mock.handle("rpc free_licences_for_circle", () => [{ licence_id: "lic-03", label: "Zoom 03", is_mock: false, has_zoom: true }]);
  await signIn(page, { role: "super", hash: "/Circles" });
  await page.locator("table tbody tr").first().click();
  const drawer = page.locator(".drawer").first();
  await drawer.waitFor();
  await page.waitForTimeout(400);
  await snap(page, "manage-1-panel", { clip: drawer, hl: drawer.locator("button.sec-toggle").nth(2), pad: 0 });
  await openSection(page, "Circle details");
  const dayLabel = page.locator(".drawer label", { hasText: /^Day/ }).first();
  await snap(page, "manage-2-details", { clip: [page.getByText(/^When \(facilitator/), page.getByRole("button", { name: "Save changes" })], hl: [dayLabel, page.getByRole("button", { name: "Save changes" })], pad: 20 });
  await openSection(page, "Manage");
  await snap(page, "manage-3-move", { clip: sec(page, "Manage"), hl: page.getByLabel("Move to another licence"), pad: 16 });
  // co-facilitators
  await openSection(page, "Facilitators");
  await page.locator("button.sec-toggle", { hasText: "Facilitators" }).first().scrollIntoViewIfNeeded();
  await snap(page, "cofac-1-section", { clip: sec(page, "Facilitators"), hl: page.getByText("Co-facilitators").first(), pad: 16 });
  await snap(page, "cofac-2-add", { clip: [page.getByText("Co-facilitators").first(), page.getByRole("button", { name: "+ Add co-facilitator" })], hl: page.getByRole("button", { name: "+ Add co-facilitator" }), pad: 24 });
  await snap(page, "cofac-3-change", { clip: [page.getByText("Primary facilitator").first(), page.getByText("Co-facilitators").first()], hl: page.getByRole("button", { name: "Change" }).first(), pad: 24 });
});

test("requests", async ({ page, mock }) => {
  Object.assign(mock.db.change_requests[0].details, { from: "2026-10-07" });
  mock.db.change_requests[0].message = "Move to Tuesdays at 19:00 from Wed 7 Oct 2026";
  await signIn(page, { role: "super", hash: "/Requests" });
  const main = page.locator("main section.card").first();
  await main.waitFor();
  await snap(page, "requests-1-list", { clip: main, hl: main.locator(".seg"), pad: 12 });
  const row = main.locator(".row").first();
  await snap(page, "requests-2-row", { clip: row, hl: row.getByRole("button", { name: "Apply new time" }), pad: 16 });
});

test("overview and schedule", async ({ page }) => {
  await signIn(page, { role: "super" });
  const week = card(page, "Week at a glance");
  await week.waitFor();
  await snap(page, "overview-1-licence", { clip: week, hl: week.locator("table.matrix"), pad: 12 });
  await matrixCell(page, "Zoom 01", 0).locator(".cell-fill").hover();
  await page.waitForTimeout(300);
  await snap(page, "overview-2-hover", { clip: [week, page.locator(".hovercard")], hl: matrixCell(page, "Zoom 01", 0), pad: 16 });
  await page.mouse.move(5, 5);
  await week.getByRole("button", { name: "By hour" }).click();
  await page.waitForTimeout(300);
  await snap(page, "overview-3-hour", { clip: week, hl: week.getByRole("button", { name: "By hour" }), pad: 12 });
  await week.getByRole("button", { name: "By licence" }).click();
  await page.goto("/#/Schedule");
  await page.getByRole("button", { name: "Mon", exact: true }).click();
  await page.waitForTimeout(400);
  await snap(page, "schedule-1-day", { clip: page.locator("main"), hl: page.getByRole("button", { name: "Mon", exact: true }), pad: 0 });
});

test("facilitators", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Facilitators" });
  const main = page.locator("main section.card").first();
  await main.waitFor();
  await snap(page, "fac-1-list", { clip: main, hl: page.getByRole("heading", { name: /^Facilitators/ }), pad: 12 });
  await snap(page, "fac-2-filters", { clip: [page.getByRole("button", { name: /^All \d/ }), page.getByRole("button", { name: /^No phone/ })], hl: page.getByRole("button", { name: /^Unverified/ }), pad: 20 });
  await page.locator(".fac-row:not(.fac-head)").nth(1).click();
  const drawer = page.locator(".fac-drawer");
  await drawer.waitFor();
  await page.waitForTimeout(400);
  await snap(page, "fac-3-panel", { clip: drawer, pad: 0 });
  await snap(page, "fac-4-verify", { clip: drawer.locator(".drawer-head"), hl: drawer.getByRole("button", { name: "Remove verification" }), pad: 16 });
  await snap(page, "fac-5-assign", { clip: [drawer.getByRole("button", { name: "Assign to a circle" }), drawer.getByRole("button", { name: "New circle" })], hl: [drawer.getByRole("button", { name: "Assign to a circle" }), drawer.getByRole("button", { name: "New circle" })], pad: 24 });
  await page.keyboard.press("Escape");
  await page.mouse.click(30, 400);
  await page.getByRole("button", { name: "New facilitator" }).click();
  const nd = page.locator(".new-fac-drawer");
  await nd.waitFor();
  await snap(page, "fac-6-new", { clip: nd, hl: nd.getByRole("button", { name: "Add to the system" }), pad: 0 });
});
