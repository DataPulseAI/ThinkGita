import { test, expect, signIn, toast, navTo } from "./support/test.js";
import { NAMES, ADMIN_EMAIL } from "../fixtures/data.js";

test.describe("Email templates", () => {
  test("renders the editor and a preview for a live circle", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Setup", "Email templates");
    await expect(page.getByRole("heading", { name: "Links and contacts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Facilitator emails" })).toBeVisible();
    await expect(page.getByLabel("Preview with")).toHaveValue("c01");
    await expect(page.locator(".email-preview .email-subject")).not.toBeEmpty();
    await expect(page.locator(".email-preview .email-body")).toContainText("https://zoom.example.org/j/100000001?pwd=fake");
    await expect(page.getByRole("button", { name: "Saved" }).first()).toBeDisabled();
  });

  test("sends a test email with the current draft", async ({ page, mock }) => {
    await signIn(page, { hash: "/Emails" });
    const subject = page.locator(".email-editor").getByLabel("Subject");
    await subject.fill("Your circle details (draft)");
    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(toast(page)).toHaveText(`Test email sent to ${ADMIN_EMAIL}`);
    const [call] = mock.fn("provision-circle", "test_email");
    expect(call).toMatchObject({ action: "test_email", circle_id: "c01", template_key: "approved", template: { subject: "Your circle details (draft)" } });
    expect(call.template.body.length).toBeGreaterThan(50);
  });

  test("a test email for a circle awaiting approval uses that circle", async ({ page, mock }) => {
    await signIn(page, { hash: "/Emails" });
    await page.getByLabel("Preview with").selectOption("c03");
    await expect(page.getByText("Zoom link, meeting ID, passcode and exact first date are filled in when the circle is approved.")).toBeVisible();
    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(toast(page)).toBeVisible();
    expect(mock.fn("provision-circle", "test_email")[0].circle_id).toBe("c03");
  });

  test("details changed email: the changes placeholder, example changes in the preview and the test email", async ({ page, mock }) => {
    await signIn(page, { hash: "/Emails" });
    await page.getByRole("button", { name: "Details changed" }).click();
    const editor = page.locator(".email-editor");
    await expect(editor.getByLabel("Body")).toHaveValue(/WHAT CHANGED\n\{\{changes\}\}/);
    await expect(editor.locator(".ph-chip", { hasText: "changes" })).toHaveClass(/used/);
    await expect(editor.locator(".ph-chip", { hasText: "changes" })).toHaveAttribute("title", "What changed, before and after (details changed email)");
    await expect(page.getByText('"What changed" shows example changes here and in the test email')).toBeVisible();
    const body = page.locator(".email-preview .email-body");
    await expect(body).toContainText("WHAT CHANGED");
    await expect(body).toContainText("- Day and time: Sunday 19:00 to Monday 19:00 (UK time)");
    await expect(body).toContainText("- Zoom link: the same as before, so nothing changes in your WhatsApp group.");
    await expect(page.getByText(/Nothing set for this circle:.*What changed/)).toHaveCount(0);

    // A template without the placeholder (like one saved before it existed) still opens with what changed.
    await editor.getByLabel("Body").fill("Dear {{first_name}},\n\nSome details of your Circle have changed.\n\nYOUR CIRCLE\nCircle name: {{circle_name}}");
    await expect(body.locator("p").nth(1)).toContainText("WHAT CHANGED- Day and time: Sunday 19:00 to Monday 19:00 (UK time)");
    await expect(body.locator("p").nth(2)).toHaveText("Some details of your Circle have changed.");

    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(toast(page)).toHaveText(`Test email sent to ${ADMIN_EMAIL}`);
    expect(mock.fn("provision-circle", "test_email")[0]).toMatchObject({ circle_id: "c01", template_key: "updated" });
  });

  test("saving a template and the links", async ({ page, mock }) => {
    await signIn(page, { hash: "/Emails" });
    const editor = page.locator(".email-editor");
    await editor.getByLabel("Body").fill("Hello {{bogus}}");
    await expect(page.getByText("Not recognised: {{bogus}}.")).toBeVisible();
    await editor.getByLabel("Body").fill("Hello {{facilitator_name}}, your circle is ready.");
    await editor.getByLabel("Subject").fill("Ready");
    await page.getByRole("button", { name: "Save email" }).click();
    await expect(toast(page)).toHaveText("Email saved. It's used from the next email sent.");
    const saved = mock.rest("email_templates", "POST")[0].body;
    expect(saved).toMatchObject({ key: "approved", subject: "Ready", body: "Hello {{facilitator_name}}, your circle is ready.", updated_by: ADMIN_EMAIL });

    const links = page.locator("section.card", { has: page.getByRole("heading", { name: "Links and contacts" }) });
    await links.getByLabel("Support contact").fill("help@example.org");
    await links.getByRole("button", { name: "Save" }).click();
    await expect(toast(page)).toHaveText("Links and contacts saved");
    expect(mock.rest("settings", "PATCH").map((r) => [r.query.id, r.body])).toEqual([
      ["eq.1", { drive_folder_link: "https://drive.example.org/shared-folder", support_contact: "help@example.org", youtube_playlist_link: null }],
    ]);
  });
});

test.describe("Sent emails", () => {
  test("lists emails with status filters and opens one", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Setup", "Sent emails");
    await expect(page.getByRole("heading", { name: "Sent emails" })).toBeVisible();
    const rows = page.locator("table.email-log tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("button", { name: "All (3)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sent (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Failed or not sent (2)" }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("SMTP timeout");
    await expect(rows.first().getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(rows.nth(1)).toContainText("Not sent");

    await page.getByRole("button", { name: "All (3)" }).click();
    await rows.first().click();
    const detail = page.locator(".email-detail");
    await expect(detail).toContainText("ThinkGita Circles <circles@example.org>");
    await expect(detail).toContainText("Your ThinkGita circle is ready");
    await expect(detail.locator("iframe.email-frame")).toBeVisible();
    await detail.getByRole("button", { name: "Plain text" }).click();
    await expect(detail.locator("pre.email-plain")).toHaveText("Hello Asha, your circle is ready.");
    const read = mock.log.find((r) => r.kind === "rest" && r.table === "email_log" && r.query.id === "eq.em-01");
    expect(read.single).toBe(true);
  });

  test("search and resend a failed email", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/EmailLog" });
    await page.getByPlaceholder("Search recipient, subject, circle").fill("dev.fictional");
    const rows = page.locator("table.email-log tbody tr");
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("button", { name: "Resend" }).click();
    await expect(toast(page)).toHaveText("Details email: Email sent to dev.fictional@example.org.");
    expect(dialogs.messages[0]).toBe(`Send the current details email for "${NAMES.c05}" to dev.fictional@example.org again?`);
    expect(mock.fn("provision-circle", "resend")).toEqual([{ action: "resend", circle_id: "c05" }]);
  });

  test("the Overview failed email banner opens the failed emails", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "See which" }).click();
    await expect(page).toHaveURL(/#\/EmailLog\/failed$/);
    await expect(page.locator("table.email-log tbody tr")).toHaveCount(2);
  });
});
