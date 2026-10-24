// Circle attendees: sign-ups from the Tally circle sign-up form, linked to circles. Admins see everyone, pick circles for
// older sign-ups under "Needs matching" and copy each circle's sign-up link; facilitators see their own circles'
// attendees (no date of birth). Zoom registration can be switched on for one circle. Made-up people only.
import { test, expect, signIn, toast, drawer } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

const row = (page, name) => page.locator(".at-row", { hasText: name });

test.describe("Attendees", () => {
  test("admins see every attendee, filter by circle and open one", async ({ page }) => {
    await signIn(page);
    await page.locator("nav.tabs").getByRole("button", { name: /^Circles/ }).click();
    await expect(page.locator("nav.tabs").getByRole("menuitem", { name: /^Attendees/ })).toContainText("2"); // waiting to be matched
    await page.locator("nav.tabs").getByRole("menuitem", { name: /^Attendees/ }).click();
    await expect(page.locator(".at-page h2")).toContainText("Attendees (7)");
    await expect(row(page, "Mira Example")).toContainText("Kirtana (Asha Example)");
    await expect(row(page, "Rosa Example")).toContainText("Needs matching");
    await expect(row(page, "Tara Example")).toHaveCount(0); // marked "not a circle": only under that filter

    await page.getByLabel("Circle").selectOption({ label: "Kirtana (Asha Example) | Monday 19:00 (London time) (3)" });
    await expect(page.locator(".at-page h2")).toContainText("Attendees (3)");
    await expect(page.locator(".at-circle-bar")).toContainText("Copy sign-up link");
    await row(page, "Olu Example").click();
    const open = page.locator(".at-open");
    await expect(open).toContainText("Never read it but heard of it");
    await expect(open).toContainText("Date of birth");
    await expect(open).toContainText("Matched on the link details (Same WhatsApp group).");

    await page.getByLabel("Search attendees").fill("bristol");
    await expect(page.locator(".at-page h2")).toContainText("Attendees (1)");
  });

  test("needs matching: pick a suggested circle, or mark as not a circle", async ({ page, mock }) => {
    await signIn(page, { hash: "/Attendees/match" });
    const list = page.locator(".at-match-row");
    await expect(list).toHaveCount(2);
    const rosa = list.filter({ hasText: "Rosa Example" });
    await expect(rosa).toContainText("Link said: Devi · Hin · 9Sep26");
    await expect(rosa).toContainText("2 circles by Devi");
    // Only suggested circles that could have run are offered (c04 never got a licence).
    await expect(rosa.getByRole("button", { name: "Devi (Dev Fictional) | Wednesday 12:00 (Kolkata time)" })).toHaveCount(1);
    await expect(rosa.getByRole("button", { name: /Dev Fictional \| Monday/ })).toHaveCount(0);
    await rosa.getByRole("button", { name: "Devi (Dev Fictional) | Wednesday 12:00 (Kolkata time)" }).click();
    await expect(toast(page)).toContainText("Rosa Example linked to");
    expect(mock.rest("circle_signups", "PATCH").at(-1).body).toEqual({ circle_id: "c05" });
    await expect(list).toHaveCount(1);

    await list.filter({ hasText: "Sam Example" }).getByRole("button", { name: "Not a circle" }).click();
    expect(mock.rest("circle_signups", "PATCH").at(-1).body).toEqual({ circle_id: null, match_method: "none" });
    await expect(page.locator(".at-match-list")).toContainText("Nothing to match");

    await page.getByRole("button", { name: "Check again" }).click();
    expect(mock.fn("signups", "rematch")).toHaveLength(1);
  });

  test("circle panel: sign-up count and link, and Zoom registration on and off", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Circles" });
    await page.getByLabel("Show").selectOption("all");
    await page.locator("table.table tbody tr", { has: page.locator("td", { hasText: NAMES.c01 }) }).locator("td").first().click();
    const d = drawer(page);
    // A copy button at the top of the panel, and the Attendees section with the count and the full link.
    await expect(d.locator(".at-when").getByRole("button", { name: "Copy sign-up link" })).toBeVisible();
    const sec = d.locator("section.sec", { hasText: "Attendees" });
    await sec.locator(".sec-toggle").first().click();
    await expect(sec).toContainText("3 people have signed up");
    await expect(sec.locator(".at-link")).toContainText("circle_id=c01");

    const reg = d.locator(".at-zoomreg");
    await expect(reg).toContainText("Off");
    await reg.getByRole("button", { name: "Turn on" }).click();
    expect(dialogs.messages.at(-1)).toContain("The join link and WhatsApp link stay the same.");
    await expect(toast(page)).toContainText("Zoom registration on");
    expect(mock.fn("provision-circle", "zoom_registration")).toEqual([{ action: "zoom_registration", circle_id: "c01", on: true }]);
    await expect(reg).toContainText("On");

    await sec.getByRole("button", { name: "See attendees" }).click();
    await expect(page).toHaveURL(/#\/Attendees\/c01$/);
    await expect(page.locator(".at-page h2")).toContainText("Attendees (3)");
  });

  test("settings: import from Tally and registration for new circles", async ({ page, mock }) => {
    await signIn(page, { hash: "/Settings" });
    const card = page.locator("section.card", { hasText: "Circle attendees" });
    await card.getByRole("button", { name: "Import sign-ups from Tally" }).click();
    await expect(toast(page)).toContainText("Imported 8 sign-ups: 5 linked to a circle, 2 need matching.");
    expect(mock.fn("signups", "sync")).toHaveLength(1);
    const box = card.getByLabel(/Ask for name and email on new circles/);
    await box.click();
    await expect(toast(page)).toContainText("New Zoom meetings will ask joiners for their email");
    expect(mock.rest("settings", "PATCH").at(-1).body).toEqual({ zoom_registration_new: true });
    await expect(box).toBeChecked();
  });

  test("facilitators see their own circles' attendees in their own pane, without dates of birth", async ({ page, mock }) => {
    await signIn(page, { role: "facilitator" });
    const tabs = page.getByRole("tablist", { name: "Portal view" });
    await expect(tabs.getByRole("tab", { name: /Attendees/ })).toContainText("3");
    // Each live circle card has a short line that opens the pane for that circle.
    const card = page.locator("main section.card", { has: page.locator("h2", { hasText: NAMES.c01 }) });
    await card.getByRole("button", { name: "See attendees" }).click();
    const pane = page.getByRole("region", { name: "Attendees" });
    await expect(pane.locator(".fac-att-row")).toHaveCount(3);
    await expect(pane.getByLabel("Circle")).toHaveValue("c01");
    await pane.getByRole("button", { name: /Olu Example/ }).click();
    await expect(pane).toContainText("Never read it but heard of it");
    await expect(pane).not.toContainText("Date of birth");
    await expect(pane.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:olu.example@example.org");
    await expect(pane.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/447700900103");
    await pane.getByLabel("Search attendees").fill("bristol");
    await expect(pane.locator(".fac-att-row")).toHaveCount(1);
    expect(mock.rpc("my_circle_signups")).toHaveLength(1);

    // Back to the circles.
    await tabs.getByRole("tab", { name: "Your circles" }).click();
    await expect(page.getByRole("heading", { name: "Your circles" })).toBeVisible();
  });

});
