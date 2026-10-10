import { test, expect, signIn, fail, dateText } from "./support/test.js";
import { NAMES } from "../fixtures/data.js";

const cardOf = (page, name) => page.locator("main section.card", { has: page.locator("h2", { hasText: name }) });

test.describe("Facilitator portal", () => {
  test("lists their own and co-facilitated circles", async ({ page, mock }) => {
    await signIn(page, { role: "facilitator" });
    await expect(page.locator("main section.card h2")).toHaveText([NAMES.c01, NAMES.c08]);
    expect(mock.rpc("my_circles_v2")).toHaveLength(1);

    // c01: co-facilitated and live, so the Zoom details are there.
    const live = cardOf(page, NAMES.c01);
    await expect(live.locator(".pill").first()).toHaveText("Ready");
    await expect(live.locator(".lead")).toHaveText("Every Monday, 19:00–20:15 (London time)");
    await expect(live).toContainText("https://zoom.example.org/j/100000001?pwd=fake");
    await expect(live).toContainText("100000001");
    const hostKey = live.locator(".host-key");
    await expect(hostKey.locator(".detail-value")).toContainText("••••••");
    await hostKey.getByRole("button", { name: "Show" }).click();
    await expect(hostKey.locator(".detail-value")).toContainText("111111");
    await expect(live).toContainText(dateText("from Mon 7 Sept 2026 until Mon 28 Jun 2027"));
    const links = live.locator(".details", { hasText: "Links" });
    await expect(links).toContainText("https://chat.whatsapp.com/EXAMPLE01");
    await expect(links).toContainText("https://signup.example.org/?circle=c01");
    await expect(links).toContainText("https://drive.example.org/shared-folder");

    // c08: their own, still awaiting approval.
    const pending = cardOf(page, NAMES.c08);
    await expect(pending.locator(".pill").first()).toHaveText("Awaiting approval");
    await expect(pending).toContainText("Your Zoom link will appear here once the team approves your circle.");
    await expect(pending.locator(".host-key")).toHaveCount(0);
  });

  test("a change request sends a structured body", async ({ page, mock }) => {
    await signIn(page, { role: "facilitator" });
    const card = cardOf(page, NAMES.c08);
    await card.getByRole("button", { name: "Need to change something?" }).click();
    const send = card.getByRole("button", { name: "Send request" });
    await expect(send).toBeDisabled();
    await card.getByLabel("What do you need?").selectOption("change_time");
    await card.getByLabel("New day").selectOption("4");
    await card.getByLabel(/New start time/).fill("18:30");
    await expect(send).toBeDisabled();
    await card.getByLabel("From").fill("2026-10-15");
    await card.getByLabel("Anything else? (optional)").fill("Evenings suit the group better");
    await expect(card.getByText("We'll send:")).toContainText(dateText("Move to Thursdays at 18:30 from Thu 15 Oct 2026"));
    await send.click();

    await expect(card.getByText("Thanks, the team has your request. You'll see its status above.")).toBeVisible();
    expect(mock.rest("change_requests", "POST").map((r) => r.body)).toEqual([{
      circle_id: "c08", request_type: "change_time", details: { weekday: 4, start_time: "18:30", from: "2026-10-15" },
      message: expect.stringMatching(dateText("Move to Thursdays at 18:30 from Thu 15 Oct 2026. Evenings suit the group better")),
    }]);
    const history = card.locator(".history-row");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("Change day or time");
    await expect(history.locator(".pill")).toHaveText("Waiting for the team");
  });

  test("'Something else' needs a note, and a failed send says so", async ({ page, mock }) => {
    mock.handle("POST change_requests", fail("new row violates row-level security policy", 403));
    await signIn(page, { role: "facilitator" });
    const card = cardOf(page, NAMES.c01);
    await card.getByRole("button", { name: "Need to change something?" }).click();
    await card.getByLabel("What do you need?").selectOption("other");
    await expect(card.getByRole("button", { name: "Send request" })).toBeDisabled();
    await card.getByLabel("Tell us what you need").fill("Can we make the sessions 90 minutes?");
    await card.getByRole("button", { name: "Send request" }).click();
    await expect(card.getByText("Couldn't send your request. Please try again, or contact the team.")).toBeVisible();
    expect(mock.rest("change_requests", "POST")[0].body).toEqual({
      circle_id: "c01", request_type: "other", details: {}, message: "Can we make the sessions 90 minutes?",
    });
  });

  test("someone with no circles is told what to do", async ({ page }) => {
    await signIn(page, { role: "facilitator", email: "newcomer@example.org" });
    await expect(page.getByText("There are no circles linked to newcomer@example.org yet.")).toBeVisible();
  });
});
