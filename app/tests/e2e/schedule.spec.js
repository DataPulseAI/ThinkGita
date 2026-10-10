import { test, expect, signIn, drawer } from "./support/test.js";
import { circleRow, LIC, FAC, NAMES } from "../fixtures/data.js";

const card = (page) => page.locator("section.card").first();
const lane = (page, label) => page.locator(".timeline .lane", { has: page.locator(".lane-label", { hasText: label }) });
const pickDay = (page, d) => card(page).locator(".card-head .seg").getByRole("button", { name: d, exact: true }).click();

test.describe("Weekly schedule", () => {
  test("opens on today in UK time and switches days", async ({ page }) => {
    await signIn(page, { hash: "/Schedule" });
    // The clock is fixed to a Wednesday.
    await expect(card(page).locator("h2")).toContainText("Wednesday");
    await expect(card(page).locator(".day-count").first()).toHaveText("1 circle");
    await expect(lane(page, "Zoom 02").locator("button.block")).toHaveCount(1);
    await expect(lane(page, "Zoom 02").locator(".b-time")).toHaveText("07:30–09:00");

    await pickDay(page, "Sun");
    await expect(card(page).locator("h2")).toContainText("Sunday");
    await expect(page.getByText("No circles on Sunday.")).toBeVisible();

    await pickDay(page, "Tue");
    await expect(card(page).locator("h2")).toContainText("Tuesday");
    await expect(lane(page, "Zoom 02").locator("button.block")).toHaveAttribute("aria-label", `${NAMES.c03}, Tue 23:00–00:00 UK, Awaiting approval`);
  });

  test("a licence with two circles at once shows them side by side", async ({ page }) => {
    await signIn(page, { hash: "/Schedule" });
    await pickDay(page, "Mon");
    await expect(card(page).locator("h2")).toContainText("3 circles, 1 with no licence");
    await expect(card(page).locator(".day-count.shared")).toHaveText("1 shared licence");
    const z1 = lane(page, "Zoom 01");
    await expect(z1).toHaveClass(/lane-stacked/);
    await expect(z1).not.toHaveClass(/lane-over/);
    await expect(z1.locator(".at-once-tag")).toHaveText("2 at once");
    await expect(z1.locator(".at-once-tag")).not.toHaveClass(/over/);
    await expect(z1.locator("button.block .b-name")).toHaveText(["Kirtana (Asha Example)", "Bram Sample"]);
    await expect(z1.locator(".share-band")).toHaveCount(1);
    await expect(z1.locator(".share-band.over")).toHaveCount(0);
    // The clash sits in the "No licence" lane.
    await expect(lane(page, "No licence").locator("button.block")).toHaveClass(/st-conflict/);
    await expect(page.locator(".legend")).toContainText("Shared licence: 2 at once (allowed)");
    await expect(page.locator(".legend")).not.toContainText("over Zoom's limit");
  });

  test("a third overlapping circle is shown as over the limit", async ({ page, mock }) => {
    mock.db.circles.push(circleRow({ id: "c10", name: "Gita Circles | Third Wheel | Monday 19:15 (London time)", status: "pending", facilitator_id: FAC.farid, weekday: 1, start_time: "19:15:00", licence_id: LIC.z1 }));
    await signIn(page, { hash: "/Schedule" });
    await pickDay(page, "Mon");
    await expect(card(page).locator(".day-count.over")).toHaveText("1 licence over the limit");
    const z1 = lane(page, "Zoom 01");
    await expect(z1).toHaveClass(/lane-over/);
    await expect(z1.locator(".at-once-tag")).toHaveText("3 at once");
    await expect(z1.locator(".at-once-tag")).toHaveClass(/over/);
    await expect(z1.locator(".share-band.over")).toHaveCount(1);
    await expect(z1.locator("button.block")).toHaveCount(3);
    await expect(page.locator(".legend .warn-text")).toHaveText("3 or more at once: over Zoom's limit");
  });

  test("hovering a circle shows its details and who it shares the licence with", async ({ page }) => {
    await signIn(page, { hash: "/Schedule" });
    await pickDay(page, "Mon");
    await lane(page, "Zoom 01").locator("button.block").first().hover();
    const tip = page.getByRole("tooltip");
    await expect(tip.locator(".hc-title")).toHaveText(NAMES.c01);
    await expect(tip.locator(".pill")).toHaveText("Live");
    const row = (k) => tip.locator("dt", { hasText: k }).locator("xpath=following-sibling::dd[1]");
    await expect(row("UK time")).toHaveText("Mon 19:00–20:15");
    await expect(row("Facilitator")).toHaveText("Asha Example");
    await expect(row("Licence")).toHaveText("Zoom 01");
    await expect(row("Shared with")).toHaveText("Bram Sample (Mon 19:30–20:30)");
    await expect(tip.locator(".hc-foot")).toHaveText("Click to open");
  });

  test("a circle abroad shows its own local time in the hover card", async ({ page }) => {
    await signIn(page, { hash: "/Schedule" });
    await pickDay(page, "Tue");
    await lane(page, "Zoom 02").locator("button.block").hover();
    const tip = page.getByRole("tooltip");
    await expect(tip.locator("dt", { hasText: "Their time" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Tue 18:00 New York time");
    await expect(tip.locator(".hc-foot")).toHaveText("Click to review and approve");
  });

  test("clicking a circle opens its panel", async ({ page }) => {
    await signIn(page, { hash: "/Schedule" });
    await pickDay(page, "Mon");
    await lane(page, "Zoom 01").locator("button.block").nth(1).click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c02);
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
  });
});
