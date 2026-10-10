// Phone-width smoke tests. The "mobile" project (Pixel 7) runs only tests tagged @mobile; they also run on desktop.
import { test, expect, signIn, drawer, expectNoHorizontalOverflow } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

test.describe("Phone width", () => {
  test("Overview fits the screen @mobile", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Week at a glance" })).toBeVisible();
    await expect(page.locator("button.stat")).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "By hour" }).click();
    await expect(page.locator("table.hour-matrix")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Circles list fits the screen @mobile", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await expect(page.getByRole("heading", { name: /^Circles/ })).toHaveText("Circles (7)");
    await expect(page.locator(".web-filter button.web-chip")).toHaveCount(6);
    await expectNoHorizontalOverflow(page);
  });

  test("the circle panel fits the screen @mobile", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await page.locator("table.table tbody tr", { hasText: NAMES.c01 }).locator("td").first().click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c01);
    await expect(drawer(page).getByText("Zoom details")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const box = await drawer(page).boundingBox();
    const width = page.viewportSize().width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  });

  test("Website page fits the screen @mobile", async ({ page }) => {
    await signIn(page, { hash: "/Website" });
    await expect(page.getByRole("heading", { name: "On the website (2)" })).toBeVisible();
    await page.locator("summary").click();
    await expectNoHorizontalOverflow(page);
  });

  test("the facilitator portal fits the screen @mobile", async ({ page }) => {
    await signIn(page, { role: "facilitator" });
    await expect(page.locator("main section.card:not(.profile-card)")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    // The details form fits too.
    await page.getByRole("button", { name: "Edit my details" }).click();
    await expect(page.getByLabel("Phone (with country code)")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
