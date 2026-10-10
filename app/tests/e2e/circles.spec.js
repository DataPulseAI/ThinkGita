import { test, expect, signIn, toast, fail } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

const rows = (page) => page.locator("table.table tbody tr");
const rowOf = (page, name) => page.locator("table.table tbody tr", { has: page.locator("td", { hasText: name }) });
const webChips = (page) => page.locator(".web-filter[aria-label=Website] button.web-chip");
const chip = (page, label) => webChips(page).filter({ hasText: label });
const needChips = (page) => page.locator(".web-need button.web-chip");
const heading = (page) => page.getByRole("heading", { name: /^Circles/ });

test.describe("Circles list", () => {
  test("shows current circles by default and filters by status", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await expect(heading(page)).toHaveText("Circles (7)");
    const show = page.getByLabel("Show");
    await expect(show).toHaveValue("active");
    await show.selectOption("live");
    await expect(heading(page)).toHaveText("Circles (3)");
    await expect(rows(page).locator("td:first-child")).toContainText([NAMES.c01, NAMES.c02, NAMES.c05]);
    await show.selectOption("closed");
    await expect(heading(page)).toHaveText("Circles (2)");
    await expect(rows(page).locator(".pill")).toHaveText(["Ended", "Rejected"]);
    await show.selectOption("action");
    await expect(heading(page)).toHaveText("Circles (3)");
    await show.selectOption("all");
    await expect(heading(page)).toHaveText("Circles (9)");
  });

  test("search matches names, co-facilitators, licences and languages", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    const search = page.getByPlaceholder("Search name, facilitator, licence, language");
    await search.fill("esha");
    await expect(heading(page)).toHaveText("Circles (2)");
    await expect(rowOf(page, NAMES.c01)).toContainText("+ Esha Specimen");
    await search.fill("Zoom 03");
    await expect(rows(page)).toHaveCount(2);
    await search.fill("spanish");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(NAMES.c03);
    await search.fill("nobody at all");
    await expect(rows(page)).toHaveCount(0);
  });

  test("website chips count each state and filter the table", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await expect(webChips(page)).toHaveText([
      "All 7", "On website 1", "On, but held back 1", "Ready to show 1", "Not ready 2", "Can't be listed 2",
    ]);
    await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Ready to show")).toHaveAttribute("title", "Everything is filled in: switch it on to list it");

    await chip(page, "On website").click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(NAMES.c01);
    await chip(page, "On, but held back").click();
    await expect(rows(page).first()).toContainText(NAMES.c05);
    await expect(rows(page).first().locator(".warn-text")).toHaveText("Needs order");
    await chip(page, "Ready to show").click();
    await expect(rows(page).first()).toContainText(NAMES.c02);
    await expect(rows(page).first().locator(".ok-text")).toHaveText("Ready");
    await chip(page, "Can't be listed").click();
    await expect(rows(page).locator("td:first-child")).toContainText([NAMES.c04, NAMES.c07]);
    await chip(page, "All").click();
    await expect(rows(page)).toHaveCount(7);
  });

  test("chip counts follow the status filter", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await page.getByLabel("Show").selectOption("live");
    await expect(webChips(page)).toHaveText(["All 3", "On website 1", "On, but held back 1", "Ready to show 1"]);
  });

  test("the Missing row breaks down what not-ready circles lack and narrows the list", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await expect(needChips(page)).toHaveCount(0);
    await chip(page, "Not ready").click();
    await expect(rows(page)).toHaveCount(2);
    await expect(needChips(page)).toHaveText(["photo 2", "WhatsApp link 1", "order 1"]);
    await expect(rowOf(page, NAMES.c03).locator(".muted.small").last()).toHaveText("Needs photo, WhatsApp link +1");
    await expect(rowOf(page, NAMES.c03).locator("[title^='Needs:']")).toHaveAttribute("title", "Needs: photo, WhatsApp group link, website order");

    await needChips(page).filter({ hasText: "WhatsApp link" }).click();
    await expect(needChips(page).filter({ hasText: "WhatsApp link" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(NAMES.c03);
    await needChips(page).filter({ hasText: "WhatsApp link" }).click();
    await expect(rows(page)).toHaveCount(2);

    await needChips(page).filter({ hasText: "photo" }).click();
    await expect(rows(page)).toHaveCount(2);
    // Picking another website state clears the missing filter.
    await chip(page, "On website").click();
    await expect(needChips(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
  });

  // BUG: chips with a count of 0 are hidden, but a hidden chip's filter stays applied. Pick "Ready to show",
  // then switch the status to "Ended or rejected": the chip vanishes, "All" is not pressed, and the table is
  // empty with no visible reason. The same happens to a chosen "Missing" item. Expected: the active filter
  // stays visible (or resets to All) so the list is never silently empty.
  test.fail("a website filter stays visible when its count drops to zero", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await chip(page, "Ready to show").click();
    await expect(rows(page)).toHaveCount(1);
    await page.getByLabel("Show").selectOption("closed");
    await expect(webChips(page).and(page.locator("[aria-pressed=true]"))).toHaveCount(1, { timeout: 2000 });
  });

  test("opening #/Circles/web-ready starts on that website view", async ({ page }) => {
    await signIn(page, { hash: "/Circles/web-ready" });
    await expect(chip(page, "Ready to show")).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(1);
  });

  test("a not-ready circle's switch is disabled and says why", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const sw = rowOf(page, NAMES.c03).getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(sw).toHaveAttribute("aria-disabled", "true");
    await expect(sw).toHaveText("Not ready");
    await expect(sw).toHaveAttribute("title", "Not ready for the website. Needs: photo, WhatsApp group link, website order");
    // aria-disabled: Playwright would wait for it to be enabled, so click anyway as a user could.
    await sw.click({ force: true });
    await page.waitForTimeout(300);
    expect(mock.rest("circles", "PATCH")).toHaveLength(0);
    // Other reasons a circle can't be listed.
    await expect(rowOf(page, NAMES.c04).getByRole("switch")).toHaveAttribute("title", "Needs a licence before it can be listed");
    await expect(rowOf(page, NAMES.c07).getByRole("switch")).toHaveAttribute("title", "Paused circles aren't listed");
  });

  test("switching a ready circle on sends the PATCH, then updates the website", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const sw = rowOf(page, NAMES.c02).getByRole("switch");
    await expect(sw).toHaveText("Hidden");
    await expect(sw).toHaveAttribute("title", "Hidden from website. Click to show.");
    await sw.click();
    await expect(toast(page)).toHaveText("Set to show on the website");
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c02", { website_visible: true }]]);
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(sw).toHaveText("Shown");
    await expect(chip(page, "On website")).toHaveText("On website 2");
    // Changes are pushed to the website in the background shortly after.
    await expect.poll(() => mock.fn("framer-sync", "sync").length, { timeout: 5000 }).toBe(1);
  });

  test("switching a listed circle off hides it", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c01).getByRole("switch").click();
    await expect(toast(page)).toHaveText("Hidden from the website");
    expect(mock.rest("circles", "PATCH").map((r) => r.body)).toEqual([{ website_visible: false }]);
  });

  test("deleting a circle that is not live asks, then deletes only the row", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c08).getByRole("button", { name: "Delete circle" }).click();
    await expect(toast(page)).toHaveText("Circle deleted");
    expect(dialogs.messages).toEqual([`Delete "${NAMES.c08}"? This can't be undone.`]);
    const del = mock.rest("circles", "DELETE");
    expect(del.map((r) => r.query)).toEqual([{ id: "eq.c08", select: "id" }]);
    expect(mock.fn("provision-circle")).toHaveLength(0);
    expect(mock.fn("framer-sync", "set_item")).toHaveLength(0);
    await expect(heading(page)).toHaveText("Circles (6)");
  });

  test("cancelling the delete confirmation sends nothing", async ({ page, mock, dialogs }) => {
    dialogs.accept = false;
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c08).getByRole("button", { name: "Delete circle" }).click();
    await expect.poll(() => dialogs.messages.length).toBe(1);
    expect(mock.writes()).toHaveLength(0);
    await expect(heading(page)).toHaveText("Circles (7)");
  });

  test("deleting a live circle ends it, hides its website item, then deletes it", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Circles" });
    const del = rowOf(page, NAMES.c01).getByRole("button", { name: "Delete circle" });
    await expect(del).toHaveAttribute("title", "Delete circle (ends it and its Zoom meeting first)");
    await del.click();
    await expect(toast(page)).toHaveText("Circle ended and deleted");
    expect(dialogs.messages).toEqual([
      `"${NAMES.c01}" is live. Delete it?\n\nThis ends it, deletes its Zoom meeting and removes it from the dashboard. It can't be undone.`,
    ]);
    const steps = mock.writes().filter((r) => !(r.kind === "fn" && r.body?.action === "sync")).map((r) =>
      r.kind === "fn" ? [r.name, r.body] : [r.method, r.table, r.query, r.body]);
    expect(steps).toEqual([
      ["provision-circle", { action: "cancel", circle_id: "c01" }],
      ["PATCH", "circles", { id: "eq.c01" }, { framer_item_id: null }],
      ["framer-sync", { action: "set_item", id: "fi-c01", draft: true }],
      ["DELETE", "circles", { id: "eq.c01", select: "id" }, null],
    ]);
  });

  test("delete reports an error when nothing was deleted", async ({ page, mock }) => {
    mock.handle("DELETE circles", () => []);
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c08).getByRole("button", { name: "Delete circle" }).click();
    await expect(page.locator(".toast.error")).toHaveText("The circle wasn't deleted (it may already be gone, or you don't have access). Refresh and try again.");
    await expect(rowOf(page, NAMES.c08)).toHaveCount(1);
  });

  test("delete reports a database error", async ({ page, mock }) => {
    mock.handle("DELETE circles", fail("permission denied for table circles", 403));
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c08).getByRole("button", { name: "Delete circle" }).click();
    await expect(page.locator(".toast.error")).toHaveText("permission denied for table circles");
  });

  test("clicking a row opens the circle panel", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    await rowOf(page, NAMES.c05).locator("td").first().click();
    await expect(page.locator("aside.drawer h2").first()).toHaveText(NAMES.c05);
  });
});
