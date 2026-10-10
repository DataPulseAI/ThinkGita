// provision-circle actions end to end with a fake Zoom API (fetch stub), in-memory database and the nodemailer stub.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { sent } from "../stubs/nodemailer.js";
import { attachFake } from "./helpers/fakeSupabase.js";
import { withDenoEnv } from "./helpers/env.js";
import { freeze, person } from "./helpers/circles.js";
import { followSchedule } from "../../src/lib.js";

// Stands in for the circles_auto_name trigger (migration 20261010000026): imported names follow the schedule.
const renameTrigger = (row, old) => {
  if (!row.name_auto && row.name === old.name) row.name = followSchedule(row.name, old, row);
};

let pc, restoreEnv;
beforeAll(async () => {
  restoreEnv = withDenoEnv({
    ZOOM_ACCOUNT_ID: "acct", ZOOM_CLIENT_ID: "cid", ZOOM_CLIENT_SECRET: "secret",
    GMAIL_USER: "team@example.org", GMAIL_APP_PASSWORD: "abcd efgh", APP_URL: "https://circles.example.org/",
  });
  pc = await import("../../../supabase/functions/provision-circle/index.ts");
});
afterAll(() => restoreEnv());

// fake Zoom
let zoomCalls, zoomFail, nextMeeting;
function zoomFetch() {
  return vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://zoom.us/oauth/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    const path = u.replace("https://api.zoom.us/v2", "");
    const method = init.method ?? "GET";
    const call = { method, path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization };
    zoomCalls.push(call);
    const fail = zoomFail.find((f) => f.method === method && path.startsWith(f.path));
    if (fail) return new Response(fail.body ?? "{\"message\":\"nope\"}", { status: fail.status ?? 400 });
    if (method === "POST" && /\/meetings$/.test(path)) return new Response(JSON.stringify(nextMeeting), { status: 201 });
    return new Response(null, { status: 204 });
  });
}
const zoomApi = (method) => zoomCalls.filter((c) => c.method === method);

// data
const licence = (over = {}) => ({ id: "lic-1", label: "Licence 01", active: true, zoom_user_email: "zoom1@example.org", is_mock: false, host_key: "246810", ...over });
const circle = (over = {}) => ({
  id: "c1", name: "Gita Circles | Asha Example | Sunday 19:30 (Chicago)", status: "pending", weekday: 7, start_time: "19:30:00",
  duration_min: 60, timezone: "America/Chicago", preferred_start: null, starts_on: null, ends_on: null, zoom_meeting_id: null,
  licence_id: "lic-1", licence: licence(), facilitator: person(), whatsapp_group_link: "https://chat.whatsapp.com/ABC",
  ...over,
});
let db;
function setup({ circles = [circle()], settings = {}, licences = [licence()], cofacs = [], facilitators = [] } = {}) {
  db = attachFake(pc.db, {
    circles, licences, facilitators, circle_cofacilitators: cofacs,
    settings: [{ id: 1, term_start: null, term_end: "2026-12-14", support_contact: "help@example.org", ...settings }],
    admin_emails: [{ email: "admin@example.org", name: "Admin Example" }], email_templates: [], email_log: [], audit_log: [],
  });
  db.invites = [];
  db.client.auth.admin.inviteUserByEmail = async (email) => { db.invites.push(email); return { data: {}, error: null }; };
  pc.db.auth = db.client.auth;
}
const row = (id = "c1") => db.row("circles", id);

