import { test } from "../e2e/support/test.js";
import { signIn } from "../e2e/support/auth.js";
import { snap, openSection, card, sec, closeDrawer } from "./lib.js";

test("zoom pages", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Licences" });
  const main = page.locator("main section.card").first();
  await main.waitFor();
  await snap(page, "licences-1-page", { clip: main, hl: page.getByRole("heading", { name: "Zoom licences" }), pad: 12 });
  await snap(page, "licences-2-sync", { clip: main.locator(".card-head"), hl: page.getByRole("button", { name: "Sync from Zoom" }), pad: 16 });
  await snap(page, "licences-3-key", { clip: page.locator("main table tbody tr").nth(2), hl: page.getByRole("button", { name: "Set key" }), pad: 16 });
  await page.goto("/#/Zoom");
  const z = page.locator("main");
  await page.getByRole("heading", { name: "Meetings on Zoom" }).waitFor();
  await snap(page, "zoom-1-page", { clip: z, hl: page.getByRole("heading", { name: "Meetings on Zoom" }), pad: 0 });
  await snap(page, "zoom-2-sync", { clip: z.locator(".card-head").first(), hl: page.getByRole("button", { name: "Sync now" }), pad: 16, top: true });
  await page.goto("/#/Attendance");
  await page.getByRole("heading", { name: "Attendance", exact: true }).waitFor();
  await snap(page, "attendance-1-page", { clip: page.locator("main"), hl: page.locator("main .stats, main .stat").first(), pad: 0, top: true });
  await snap(page, "attendance-2-meeting", { clip: page.locator("main"), hl: page.getByRole("button", { name: "By meeting" }), pad: 0 });
  await page.goto("/#/Insights");
  await page.getByRole("heading", { name: "Attendance insights" }).waitFor();
  await page.waitForTimeout(500);
  await snap(page, "insights-1-page", { clip: page.locator("main"), hl: page.getByRole("button", { name: "26 weeks" }), pad: 0 });
});

test("website and emails", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Website" });
  await page.getByRole("heading", { name: "Website preview" }).waitFor();
  await snap(page, "website-1-page", { clip: page.locator("main"), hl: page.getByRole("heading", { name: /^Ready to show/ }), pad: 0 });
  const show = page.getByRole("button", { name: "Show", exact: true }).first();
  await snap(page, "website-2-show", { clip: page.locator("main"), hl: show, pad: 0, top: true });
  await page.goto("/#/Circles");
  await page.locator("table tbody tr").nth(2).click();
  await page.locator(".drawer").first().waitFor();
  await openSection(page, "Website");
  await snap(page, "website-3-circle", { clip: sec(page, "Website"), hl: page.locator("button.sec-toggle", { hasText: "Website" }), pad: 16 });
  await page.goto("/#/Settings");
  await page.reload();
  const w = card(page, "Website");
  await w.waitFor();
  await snap(page, "website-4-settings", { clip: w, hl: w.getByLabel("Publish the website after each update"), pad: 16 });

  await page.goto("/#/Emails");
  await page.reload();
  const links = card(page, "Links and contacts");
  await links.waitFor();
  await snap(page, "emails-1-links", { clip: links, hl: links.getByRole("heading", { name: "Links and contacts" }), pad: 12 });
  await snap(page, "emails-2-editor", { clip: page.locator("main"), hl: page.getByRole("button", { name: "Approval email" }), pad: 0 });
  await snap(page, "emails-3-placeholders", { clip: page.locator("main"), hl: page.getByRole("button", { name: "first_name" }), pad: 0 });
  await snap(page, "emails-4-test", { clip: page.locator("main"), hl: page.getByRole("button", { name: "Send test to me" }), pad: 0 });
  await page.goto("/#/EmailLog");
  await page.getByRole("heading", { name: "Sent emails" }).waitFor();
  await snap(page, "emaillog-1-page", { clip: page.locator("main"), hl: page.getByRole("button", { name: /^Failed or not sent/ }), pad: 0 });
});

test("settings", async ({ page }) => {
  await signIn(page, { role: "super", hash: "/Settings" });
  const rules = card(page, "Scheduling rules");
  await rules.waitFor();
  await snap(page, "settings-1-page", { clip: page.locator("main"), pad: 0, top: true });
  await snap(page, "settings-2-rules", { clip: rules, hl: [page.getByLabel(/^Buffer between meetings/), rules.getByRole("button", { name: "Save" })], pad: 12 });
  await snap(page, "settings-3-term", { clip: rules, hl: [page.getByLabel("Term starts"), page.getByLabel("Term ends")], pad: 12 });
  const tally = card(page, "Training forms (Tally)");
  await snap(page, "settings-4-tally", { clip: tally, hl: tally.getByRole("button", { name: "Resync from Tally" }), pad: 16 });
  const act = card(page, "Activity");
  await snap(page, "settings-5-activity", { clip: act, hl: act.getByRole("button", { name: "Circles", exact: true }), pad: 12 });
  const admins = card(page, "Admins");
  await snap(page, "admins-1-card", { clip: admins, hl: admins.locator(".admin-super").first(), pad: 12 });
  await snap(page, "admins-2-add", { clip: [admins.getByRole("button", { name: "Add admin" }).locator("..")], hl: admins.getByRole("button", { name: "Add admin" }), pad: 24 });
  await snap(page, "admins-3-super", { clip: admins.locator(".row").nth(1), hl: admins.getByRole("button", { name: "Make super admin" }), pad: 16 });
  const ass = card(page, "Assessors");
  await snap(page, "assessors-1-card", { clip: ass, hl: ass.getByRole("heading", { name: "Assessors" }), pad: 12 });
  await snap(page, "assessors-2-add", { clip: ass, hl: [ass.getByRole("button", { name: "Add and invite" })], pad: 12 });
});
