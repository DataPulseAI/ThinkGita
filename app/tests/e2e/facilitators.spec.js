// Facilitators page (Circles > Facilitators, #/Facilitators): list, consistency strips, filters, and the edit panel.
import { test, expect, signIn, navTo, toast, fail, expectNoHorizontalOverflow } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

// Extra attendance for the page: Bram's Monday circle met twice then stopped; Dev's Kolkata circle met every week.
// (c01 already has weekly sessions in the fixtures.) Times are UTC.
function addSessions(mock) {
  const s = (id, circle_id, zoom_meeting_id, started_at, participant_count) => ({
    id, circle_id, zoom_meeting_id, started_at, ended_at: new Date(Date.parse(started_at) + 80 * 60000).toISOString(),
    topic: null, circle_name: null, licence_label: null, participant_count,
  });
  mock.db.attendance_sessions.push(
    s("s-c02-1", "c02", "100000002", "2026-09-07T18:30:00Z", 6),
    s("s-c02-2", "c02", "100000002", "2026-09-14T18:30:00Z", 5),
    ...["09-09", "09-16", "09-23", "09-30"].map((d, i) => s(`s-c05-${i}`, null, "100000005", `2026-${d}T06:30:00Z`, 9)),
  );
}
const row = (page, name) => page.locator(".fac-row", { hasText: name });
const panel = (page) => page.locator("aside.fac-drawer");
const field = (page, label) => panel(page).locator(".fac-form label").filter({ hasText: new RegExp(`^${label}`) }).locator("input").first();

