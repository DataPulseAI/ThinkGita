import { test, expect, signIn, toast, fail } from "./support/test.js";
import { NAMES, ADMIN_EMAIL, OTHER_ADMIN_EMAIL } from "../fixtures/data.js";

const sectionOf = (page, title) => page.locator("section.card", { has: page.locator(".card-head h2", { hasText: new RegExp(`^${title}$`) }) });
const adminRow = (page, email) => sectionOf(page, "Admins").locator(".list .row", { has: page.locator(".row-main", { hasText: email }) });

test.describe("Settings", () => {
  test("scheduling rules are saved in one call", async ({ page, mock }) => {
    await signIn(page, { hash: "/Settings" });
    const rules = sectionOf(page, "Scheduling rules");
    await rules.getByLabel("Term starts").fill("2026-09-01");
    await rules.getByLabel("Term ends").fill("2027-07-31");
    await rules.getByLabel("Buffer between meetings (min)").fill("10");
    await rules.getByRole("button", { name: "Save" }).click();
    await expect(toast(page)).toHaveText("Settings saved");
    expect(mock.rpc("save_settings")).toEqual([{ p_buffer: 10, p_duration: 75, p_timezone: "Europe/London", p_term_start: "2026-09-01", p_term_end: "2027-07-31" }]);
  });

  test("settings that would cause a clash are refused in plain English", async ({ page, mock }) => {
    mock.handle("rpc save_settings", fail('new row violates "no_licence_clash"'));
    await signIn(page, { hash: "/Settings" });
    await sectionOf(page, "Scheduling rules").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".toast.error")).toHaveText("Not saved: with these settings a licence would have 3 meetings at once (Zoom allows 2). Reduce the buffer or move a circle first.");
  });

  test("the auto publish switch updates the setting", async ({ page, mock }) => {
    await signIn(page, { hash: "/Settings" });
    const web = sectionOf(page, "Website");
    const box = web.getByLabel("Publish the website after each update");
    await expect(box).toBeChecked();
    await expect(web).toContainText("Website last published 2 hours ago.");
    // The box follows the saved setting, so it changes once the save has gone through.
    await box.click();
    await expect(toast(page)).toHaveText("Website updates will wait for someone to publish in Framer");
    expect(mock.rest("settings", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.1", { framer_auto_publish: false }]]);
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(toast(page)).toHaveText("The website will publish after each update");
    expect(mock.rest("settings", "PATCH")[1].body).toEqual({ framer_auto_publish: true });
  });

  test("publish status shows failures and Publish now retries", async ({ page, mock }) => {
    const ago = (m) => new Date(Date.parse("2026-10-07T10:00:00Z") - m * 60000).toISOString();
    Object.assign(mock.db.settings[0], {
      framer_fail_count: 3, framer_last_error: "Framer API rate limit", framer_failed_at: ago(5),
      framer_publish_pending: true, framer_publish_error: "Publishing is temporarily unavailable", framer_publish_tried_at: ago(10),
    });
    await signIn(page, { hash: "/Settings" });
    const web = sectionOf(page, "Website");
    await expect(web.locator("p.warn-text").first()).toHaveText(
      "Website updates are failing (last try 5 min ago): Framer API rate limit. They retry automatically with longer gaps. If this persists, check the Framer API key and that the Course collection still exists.");
    await expect(web.locator(".card-note .warn-text")).toHaveText(
      "Some website changes are saved in Framer but not live yet. Last try 10 min ago: Publishing is temporarily unavailable. It retries automatically.");
    await web.getByRole("button", { name: "Publish now" }).click();
    await expect(toast(page)).toHaveText("Website published");
    expect(mock.fn("framer-sync", "publish")).toEqual([{ action: "publish" }]);
  });

  test("Publish now reports when Framer still refuses", async ({ page, mock }) => {
    Object.assign(mock.db.settings[0], { framer_publish_pending: true, framer_auto_publish: false });
    mock.handle("fn framer-sync publish", { published: "Framer is busy, try later" });
    await signIn(page, { hash: "/Settings" });
    const web = sectionOf(page, "Website");
    await expect(web.locator(".card-note")).toContainText("Auto publish is off, so publish in Framer or below.");
    await web.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator(".toast.warn")).toHaveText("Still not published: Framer is busy, try later");
  });

  test("Update all circles now pushes every circle", async ({ page, mock }) => {
    mock.handle("fn framer-sync sync", { created: 1, updated: 2, hidden: 0, errors: [], published: true });
    await signIn(page, { hash: "/Settings" });
    await sectionOf(page, "Website").getByRole("button", { name: "Update all circles now" }).click();
    await expect(toast(page)).toHaveText("Website updated: 1 added, 2 updated. Site published.");
    expect(mock.fn("framer-sync", "sync")[0]).toEqual({ action: "sync", all: true });
  });

  test("activity log shows readable lines and filters by group", async ({ page }) => {
    await signIn(page, { hash: "/Settings" });
    const act = sectionOf(page, "Activity");
    const rows = act.locator(".log-row");
    // The background sync that changed nothing is left out.
    await expect(rows).toHaveCount(6);
    await expect(rows.locator("b")).toHaveText(["Deleted circle", "Edited circle", "Ended circle", "Changed website listing", "Website update", "Created circle"]);
    await expect(rows.nth(0).locator(".log-what")).toHaveText("Gita Circles | Old Sample | Thursday 10:00 (London time), was Ended");
    await expect(rows.nth(1)).toContainText(`by ${OTHER_ADMIN_EMAIL}`);
    await expect(rows.nth(1).locator(".log-what")).toHaveText(`${NAMES.c02}: website hidden → shown; start time 19:00 → 19:30; licence none → Zoom 01`);
    await expect(rows.nth(2).locator(".log-what")).toHaveText("Circle, Zoom meeting 100000099 removed");
    await expect(rows.nth(3).locator(".log-what")).toHaveText("order set to 1, published");
    await expect(rows.nth(4)).toContainText("by automatic");
    await expect(rows.nth(4).locator(".log-what")).toHaveText("1 updated, published");
    await expect(rows.nth(5).locator(".log-what")).toHaveText(`${NAMES.c08} (tally)`);
    await expect(act).toContainText("Showing the latest 7 entries.");

    await act.getByRole("button", { name: "Website" }).click();
    await expect(act.getByRole("button", { name: "Website" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows.locator("b")).toHaveText(["Changed website listing", "Website update"]);
    await act.getByRole("button", { name: "Circles" }).click();
    await expect(rows.locator("b")).toHaveText(["Deleted circle", "Edited circle", "Ended circle", "Created circle"]);
    await act.getByRole("button", { name: "Zoom and admin" }).click();
    await expect(rows).toHaveCount(0);
    await expect(act.getByText("Nothing yet.")).toBeVisible();
  });

  test("a failed website update is highlighted in the activity log", async ({ page, mock }) => {
    mock.db.audit_log.unshift({ id: 20, at: "2026-10-07T09:59:00Z", actor: "cron", action: "framer_sync", circle_id: null, detail: { failed: "Course collection not found in Framer" } });
    await signIn(page, { hash: "/Settings" });
    const first = sectionOf(page, "Activity").locator(".log-row").first();
    await expect(first).toHaveClass(/warn-text/);
    await expect(first.locator(".log-what")).toHaveText("Failed: Course collection not found in Framer");
  });

  test("a super admin can add and remove admins", async ({ page, mock, dialogs }) => {
    await signIn(page, { role: "super", hash: "/Settings" });
    const admins = sectionOf(page, "Admins");
    await expect(admins).toContainText("You're a super admin: you can add and remove admins");
    await expect(adminRow(page, ADMIN_EMAIL).locator(".admin-super")).toHaveText("Super admin");
    await expect(adminRow(page, ADMIN_EMAIL).getByRole("button", { name: `Remove ${ADMIN_EMAIL}` })).toBeDisabled();
    await expect(adminRow(page, ADMIN_EMAIL).getByRole("button", { name: `Remove ${ADMIN_EMAIL}` })).toHaveAttribute("title", "You can't remove yourself");
    await expect(adminRow(page, OTHER_ADMIN_EMAIL).getByRole("button", { name: "Make super admin" })).toBeVisible();

    await admins.getByPlaceholder("email@…").fill(" New.Admin@Example.org ");
    await admins.getByRole("button", { name: "Add admin" }).click();
    await expect(toast(page)).toHaveText("Admin added and emailed an invite to set their password.");
    expect(mock.rest("admin_emails", "POST").map((r) => r.body)).toEqual([{ email: "new.admin@example.org" }]);
    expect(mock.fn("provision-circle", "invite_admin")).toEqual([{ action: "invite_admin", circle_id: null, facilitator: { email: "new.admin@example.org" } }]);
    await expect(adminRow(page, "new.admin@example.org")).toHaveCount(1);

    await adminRow(page, OTHER_ADMIN_EMAIL).getByRole("button", { name: `Remove ${OTHER_ADMIN_EMAIL}` }).click();
    await expect(toast(page)).toHaveText("Removed");
    expect(dialogs.messages).toContain(`Remove ${OTHER_ADMIN_EMAIL} as an admin?`);
    expect(mock.rest("admin_emails", "DELETE").map((r) => r.query)).toEqual([{ email: `eq.${OTHER_ADMIN_EMAIL}` }]);
    await expect(adminRow(page, OTHER_ADMIN_EMAIL)).toHaveCount(0);
  });

  test("a super admin can make someone a super admin", async ({ page, mock }) => {
    await signIn(page, { role: "super", hash: "/Settings" });
    await adminRow(page, OTHER_ADMIN_EMAIL).getByRole("button", { name: "Make super admin" }).click();
    await expect(toast(page)).toHaveText("Now a super admin");
    expect(mock.rest("admin_emails", "PATCH").map((r) => [r.query.email, r.body])).toEqual([[`eq.${OTHER_ADMIN_EMAIL}`, { is_super: true }]]);
    await expect(adminRow(page, OTHER_ADMIN_EMAIL).getByRole("button", { name: "Remove super admin" })).toBeVisible();
  });

  test("a normal admin sees the list but cannot add or remove admins", async ({ page }) => {
    await signIn(page, { role: "admin", hash: "/Settings" });
    const admins = sectionOf(page, "Admins");
    await expect(admins).toContainText("Everyone listed can use the whole dashboard. Only super admins can add or remove admins.");
    await expect(admins.locator(".list .row")).toHaveCount(2);
    await expect(admins.getByPlaceholder("email@…")).toHaveCount(0);
    await expect(admins.getByRole("button", { name: "Add admin" })).toHaveCount(0);
    await expect(admins.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(admins.getByRole("button", { name: /super admin/ })).toHaveCount(0);
    // Inviting another admin and naming yourself are still allowed.
    await expect(adminRow(page, OTHER_ADMIN_EMAIL).getByRole("button", { name: "Send invite" })).toBeVisible();
    await expect(adminRow(page, ADMIN_EMAIL).getByRole("button", { name: "Send invite" })).toHaveCount(0);
  });

  test("an admin can change the name that signs emails", async ({ page, mock }) => {
    await signIn(page, { role: "admin", hash: "/Settings" });
    const mine = adminRow(page, ADMIN_EMAIL);
    await mine.getByPlaceholder("Name (signs emails)").fill("Alex Q. Admin");
    await mine.getByRole("button", { name: "Save" }).click();
    await expect(toast(page)).toHaveText("Name saved");
    expect(mock.rest("admin_emails", "PATCH").map((r) => [r.query.email, r.body])).toEqual([[`eq.${ADMIN_EMAIL}`, { name: "Alex Q. Admin" }]]);
  });
});