beforeEach(() => {
  zoomCalls = []; zoomFail = []; nextMeeting = { id: 987654321, join_url: "https://zoom.us/j/987654321?pwd=x", password: "abc123" };
  sent.length = 0;
  vi.stubGlobal("fetch", zoomFetch());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("provision", () => {
  it("Chicago Sunday evening after UK midnight starts today in Chicago, ends 23:59 Chicago time", async () => {
    freeze("2026-10-12T03:00:00Z"); // UK Mon 04:00, Chicago Sun 22:00
    setup();
    const r = await pc.provision("c1", "admin@example.org");
    expect(r).toMatchObject({ status: "live", meeting_id: 987654321, join_url: nextMeeting.join_url, invite: "invited", email: "sent", mock: false });

    const [post] = zoomApi("POST");
    expect(post.path).toBe("/users/zoom1%40example.org/meetings");
    expect(post.auth).toBe("Bearer tok");
    expect(post.body).toMatchObject({
      topic: circle().name, type: 8, start_time: "2026-10-11T19:30:00", timezone: "America/Chicago", duration: 60,
      recurrence: { type: 2, repeat_interval: 1, weekly_days: "1", end_date_time: "2026-12-15T05:59:00Z" },
    });
    expect(post.body.settings).toMatchObject({ join_before_host: true, waiting_room: false, approval_type: 2 });

    expect(row()).toMatchObject({ status: "live", zoom_meeting_id: "987654321", join_url: nextMeeting.join_url, passcode: "abc123", starts_on: "2026-10-11", ends_on: "2026-12-14" });
    expect(db.invites).toEqual(["asha@example.org"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "asha@example.org", replyTo: "help@example.org", from: { name: "Think Gita Circles", address: "team@example.org" } });
    expect(sent[0].subject).toBe("You're approved! Your Think Gita Circle is ready, Asha");
    expect(sent[0].text).toContain("Meeting link: https://zoom.us/j/987654321?pwd=x");
    expect(sent[0].text).toContain("Host key: 246810");
    expect(sent[0].text).toContain("First session: Sunday 11 October 2026");
    expect(sent[0].text).toContain("(Chicago time)");
    expect(sent[0].text).toContain("Admin Example");
    expect(db.tables.email_log.at(-1)).toMatchObject({ kind: "approved", status: "sent", to_email: "asha@example.org", circle_id: "c1" });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "provision", circle_id: "c1" });
  });

  it.each([[1, "2"], [2, "3"], [3, "4"], [4, "5"], [5, "6"], [6, "7"], [7, "1"]])("ISO weekday %i maps to Zoom weekly_days %s", async (wd, zoomDay) => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle({ weekday: wd, timezone: "Europe/London" })] });
    await pc.provision("c1", "admin@example.org", false);
    expect(zoomApi("POST")[0].body.recurrence.weekly_days).toBe(zoomDay);
  });

  it("starts from the latest of today, term start and preferred start", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle({ weekday: 1, timezone: "Europe/London", preferred_start: "2026-10-20" })], settings: { term_start: "2026-10-15" } });
    await pc.provision("c1", "a", false);
    expect(zoomApi("POST")[0].body.start_time).toBe("2026-10-26T19:30:00");
    expect(row().starts_on).toBe("2026-10-26");
  });

  it("without a term end: 50 sessions, ends_on 49 weeks after the start", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle({ weekday: 6, timezone: "Europe/London" })], settings: { term_end: null } });
    await pc.provision("c1", "a", false);
    const rec = zoomApi("POST")[0].body.recurrence;
    expect(rec.end_times).toBe(50);
    expect(rec.end_date_time).toBeUndefined();
    expect(row()).toMatchObject({ starts_on: "2026-10-10", ends_on: "2027-09-18" });
  });

  it("without notify: no invite or email, a skipped entry in email_log", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup();
    const r = await pc.provision("c1", "a", false);
    expect(r.email).toBe("not sent (approved without email)");
    expect(sent).toHaveLength(0);
    expect(db.invites).toEqual([]);
    expect(db.tables.email_log.at(-1)).toMatchObject({ status: "skipped", kind: "approved" });
  });

  it("emails every co-facilitator once", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ cofacs: [
      { circle_id: "c1", facilitator: person({ id: "f2", name: "Bela Example", email: "bela@example.org" }) },
      { circle_id: "c1", facilitator: person() },
      { circle_id: "other", facilitator: person({ email: "x@example.org" }) },
    ] });
    await pc.provision("c1", "a");
    expect(sent.map((m) => m.to)).toEqual(["asha@example.org", "bela@example.org"]);
    expect(sent[1].subject).toContain("Bela");
    expect(db.invites).toEqual(["asha@example.org", "bela@example.org"]);
  });

  it("mock licences never call Zoom", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle({ licence: licence({ is_mock: true, zoom_user_email: null }) })] });
    const r = await pc.provision("c1", "a", false);
    expect(r.mock).toBe(true);
    expect(String(r.meeting_id)).toMatch(/^MOCK\d{10}$/);
    expect(zoomCalls).toEqual([]);
  });

  it.each([
    [{ status: "approved" }, "This circle is already being approved"],
    [{ status: "live" }, "Circle is live, not awaiting approval"],
    [{ licence: null }, "Circle has no licence assigned"],
    [{ licence: licence({ active: false }) }, "Licence 01 is inactive. Re-check licences first."],
    [{ licence: licence({ zoom_user_email: null }) }, "Licence 01 has no Zoom user email set"],
    [{ facilitator: null }, "Circle has no facilitator"],
  ])("refuses %j", async (over, msg) => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle(over)] });
    await expect(pc.provision("c1", "a")).rejects.toThrow(msg);
    expect(zoomCalls).toEqual([]);
  });

  it("term ending before the first session is refused and the circle released", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ settings: { term_end: "2026-10-09" } });
    await expect(pc.provision("c1", "a")).rejects.toThrow(/term ends before/);
    expect(row().status).toBe("pending");
  });

  it("term longer than 50 weeks is refused", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ settings: { term_end: "2027-12-31" } });
    await expect(pc.provision("c1", "a")).rejects.toThrow("Term is longer than 50 weeks");
    expect(row().status).toBe("pending");
  });

  it("Zoom refusing releases the claim", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup();
    zoomFail.push({ method: "POST", path: "/users/", status: 400 });
    await expect(pc.provision("c1", "a")).rejects.toThrow(/Zoom \/users\/zoom1%40example.org\/meetings failed: 400/);
    expect(row().status).toBe("pending");
  });

  it("a failed save deletes the new Zoom meeting again", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup();
    db.failNext("circles", "update", "db down", 1); // the claim succeeds, the save fails
    await expect(pc.provision("c1", "a")).rejects.toThrow("Saving failed, so the Zoom meeting was removed again: db down");
    expect(zoomApi("DELETE").map((c) => c.path)).toEqual(["/meetings/987654321"]);
    expect(row().status).toBe("pending");
  });

  it("a lost claim race is refused before Zoom", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup();
    const orig = db.client.from;
    pc.db.from = (t) => { const q = orig(t); if (t === "circles") { const u = q.update.bind(q); q.update = (p) => (p.status === "approved" ? u({}).eq("id", "nobody") : u(p)); } return q; };
    await expect(pc.provision("c1", "a")).rejects.toThrow("This circle is already being approved");
    expect(zoomCalls).toEqual([]);
  });
});

