import { test, expect, signIn, toast, navTo, drawer, dateText } from "./support/test.js";
import { NAMES, LIC } from "../fixtures/data.js";

const stat = (page, label) => page.locator("button.stat", { hasText: label }).locator(".stat-value");

test.describe("Licences", () => {
  test("lists licences with their circles and shared days", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Zoom", "Licences");
    await expect(page.getByRole("heading", { name: "Zoom licences" })).toBeVisible();
    const rows = page.locator("table.table tbody tr");
    await expect(rows).toHaveCount(4);
    expect(await rows.locator("td:first-child input").evaluateAll((els) => els.map((e) => e.value))).toEqual(["Zoom 01", "Zoom 02", "Zoom 03", "Zoom 04"]);
    const z1 = rows.nth(0);
    await expect(z1.getByRole("button", { name: "2", exact: true })).toBeVisible();
    await expect(z1.locator(".shared-days")).toHaveText("2 at once: Mon");
    await expect(z1.getByRole("button", { name: "Change" })).toBeVisible();
    await expect(rows.nth(2).getByRole("button", { name: "Set key" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  test("editing a licence and saving sends the update", async ({ page, mock }) => {
    await signIn(page, { hash: "/Licences" });
    const z4 = page.locator("table.table tbody tr").nth(3);
    await z4.locator("td").nth(1).locator("input").fill(" Zoom04@Example.org ");
    await z4.locator("td").nth(3).locator("input[type=checkbox]").check();
    await expect(z4).toHaveClass(/dirty/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toHaveText("Licences saved");
    expect(mock.rest("licences", "PATCH").map((r) => [r.query.id, r.body])).toEqual([
      [`eq.${LIC.z4}`, { label: "Zoom 04", zoom_user_email: "zoom04@example.org", host_key: null, active: true, is_mock: false }],
    ]);
  });

  test("setting a host key asks first and calls the edge function", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Licences" });
    await page.locator("table.table tbody tr").nth(2).getByRole("button", { name: "Set key" }).click();
    await expect(toast(page)).toHaveText("Zoom 03: new host key 654321 set in Zoom");
    expect(dialogs.messages[0]).toContain("Set a new host key on Zoom 03 (zoom03@example.org)?");
    expect(mock.fn("provision-circle", "set_host_key")).toEqual([{ action: "set_host_key", circle_id: null, licence_id: LIC.z3 }]);
  });

  test("a licence with active circles can't be deleted", async ({ page, mock }) => {
    await signIn(page, { hash: "/Licences" });
    await page.getByRole("button", { name: "Delete Zoom 01" }).click();
    await expect(page.locator(".toast.error")).toHaveText("Zoom 01 has 2 active circles. Move or end them first, or untick Active instead.");
    expect(mock.rest("licences")).toHaveLength(0);
  });

  test("the circle count opens the circles on that licence", async ({ page }) => {
    await signIn(page, { hash: "/Licences" });
    await page.locator("table.table tbody tr").nth(0).getByRole("button", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/#\/Circles\/Zoom%2001$/);
    await expect(page.getByPlaceholder("Search name, facilitator, licence, language")).toHaveValue("Zoom 01");
    await expect(page.locator("table.table tbody tr")).toHaveCount(2);
  });
});

test.describe("Meetings on Zoom", () => {
  test("shows the last snapshot with counts and filters", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Zoom", "Meetings on Zoom");
    await expect(page.getByRole("heading", { name: "Meetings on Zoom" })).toBeVisible();
    await expect(page.locator(".zoom-synced")).toContainText("Last synced 2 hours ago");
    await expect(stat(page, "Weekly series")).toHaveText("3");
    await expect(stat(page, "One-off meetings")).toHaveText("1");
    await expect(stat(page, "Circles (made in this dashboard)")).toHaveText("3");
    await expect(stat(page, "Other Zoom meetings")).toHaveText("1");
    await expect(page.locator("p.hint")).toContainText("1 meeting was set up directly in Zoom on active licences.");
    const rows = page.locator("table.zoom-table tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(page.locator(".zoom-acc", { hasText: "Zoom 03" }).locator(".za-sub")).toHaveText("free");

    await page.locator(".zoom-filters").getByRole("button", { name: "Other Zoom meetings" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Team planning call");
    await expect(rows.first()).toContainText("Not a circle");
    await expect(page.getByRole("button", { name: "Export filtered: 1 of 4 (CSV)" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.locator(".zoom-acc", { hasText: "Zoom 01" }).click();
    await expect(rows).toHaveCount(2);
  });

  test("clicking a circle's meeting opens the circle", async ({ page }) => {
    await signIn(page, { hash: "/Zoom" });
    await page.locator("table.zoom-table tbody tr", { hasText: "ID 100000001" }).locator("td").first().click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c01);
  });

  test("before the first sync it explains what the page is for", async ({ page, mock }) => {
    mock.db.audit_log = mock.db.audit_log.filter((l) => l.action !== "zoom_meetings_snapshot");
    await signIn(page, { hash: "/Zoom" });
    await expect(page.getByText("Not synced yet.")).toBeVisible();
    await expect(page.getByText("See every meeting booked on your Zoom accounts")).toBeVisible();
  });
});

test.describe("Attendance", () => {
  test("lists meetings with headcounts and drop-offs without syncing again", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Zoom", "Attendance");
    await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
    await expect(page.locator(".zoom-synced")).toContainText("Last synced 1 hour ago");
    await expect(stat(page, "Sessions in the last 7 days")).toHaveText("2");
    await expect(stat(page, "People seen")).toHaveText("5");
    await expect(stat(page, "Dropped off")).toHaveText("1");
    const rows = page.locator("table.att-circles tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("td").first()).toHaveText("Kirtana (Asha Example)");
    await expect(rows.nth(0).locator("td").nth(2)).toHaveText("7");
    await expect(rows.nth(1)).toContainText("Team planning call");
    await expect(rows.nth(1)).toContainText("Not a circle");
    // The last sync was recent, so opening the page does not start another one.
    expect(mock.fn("provision-circle", "sync_attendance")).toHaveLength(0);
  });

  test("a meeting's page lists people, leaves out the host and filters drop-offs", async ({ page }) => {
    await signIn(page, { hash: "/Attendance" });
    await page.locator("table.att-circles tbody tr").first().click();
    await expect(page).toHaveURL(/#\/Attendance\/c01$/);
    await expect(page.getByText("People (4)")).toBeVisible();
    const people = page.locator("table.att-grid tbody tr");
    await expect(people).toHaveCount(4);
    await expect(people.first()).toContainText("Participant One");
    await expect(people.first()).toContainText("7 of 7");
    await expect(page.locator("table.att-grid")).not.toContainText("Zoom 01");
    await page.getByLabel(/Only people not seen in 3\+ sessions/).check();
    await expect(people).toHaveCount(1);
    await expect(people.first()).toContainText("Participant Four");
    await expect(people.first().locator(".pill")).toHaveText("Not seen in 4");
    await page.getByRole("button", { name: "Attendance", exact: true }).click();
    await expect(page.locator("table.att-circles")).toBeVisible();
  });

  test("by person view shows the heatmap", async ({ page }) => {
    await signIn(page, { hash: "/Attendance" });
    await page.getByRole("button", { name: "By person" }).click();
    await expect(page.locator(".heat-row:not(.heat-head)")).toHaveCount(5);
    await page.getByPlaceholder("Find a person").fill("four");
    await expect(page.locator(".heat-row:not(.heat-head)")).toHaveCount(1);
  });

  test("an old sync starts a new one when the page opens", async ({ page, mock }) => {
    mock.db.audit_log.find((l) => l.action === "sync_attendance").at = "2026-10-06T08:00:00Z";
    await signIn(page, { hash: "/Attendance" });
    await expect.poll(() => mock.fn("provision-circle", "sync_attendance").length).toBe(1);
    await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled();
  });
});

test.describe("Attendance insights", () => {
  test("renders trends and the comparison table", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Zoom", "Attendance insights");
    await expect(page.getByRole("heading", { name: "Attendance insights" })).toBeVisible();
    await expect(stat(page, "People seen (26 weeks)")).toHaveText("5");
    await expect(page.getByRole("heading", { name: "Growth: people each week" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Do first-timers come back?" })).toBeVisible();
    const compare = page.locator("table.ins-compare tbody tr");
    await expect(compare).toHaveCount(2);
    await page.locator(".ins-kind").getByRole("button", { name: "Circles" }).click();
    await expect(compare).toHaveCount(1);
    await page.getByRole("button", { name: "12 weeks" }).click();
    await expect(stat(page, "People seen (12 weeks)")).toHaveText("4");
    await compare.first().click();
    await expect(page).toHaveURL(/#\/Attendance\/c01$/);
  });
});

test.describe("Change requests", () => {
  test("lists open requests and marks one done", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Requests" });
    const rows = page.locator(".list .row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Move to Tuesdays at 19:00 from Tue 13 Oct 2026");
    await expect(rows.first()).toContainText("Currently Mondays 19:00 (London time)");
    // A live circle can't change from a future date yet.
    await expect(rows.first().locator(".warn-text")).toHaveText(dateText("Due on Tue 13 Oct 2026: apply on or after that date"));
    await page.getByRole("button", { name: "All" }).click();
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole("button", { name: "Mark done" }).click();
    await expect(toast(page)).toHaveText("Marked done");
    expect(mock.rest("change_requests", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.req-01", { status: "done" }]]);
  });
});