// unskip once wired: needs the "Facilitators" item under the Circles menu and the #/Facilitators route in Admin.jsx.
test.describe("Facilitators", () => {
  test.beforeEach(async ({ mock }) => addSessions(mock));

  test("opens from the Circles menu and shows each facilitator's consistency", async ({ page }) => {
    await signIn(page);
    await navTo(page, "Circles", "Facilitators");
    await expect(page).toHaveURL(/#\/Facilitators$/);
    await expect(page.getByRole("heading", { name: /^Facilitators/ })).toContainText("(6)");

    const chips = page.getByRole("group", { name: "Circles" });
    await expect(chips.getByRole("button", { name: "Running well 3" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "Needs a check 1" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "Starting soon 1" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "No active circles 1" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Details" }).getByRole("button", { name: "No photo 4" })).toBeVisible();

    // Needs a check comes first, with the reason.
    await expect(page.locator(".fac-row:not(.fac-head)").first()).toContainText("Bram Sample");
    await expect(row(page, "Bram Sample")).toContainText("No session in 3 weeks");
    await expect(row(page, "Bram Sample").locator(".fac-counts")).toContainText("1 live");
    await expect(row(page, "Bram Sample").locator(".fac-counts")).toContainText("1 paused");
    // Initiated name first, legal name beside it; photo where there is one.
    await expect(row(page, "Kirtana")).toContainText("Asha Example");
    await expect(row(page, "Kirtana").locator("img.fac-avatar")).toHaveCount(1);
    await expect(row(page, "Bram Sample").locator(".fac-initials")).toHaveText("BS");
    // c01: 17 Aug is before its start date, every week after had a session.
    const strip = row(page, "Kirtana").locator(".fac-strip i");
    await expect(strip).toHaveCount(8);
    await expect(row(page, "Kirtana").locator(".fac-strip .wk-before")).toHaveCount(1);
    await expect(row(page, "Kirtana").locator(".fac-strip .wk-held")).toHaveCount(7);
    // Dev's Kolkata circle: sessions matched by Zoom meeting ID; today's session is not synced yet.
    await expect(row(page, "Devi").locator(".fac-strip .wk-held")).toHaveCount(4);
    await expect(row(page, "Devi").locator(".fac-strip .wk-waiting")).toHaveCount(1);
    await expect(row(page, "Esha Specimen").locator(".fac-counts")).toContainText("1 co-facilitating");
    await expect(row(page, "Farid Dummy")).toContainText("Nothing running");
  });

  test("chips, search and sort narrow the list", async ({ page }) => {
    await signIn(page, { hash: "/Facilitators" });
    await page.getByRole("group", { name: "Circles" }).getByRole("button", { name: /^Needs a check/ }).click();
    await expect(page.locator(".fac-row:not(.fac-head)")).toHaveCount(1);
    await page.getByRole("group", { name: "Circles" }).getByRole("button", { name: /^All/ }).click();
    await page.getByRole("group", { name: "Details" }).getByRole("button", { name: /^No phone/ }).click();
    await expect(page.locator(".fac-row:not(.fac-head)")).toHaveCount(1);
    await expect(row(page, "Farid Dummy")).toBeVisible();
    await page.getByRole("group", { name: "Details" }).getByRole("button", { name: /^No phone/ }).click();
    await page.getByLabel("Search facilitators").fill("kolkata");
    await expect(page.locator(".fac-row:not(.fac-head)")).toHaveCount(1);
    await expect(row(page, "Devi")).toBeVisible();
    await page.getByLabel("Search facilitators").fill("");
    await page.getByLabel("Sort").selectOption("name");
    await expect(page.locator(".fac-row:not(.fac-head) .fac-name").first()).toHaveText("Bram Sample");
  });

  test("the panel saves a new photo and phone", async ({ page, mock }) => {
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Bram Sample").locator(".fac-name").click();
    await expect(panel(page).locator("h2")).toHaveText("Bram Sample");
    await expect(panel(page)).toContainText("No session in 3 weeks");
    await expect(panel(page).locator(".fac-circle")).toHaveCount(2);

    const save = panel(page).getByRole("button", { name: "Save details" });
    await expect(save).toBeDisabled();
    await field(page, "Photo link").fill("not a link");
    await expect(panel(page).getByText("It should start with https://")).toBeVisible();
    await expect(save).toBeDisabled();
    await field(page, "Photo link").fill("https://images.example.org/bram-new.png");
    await field(page, "Phone").fill("+44 7700 900099");
    await save.click();
    await expect(toast(page)).toHaveText("Facilitator saved.");
    expect(mock.rest("facilitators", "PATCH").map((r) => [r.query.id, r.body])).toEqual([
      ["eq.fac-02", { phone: "+44 7700 900099", photo_url: "https://images.example.org/bram-new.png" }],
    ]);
    // Name not changed, so circles are left alone.
    expect(mock.rest("circles", "PATCH")).toEqual([]);
    await expect(row(page, "Bram Sample").locator("img.fac-avatar")).toHaveCount(1);
  });

  test("changing only a first name refreshes the automatic names of their circles", async ({ page, mock }) => {
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Kirtana").locator(".fac-name").click();
    await field(page, "First name").fill("Asha");
    await panel(page).getByRole("button", { name: "Save details" }).click();
    await expect(toast(page)).toHaveText("Facilitator saved.");
    expect(mock.rest("facilitators", "PATCH")[0].body).toEqual({ first_name: "Asha" });
    expect(mock.rest("circles", "PATCH").map((r) => [r.query, r.body])).toEqual([
      [{ facilitator_id: "eq.fac-01", name_auto: "eq.true" }, { name_auto: true }],
    ]);
  });

  test("a clash on email shows a plain message", async ({ page, mock }) => {
    mock.handle("PATCH facilitators", () => fail('duplicate key value violates unique constraint "facilitators_email_key"', 409));
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Bram Sample").locator(".fac-name").click();
    await field(page, "Email").fill("asha.example@example.org");
    await expect(panel(page).getByText(/sign in with the new email/)).toBeVisible();
    await panel(page).getByRole("button", { name: "Save details" }).click();
    await expect(toast(page)).toHaveText("Another facilitator already uses that email.");
  });

  test("a circle in the panel opens the circle panel", async ({ page }) => {
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Kirtana").locator(".fac-name").click();
    await panel(page).getByRole("button", { name: NAMES.c01.replace("Gita Circles | ", "") }).click();
    await expect(page.locator("aside.drawer:not(.fac-drawer) h2").first()).toHaveText(NAMES.c01);
  });

  test("fits a phone screen @mobile", async ({ page }) => {
    await signIn(page, { hash: "/Facilitators" });
    await expect(row(page, "Bram Sample")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await row(page, "Bram Sample").locator(".fac-name").click();
    await expect(panel(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