describe("reschedule", () => {
  const live = (over = {}) => circle({ status: "live", weekday: 3, timezone: "Europe/London", zoom_meeting_id: "555", starts_on: "2026-09-02", ends_on: "2026-12-14", ...over });

  it("moves the Zoom meeting with the new day and keeps the series end in the circle's zone", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    const r = await pc.reschedule("c1", "a", { weekday: 1, name: "ignored" });
    expect(r).toMatchObject({ status: "live", starts_on: "2026-10-12", email: "sent" });
    const [patch] = zoomApi("PATCH");
    expect(patch.path).toBe("/meetings/555");
    expect(patch.body).toEqual({
      topic: live().name, start_time: "2026-10-12T19:30:00", timezone: "Europe/London", duration: 60,
      recurrence: { type: 2, repeat_interval: 1, weekly_days: "2", end_date_time: "2026-12-14T23:59:00Z" },
    });
    expect(row()).toMatchObject({ weekday: 1, starts_on: "2026-10-12" });
    expect(sent[0].subject).toBe("Your Think Gita Circle details have changed, Asha");
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "reschedule", detail: { to: { weekday: 1 } } });
  });

  it("a timezone change computes the end in the new zone", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    await pc.reschedule("c1", "a", { timezone: "Asia/Kolkata" });
    const [patch] = zoomApi("PATCH");
    expect(patch.body.timezone).toBe("Asia/Kolkata");
    expect(patch.body.recurrence.end_date_time).toBe("2026-12-14T18:29:00Z");
  });

  it("no end date: 50 sessions", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ ends_on: null })] });
    await pc.reschedule("c1", "a", { start_time: "20:00" });
    expect(zoomApi("PATCH")[0].body.recurrence).toEqual({ type: 2, repeat_interval: 1, weekly_days: "4", end_times: 50 });
    expect(zoomApi("PATCH")[0].body.start_time).toBe("2026-10-14T20:00:00");
  });

  it("never pulls a not-yet-started circle earlier", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ starts_on: "2026-11-04" })] });
    const r = await pc.reschedule("c1", "a", { weekday: 1 });
    expect(r.starts_on).toBe("2026-11-09");
  });

  it("the email opens with what changed, and Zoom and the email use the name the database renamed", async () => {
    freeze("2026-10-11T12:00:00Z");
    setup({ circles: [live({ name: "TG Circles | Tue | 5pm CT | Test Host", name_auto: false, weekday: 2, start_time: "17:00:00", timezone: "America/Chicago", join_url: "https://zoom.us/j/555" })] });
    db.triggers.circles = renameTrigger;
    const r = await pc.reschedule("c1", "a", { weekday: 6, start_time: "09:00" });
    expect(r.starts_on).toBe("2026-10-17");
    expect(zoomApi("PATCH")[0].body.topic).toBe("TG Circles | Sat | 9am CT | Test Host");
    expect(row().name).toBe("TG Circles | Sat | 9am CT | Test Host");
    const text = sent[0].text;
    expect(text).toContain([
      "WHAT CHANGED",
      "- Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)",
      "- First session at the new time: Saturday 17 October",
      "- Circle name: TG Circles | Tue | 5pm CT | Test Host to TG Circles | Sat | 9am CT | Test Host",
      "- Zoom link: the same as before, so nothing changes in your WhatsApp group.",
    ].join("\n"));
    expect(text.indexOf("WHAT CHANGED")).toBeLessThan(text.indexOf("YOUR CIRCLE"));
    expect(text).toContain("Circle name: TG Circles | Sat | 9am CT | Test Host\nMeeting day and time: Saturday at 09:00 (Chicago time)");
    expect(sent[0].html).toContain(">WHAT CHANGED</strong>- Day and time: Tuesday 17:00 to Saturday 09:00 (Chicago time)<br>");
  });

  it("a saved template without {{changes}} still opens with what changed", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    db.tables.email_templates.push({ key: "updated", subject: "Changed, {{first_name}}", body: "Dear {{first_name}},\n\nSome details of your Circle have changed.\n\nYOUR CIRCLE\nCircle name: {{circle_name}}" });
    await pc.reschedule("c1", "a", { start_time: "20:00" });
    expect(sent[0].text.startsWith("Dear Asha,\n\nWHAT CHANGED\n- Day and time: Wednesday 19:30 to Wednesday 20:00 (UK time)\n")).toBe(true);
  });

  it("an unchanged save does nothing (19:30 equals 19:30:00)", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    const r = await pc.reschedule("c1", "a", { start_time: "19:30", weekday: 3, name: "x" });
    expect(r).toEqual({ status: "live", unchanged: true, email: "not needed (nothing changed)" });
    expect(zoomCalls).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("Zoom refusing puts the old values back", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    zoomFail.push({ method: "PATCH", path: "/meetings/555" });
    await expect(pc.reschedule("c1", "a", { weekday: 5, start_time: "08:00" })).rejects.toThrow(/Zoom \/meetings\/555 failed/);
    expect(row()).toMatchObject({ weekday: 3, start_time: "19:30:00" });
  });

  it("Zoom refusing also puts back the exact old name of an imported circle", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ name: "TG Circles | Wed | 7.30pm UK | Test Host", name_auto: false })] });
    db.triggers.circles = renameTrigger;
    zoomFail.push({ method: "PATCH", path: "/meetings/555" });
    await expect(pc.reschedule("c1", "a", { weekday: 5 })).rejects.toThrow();
    expect(db.writes("circles").at(-1).payload).toMatchObject({ weekday: 3, name: "TG Circles | Wed | 7.30pm UK | Test Host" });
    expect(row()).toMatchObject({ weekday: 3, name: "TG Circles | Wed | 7.30pm UK | Test Host" });
    expect(sent).toHaveLength(0);
  });

  it("a licence clash becomes a plain message", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    db.failNext("circles", "update", "violates no_licence_clash");
    await expect(pc.reschedule("c1", "a", { weekday: 5 })).rejects.toThrow("Licence 01 already has 2 meetings at that time");
  });

  it("mock meetings skip Zoom, and only live circles can be rescheduled here", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ zoom_meeting_id: "MOCK1234567890" })] });
    await pc.reschedule("c1", "a", { weekday: 5 });
    expect(zoomCalls).toEqual([]);
    setup({ circles: [live({ status: "pending" })] });
    await expect(pc.reschedule("c1", "a", { weekday: 5 })).rejects.toThrow(/Only live circles/);
  });
});

