// Training page (#/Training): trainees with one dot per training step, filters, the trainee panel (sessions, form
// answers, personal links, assessment) and the final Certified / Not certified email. Made-up trainees only.
import { test, expect, signIn, navTo, toast, expectNoHorizontalOverflow } from "./support/test.js";

const row = (page, name) => page.locator(".tr-row", { hasText: name });
const panel = (page) => page.locator("aside.tr-drawer");

test.describe("Training", () => {
  test("lists trainees with their progress dots and filters by status", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Training");
    await expect(page).toHaveURL(/#\/Training$/);
    await expect(page.getByRole("heading", { name: /^Trainees/ })).toContainText("(5)");

    // Gauri: intro, agreement and scene done. Hari: everything done, so ready to assess.
    await expect(row(page, "Gauri").locator(".tr-dot.done")).toHaveCount(3);
    await expect(row(page, "Gauri")).toContainText("In training");
    await expect(row(page, "Haridas").locator(".tr-dot.done")).toHaveCount(7);
    await expect(row(page, "Haridas")).toContainText("Ready to assess");
    await expect(row(page, "Isha")).toContainText("Applied");
    await expect(row(page, "Jay")).toContainText("Certified");
    // Kavi's assessor has sent in their assessment: waiting for an admin to decide.
    await expect(row(page, "Kavi")).toContainText("Assessed, awaiting decision");
    await expect(row(page, "Gauri").locator(".tr-dot").first()).toHaveAttribute("title", /^Intro session: done/);

    const chips = page.getByRole("group", { name: "Training status" });
    await chips.getByRole("button", { name: "Ready to assess 1" }).click();
    await expect(page.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await chips.getByRole("button", { name: "Assessed, awaiting decision 1" }).click();
    await expect(page.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await expect(row(page, "Kavi")).toBeVisible();
    await chips.getByRole("button", { name: "All 5" }).click();
    await page.getByRole("searchbox", { name: "Search trainees" }).fill("isha");
    await expect(page.locator(".tr-row:not(.tr-head)")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test("resync lives in Settings (asks first), and matching a form nobody claimed", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await expect(page.getByRole("button", { name: "Resync from Tally" })).toHaveCount(0);
    await navTo(page, "Setup", "Settings");
    await page.getByRole("region", { name: "Training forms from Tally" }).getByRole("button", { name: "Resync from Tally" }).click();
    expect(dialogs.messages.at(-1)).toMatch(/Run a full sync from Tally\?/);
    await expect(toast(page)).toContainText("Synced from Tally: 3 submissions, 1 new.");
    expect(mock.fn("training", "sync")).toHaveLength(1);
    await navTo(page, "Training");

    // Needs matching is its own view, with a count of emails to match.
    await expect(page.getByRole("tab", { name: /^Needs matching\s*2$/ })).toBeVisible();
    await page.getByRole("tab", { name: /Needs matching/ }).click();
    const card = page.getByRole("region", { name: "Needs matching" });
    const kiran = card.getByLabel("Forms from unknown.person@example.org", { exact: true });
    await expect(kiran).toContainText("Wisdom reflections");
    await expect(kiran).toContainText("Kiran Unknown");
    // Nobody has that name, so it's picked by hand.
    await kiran.getByRole("combobox").selectOption({ label: "Gauri Testperson (gauri.trainee@example.org)" });
    await expect(toast(page)).toContainText("Linked 1 form from unknown.person@example.org to Gauri Testperson. Future forms from this email will match too.");
    expect(mock.rest("training_submissions", "PATCH")[0].body).toEqual({ trainee_id: "gauri.trainee", matched_by: "admin" });
    expect(mock.rest("trainees", "PATCH")[0].body).toEqual({ other_emails: ["unknown.person@example.org"] });
    await expect(kiran).toHaveCount(0);
    await page.getByRole("tab", { name: "Trainees" }).click();
    await expect(row(page, "Gauri").locator(".tr-dot.done")).toHaveCount(4);
    // The other email shows on her panel, and can be removed.
    await row(page, "Gauri").click();
    await expect(panel(page).locator(".tr-other-emails")).toContainText("unknown.person@example.org");
    await panel(page).getByRole("button", { name: "Remove unknown.person@example.org" }).click();
    await expect(toast(page)).toContainText("unknown.person@example.org removed");
    expect(mock.rest("trainees", "PATCH").at(-1).body).toEqual({ other_emails: [] });
  });

  test("needs matching suggests a trainee by name and links every form from that email", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await page.getByRole("tab", { name: /Needs matching/ }).click();
    const isha = page.getByLabel("Forms from ishaplaceholder108@example.org", { exact: true });
    // One row for the email, listing both forms, with Isha suggested side by side.
    await expect(isha).toContainText("Agreement form");
    await expect(isha).toContainText("Setting the Scene reflections");
    await expect(isha.locator(".tr-match-hint")).toContainText("Isha Placeholder");
    await expect(isha.locator(".tr-match-hint")).toContainText("isha.trainee@example.org (same name)");
    // Not them: the suggestion goes and the picker comes back.
    await isha.getByRole("button", { name: "Not them" }).click();
    await expect(isha.getByRole("combobox")).toBeVisible();
    expect(mock.rest("training_submissions", "PATCH")).toHaveLength(0);
    // Come back to the view: the suggestion is offered again.
    await page.getByRole("tab", { name: "Trainees" }).click();
    await page.getByRole("tab", { name: /Needs matching/ }).click();
    await page.getByLabel("Forms from ishaplaceholder108@example.org", { exact: true }).getByRole("button", { name: "Same person: link" }).click();
    await expect(toast(page)).toContainText("Linked 2 forms from ishaplaceholder108@example.org to Isha Placeholder. Future forms from this email will match too.");
    const patch = mock.rest("training_submissions", "PATCH").at(-1);
    expect(patch.body).toEqual({ trainee_id: "isha.trainee", matched_by: "admin" });
    expect(patch.query).toMatchObject({ trainee_id: "is.null", email: "eq.ishaplaceholder108@example.org" });
    expect(mock.rest("trainees", "PATCH").at(-1).body).toEqual({ other_emails: ["ishaplaceholder108@example.org"] });
    await expect(page.getByLabel("Forms from ishaplaceholder108@example.org", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Trainees" }).click();
    await expect(row(page, "Isha").locator(".tr-dot.done")).toHaveCount(2);
  });

  test("trainee panel: sessions, answers, personal links and the assessment", async ({ page, mock, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Gauri").click();
    const p = panel(page);
    await expect(p.getByRole("heading", { name: "Gauri Testperson" })).toBeVisible();

    // Closing session: mark as attended.
    await p.getByRole("checkbox", { name: "Closing session attended" }).click();
    await expect(toast(page)).toContainText("Closing session marked as attended");
    const patch = mock.rest("trainees", "PATCH").at(-1).body;
    expect(patch.closing_marked_by).toBe("admin@example.org");
    expect(patch.closing_attended_at).toBeTruthy();
    await expect(p.getByRole("checkbox", { name: "Closing session attended" })).toBeChecked();

    // A form's answers.
    await p.locator(".tr-checklist li", { hasText: "Setting the Scene" }).getByRole("button", { name: /Answers/ }).click();
    await expect(p.locator(".tr-answers")).toContainText("Arjuna's doubt felt familiar.");

    // Personal links carry the trainee id.
    await expect(p.locator(".tr-links")).toContainText("https://forms.example.org/scene?lang=en&tid=gauri.trainee");
    await p.getByRole("button", { name: "Copy all links" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.split("\n")).toEqual([
      "Agreement form: https://tally.example.org/r/agree?tid=gauri.trainee",
      "Setting the Scene reflections: https://forms.example.org/scene?lang=en&tid=gauri.trainee",
      "Empowerment reflections: https://tally.example.org/r/empower?tid=gauri.trainee",
      "Wisdom reflections: https://tally.example.org/r/wisdom?tid=gauri.trainee",
      "Video assessment: https://tally.example.org/r/video?tid=gauri.trainee",
    ]);

    // Assessment: rate two criteria, add a note and feedback, save.
    await p.getByRole("radiogroup", { name: "Delivery and communication skills" }).getByRole("radio", { name: "Meets" }).click();
    await p.getByRole("radiogroup", { name: "Technical quality" }).getByRole("radio", { name: "Partly" }).click();
    await p.getByRole("textbox", { name: "Technical quality note" }).fill("Audio dipped at times");
    await p.getByRole("textbox", { name: /Overall feedback/ }).fill("Warm and clear.");
    await p.getByRole("button", { name: "Save assessment" }).click();
    await expect(toast(page)).toContainText("Assessment saved");
    expect(mock.rpc("save_assessment").at(-1)).toEqual({
      p_trainee: "gauri.trainee",
      p_assessment: { delivery: { rating: "meets" }, technical: { rating: "partly", note: "Audio dipped at times" } },
      p_feedback: "Warm and clear.",
    });
  });

  test("a video answer plays in the panel, with a fresh link fetched on Play", async ({ page, mock }) => {
    await page.route("https://storage.example.org/**", (r) => r.fulfill({ status: 200, contentType: "video/mp4", body: "not a video" }));
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Haridas").click();
    const p = panel(page);
    await p.locator(".tr-checklist li", { hasText: "Video assessment" }).getByRole("button", { name: /Answers/ }).click();
    await expect(p.locator("video")).toHaveCount(0);
    await p.getByRole("button", { name: "▶ Play practice.mp4" }).click();
    await expect(p.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute("href", "https://storage.example.org/practice.mp4?fresh=1");
    expect(mock.fn("training", "file").at(-1)).toMatchObject({ action: "file", response_id: "r-ts-h9" });
    // This file can't play here (the test server has no video), so the panel says so instead of a broken player.
    await expect(p.getByText(/can't play this video format/)).toBeVisible();
  });

  test("certify with the email, edited before it goes", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Haridas").click();
    const p = panel(page);
    await p.getByRole("textbox", { name: /Overall feedback/ }).fill("Lovely pacing and warmth.");
    await p.getByRole("radiogroup", { name: "Outcome" }).getByRole("radio", { name: "Certified", exact: true }).click();
    await expect(p.getByLabel("Subject")).toHaveValue("You're a certified Think Gita facilitator, Hari");
    const message = p.getByRole("textbox", { name: "Message" });
    await expect(message).toHaveValue(/Lovely pacing and warmth\./);
    await expect(message).toHaveValue(/https:\/\/tally\.example\.org\/r\/request/);
    await message.fill(`${await message.inputValue()}\n\nPS: see you at the next gathering.`);
    await expect(p.getByLabel("Email preview")).toContainText("PS: see you at the next gathering.");
    await p.getByRole("button", { name: "Send email and record" }).click();
    await expect(toast(page)).toContainText("Certified recorded. Email sent to hari.trainee@example.org.");
    const sent = mock.fn("training", "decide")[0];
    expect(sent).toMatchObject({ trainee_id: "hari.trainee", decision: "certified", send: true, feedback: "Lovely pacing and warmth.", subject: "You're a certified Think Gita facilitator, Hari" });
    expect(sent.text).toContain("PS: see you at the next gathering.");
    expect(sent.html).toContain('<a href="https://tally.example.org/r/request"');
    await expect(row(page, "Haridas")).toContainText("Certified");
  });

  test("not certified without an email, after a warning about missing steps", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Gauri").click();
    const p = panel(page);
    await p.getByRole("radiogroup", { name: "Outcome" }).getByRole("radio", { name: "Not certified" }).click();
    await p.getByRole("button", { name: "Record without email" }).click();
    expect(dialogs.messages[0]).toMatch(/Only 3 of 7 training steps are done/);
    await expect(toast(page)).toContainText("Not certified recorded. No email sent.");
    expect(mock.fn("training", "decide")[0]).toMatchObject({ decision: "not_certified", send: false });
    expect(mock.fn("training", "decide")[0].subject).toBeUndefined();
  });

  test("email wording can be edited and saved", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await page.getByRole("tab", { name: "Email wording" }).click();
    await page.locator(".tr-emails").getByRole("button", { name: "Certified", exact: true }).click();
    const subject = page.locator(".tr-emails").getByLabel("Subject");
    await expect(subject).not.toHaveValue("");
    await subject.fill("Congratulations, {{first_name}}");
    await expect(page.locator(".tr-emails").getByRole("button", { name: "Save email" })).toBeEnabled();
    await page.locator(".tr-emails").getByRole("button", { name: "Save email" }).click();
    await expect(toast(page)).toContainText("Email wording saved");
    expect(mock.rest("email_templates", "POST")[0].body).toMatchObject({ key: "training_certified", subject: "Congratulations, {{first_name}}" });
  });

  test("next steps: send each trainee their next form, and chase", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    // Isha's Agreement email failed, so she still needs it; Gauri was sent Empowerment 8 days ago.
    await page.getByRole("tab", { name: /Next steps/ }).click();
    // Two forms to send or chase, plus Kavi's assessment waiting for a decision.
    await expect(page.getByRole("tab", { name: /Next steps/ })).toContainText("3");
    const send = page.getByRole("region", { name: "Send next form" });
    await expect(send.getByRole("heading", { name: "Agreement form (1)" })).toBeVisible();
    await expect(send).toContainText("Isha Placeholder");
    await expect(send).not.toContainText("Haridas");
    const chase = page.getByRole("region", { name: "Chase" });
    await expect(chase).toContainText("Gauri Testperson");
    await expect(chase).toContainText("Empowerment reflections · Sent 8 days ago");

    await send.getByRole("button", { name: "Send to all 1" }).click();
    expect(dialogs.messages.at(-1)).toMatch(/Send the Agreement form to 1 trainee\?/);
    await expect(toast(page)).toContainText("Sent 1.");
    const emails = mock.fn("training", "send_form")[0].emails;
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ trainee_id: "isha.trainee", form_key: "agreement", subject: "Your next Think Gita training form: Agreement form" });
    expect(emails[0].text).toContain("Dear Isha,");
    expect(emails[0].text).toContain("Your next step is the Agreement form.");
    expect(emails[0].text).toContain("https://tally.example.org/r/agree?tid=isha.trainee");
    expect(emails[0].html).toContain('<a href="https://tally.example.org/r/agree?tid=isha.trainee"');
    await expect(send).toContainText("Everyone has been sent their next form.");

    await chase.getByRole("button", { name: "Resend Empowerment reflections to Gauri Testperson" }).click();
    await expect(toast(page)).toContainText("Sent 1.");
    expect(mock.fn("training", "send_form")[1].emails[0]).toMatchObject({ trainee_id: "gauri.trainee", form_key: "empowerment" });
  });

  test("trainee panel: send a form with an edited email, and the send history", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Gauri").click();
    const p = panel(page);
    const sec = p.getByRole("region", { name: "Send a form" });
    await expect(sec).toContainText("Next: Empowerment reflections · Sent 8 days ago");
    await expect(sec.getByRole("list", { name: "Forms sent" })).toContainText("Empowerment reflections");
    await expect(sec.getByRole("combobox", { name: "Form to send" })).toHaveValue("empowerment");
    await sec.getByRole("button", { name: "Send…" }).click();
    await sec.getByLabel("Subject").fill("A gentle reminder: Empowerment reflections");
    await expect(sec.getByRole("textbox", { name: "Form email message" })).toHaveValue(/https:\/\/tally\.example\.org\/r\/empower\?tid=gauri\.trainee/);
    await sec.getByRole("button", { name: "Send email" }).click();
    await expect(toast(page)).toContainText("Empowerment reflections sent to gauri.trainee@example.org");
    expect(mock.fn("training", "send_form")[0].emails).toEqual([expect.objectContaining({
      trainee_id: "gauri.trainee", form_key: "empowerment", subject: "A gentle reminder: Empowerment reflections",
    })]);
  });

  test("resync is held back for 15 minutes after the last full sync", async ({ page, mock }) => {
    mock.db.settings[0].training_synced_at = "2026-10-07T09:55:00Z";
    await signIn(page);
    await navTo(page, "Setup", "Settings");
    const card = page.getByRole("region", { name: "Training forms from Tally" });
    await expect(card).toContainText("Available again after 11:10.");
    await expect(card.getByRole("button", { name: "Resync from Tally" })).toHaveCount(0);
  });
});
