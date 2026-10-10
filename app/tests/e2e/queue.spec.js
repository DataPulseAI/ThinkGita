import { test, expect, signIn, toast, fail } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

const row = (page, name) => page.locator(".list .row", { has: page.locator(".row-title", { hasText: name }) });
const modal = (page) => page.locator("form.approve-modal");

test.describe("Queue", () => {
  test("lists clashes first, then circles awaiting approval", async ({ page }) => {
    await signIn(page, { hash: "/Queue" });
    const rows = page.locator(".list .row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveClass(/row-warn/);
    await expect(rows.nth(0).locator(".row-title")).toHaveText(NAMES.c04);
    await expect(rows.nth(0)).toContainText("No licence free on Monday at 19:00 (UK)");
    await expect(rows.nth(1).locator(".row-title")).toHaveText(NAMES.c03);
    await expect(rows.nth(1)).toContainText("Assigned to Zoom 02");
    await expect(rows.nth(1)).toContainText("Tue 18:00 New York time");
    await expect(page.getByRole("button", { name: "Approve all ready (2)" })).toBeEnabled();
    await expect(page.locator("nav.tabs .tab", { hasText: "Queue" }).locator(".count")).toHaveText("3");
  });

  test("approve without emailing: the dialog and the provision request", async ({ page, mock }) => {
    await signIn(page, { hash: "/Queue" });
    await row(page, NAMES.c03).getByRole("button", { name: "Approve + create Zoom" }).click();
    const m = modal(page);
    await expect(m.getByRole("heading")).toHaveText(`Approve ${NAMES.c03}`);
    await expect(m).toContainText("Creates the weekly Zoom meeting on Zoom 02 and emails Chitra Placeholder their details and a sign-in invite.");
    const notify = m.getByLabel("Email the facilitator their details and a sign-in invite");
    await expect(notify).toBeChecked();
    await expect(m.getByLabel("Email signed by")).toHaveValue("Alex Admin");
    await notify.uncheck();
    await expect(m).toContainText("Nobody is emailed.");
    await expect(m).toContainText("You can send it later from the circle panel with Resend details email.");
    await m.getByRole("button", { name: "Create Zoom, no email" }).click();

    await expect(toast(page)).toHaveText("Zoom meeting created. No email sent, as chosen. Use Resend details email when ready.");
    await expect(modal(page)).toHaveCount(0);
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c03", { whatsapp_group_link: null, youtube_playlist_link: null }]]);
    expect(mock.fn("provision-circle")).toEqual([{ action: "provision", circle_id: "c03", notify: false }]);
    // The admin's name did not change, so it is not saved again.
    expect(mock.rest("admin_emails", "PATCH")).toHaveLength(0);
  });

  test("approve and email: links and signer name are saved first", async ({ page, mock }) => {
    await signIn(page, { hash: "/Queue" });
    await row(page, NAMES.c03).getByRole("button", { name: "Approve + create Zoom" }).click();
    const m = modal(page);
    await m.getByLabel("WhatsApp group link").fill("not a link");
    await expect(m.getByText("That doesn't look like a link. It should start with https://")).toBeVisible();
    await expect(m.getByRole("button", { name: "Approve + create Zoom" })).toBeDisabled();
    await m.getByLabel("WhatsApp group link").fill("https://chat.whatsapp.com/NEWGROUP");
    await m.getByLabel("YouTube playlist link").fill("https://youtube.com/playlist?list=FAKE");
    await m.getByLabel("Email signed by").fill("Alex A.");
    await m.getByRole("button", { name: "Approve + create Zoom" }).click();

    await expect(toast(page)).toHaveText("Zoom meeting created. Sign-in invite sent. Email sent to chitra.placeholder@example.org.");
    expect(mock.rest("admin_emails", "PATCH").map((r) => [r.query.email, r.body])).toEqual([["eq.admin@example.org", { name: "Alex A." }]]);
    expect(mock.rest("circles", "PATCH")[0].body).toEqual({ whatsapp_group_link: "https://chat.whatsapp.com/NEWGROUP", youtube_playlist_link: "https://youtube.com/playlist?list=FAKE" });
    expect(mock.fn("provision-circle")).toEqual([{ action: "provision", circle_id: "c03", notify: true }]);
  });

  test("approving with an email but no links asks first, and cancelling sends nothing", async ({ page, mock, dialogs }) => {
    dialogs.accept = false;
    await signIn(page, { hash: "/Queue" });
    await row(page, NAMES.c03).getByRole("button", { name: "Approve + create Zoom" }).click();
    await modal(page).getByRole("button", { name: "Approve + create Zoom" }).click();
    await expect.poll(() => dialogs.messages).toEqual(['No WhatsApp group yet. The email will say "to follow" there. Approve anyway?']);
    await expect(modal(page)).toBeVisible();
    expect(mock.fn("provision-circle")).toHaveLength(0);
    await modal(page).getByRole("button", { name: "Cancel" }).click();
    await expect(modal(page)).toHaveCount(0);
  });

  test("a failed approval shows the error from the server", async ({ page, mock }) => {
    mock.handle("fn provision-circle provision", fail("Zoom user zoom02@example.org is not licensed", 500));
    await signIn(page, { hash: "/Queue" });
    await row(page, NAMES.c03).getByRole("button", { name: "Approve + create Zoom" }).click();
    await modal(page).getByLabel("Email the facilitator their details and a sign-in invite").uncheck();
    await modal(page).getByRole("button", { name: "Create Zoom, no email" }).click();
    await expect(page.locator(".toast.error")).toHaveText("Zoom user zoom02@example.org is not licensed");
    await expect(modal(page)).toBeVisible();
  });

  test("approve all ready approves every pending circle with a licence", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Queue" });
    await page.getByRole("button", { name: "Approve all ready (2)" }).click();
    await expect(toast(page)).toHaveText("2 circles approved. Emails sent: 2 of 2.");
    expect(dialogs.messages[0]).toBe("Create Zoom meetings for 2 circles and email their facilitators?");
    expect(mock.fn("provision-circle")).toEqual([{ action: "provision", circle_id: "c03" }, { action: "provision", circle_id: "c08" }]);
  });

  test("a clash can suggest free times and move to one", async ({ page, mock }) => {
    mock.handle("rpc suggest_slots", [{ start_time: "20:30:00", licence_label: "Zoom 02" }, { start_time: "21:00:00", licence_label: "Zoom 03" }]);
    mock.handle("rpc allocate_circle", (req, m) => {
      const c = m.db.circles.find((x) => x.id === req.body.p_circle);
      Object.assign(c, { status: "pending", licence_id: "lic-02", conflict_reason: null });
      return { status: "pending" };
    });
    await signIn(page, { hash: "/Queue" });
    const clash = row(page, NAMES.c04);
    await clash.getByRole("button", { name: "Suggest times" }).click();
    await expect(clash.locator(".suggest")).toContainText("Free times (their time):");
    await expect(clash.locator(".suggest .chip")).toHaveText(["20:30 · Zoom 02", "21:00 · Zoom 03"]);
    expect(mock.rpc("suggest_slots")).toEqual([{ p_circle: "c04" }]);
    await clash.getByRole("button", { name: "20:30 · Zoom 02", exact: true }).click();
    await expect(toast(page)).toHaveText(`${NAMES.c04} moved to 20:30 (their time): Awaiting approval`);
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c04", { start_time: "20:30:00" }]]);
    expect(mock.rpc("allocate_circle")).toEqual([{ p_circle: "c04" }]);
    await expect(page.locator(".list .row.row-warn")).toHaveCount(0);
  });

  test("a clash with no free time says so, and re-check reports the result", async ({ page, mock }) => {
    await signIn(page, { hash: "/Queue" });
    const clash = row(page, NAMES.c04);
    await clash.getByRole("button", { name: "Suggest times" }).click();
    await expect(clash.getByText("No free time within 3 hours that day.")).toBeVisible();
    await clash.getByRole("button", { name: "Re-check", exact: true }).click();
    await expect(toast(page)).toHaveText("Re-checked: Clash: no licence");
    await page.getByRole("button", { name: "Re-check all clashes (1)" }).click();
    await expect(toast(page)).toHaveText("Re-checked: no licence has freed up yet");
    expect(mock.rpc("recheck_conflicts")).toHaveLength(1);
  });

  test("reject asks first and sends the status change", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Queue" });
    await row(page, NAMES.c08).getByRole("button", { name: "Reject" }).click();
    await expect(toast(page)).toHaveText("Rejected");
    expect(dialogs.messages).toEqual([`Reject ${NAMES.c08}?`]);
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c08", { status: "rejected", licence_id: null }]]);
    await expect(page.locator(".list .row")).toHaveCount(2);
  });
});