describe("endOn and cancel", () => {
  const live = (over = {}) => circle({ status: "live", weekday: 4, zoom_meeting_id: "555", ...over });

  it("needs a valid date", async () => {
    setup({ circles: [live()] });
    await expect(pc.endOn("c1", "a", "14/12/2026")).rejects.toThrow("A valid end date is needed");
    await expect(pc.endOn("c1", "a", undefined)).rejects.toThrow("A valid end date is needed");
  });

  it("a future date patches the Zoom series end in the circle's zone", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()] });
    const r = await pc.endOn("c1", "a", "2026-11-26");
    expect(r).toEqual({ status: "live", ends_on: "2026-11-26" });
    expect(zoomApi("PATCH")[0]).toMatchObject({ path: "/meetings/555", body: { recurrence: { type: 2, repeat_interval: 1, weekly_days: "5", end_date_time: "2026-11-27T05:59:00Z" } } });
    expect(row().ends_on).toBe("2026-11-26");
  });

  it("today in the circle's own zone ends it now (LA still on Saturday after UK midnight)", async () => {
    freeze("2026-10-11T05:00:00Z");
    setup({ circles: [live({ timezone: "America/Los_Angeles" })] });
    expect(await pc.endOn("c1", "a", "2026-10-10")).toEqual({ status: "ended" });
    expect(zoomApi("DELETE")[0].path).toBe("/meetings/555");
    expect(row()).toMatchObject({ status: "ended", licence_id: null });
  });

  it("the UK date that is still tomorrow in LA only sets the end", async () => {
    freeze("2026-10-11T05:00:00Z");
    setup({ circles: [live({ timezone: "America/Los_Angeles" })] });
    expect(await pc.endOn("c1", "a", "2026-10-11")).toEqual({ status: "live", ends_on: "2026-10-11" });
    expect(zoomApi("PATCH")[0].body.recurrence.end_date_time).toBe("2026-10-12T06:59:00Z");
  });

  it("circles that are not live just get the date", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ status: "approved" })] });
    expect(await pc.endOn("c1", "a", "2026-11-26")).toEqual({ status: "approved", ends_on: "2026-11-26" });
    expect(zoomCalls).toEqual([]);
  });

  it("cancel tolerates a meeting already deleted in Zoom but not other errors", async () => {
    setup({ circles: [live()] });
    zoomFail.push({ method: "DELETE", path: "/meetings/555", status: 404 });
    expect(await pc.cancel("c1", "a")).toEqual({ status: "ended" });
    setup({ circles: [live()] });
    zoomFail = [{ method: "DELETE", path: "/meetings/555", status: 500 }];
    await expect(pc.cancel("c1", "a")).rejects.toThrow(/500/);
    expect(row().status).toBe("live");
  });

  it("cancel skips Zoom for mock meetings", async () => {
    setup({ circles: [live({ zoom_meeting_id: "MOCK0000000000" })] });
    await pc.cancel("c1", "a");
    expect(zoomCalls).toEqual([]);
  });
});

