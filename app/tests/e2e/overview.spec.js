import { test, expect, signIn } from "./support/test.js";
import { circleRow, LIC, FAC } from "../fixtures/data.js";

const stat = (page, label) => page.locator("button.stat", { hasText: label }).locator(".stat-value");
const matrixCell = (page, licence, dayIndex) =>
  page.locator("table.matrix tbody tr", { has: page.locator("th.rowhead", { hasText: licence }) }).locator("td").nth(dayIndex);

test.describe("Overview", () => {
  test("shows the headline numbers and the failed email banner", async ({ page }) => {
    await signIn(page);
    await expect(stat(page, "Live circles")).toHaveText("3");
    await expect(stat(page, "Awaiting approval")).toHaveText("2");
    await expect(stat(page, "Clashes to resolve")).toHaveText("1");
    await expect(page.locator("button.stat.warn", { hasText: "Clashes to resolve" })).toBeVisible();
    await expect(stat(page, "Open change requests")).toHaveText("1");
    await expect(stat(page, "Licences without Zoom user")).toHaveText("0");
    await expect(page.getByText("1 email failed to send in the last 7 days.")).toBeVisible();
  });

  test("clicking a stat opens the matching page", async ({ page }) => {
    await signIn(page);
    await page.locator("button.stat", { hasText: "Live circles" }).click();
    await expect(page).toHaveURL(/#\/Circles\/live$/);
    await expect(page.getByRole("heading", { name: /^Circles/ })).toContainText("(3)");
    await page.goBack();
    await page.locator("button.stat", { hasText: "Awaiting approval" }).click();
    await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  });

  test("the setup checklist lists what is left before going live", async ({ page }) => {
    await signIn(page);
    const list = page.locator("section.card", { has: page.getByRole("heading", { name: "Before going live" }) });
    await expect(list).toContainText("2 of 4 done");
    await expect(list.locator("li:not(.done)")).toHaveCount(2);
    await expect(list.locator("li:not(.done)").first()).toContainText("Connect Zoom licences (2 of 3 have a Zoom user and host key)");
    await expect(list.locator("li.done", { hasText: "Turn off mock licences" })).toBeVisible();
    await expect(list.locator("li:not(.done)", { hasText: "Set the term dates" })).toBeVisible();
    await list.getByRole("button", { name: "Go to Settings" }).click();
    await expect(page.getByRole("heading", { name: "Scheduling rules" })).toBeVisible();
  });

  test("the checklist is hidden once everything is done", async ({ page, mock }) => {
    mock.db.licences.find((l) => l.label === "Zoom 03").host_key = "333333";
    Object.assign(mock.db.settings[0], { term_start: "2026-09-01", term_end: "2027-07-31" });
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Week at a glance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before going live" })).toHaveCount(0);
  });

  test("week at a glance by licence counts circles and marks a shared licence", async ({ page }) => {
    await signIn(page);
    const rows = page.locator("table.matrix tbody tr");
    await expect(rows).toHaveCount(4); // three active licences and "No licence"
    await expect(rows.locator("th.rowhead")).toHaveText(["Zoom 01", "Zoom 02", "Zoom 03", "No licence"]);
    const monday = matrixCell(page, "Zoom 01", 0);
    await expect(monday).toHaveClass(/filled/);
    await expect(monday).toHaveClass(/shared/);
    await expect(monday).not.toHaveClass(/over/);
    await expect(monday.locator(".cell-fill")).toHaveText("22×");
    await expect(monday.locator(".at-once")).toHaveText("2×");
    await expect(matrixCell(page, "Zoom 02", 1).locator(".cell-fill")).toHaveText("1");
    await expect(matrixCell(page, "No licence", 0)).toHaveText("1");
    await expect(matrixCell(page, "No licence", 0)).toHaveClass(/conflict-cell/);
    await expect(page.locator(".matrix-note")).toContainText("two circles share that licence at the same time");
  });

  test("hovering a licence cell lists the circles and the shared licence note", async ({ page }) => {
    await signIn(page);
    await matrixCell(page, "Zoom 01", 0).locator(".cell-fill").hover();
    const card = page.getByRole("tooltip");
    await expect(card.locator(".hc-title")).toHaveText("Zoom 01, Monday");
    await expect(card.locator(".hc-sub")).toHaveText("2 circles");
    await expect(card.locator("dt")).toHaveText(["19:00–20:15", "19:30–20:30"]);
    await expect(card.locator("dd").first()).toContainText("Kirtana (Asha Example)");
    await expect(card.locator("dd").nth(1)).toContainText("Bram Sample");
    await expect(card).toContainText("2 at once at the busiest moment (shared licence, Zoom allows 2)");
    await expect(card).toContainText("Click to see the day");
    await page.mouse.move(5, 5);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("a pending circle in a hover card shows its status", async ({ page }) => {
    await signIn(page);
    await matrixCell(page, "Zoom 02", 1).locator(".cell-fill").hover();
    const card = page.getByRole("tooltip");
    await expect(card.locator(".hc-title")).toHaveText("Zoom 02, Tuesday");
    await expect(card.locator(".hc-meta")).toHaveText("Awaiting approval");
  });

  test("a third overlapping circle shows as over the limit", async ({ page, mock }) => {
    mock.db.circles.push(circleRow({ id: "c10", name: "Gita Circles | Third Wheel | Monday 19:15 (London time)", status: "live", facilitator_id: FAC.farid, weekday: 1, start_time: "19:15:00", licence_id: LIC.z1 }));
    await signIn(page);
    const monday = matrixCell(page, "Zoom 01", 0);
    await expect(monday).toHaveClass(/over/);
    await expect(monday.locator(".at-once")).toHaveText("3×");
    await expect(page.locator(".matrix-note")).toContainText("more than Zoom allows: move one.");
    await monday.locator(".cell-fill").hover();
    await expect(page.getByRole("tooltip").locator(".hc-foot.warn-text")).toHaveText("3 at once at the busiest moment: over Zoom's limit of 2, move one");
  });

  // BUG (inconsistency): a cell counts only pending, approved and live circles, but the "2×" shared badge and
  // the "2 at once" note also count paused circles (which hold the licence). A paused circle overlapping a live
  // one shows a cell of "1" whose hover card lists 1 circle yet says "2 at once". Expected: the count, the list
  // and the badge agree (either list the paused circle or leave it out of the peak).
  test.fail("a paused circle sharing a licence is counted the same way in the cell and the badge", async ({ page, mock }) => {
    mock.db.circles.find((c) => c.id === "c02").status = "paused";
    await signIn(page);
    const monday = matrixCell(page, "Zoom 01", 0);
    await monday.locator(".cell-fill").hover();
    const card = page.getByRole("tooltip");
    await expect(card.locator(".hc-sub")).toHaveText("1 circle");
    await expect(card).not.toContainText("2 at once", { timeout: 2000 });
  });

  test("by hour view shows busy hours, free licences, and is remembered after reload", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "By hour" }).click();
    await expect(page.getByRole("button", { name: "By hour" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("table.hour-matrix")).toBeVisible();
    // Only hours with circles (plus one either side) are drawn: 06:00 to 24:00 here.
    await expect(page.locator("table.hour-matrix tbody th.rowhead").first()).toHaveText("06:00");
    const row19 = page.locator("table.hour-matrix tbody tr", { has: page.locator("th", { hasText: "19:00" }) });
    await expect(row19.locator("td").first().locator(".cell-fill")).toHaveText("2");
    await row19.locator("td").first().locator(".cell-fill").hover();
    const card = page.getByRole("tooltip");
    await expect(card.locator(".hc-title")).toHaveText("Monday, 19:00 to 20:00");
    await expect(card.locator(".hc-sub")).toHaveText("2 circles · 2 licences free");
    await expect(card.locator(".hc-meta")).toHaveText(["Zoom 01", "Zoom 01"]);

    await page.reload();
    await expect(page.getByRole("button", { name: "By hour" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("table.hour-matrix")).toBeVisible();
    await page.getByRole("button", { name: "By licence" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "By licence" })).toHaveAttribute("aria-pressed", "true");
  });

  test("an hour with every licence in use is outlined and says so", async ({ page, mock }) => {
    mock.db.circles.push(circleRow({ id: "c10", name: "Gita Circles | Third Room | Monday 19:00 (London time)", status: "live", facilitator_id: FAC.farid, weekday: 1, start_time: "19:00:00", licence_id: LIC.z2 }));
    mock.db.circles.push(circleRow({ id: "c11", name: "Gita Circles | Fourth Room | Monday 19:00 (London time)", status: "pending", facilitator_id: FAC.farid, weekday: 1, start_time: "19:00:00", licence_id: LIC.z3 }));
    await signIn(page);
    await page.getByRole("button", { name: "By hour" }).click();
    const cell = page.locator("table.hour-matrix tbody tr", { has: page.locator("th", { hasText: "19:00" }) }).locator("td").first();
    await expect(cell).toHaveClass(/full/);
    await cell.locator(".cell-fill").hover();
    await expect(page.getByRole("tooltip").locator(".hc-sub")).toHaveText("4 circles · every licence in use");
  });

  test("clicking a cell opens that day's schedule", async ({ page }) => {
    await signIn(page);
    await matrixCell(page, "Zoom 02", 1).click();
    await expect(page).toHaveURL(/#\/Schedule$/);
    await expect(page.locator("section.card h2").first()).toContainText("Tuesday");
    await page.goBack();
    await page.getByRole("button", { name: "By hour" }).click();
    await page.locator("table.hour-matrix thead").getByRole("button", { name: "Sat" }).click();
    await expect(page.locator("section.card h2").first()).toContainText("Saturday");
  });
});
