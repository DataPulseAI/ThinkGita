import { test, expect, signIn, toast, drawer } from "./support/test.js";
import { NAMES, circleRow, LIC, FAC } from "../fixtures/data.js";

// Opens a circle's panel from the Circles list (status "All" so every circle is there).
async function openCircle(page, name) {
  await page.getByLabel("Show").selectOption("all");
  await page.locator("table.table tbody tr", { has: page.locator("td", { hasText: name }) }).locator("td").first().click();
  await expect(drawer(page).locator("h2").first()).toHaveText(name);
  return drawer(page);
}
// A field in the panel's main form, by the start of its label.
const field = (d, label) => d.locator(".form > label, .form .grid2 > label, .form .grid3 > label, .form fieldset label")
  .filter({ hasText: new RegExp(`^${label}`) }).locator("input, select, textarea").first();
const section = (d, title) => d.locator(".details", { has: d.page().locator(".section-title", { hasText: title }) });

test.describe("Circle panel", () => {
  test("editing a pending circle saves the facilitator and circle rows", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c03);
    await expect(d.locator(".pills .pill").first()).toHaveText("Awaiting approval");
    await expect(field(d, "Timezone")).toHaveValue("America/New_York");
    await expect(d.getByText("From the form: (GMT-05:00) Eastern Time")).toBeVisible();
    await field(d, "Language").fill("Portuguese");
    await field(d, "Start").fill("18:30");
    await field(d, "Notes").fill("Prefers a small group");
    await d.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page)).toHaveText("Saved: Awaiting approval");
    await expect(drawer(page)).toHaveCount(0);
    expect(mock.rest("facilitators", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.fac-03", { phone: "+1 555 0100" }]]);
    const patches = mock.rest("circles", "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0].query).toEqual({ id: "eq.c03" });
    expect(patches[0].body).toEqual({
      facilitator_id: "fac-03", weekday: 2, start_time: "18:30",
      alt_weekday: null, alt_start_time: null, duration_min: 60, timezone: "America/New_York", preferred_start: "2026-10-20",
      circle_type: "Beginner", language: "Portuguese", notes: "Prefers a small group",
      whatsapp_group_link: null, participant_signup_link: null, youtube_playlist_link: null, drive_folder_link: null,
    });
    expect(patches[1].query).toEqual({ id: "eq.c03", select: "*" });
    expect(patches[1].body).toEqual({ licence_id: "lic-02", status: "pending", conflict_reason: null });
  });

  test("an automatic name is shown read-only and never sent on save", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c08);
    const name = field(d, "Circle name");
    await expect(name).toHaveValue(NAMES.c08);
    await expect(name).toHaveAttribute("readonly", "");
    await expect(d.locator(".name-hint")).toHaveText("Automatic: Gita Circles | host | day and time. It follows the host, day and time, so it can't be typed.");
    await expect(d.getByRole("button", { name: "Use automatic name" })).toHaveCount(0);
    await field(d, "Licence").selectOption("auto");
    await d.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toHaveText("Saved: Awaiting approval");
    const body = mock.rest("circles", "PATCH")[0].body;
    expect(body).toMatchObject({ licence_id: null, status: "pending", conflict_reason: null });
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("name_auto");
    expect(mock.rpc("allocate_circle")).toEqual([{ p_circle: "c08" }]);
  });

  test("an imported name is read-only, previews its new day and time, and can switch to automatic", async ({ page, mock, dialogs }) => {
    const imported = "TG Circles | Mon | 7pm UK | Test Host";
    const auto = "Gita Circles | Farid Dummy | Monday 19:00 (UK time)";
    mock.db.circles.push(circleRow({ id: "c11", name: imported, name_auto: false, source: "import", status: "live", facilitator_id: FAC.farid,
      weekday: 1, start_time: "19:00:00", licence_id: LIC.z3, zoom_meeting_id: "100000011", join_url: "https://zoom.example.org/j/100000011" }));
    // The database switches the name when name_auto is turned on (circles_auto_name trigger).
    mock.handle("PATCH circles", (req) => {
      if (req.query.id !== "eq.c11" || req.body.name_auto !== true) return undefined;
      const row = mock.db.circles.find((c) => c.id === "c11");
      Object.assign(row, { name_auto: true, name: auto });
      return req.single ? { name: row.name } : [{ name: row.name }];
    });
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, imported);
    const name = field(d, "Circle name");
    await expect(name).toHaveValue(imported);
    await expect(name).toHaveAttribute("readonly", "");
    await expect(d.locator(".name-hint")).toContainText("Imported name. Its day and time are updated when the schedule changes; everything else stays.");
    await expect(d.locator(".name-after")).toHaveCount(0);
    await field(d, "Day").selectOption("6");
    await field(d, "Start").fill("09:30");
    await expect(d.locator(".name-after")).toHaveText("After saving: TG Circles | Sat | 9.30am UK | Test Host");

    // Cancelling the confirmation changes nothing.
    dialogs.accept = false;
    await d.getByRole("button", { name: "Use automatic name" }).click();
    expect(mock.rest("circles", "PATCH")).toHaveLength(0);
    dialogs.accept = true;
    await d.getByRole("button", { name: "Use automatic name" }).click();
    await expect(toast(page)).toHaveText(`Name is now automatic: ${auto}`);
    expect(dialogs.messages[0]).toContain(`"${imported}" will be replaced by a name that follows the host, day and time`);
    expect(dialogs.messages[0]).toContain("The Zoom meeting title changes to match.");
    const [patch] = mock.rest("circles", "PATCH");
    expect(patch.query).toEqual({ id: "eq.c11", select: "name" });
    expect(patch.body).toEqual({ name_auto: true });
    expect(mock.fn("provision-circle", "rename")).toEqual([{ action: "rename", circle_id: "c11" }]);
    // The panel now shows the automatic name, read-only.
    await expect(drawer(page).locator("h2").first()).toHaveText(auto);
    await expect(field(drawer(page), "Circle name")).toHaveValue(auto);
    await expect(drawer(page).getByRole("button", { name: "Use automatic name" })).toHaveCount(0);
  });

  test("an imported name that does not follow the pattern stays as it is", async ({ page, mock }) => {
    mock.db.circles.push(circleRow({ id: "c11", name: "Bhakti Circles - Monday", name_auto: false, source: "import", status: "pending", facilitator_id: FAC.farid, weekday: 1, start_time: "18:00:00", licence_id: LIC.z3 }));
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, "Bhakti Circles - Monday");
    await expect(d.locator(".name-hint")).toContainText("Imported name. It stays exactly as it is when the schedule changes.");
    await field(d, "Start").fill("19:00");
    await expect(d.locator(".name-after")).toHaveCount(0);
  });

  test("changing a live circle's time moves the Zoom meeting", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c02);
    await expect(field(d, "Licence")).toBeDisabled();
    await expect(d.getByText("To change the licence of a live circle, use Move to another licence above.")).toBeVisible();
    await field(d, "Start").fill("19:45");
    await d.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toHaveText("Saved: Zoom meeting moved, same link. Email sent to bram.sample@example.org.");
    expect(mock.fn("provision-circle")).toEqual([{ action: "reschedule", circle_id: "c02", patch: { start_time: "19:45" } }]);
    const circlePatch = mock.rest("circles", "PATCH")[0];
    expect(circlePatch.query).toEqual({ id: "eq.c02", select: "name" });
    expect(circlePatch.body).toMatchObject({ language: "Hindi" });
    expect(circlePatch.body).not.toHaveProperty("start_time");
    // The name is the database's job (it follows the new time); the panel never sends it.
    expect(circlePatch.body).not.toHaveProperty("name");
    expect(circlePatch.body).not.toHaveProperty("name_auto");
  });

  test("adding a new circle creates the facilitator and picks a licence", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    await page.getByRole("button", { name: "Add circle" }).click();
    const d = drawer(page);
    await expect(d.locator("h2").first()).toHaveText("New circle");
    await expect(field(d, "Circle name")).toHaveAttribute("readonly", "");
    await expect(d.locator(".name-hint")).toHaveText("Set automatically when you add the circle: Gita Circles | host | day and time. It follows the host, day and time, so it can't be typed.");
    await field(d, "Facilitator name").fill("Gita Newcomer");
    await field(d, "Facilitator email").fill("Gita.Newcomer@Example.org");
    await field(d, "Day").selectOption("4");
    await field(d, "Start").fill("20:00");
    await expect(field(d, "Circle name")).toHaveValue("Gita Circles | Gita Newcomer | Thursday 20:00 (UK time)");
    await d.getByRole("button", { name: "Add circle" }).click();
    await expect(toast(page)).toHaveText("Saved: Awaiting approval");
    expect(mock.rest("facilitators", "POST").map((r) => r.body)).toEqual([{ email: "gita.newcomer@example.org", name: "Gita Newcomer", phone: null }]);
    const created = mock.rest("circles", "POST")[0].body;
    expect(created).toMatchObject({ name: "Gita Circles", name_auto: true, weekday: 4, start_time: "20:00", duration_min: 75, timezone: "Europe/London", source: "manual", licence_id: null, status: "pending" });
    expect(mock.rpc("allocate_circle")).toHaveLength(1);
  });

  test("live circle details, resend email and the shared licence note", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c01);
    const zoom = section(d, "Zoom details");
    await expect(zoom).toContainText("https://zoom.example.org/j/100000001?pwd=fake");
    await expect(zoom).toContainText("111111");
    await expect(zoom).toContainText("Mondays 19:00 (London time)");
    const note = d.locator("p.hint", { hasText: "Shared licence" });
    await expect(note).toHaveText("Shared licence: Zoom 01 also runs Bram Sample (Mon 19:30–20:30 UK) at this time. Zoom allows 2 meetings at once on one licence, so both can run.");
    await expect(note).not.toHaveClass(/warn/);
    await zoom.getByRole("button", { name: "Resend details email" }).click();
    await expect(toast(page)).toHaveText("Details email: Email sent to asha.example@example.org and 1 co-facilitator.");
    expect(mock.fn("provision-circle", "resend")).toEqual([{ action: "resend", circle_id: "c01" }]);
    // The other circle in the note opens its own panel.
    await note.getByRole("button", { name: "Bram Sample" }).click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c02);
  });

  test("the shared licence note warns when three meetings overlap", async ({ page, mock }) => {
    mock.db.circles.push(circleRow({ id: "c10", name: "Gita Circles | Third Wheel | Monday 19:15 (London time)", status: "pending", facilitator_id: FAC.farid, weekday: 1, start_time: "19:15:00", licence_id: LIC.z1 }));
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c01);
    const note = d.locator("p.hint.warn");
    await expect(note).toContainText("Zoom 01 has 3 meetings at once here, more than Zoom allows (2). Move this circle or one of:");
    await expect(note.getByRole("button")).toHaveText(["Third Wheel", "Bram Sample"]);
  });

  test("move licence menu lists free and shared licences and sends the move", async ({ page, mock, dialogs }) => {
    mock.db.circles.push(circleRow({ id: "c12", name: "Gita Circles | Neighbour (Farid Dummy) | Monday 19:00 (London time)", status: "live", facilitator_id: FAC.farid, weekday: 1, start_time: "19:00:00", licence_id: LIC.z2 }));
    mock.handle("rpc free_licences_for_circle", [{ licence_id: LIC.z3, label: "Zoom 03", is_mock: false, has_zoom: true }]);
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c01);
    const manage = section(d, "Manage");
    const menu = manage.getByLabel("Move to another licence");
    await expect(menu.locator("option").first()).toHaveText("Choose a licence…");
    await expect(menu.locator("optgroup")).toHaveCount(2);
    await expect(menu.locator("optgroup").nth(0)).toHaveAttribute("label", "Free at this time");
    await expect(menu.locator("optgroup").nth(1)).toHaveAttribute("label", "Shared: 1 other meeting at this time");
    await expect(menu.locator("optgroup").nth(1).locator("option")).toHaveText("Zoom 02, shared with Neighbour (Farid Dummy)");
    expect(mock.rpc("free_licences_for_circle")).toEqual([{ p_circle: "c01" }]);
    await expect(manage.getByRole("button", { name: "Move" })).toBeDisabled();
    await menu.selectOption(LIC.z3);
    await manage.getByRole("button", { name: "Move" }).click();
    await expect(toast(page)).toHaveText("Moved to Zoom 03, new Zoom link created. Email sent to asha.example@example.org and 1 co-facilitator.");
    expect(dialogs.messages[0]).toContain(`Move "${NAMES.c01}" to Zoom 03?`);
    expect(dialogs.messages[0]).toContain("so the join link changes");
    expect(mock.fn("provision-circle", "move_licence")).toEqual([{ action: "move_licence", circle_id: "c01", licence_id: LIC.z3 }]);
  });

  test("with no other licence free, the move menu says so", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c02);
    await expect(section(d, "Manage").getByLabel("Move to another licence").locator("option").first()).toHaveText("No other licence has room at this time");
  });

  test("a clash lists who holds the time", async ({ page, mock }) => {
    mock.handle("rpc slot_holders", [{ circle_id: "c01", circle_name: NAMES.c01, licence_label: "Zoom 01", weekday: 1, start_time: "19:00:00", status: "live", facilitator: "Asha Example" }]);
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c04);
    await expect(d.locator(".approve-bar.warn")).toContainText("Can't approve yet");
    const holders = section(d, "Who's using this time");
    await expect(holders.locator("button.holder")).toContainText("Mon 19:00 UK · Live · Asha Example");
    await holders.locator("button.holder").click();
    await expect(drawer(page).locator("h2").first()).toHaveText(NAMES.c01);
  });

  test("co-facilitators can be added and removed", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Circles" });
    let d = await openCircle(page, NAMES.c02);
    const co = section(d, "Co-facilitators");
    await expect(co).toContainText("None. Co-facilitators see this circle when they sign in and get its emails.");
    await co.getByRole("button", { name: "Add co-facilitator" }).click();
    await expect(co.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await co.getByLabel("Name").fill("Hari Helper");
    await co.getByLabel("Email").fill("Hari.Helper@example.org");
    await co.getByLabel("Phone").fill("+44 7700 900009");
    await co.getByRole("button", { name: "Add", exact: true }).click();
    await expect(toast(page)).toHaveText("Hari Helper added. They'll get future emails; use Resend details email to send them the details now.");
    expect(mock.rest("facilitators", "POST").map((r) => r.body)).toEqual([{ email: "hari.helper@example.org", name: "Hari Helper", phone: "+44 7700 900009" }]);
    const link = mock.rest("circle_cofacilitators", "POST")[0].body;
    expect(link.circle_id).toBe("c02");
    expect(link.facilitator_id).toBe(mock.db.facilitators.find((f) => f.email === "hari.helper@example.org").id);
    await expect(co.locator(".cofac-row")).toContainText("Hari Helper · hari.helper@example.org · +44 7700 900009");

    await page.keyboard.press("Escape");
    d = await openCircle(page, NAMES.c01);
    const co1 = section(d, "Co-facilitators");
    await expect(co1.locator(".cofac-row")).toContainText("Esha Specimen · esha.specimen@example.org");
    await co1.getByRole("button", { name: "Remove" }).click();
    await expect(toast(page)).toHaveText("Esha Specimen removed from this circle");
    expect(dialogs.messages).toEqual(["Remove Esha Specimen from this circle? They keep their other circles."]);
    expect(mock.rest("circle_cofacilitators", "DELETE").map((r) => r.query)).toEqual([{ circle_id: "eq.c01", facilitator_id: "eq.fac-05" }]);
    await expect(co1.locator(".cofac-row")).toHaveCount(0);
  });

  test("adding the main facilitator as a co-facilitator is refused", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const co = section(await openCircle(page, NAMES.c02), "Co-facilitators");
    await co.getByRole("button", { name: "Add co-facilitator" }).click();
    await co.getByLabel("Email").fill("bram.sample@example.org");
    await co.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator(".toast.error")).toHaveText("That's already the main facilitator.");
    expect(mock.rest("circle_cofacilitators")).toHaveLength(0);
  });

  test("website section: checklist, field validation and save", async ({ page, mock }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c03);
    const web = section(d, "Website");
    await expect(web).toContainText("Not listed on the ThinkGita website (kept as a draft). Switch it on to advertise it before it's approved.");
    await expect(web.locator(".wf-ready > p")).toHaveText("Not ready for the website. Before it can be shown, set: photo, WhatsApp group link, website order.");
    await expect(web.locator(".wf-checklist li")).toHaveCount(9);
    await expect(web.locator(".wf-checklist li:not(.done) .what")).toContainText(["Photo", "WhatsApp group link", "Website order"]);
    await expect(web.locator(".wf-checklist li.done", { hasText: "Start date" })).toContainText("Starts 2026-10-20");
    await expect(web.getByRole("switch")).toHaveText("Not ready");

    const form = web.locator("form.wf-form");
    const save = form.getByRole("button", { name: "Save website details" });
    await expect(save).toBeDisabled();
    const photo = form.getByLabel(/^Facilitator photo/);
    await photo.fill("not a link");
    await expect(form.getByText("That doesn't look like a link. It should start with https://")).toBeVisible();
    await expect(save).toBeDisabled();
    await photo.fill("https://images.example.org/chitra.png");
    await expect(form.locator(".wf-thumb")).toHaveAttribute("src", "https://images.example.org/chitra.png");
    const order = form.getByLabel("Website order");
    await order.fill("0");
    await expect(form.getByText("Order must be a whole number from 1.")).toBeVisible();
    await expect(save).toBeDisabled();
    await order.fill("2.5");
    await expect(form.getByText("Order must be a whole number from 1.")).toBeVisible();
    await order.fill("7");
    await expect(form.getByText("Order must be a whole number from 1.")).toHaveCount(0);
    await form.getByLabel("Name on the website card").fill("Chitra");
    await save.click();

    await expect(toast(page)).toHaveText("Website details saved");
    expect(mock.rest("facilitators", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.fac-03", { photo_url: "https://images.example.org/chitra.png" }]]);
    expect(mock.rest("circles", "PATCH").map((r) => [r.query.id, r.body])).toEqual([["eq.c03", { website_photo_url: null, website_name: "Chitra", website_order: 7 }]]);
    // After the reload only the WhatsApp link is missing.
    await expect(web.locator(".wf-ready > p")).toHaveText("Not ready for the website. Before it can be shown, set: WhatsApp group link.");
  });

  test("undo puts the website fields back", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    const form = section(await openCircle(page, NAMES.c08), "Website").locator("form.wf-form");
    await form.getByLabel("Website order").fill("9");
    await form.getByRole("button", { name: "Undo" }).click();
    await expect(form.getByLabel("Website order")).toHaveValue("4");
    await expect(form.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  test("a switched-on circle held back for missing details shows the readiness note, not an error", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    const web = section(await openCircle(page, NAMES.c05), "Website");
    await expect(web.locator("p.muted.small").first()).toHaveText("Listed on the ThinkGita website. Kept hidden until the missing details below are set.");
    await expect(web.getByText("Last website update failed")).toHaveCount(0);
    await expect(web.locator(".wf-ready > p")).toHaveText("Not ready for the website. It stays hidden until: website order.");
    await expect(web.getByRole("switch")).toHaveText("Shown");
  });

  test("a real website error is shown in the panel", async ({ page, mock }) => {
    mock.db.circles.find((c) => c.id === "c02").framer_error = "Framer rejected the image";
    await signIn(page, { hash: "/Circles" });
    const web = section(await openCircle(page, NAMES.c02), "Website");
    await expect(web.locator(".warn-text")).toHaveText("Last website update failed: Framer rejected the image");
  });

  test("delete from the panel for a circle that is not live", async ({ page, mock, dialogs }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c09);
    await expect(d.locator(".drawer-foot")).toContainText("Source: tally");
    await d.getByRole("button", { name: "Delete circle" }).click();
    await expect(toast(page)).toHaveText("Circle deleted");
    await expect(drawer(page)).toHaveCount(0);
    expect(mock.rest("circles", "DELETE").map((r) => r.query.id)).toEqual(["eq.c09"]);
  });

  test("a live circle has no delete button in its panel", async ({ page }) => {
    await signIn(page, { hash: "/Circles" });
    const d = await openCircle(page, NAMES.c01);
    await expect(d.locator(".drawer-foot")).toBeVisible();
    await expect(d.locator(".drawer-foot").getByRole("button", { name: "Delete circle" })).toHaveCount(0);
  });
});