describe("moveLicence", () => {
  const live = (over = {}) => circle({ status: "live", weekday: 2, timezone: "America/Chicago", zoom_meeting_id: "555", starts_on: "2026-09-01", ends_on: "2026-12-15", ...over });
  const target = licence({ id: "lic-2", label: "Licence 02", zoom_user_email: "zoom2@example.org", host_key: "135790" });

  it("creates the meeting on the new licence, deletes the old one and emails the new link", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()], licences: [licence(), target] });
    const r = await pc.moveLicence("c1", "a", "lic-2");
    expect(r).toEqual({ licence: "Licence 02", join_url: nextMeeting.join_url, email: "sent" });
    const [post] = zoomApi("POST");
    expect(post.path).toBe("/users/zoom2%40example.org/meetings");
    expect(post.body).toMatchObject({ start_time: "2026-10-13T19:30:00", timezone: "America/Chicago", recurrence: { weekly_days: "3", end_date_time: "2026-12-16T05:59:00Z" } });
    expect(zoomApi("DELETE")[0].path).toBe("/meetings/555");
    expect(row()).toMatchObject({ licence_id: "lic-2", zoom_meeting_id: "987654321", starts_on: "2026-10-13" });
    expect(sent[0].text).toContain("Host key: 135790"); // the new licence's key
    expect(sent[0].subject).toContain("have changed");
  });

  it("the move email says the Zoom link and host key are new", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live({ join_url: "https://zoom.us/j/555" })], licences: [licence(), target] });
    await pc.moveLicence("c1", "a", "lic-2");
    expect(sent[0].text).toContain([
      "WHAT CHANGED",
      "- First session with the new link: Tuesday 13 October",
      "- Zoom link: new. The meeting link, meeting ID and passcode below have changed, so please share the new link in your WhatsApp group.",
      "- Host key: new, see below.",
    ].join("\n"));
    expect(sent[0].text).not.toContain("Day and time:");
  });

  it("Zoom refusing moves the circle back to its licence", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [live()], licences: [licence(), target] });
    zoomFail.push({ method: "POST", path: "/users/zoom2" });
    await expect(pc.moveLicence("c1", "a", "lic-2")).rejects.toThrow();
    expect(row().licence_id).toBe("lic-1");
    expect(zoomApi("DELETE")).toEqual([]);
  });

  it.each([
    ["missing", null, "Choose a licence to move to"],
    ["inactive", { active: false }, "Licence 02 is inactive"],
    ["no Zoom user", { zoom_user_email: null }, "Licence 02 has no Zoom user email set"],
  ])("refuses a %s target", async (_, over, msg) => {
    setup({ circles: [live()], licences: over ? [licence(), { ...target, ...over }] : [licence()] });
    await expect(pc.moveLicence("c1", "a", "lic-2")).rejects.toThrow(msg);
  });
});

