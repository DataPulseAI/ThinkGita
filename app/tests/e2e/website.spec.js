import { test, expect, signIn, toast, fail, drawer } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

const sectionOf = (page, title) => page.locator("section.card", { has: page.locator("h2", { hasText: title }) });
const cardOf = (section, title) => section.locator(".site-card", { has: section.page().locator(".site-title", { hasText: title }) });

test.describe("Setup, Website page", () => {
  test("shows what is on the website, what is ready and what is not", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    const on = sectionOf(page, "On the website");
    await expect(on.locator("h2")).toHaveText("On the website (2)");
    // Sorted by order: the circle (1), then the hand-made listing (3). Hidden items are not here.
    await expect(on.locator(".site-title")).toHaveText(["Gita Circles (English)", "Gita Circles (Slovak)"]);
    await expect(cardOf(on, "English").locator(".site-author")).toHaveText("Kirtana");
    await expect(cardOf(on, "English").getByRole("button", { name: "Circle" })).toBeVisible();
    await expect(cardOf(on, "Slovak").getByText("Hand-made")).toBeVisible();
    await expect(cardOf(on, "Slovak").getByLabel("Order")).toHaveValue("3");
    await expect(cardOf(on, "English").getByLabel("Order")).toHaveValue("1");

    const ready = sectionOf(page, "Ready to show");
    await expect(ready.locator("h2")).toHaveText("Ready to show (2)");
    await expect(ready.locator(".site-title")).toHaveText(["Gita Circles (Hindi)", "Gita Circles (Czech)"]);
    await expect(cardOf(ready, "Hindi")).toContainText("Live circle");
    await expect(cardOf(ready, "Czech")).toContainText("Hand-made, hidden");

    const notReady = sectionOf(page, "Not ready yet");
    await expect(notReady.locator("h2")).toHaveText("Not ready yet (3)");
    await notReady.locator("summary").click();
    const rows = notReady.locator(".list .row");
    await expect(rows.locator(".row-main")).toHaveText([
      `${NAMES.c05}Needs website order`, `${NAMES.c08}Needs photo`, `${NAMES.c03}Needs photo, WhatsApp group link, website order`,
    ]);
    expect(mock.fn("framer-sync").map((b) => b.action).sort()).toEqual(["preview", "snapshot"]);
  });

  test("hiding a linked circle changes the circle row", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    await cardOf(sectionOf(page, "On the website"), "English").getByRole("button", { name: "Hide" }).click();
    await expect(toast(page)).toHaveText("Hidden from the website");
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c01", { website_visible: false }]]);
    expect(mock.fn("framer-sync", "set_item")).toHaveLength(0);
    // Until the website catches up, the card stays but is greyed out.
    await expect(cardOf(sectionOf(page, "On the website"), "English").getByRole("button", { name: "Hiding…" })).toBeDisabled();
  });

  test("hiding a hand-made listing goes straight to Framer", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    await cardOf(sectionOf(page, "On the website"), "Slovak").getByRole("button", { name: "Hide" }).click();
    await expect(toast(page)).toHaveText("Hidden from the website");
    expect(mock.fn("framer-sync", "set_item")).toEqual([{ action: "set_item", id: "hm-1", draft: true }]);
    expect(mock.rest("circles", "PATCH")).toHaveLength(0);
  });

  test("showing a ready circle and a hidden hand-made listing", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    const ready = sectionOf(page, "Ready to show");
    await cardOf(ready, "Hindi").getByRole("button", { name: "Show" }).click();
    await expect(toast(page)).toHaveText("Set to show on the website");
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c02", { website_visible: true }]]);
    await cardOf(ready, "Czech").getByRole("button", { name: "Show" }).click();
    await expect(toast(page)).toHaveText("Shown on the website");
    expect(mock.fn("framer-sync", "set_item")).toEqual([{ action: "set_item", id: "hm-2", draft: false }]);
  });

  test("changing the order saves to the circle or to Framer", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    const on = sectionOf(page, "On the website");
    const handMade = cardOf(on, "Slovak").getByLabel("Order");
    await handMade.fill("5");
    await handMade.press("Enter");
    await expect(toast(page)).toHaveText("Order saved");
    expect(mock.fn("framer-sync", "set_item")).toEqual([{ action: "set_item", id: "hm-1", order: 5 }]);

    const linked = cardOf(on, "English").getByLabel("Order");
    await linked.fill("6");
    await linked.blur();
    await expect.poll(() => mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c01", { website_order: 6 }]]);
  });

  test("an invalid or unchanged order is not saved", async ({ page, mock }) => {
    await signIn(page, { hash: "/Website" });
    const order = cardOf(sectionOf(page, "On the website"), "Slovak").getByLabel("Order");
    await order.fill("0");
    await order.press("Enter");
    await expect(order).toHaveValue("3");
    await order.fill("3");
    await order.press("Enter");
    await page.waitForTimeout(300);
    expect(mock.rest("circles")).toHaveLength(0);
    expect(mock.fn("framer-sync", "set_item")).toHaveLength(0);
  });

  test("a busy website update is reported", async ({ page, mock }) => {
    mock.handle("fn framer-sync set_item", { busy: true });
    await signIn(page, { hash: "/Website" });
    await cardOf(sectionOf(page, "On the website"), "Slovak").getByRole("button", { name: "Hide" }).click();
    await expect(page.locator(".toast.error")).toHaveText("A website update is running. Try again in a minute.");
  });

  test("the Circle link opens the circle panel", async ({ page }) => {
    await signIn(page, { hash: "/Website" });
    await cardOf(sectionOf(page, "On the website"), "English").getByRole("button", { name: "Circle" }).click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c01);
  });

  test("shows an error when the website can't be loaded", async ({ page, mock }) => {
    mock.handle("fn framer-sync snapshot", fail("Framer API key rejected", 500));
    await signIn(page, { hash: "/Website" });
    await expect(page.getByText("Couldn't load the website: Framer API key rejected")).toBeVisible();
    await expect(sectionOf(page, "On the website")).toHaveCount(0);
    // Refresh tries again.
    mock.handle("fn framer-sync snapshot", undefined);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(sectionOf(page, "On the website").locator("h2")).toHaveText("On the website (2)");
    await expect(page.getByText("Couldn't load the website")).toHaveCount(0);
  });

  test("says when changes are waiting to be published", async ({ page, mock }) => {
    Object.assign(mock.db.settings[0], { framer_publish_pending: true, framer_auto_publish: false });
    await signIn(page, { hash: "/Website" });
    const intro = sectionOf(page, "Website preview");
    await expect(intro).toContainText("once someone publishes in Framer (auto publish is off in Settings)");
    await expect(intro.locator(".warn-text")).toHaveText("Some changes are saved but not live yet.");
  });
});
