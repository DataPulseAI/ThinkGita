// Assessors submit to admins: the assessor saves a draft, picks a recommendation and submits; it then locks for them.
// Admins see a badge on Training, a notice on the Overview and an "Awaiting your decision" list in Next steps, can
// reopen it for the assessor, and record the outcome. No emails go to admins. Made-up people only.
import { test, expect, signIn, navTo, toast } from "./support/test.js";
import { ASSESSOR_EMAIL } from "../fixtures/data.js";

const row = (page, name) => page.locator(".tr-row", { hasText: name });
const panel = (page) => page.locator("aside.tr-drawer");

test.describe("Assessment submit", () => {
  test("an assessor submits with a recommendation, then can only read it", async ({ page, mock, dialogs }) => {
    await signIn(page, { role: "assessor", email: ASSESSOR_EMAIL });
    await row(page, "Haridas").click();
    const p = panel(page);
    await p.getByRole("radiogroup", { name: "Delivery and communication skills" }).getByRole("radio", { name: "Meets" }).click();
    await p.getByRole("textbox", { name: /Overall feedback/ }).fill("Warm and well paced.");
    const submit = p.getByRole("button", { name: "Submit to admins" });
    await expect(submit).toBeDisabled();
    await p.getByRole("radiogroup", { name: "Your recommendation" }).getByRole("radio", { name: "Recommend certifying" }).click();
    await submit.click();
    expect(dialogs.messages.at(-1)).toBe("Send your assessment of Haridas to the admins? You won't be able to change it after this unless an admin reopens it.");
    await expect(toast(page)).toContainText("Submitted. The admins will see it on the Training page.");
    expect(mock.rpc("submit_assessment").at(-1)).toEqual({
      p_trainee: "hari.trainee", p_assessment: { delivery: { rating: "meets" } }, p_feedback: "Warm and well paced.", p_recommendation: "certify",
    });

    // Locked now: no buttons to save or submit, and the inputs can't change.
    await expect(p.locator(".tr-submitted")).toContainText("Submitted on");
    await expect(p.locator(".tr-submitted")).toContainText("Recommend certifying");
    await expect(p.getByRole("button", { name: "Submit to admins" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: /Save draft|Draft saved/ })).toHaveCount(0);
    await expect(p.getByRole("radiogroup", { name: "Delivery and communication skills" }).getByRole("radio", { name: "Partly" })).toBeDisabled();
    await expect(p.getByRole("textbox", { name: /Overall feedback/ })).not.toBeEditable();
    await expect(row(page, "Haridas")).toContainText("Submitted");
  });

  test("an assessor can't change an assessment that was already submitted", async ({ page }) => {
    await signIn(page, { role: "assessor", email: ASSESSOR_EMAIL });
    await row(page, "Kavi").click();
    const p = panel(page);
    await expect(p.locator(".tr-submitted")).toContainText("An admin will record the outcome.");
    await expect(p.getByRole("button", { name: "Submit to admins" })).toHaveCount(0);
    await expect(p.getByRole("textbox", { name: /Overall feedback/ })).toHaveValue("Kavi held the group well and kept to the material.");
  });

  test("admins see the badge and the Overview notice, which opens Next steps", async ({ page }) => {
    await signIn(page);
    const training = page.locator("nav.tabs").getByRole("button", { name: /^Training/ });
    await expect(training.locator(".count")).toHaveText("1");
    const notice = page.locator(".banner", { hasText: "waiting for your decision" });
    await expect(notice).toContainText("1 assessment is waiting for your decision.");
    await notice.getByRole("button", { name: "Open Next steps" }).click();
    await expect(page).toHaveURL(/#\/Training\/next$/);
    const awaiting = page.getByRole("region", { name: "Awaiting your decision" });
    await expect(awaiting.getByRole("heading")).toContainText("Awaiting your decision (1)");
    const r = awaiting.locator(".tr-awaiting-row", { hasText: "Kavi" });
    await expect(r).toContainText("By Asha Assessor");
    await expect(r.locator(".tr-rec")).toHaveText("Recommend certifying");
    await r.getByRole("button", { name: /^Open Kavi/ }).click();
    await expect(panel(page).locator(".tr-submitted")).toContainText("Submitted by Asha Assessor on");
  });

  test("an admin reopens it for the assessor", async ({ page, mock, dialogs }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Kavi").click();
    const p = panel(page);
    await p.getByRole("button", { name: "Reopen for the assessor" }).click();
    expect(dialogs.messages.at(-1)).toBe("Reopen this assessment for Asha Assessor? They can change it and submit it again.");
    await expect(toast(page)).toContainText("Assessment reopened for the assessor.");
    expect(mock.rpc("reopen_assessment").at(-1)).toEqual({ p_trainee: "kavi.trainee" });
    await expect(row(page, "Kavi")).toContainText("Ready to assess");
    await expect(page.locator("nav.tabs").getByRole("button", { name: /^Training/ }).locator(".count")).toHaveCount(0);
  });

  test("the outcome shows what the assessor recommends, with nothing chosen for the admin", async ({ page, mock }) => {
    await signIn(page);
    await navTo(page, "Training");
    await row(page, "Kavi").click();
    const p = panel(page);
    await expect(p.locator(".tr-recommends")).toHaveText("Assessor recommends: Certify");
    const outcome = p.getByRole("radiogroup", { name: "Outcome" });
    await expect(outcome.getByRole("radio", { checked: true })).toHaveCount(0);
    await outcome.getByRole("radio", { name: "Certified", exact: true }).click();
    await p.getByRole("button", { name: "Record without email" }).click();
    await expect(toast(page)).toContainText("Certified recorded. No email sent.");
    expect(mock.fn("training", "decide")[0]).toMatchObject({ trainee_id: "kavi.trainee", decision: "certified", send: false });
    await expect(row(page, "Kavi")).toContainText("Certified");
    await expect(page.locator("nav.tabs").getByRole("button", { name: /^Training/ }).locator(".count")).toHaveCount(0);
  });
});