describe("handover", () => {
  it("needs a valid email", async () => {
    setup();
    await expect(pc.handover("c1", "a", { email: "not-an-email" })).rejects.toThrow("A valid email for the new facilitator is needed");
  });
  it("creates the facilitator when new, and does not invite while not live", async () => {
    setup();
    const r = await pc.handover("c1", "a", { name: " Chitra Example ", email: " Chitra@Example.org " });
    expect(r).toEqual({ invite: "not needed yet (circle not live)", email: "" });
    const fac = db.tables.facilitators.find((f) => f.email === "chitra@example.org");
    expect(fac.name).toBe("Chitra Example");
    expect(row().facilitator_id).toBe(fac.id);
  });
});

describe("testEmail", () => {
  it("the details changed email shows example changes; the approval email none", async () => {
    freeze("2026-10-10T12:00:00Z");
    setup({ circles: [circle({ status: "live", weekday: 3, timezone: "Europe/London", starts_on: "2026-10-14", join_url: "https://zoom.us/j/1" })] });
    await pc.testEmail("c1", "admin@example.org", "updated");
    expect(sent[0].subject).toBe("[TEST] Your Think Gita Circle details have changed, Asha");
    expect(sent[0].text).toContain("WHAT CHANGED\n- Day and time: Tuesday 19:30 to Wednesday 19:30 (UK time)\n- First session at the new time: Wednesday 14 October\n- Zoom link: the same as before");
    await pc.testEmail("c1", "admin@example.org", "approved");
    expect(sent[1].text).not.toContain("WHAT CHANGED");
  });
});
