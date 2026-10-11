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
    // A form still waiting for approval doesn't count as starting: Chitra (pending only) has no active circles.
    await expect(chips.getByRole("button", { name: /^Starting soon/ })).toHaveCount(0);
    await expect(chips.getByRole("button", { name: "No active circles 2" })).toBeVisible();
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

  test("New facilitator adds a person once and opens their profile", async ({ page, mock }) => {
    await signIn(page, { hash: "/Facilitators" });
    await page.getByRole("button", { name: "New facilitator" }).click();
    const form = page.locator("form.new-person");
    await form.getByLabel("Email").fill("asha.example@example.org");
    await expect(form.getByText("Already in the system:")).toBeVisible();
    await form.getByLabel("Initiated name (if any)").fill("Radha");
    await form.getByLabel("First name").fill("Priya");
    await form.getByLabel("Email").fill("priya.new@example.org");
    await form.getByRole("button", { name: "Add to the system" }).click();
    await expect(toast(page)).toHaveText("Radha added. Assign them to a circle, or start a new one, from their profile.");
    expect(mock.rest("facilitators", "POST").map((r) => r.body)).toEqual([{
      name: "Radha (Priya)", email: "priya.new@example.org", phone: null, first_name: "Priya", last_name: null, initiated_name: "Radha",
    }]);
    await expect(panel(page).locator("h2")).toHaveText("Radha");
  });

  test("unverified people are flagged, filterable, and can be verified from their profile", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Facilitators" });
    await expect(row(page, "Chitra Placeholder").locator(".tag.unverified")).toHaveText("Unverified");
    await expect(row(page, "Bram Sample").locator(".tag.unverified")).toHaveCount(0);
    const details = page.getByRole("group", { name: "Details" });
    await details.getByRole("button", { name: /^Unverified/ }).click();
    await expect(page.locator(".fac-row:not(.fac-head) .fac-name")).toHaveText([/Chitra Placeholder/, /Farid Dummy/]);
    await row(page, "Chitra Placeholder").locator(".fac-name").click();
    const box = panel(page).locator(".fac-verify");
    await expect(box).toContainText("Not verified yet");
    await box.getByRole("button", { name: "Verify" }).click();
    await expect(toast(page)).toHaveText("Chitra Placeholder is verified.");
    expect(mock.rpc("set_facilitator_verified")).toEqual([{ p_facilitator: "fac-03", p_verified: true }]);
    await expect(box).toContainText("Verified on");
    await expect(box).toContainText("by admin@example.org");
    await box.getByRole("button", { name: "Remove verification" }).click();
    await expect(toast(page)).toHaveText("Chitra Placeholder is no longer verified.");
    expect(dialogs.messages.at(-1)).toContain("Remove verification from Chitra Placeholder?");
    await expect(box).toContainText("Not verified yet");
  });

  test("a verified person shows how they were verified", async ({ page }) => {
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Bram Sample").locator(".fac-name").click();
    await expect(panel(page).locator(".fac-verify")).toContainText("already running circles when verification began");
  });

  test("a new facilitator can have a photo, then be assigned to a circle or given a new one", async ({ page, mock }) => {
    await signIn(page, { hash: "/Facilitators" });
    await page.getByRole("button", { name: "New facilitator" }).click();
    const d = page.locator("aside.new-fac-drawer");
    await expect(d.locator("h2")).toHaveText("New facilitator");
    await d.getByLabel("First name").fill("Gopi");
    await d.getByLabel("Last name").fill("Newperson");
    await d.getByLabel("Email").fill("gopi.new@example.org");
    await d.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await expect(d.getByText("Change photo")).toBeVisible();
    expect(mock.uploads()[0]).toMatch(/^facilitator-photos\/new-[a-z0-9]+\/\d+\.png$/);
    await d.getByRole("button", { name: "Add to the system" }).click();
    const body = mock.rest("facilitators", "POST")[0].body;
    expect(body).toMatchObject({ name: "Gopi Newperson", email: "gopi.new@example.org" });
    expect(body.photo_url).toMatch(/facilitator-photos\/new-[a-z0-9]+\/\d+\.png$/);

    // Their profile opens: assign them to an existing circle as co-facilitator.
    await expect(panel(page).locator("h2")).toHaveText("Gopi Newperson");
    await expect(panel(page)).toContainText("Not on any current circle yet.");
    await panel(page).getByRole("button", { name: "Assign to a circle" }).click();
    const assign = panel(page).getByRole("group", { name: "Assign to a circle" });
    await assign.getByLabel("Search circles").fill("bram");
    await assign.getByRole("option").first().click();
    await expect(toast(page)).toContainText("Gopi Newperson added to");
    const link = mock.rest("circle_cofacilitators", "POST")[0].body;
    expect(link.facilitator_id).toBe(body.id ?? mock.db.facilitators.find((f) => f.email === "gopi.new@example.org").id);

    // Or start a new circle with them as host.
    await panel(page).getByRole("button", { name: "New circle" }).click();
    const circle = page.locator("aside.drawer", { has: page.locator("h2", { hasText: "New circle" }) });
    await expect(circle.locator(".team .team-person")).toContainText("Gopi Newperson");
  });

  test("assigning as primary on a pending circle replaces its host after a confirm", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Facilitators" });
    await row(page, "Farid Dummy").locator(".fac-name").click();
    await panel(page).getByRole("button", { name: "Assign to a circle" }).click();
    const assign = panel(page).getByRole("group", { name: "Assign to a circle" });
    await assign.getByRole("radio", { name: "As primary facilitator" }).click();
    await assign.getByLabel("Search circles").fill("chitra tuesday");
    await assign.getByRole("option").first().click();
    expect(dialogs.messages.at(-1)).toContain("Make Farid Dummy the primary facilitator of");
    await expect(toast(page)).toContainText("Farid Dummy is now the primary facilitator of");
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c03", { facilitator_id: "fac-06" }]]);
  });
});
