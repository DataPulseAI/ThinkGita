// Assessors and the Cancelled / Revoked outcomes: an assessor sees only the trainees assigned to them; admins assign
// trainees (one at a time or in bulk), add assessors in Settings, and record Cancelled or Revoked. Made-up people only.
import { test, expect, signIn, navTo, toast } from "./support/test.js";
import { ASSESSOR_EMAIL, ADMIN_EMAIL } from "../fixtures/data.js";

const row = (page, name) => page.locator(".tr-row", { hasText: name });
const panel = (page) => page.locator("aside.tr-drawer");

test.describe("Assessors", () => {
  test("an assessor sees only their trainees, can play a video and save a draft", async ({ page, mock }) => {
    await page.route("https://storage.example.org/**", (r) => r.fulfill({ status: 200, contentType: "video/mp4", body: "not a video" }));
    await signIn(page, { role: "assessor", email: ASSESSOR_EMAIL });
    await expect(page.locator(".topbar .role")).toHaveText("Assessor");
    await expect(page.locator("nav.tabs")).toHaveCount(0);
    const list = page.getByRole("region", { name: "Trainees assigned to you" });
    await expect(list.getByRole("heading")).toContainText("(2)");
    await expect(list.locator(".tr-row:not(.tr-head)")).toHaveCount(2);
    await expect(row(page, "Haridas")).toContainText("Ready to assess");
    await expect(row(page, "Kavi")).toContainText("Submitted");

    await row(page, "Haridas").click();
    const p = panel(page);
    await expect(p.getByRole("heading", { name: "Haridas" })).toBeVisible();
    // Nothing an admin does: no links, sending, status or outcome.
    await expect(p.getByText("Personal form links")).toHaveCount(0);
    await expect(p.getByRole("radiogroup", { name: "Outcome" })).toHaveCount(0);
    await expect(p.getByRole("combobox", { name: "Assigned to" })).toHaveCount(0);
    await expect(p.getByRole("checkbox", { name: "Intro session attended" })).toHaveCount(0);

    await p.locator(".tr-checklist li", { hasText: "Video assessment" }).getByRole("button", { name: /Answers/ }).click();
    await p.getByRole("button", { name: "▶ Play practice.mp4" }).click();
    await expect(p.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute("href", "https://storage.example.org/practice.mp4?fresh=1");

    await p.getByRole("radiogroup", { name: "Facilitation readiness" }).getByRole("radio", { name: "Meets" }).click();
    await p.getByRole("textbox", { name: /Overall feedback/ }).fill("Calm and clear.");
    await p.getByRole("button", { name: "Save draft" }).click();
    await expect(toast(page)).toContainText("Draft saved");
    expect(mock.rpc("save_assessment").at(-1)).toEqual({ p_trainee: "hari.trainee", p_assessment: { readiness: { rating: "meets" } }, p_feedback: "Calm and clear." });
  });

  test("admins assign from the Assessor column, filter by assessor, and assign from the panel", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await expect(row(page, "Haridas").getByRole("combobox", { name: /^Assessor for/ })).toHaveValue(ASSESSOR_EMAIL);
    await expect(row(page, "Gauri").getByRole("combobox", { name: /^Assessor for/ })).toHaveValue("");

    for (const name of ["Gauri Testperson", "Isha Placeholder"]) {
      await page.getByRole("combobox", { name: `Assessor for ${name}` }).selectOption({ label: "Asha Assessor (assessor)" });
      await expect(toast(page)).toContainText("Trainee assigned to Asha Assessor.");
    }
    expect(mock.rest("trainees", "PATCH").map((x) => x.body)).toEqual([{ assigned_to: ASSESSOR_EMAIL }, { assigned_to: ASSESSOR_EMAIL }]);
    await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);

    await page.getByRole("combobox", { name: "Assessor filter" }).selectOption({ label: "Asha Assessor (assessor)" });
    await expect(page.locator(".tr-row:not(.tr-head)")).toHaveCount(4);
    await page.getByRole("combobox", { name: "Assessor filter" }).selectOption({ label: "Unassigned" });
    await expect(page.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await expect(row(page, "Jay")).toBeVisible();

    await row(page, "Jay").click();
    await panel(page).getByRole("combobox", { name: "Assigned to" }).selectOption({ label: "Helen Helper (admin)" });
    await expect(toast(page)).toContainText("Trainee assigned to Helen Helper.");
    expect(mock.rest("trainees", "PATCH").at(-1).body).toEqual({ assigned_to: "helper@example.org" });
  });

  test("assign one trainee straight from the Assessor column, without opening their panel", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Gauri").getByRole("combobox", { name: "Assessor for Gauri Testperson" }).selectOption({ label: "Asha Assessor (assessor)" });
    await expect(toast(page)).toContainText("Trainee assigned to Asha Assessor.");
    const patch = mock.rest("trainees", "PATCH").at(-1);
    expect(patch.body).toEqual({ assigned_to: ASSESSOR_EMAIL });
    expect(patch.query.id).toBe("in.(gauri.trainee)");
    await expect(page.locator("aside.drawer")).toHaveCount(0);
  });

  test("the assessor view filters by To assess and Submitted", async ({ page }) => {
    await signIn(page, { role: "assessor", email: ASSESSOR_EMAIL });
    const list = page.getByRole("region", { name: "Trainees assigned to you" });
    const chips = list.getByRole("group", { name: "Training status" });
    await expect(chips.getByRole("button", { name: /^All\s*2$/ })).toBeVisible();
    await expect(chips.getByRole("button", { name: /^Applied/ })).toHaveCount(0);
    await chips.getByRole("button", { name: /^Certified/ }).click();
    await expect(list.locator(".tr-row:not(.tr-head)")).toHaveCount(0);
    await chips.getByRole("button", { name: /^To assess/ }).click();
    await expect(list.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await expect(row(page, "Haridas")).toBeVisible();
    await chips.getByRole("button", { name: /^Submitted/ }).click();
    await expect(list.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await expect(row(page, "Kavi")).toBeVisible();
  });

  test("removing an assessor asks first, and says their trainees become unassigned", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Setup", "Settings");
    const card = page.getByRole("region", { name: "Assessors" });
    await card.getByRole("button", { name: `Remove ${ASSESSOR_EMAIL} as an assessor` }).click();
    expect(dialogs.messages.at(-1)).toMatch(/Their 2 assigned trainees will become unassigned\./);
    await expect(toast(page)).toContainText("removed as an assessor");
    expect(mock.rest("assessors", "DELETE")).toHaveLength(1);
  });

  test("an admin who also hosts a circle can switch to the facilitator portal and back", async ({ page, mock }) => {
    mock.db.facilitators.push({ id: "fac-admin", name: "Admin Host", email: ADMIN_EMAIL, verified_at: "2026-10-01T00:00:00Z" });
    await signIn(page);
    await page.getByRole("button", { name: "Facilitator portal" }).click();
    await expect(page.locator(".topbar .role")).toHaveText("Facilitator");
    await page.getByRole("button", { name: "Admin view" }).click();
    await expect(page.locator(".topbar .role")).toHaveText("Admin");
    await expect(page.locator("nav.tabs")).toBeVisible();
  });

  test("revoke asks first and sends the revoked email", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Gauri").click();
    const p = panel(page);
    await p.getByRole("radiogroup", { name: "Outcome" }).getByRole("radio", { name: "Revoked" }).click();
    await expect(p.locator(".tr-outcome-note")).toContainText("Permanent.");
    await expect(p.getByRole("textbox", { name: "Subject" })).toHaveValue("Your Think Gita facilitator status, Gauri");
    await p.getByRole("button", { name: "Send email and record" }).click();
    expect(dialogs.messages.at(-1)).toMatch(/^Revoke Gauri Testperson\? This is permanent/);
    await expect(toast(page)).toContainText("Revoked recorded. Email sent to gauri.trainee@example.org.");
    expect(mock.fn("training", "decide")[0]).toMatchObject({ trainee_id: "gauri.trainee", decision: "revoked", send: true });
    expect(mock.fn("training", "decide")[0].text).toContain("your Think Gita facilitator status has been revoked");
  });

  test("cancelled can be recorded without an email, with no missing steps warning", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Isha").click();
    const p = panel(page);
    await p.getByRole("radiogroup", { name: "Outcome" }).getByRole("radio", { name: "Cancelled" }).click();
    await expect(p.locator(".tr-outcome-note")).toContainText("Nothing against them");
    await p.getByRole("button", { name: "Record without email" }).click();
    await expect(toast(page)).toContainText("Cancelled recorded. No email sent.");
    expect(dialogs.messages).toEqual([]);
    expect(mock.fn("training", "decide")[0]).toMatchObject({ trainee_id: "isha.trainee", decision: "cancelled", send: false });
    await expect(row(page, "Isha")).toContainText("Cancelled");
  });

  test("Settings: add an assessor and send the invite", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Setup", "Settings");
    const card = page.getByRole("region", { name: "Assessors" });
    await expect(card).toContainText("Asha Assessor");
    await expect(card).toContainText("2 assigned");

    const form = card.getByRole("form", { name: "Add an assessor" });
    await form.getByRole("textbox", { name: "Email" }).fill("helper@example.org");
    await expect(form).toContainText("They're already an admin");
    await expect(form.getByRole("button", { name: "Add and invite" })).toBeDisabled();

    await form.getByRole("textbox", { name: "Name" }).fill("Ravi Reviewer");
    await form.getByRole("textbox", { name: "Email" }).fill(" Ravi.Reviewer@Example.org ");
    await form.getByRole("button", { name: "Add and invite" }).click();
    await expect(toast(page)).toContainText("Ravi Reviewer added as an assessor. Sign-in invite sent.");
    expect(mock.rest("assessors", "POST")[0].body).toMatchObject({ email: "ravi.reviewer@example.org", name: "Ravi Reviewer" });
    expect(mock.fn("training", "invite_assessor")[0]).toMatchObject({ email: "ravi.reviewer@example.org" });
    await expect(card).toContainText("Ravi Reviewer");

    await card.getByRole("button", { name: `Send invite to ${ASSESSOR_EMAIL}` }).click();
    await expect(toast(page)).toContainText(`${ASSESSOR_EMAIL}: Sign-in invite sent.`);
  });

  test("a revoked facilitator is tagged and can't be verified", async ({ page, mock }) => {
    const f = mock.db.facilitators.find((x) => x.name === "Chitra Placeholder");
    f.revoked_at = "2026-10-01T10:00:00Z";
    await signIn(page);
    await navTo(page, "Circles", "Facilitators");
    const r = page.locator(".fac-row", { hasText: "Chitra Placeholder" });
    await expect(r.locator(".tag.revoked")).toHaveText("Revoked");
    await r.click();
    const p = page.locator("aside.fac-drawer");
    await expect(p.locator(".fac-verify")).toContainText("Revoked on 1 Oct 2026 in training.");
    await expect(p.getByRole("button", { name: "Verify" })).toHaveCount(0);
  });
});
