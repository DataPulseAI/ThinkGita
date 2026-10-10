// app/src/Admin.jsx pure helpers (exposed for tests by the vitest config plugin).
import { describe, it, expect, afterEach, vi } from "vitest";
import * as A from "../../src/Admin.jsx";
import * as WP from "../../src/WebsitePage.jsx";
import * as lib from "../../src/lib.js";
import { DEFAULT_TEMPLATES } from "../../src/emailTemplate.js";
import { freeze, readyCircle, person } from "./helpers/circles.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("blockName", () => {
  it.each([
    ["Gita Circles | Anjali | Monday 19:30 (UK)", "Anjali"],
    ["Gita Circles | Asha & Ravi | Wednesday 07:05 (New York)", "Asha & Ravi"],
    ["TG Circles | Mon | 7.30pm UK | Anjali", "TG Circles | Mon | 7.30pm UK | Anjali"],
    ["Gita Circles | Bela", "Bela"],
    [null, ""],
  ])("%s -> %s", (n, want) => expect(A.blockName(n)).toBe(want));
});

describe("licence sharing", () => {
  const c = (id, day, start, over = {}) => ({ id, ref_weekday: day, ref_start_time: start, duration_min: 60, licence_id: "L1", status: "live", ...over });

  it("circleRanges from UK day and time, with buffer, wrapping the week", () => {
    expect(A.circleRanges(c("a", 1, "19:30:00"))).toEqual([[1170, 1230]]);
    expect(A.circleRanges(c("a", 1, "19:30:00"), 15)).toEqual([[1170, 1245]]);
    expect(A.circleRanges(c("a", 7, "23:30"), 0)).toEqual([[10050, 10080], [0, 30]]);
    expect(A.circleRanges({ weekday: 3, start_time: "10:00", duration_min: 30 })).toEqual([[3480, 3510]]);
  });
  it("circleRanges prefers stored slots", () => {
    expect(A.circleRanges({ slots: "{[1170,1245),[1230,1305)}", ref_weekday: 5, ref_start_time: "00:00", duration_min: 60 }, 99)).toEqual([[1170, 1245], [1230, 1305]]);
  });
  it("rangesOverlap treats touching ranges as separate", () => {
    expect(A.rangesOverlap([[0, 60]], [[60, 120]])).toBe(false);
    expect(A.rangesOverlap([[0, 61]], [[60, 120]])).toBe(true);
    expect(A.rangesOverlap([[0, 10], [100, 200]], [[150, 160]])).toBe(true);
    expect(A.rangesOverlap([], [[0, 1]])).toBe(false);
  });
  it("peakAtOnce counts the busiest moment, back-to-back is not overlap", () => {
    const list = [c("a", 1, "19:00"), c("b", 1, "19:30"), c("c", 1, "20:00"), c("d", 1, "19:45")];
    expect(A.peakAtOnce(list, 0)).toBe(3); // b, c, d at 20:00 to 20:30
    expect(A.peakAtOnce([c("a", 1, "19:00"), c("b", 1, "20:00")], 0)).toBe(1);
    expect(A.peakAtOnce([c("a", 1, "19:00"), c("b", 1, "20:00")], 15)).toBe(2);
    expect(A.peakAtOnce(list, 0, 1140, 1170)).toBe(1); // only 19:00 to 19:30
    expect(A.peakAtOnce([], 0)).toBe(0);
  });
  it("sharers: same licence, holding statuses, overlapping, not itself", () => {
    const me = c("me", 2, "18:00");
    const all = [me, c("x", 2, "18:30"), c("y", 2, "18:30", { status: "ended" }), c("z", 2, "18:30", { licence_id: "L2" }), c("w", 2, "19:00"), c("p", 2, "18:45", { status: "pending" })];
    expect(A.sharers(me, all, 0).map((o) => o.id)).toEqual(["x", "p"]);
    expect(A.sharers(me, all, 0, "L2").map((o) => o.id)).toEqual(["z"]);
    expect(A.sharers({ ...me, licence_id: null }, all, 0)).toEqual([]);
    expect(A.sharers(null, all, 0)).toEqual([]);
  });
  it("atOnceWith counts itself plus the busiest overlap among sharers", () => {
    const me = c("me", 3, "18:00");
    expect(A.atOnceWith(me, [me], 0)).toBe(1);
    // x and y both overlap me but not each other.
    expect(A.atOnceWith(me, [me, c("x", 3, "17:30"), c("y", 3, "18:30")], 0)).toBe(2);
    // x and y overlap each other inside my time.
    expect(A.atOnceWith(me, [me, c("x", 3, "18:10"), c("y", 3, "18:20")], 0)).toBe(3);
    expect(A.atOnceWith(me, [me, c("x", 3, "18:10", { licence_id: "L2" })], 0, "L2")).toBe(2);
  });
  it("sharedDays lists days with two or more at once", () => {
    const list = [c("a", 1, "19:00"), c("b", 1, "19:30"), c("c", 4, "10:00"), c("d", 4, "11:00"), c("e", 6, "09:00", { licence_id: "L2" }), c("f", 6, "09:00"), c("g", 6, "09:00", { status: "ended" })];
    expect(A.sharedDays("L1", list, 0)).toEqual([{ d: 1, peak: 2 }]);
    expect(A.sharedDays("L1", list, 15)).toEqual([{ d: 1, peak: 2 }, { d: 4, peak: 2 }]);
  });
});

describe("website state", () => {
  const at = () => freeze("2026-10-10T12:00:00Z");
  it("websiteBlock", () => {
    at();
    expect(A.websiteBlock(readyCircle({ status: "ended" }))).toBe("Ended and rejected circles can't be listed");
    expect(A.websiteBlock(readyCircle({ status: "rejected" }))).toBe("Ended and rejected circles can't be listed");
    expect(A.websiteBlock(readyCircle({ status: "conflict" }))).toBe("Needs a licence before it can be listed");
    expect(A.websiteBlock(readyCircle({ status: "paused" }))).toBe("Paused circles aren't listed");
    expect(A.websiteBlock(readyCircle({ is_demo: true }))).toBe("Test circles are never listed");
    expect(A.websiteBlock(readyCircle({ name: "Test circle" }))).toBe("Test circles are never listed");
    expect(A.websiteBlock(readyCircle({ licence: { is_mock: true } }))).toBe("Test circles are never listed");
    expect(A.websiteBlock(readyCircle({ whatsapp_group_link: null, website_order: null }))).toBe("Not ready for the website. Needs: WhatsApp group link, website order");
    expect(A.websiteBlock(readyCircle())).toBeNull();
  });
  it("webState", () => {
    at();
    expect(A.webState(readyCircle())).toBe("on");
    expect(A.webState(readyCircle({ website_order: null }))).toBe("waiting");
    expect(A.webState(readyCircle({ website_visible: false }))).toBe("ready");
    expect(A.webState(readyCircle({ website_visible: false, website_order: null }))).toBe("notready");
    for (const status of ["ended", "rejected", "paused", "conflict"]) expect(A.webState(readyCircle({ status }))).toBe("never");
    expect(A.webState(readyCircle({ is_demo: true }))).toBe("never");
    for (const k of ["on", "waiting", "ready", "notready", "never"]) expect(A.WEB_STATES[k].label).toBeTruthy();
  });
  it("webState and websiteBlock agree with framer-sync on what can be shown", async () => {
    at();
    const fs = await import("../../../supabase/functions/framer-sync/index.ts");
    const variants = [{}, { status: "pending", starts_on: null }, { status: "approved" }, { whatsapp_group_link: null }, { status: "paused" }, { is_demo: true }, { status: "ended" }];
    for (const v of variants) {
      const c = readyCircle(v);
      expect(A.websiteBlock(c) === null, JSON.stringify(v)).toBe(fs.wantsShown({ ...c, website_visible: true }) && fs.websiteMissing(c).length === 0);
    }
  });
});

describe("activity log", () => {
  const circles = [{ id: "c1", name: "Circle A" }];
  const licences = [{ id: "lic-1", label: "Licence 01" }];
  const sum = (action, detail, circle_id = "c1") => A.activitySummary({ action, detail, circle_id }, circles, licences);

  it("circle_edited lists each change readably", () => {
    expect(sum("circle_edited", { changes: {
      start_time: { from: "19:30:00", to: "20:00:00" }, licence_id: { from: "lic-1", to: null }, website_visible: { from: false, to: true },
      facilitator_id: { from: "a", to: "b" }, website_name: { from: "", to: "Isvara" }, mystery_field: { from: 1, to: 2 },
    } })).toBe("Circle A: start time 19:30 → 20:00; licence Licence 01 → none; website hidden → shown; facilitator changed; website name empty → Isvara; mystery_field 1 → 2");
  });
  it("long values are cut to 40 characters", () => {
    expect(sum("circle_edited", { changes: { notes: { from: null, to: "x".repeat(60) } } })).toBe(`Circle A: notes empty → ${"x".repeat(40)}`);
  });
  it("framer_sync", () => {
    expect(sum("framer_sync", { created: 1, updated: 2, hidden: 0, published: true, errors: [] })).toBe("1 added, 2 updated, published");
    expect(sum("framer_sync", { hidden: 1, published: "not published yet (busy); it will retry automatically" })).toBe("1 hidden, not published yet (busy); it will retry automatically");
    expect(sum("framer_sync", { failed: "Invalid key" })).toBe("Failed: Invalid key");
    expect(sum("framer_sync", { errors: ["a", "b"] })).toBe("2 errors");
    expect(sum("framer_sync", { created: 0, updated: 0 })).toBe("No changes");
  });
  it("framer_item and framer_publish", () => {
    expect(sum("framer_item", { draft: false, order: 3, published: true })).toBe("shown, order set to 3, published");
    expect(sum("framer_item", { draft: true, order: null })).toBe("hidden, order set to none");
    expect(sum("framer_item", {})).toBe("Hand-made listing changed");
    expect(sum("framer_publish", { published: true })).toBe("Published");
    expect(sum("framer_publish", { published: "not published yet (x)" })).toBe("not published yet (x)");
  });
  it("other actions", () => {
    expect(sum("circle_created", { source: "tally" })).toBe("Circle A (tally)");
    expect(sum("circle_deleted", { name: "Old", status: "pending" })).toBe("Old, was Awaiting approval");
    expect(sum("circle_deleted", { status: "weird" }, "gone")).toBe("Circle, was weird");
    expect(sum("cancel", { meeting_id: "555" })).toBe("Circle A, Zoom meeting 555 removed");
    expect(sum("provision", {})).toBe("Circle A");
    expect(sum("sync_licences", { licensed: 2 }, null)).toBe('{"licensed":2}');
    expect(sum("sync_licences", {}, null)).toBe("");
    expect(A.activitySummary({ action: "x", circle_id: null }, circles, licences)).toBe("");
  });
  it("quietSync hides website updates that changed nothing visible", () => {
    const q = (detail) => A.quietSync({ action: "framer_sync", detail });
    expect(q({ updated: 2, published: false, errors: [] })).toBe(true);
    expect(q({ created: 1 })).toBe(false);
    expect(q({ hidden: 1 })).toBe(false);
    expect(q({ published: true })).toBe(false);
    expect(q({ published: "not yet" })).toBe(false);
    expect(q({ errors: ["x"] })).toBe(false);
    expect(q({ failed: "x" })).toBe(false);
    expect(A.quietSync({ action: "provision", detail: {} })).toBe(false);
  });
  it("every activity group matches its actions", () => {
    expect(A.ACTIVITY_GROUPS.website.match("framer_sync")).toBe(true);
    expect(A.ACTIVITY_GROUPS.circles.match("reschedule")).toBe(true);
    expect(A.ACTIVITY_GROUPS.circles.match("intake")).toBe(true);
    expect(A.ACTIVITY_GROUPS.zoom.match("sync_attendance")).toBe(true);
    expect(A.ACTIVITY_GROUPS.zoom.match("framer_sync")).toBe(false);
  });
});

describe("toast and email helpers", () => {
  it("emailNote", () => {
    expect(A.emailNote("sent", "a@example.org")).toBe(" Email sent to a@example.org.");
    expect(A.emailNote("sent")).toBe(" Email sent.");
    expect(A.emailNote("skipped (no facilitator)")).toBe(" Email not sent: no facilitator.");
    expect(A.emailNote("failed: SMTP down")).toBe(" Email failed: SMTP down. See Setup, Sent emails.");
    expect(A.emailNote("1 of 2 sent; failed: x")).toBe(" Email failed: 1 of 2 sent; failed: x. See Setup, Sent emails.");
    expect(A.emailNote("not needed (nothing changed)")).toBe("");
    expect(A.emailNote("not sent (approved without email)")).toContain("No email sent, as chosen.");
    expect(A.emailNote(undefined)).toBe("");
  });
  it("emailFailed and withEmail", () => {
    expect(A.emailFailed("sent")).toBe(false);
    expect(A.emailFailed("")).toBe(false);
    expect(A.emailFailed("not needed (x)")).toBe(false);
    expect(A.emailFailed("not sent (approved without email)")).toBe(false);
    expect(A.emailFailed("skipped (no facilitator)")).toBe(true);
    expect(A.emailFailed("failed: x")).toBe(true);
    expect(A.withEmail("Approved.", "failed: x", "a@example.org")).toEqual({ text: "Approved. Email failed: x. See Setup, Sent emails.", warn: true });
    expect(A.withEmail("Approved.", "sent", "a@example.org")).toEqual({ text: "Approved. Email sent to a@example.org.", warn: false });
  });
  it("coFacs and teamTo", () => {
    const c = { facilitator: person(), cofacilitators: [{ facilitator: person({ email: "b@example.org" }) }, { facilitator: null }] };
    expect(A.coFacs(c)).toHaveLength(1);
    expect(A.teamTo(c)).toBe("asha@example.org and 1 co-facilitator");
    expect(A.teamTo({ ...c, cofacilitators: [...c.cofacilitators, { facilitator: person() }] })).toBe("asha@example.org and 2 co-facilitators");
    expect(A.teamTo({ facilitator: person() })).toBe("asha@example.org");
    expect(A.teamTo({ facilitator: null })).toBeUndefined();
    expect(A.coFacs(null)).toEqual([]);
  });
  it("friendlyError", () => {
    expect(A.friendlyError(new Error("violates no_licence_clash"))).toMatch(/already has 2 meetings/);
    expect(A.friendlyError({ message: "violates check term_order" })).toBe("The term end date must be after the term start date.");
    expect(A.friendlyError("plain")).toBe("plain");
  });
  it("emailGaps lists blank approval email values, ignoring those filled on approval", () => {
    const data = { templates: { approved: DEFAULT_TEMPLATES.approved }, licences: [], settings: {}, me: { name: "Admin" } };
    const c = { name: "C", weekday: 3, start_time: "19:30", timezone: "Europe/London", facilitator: person(), licence_id: null };
    expect(A.emailGaps(c, data).sort()).toEqual(["drive_folder_link", "host_key", "support_contact", "whatsapp_group_link", "youtube_playlist_link"]);
    const full = { ...data, licences: [{ id: "L1", host_key: "123456" }], settings: { drive_folder_link: "https://d.example.org", youtube_playlist_link: "https://y.example.org", support_contact: "help@example.org" } };
    expect(A.emailGaps({ ...c, licence_id: "L1", whatsapp_group_link: "https://chat.whatsapp.com/A" }, full)).toEqual([]);
  });
  it("facilitatorPatch", () => {
    const fac = { name: "Asha Example" };
    expect(A.facilitatorPatch(fac, { phone: "", facilitator_name: "Asha Example" }, "a@example.org")).toEqual({ phone: null });
    expect(A.facilitatorPatch(fac, { phone: "+44 1", facilitator_name: " Asha E. " }, "a@example.org")).toEqual({ phone: "+44 1", name: "Asha E.", first_name: null, last_name: null, initiated_name: null });
    expect(A.facilitatorPatch({ name: "" }, { facilitator_name: "" }, "a@example.org")).toEqual({ phone: null, name: "a@example.org" });
    expect(A.facilitatorPatch(null, { facilitator_name: "" }, "a@example.org")).toEqual({ phone: null, name: "a@example.org" });
    expect(A.facilitatorPatch(fac, { facilitator_name: "" }, "a@example.org")).toEqual({ phone: null });
  });
});

describe("dates and formatting", () => {
  it("ukToday, ukDate and fmtStamp use UK time in summer and winter", () => {
    freeze("2026-07-01T23:30:00Z");
    expect(A.ukToday()).toBe("2026-07-02");
    expect(A.ukDate("2026-07-01T23:30:00Z")).toBe("2026-07-02");
    expect(A.ukDate("2026-01-01T23:30:00Z")).toBe("2026-01-01");
    expect(A.fmtStamp("2026-10-07T20:44:00Z")).toContain("21:44");
    expect(A.fmtStamp("2026-01-07T20:44:00Z")).toContain("20:44");
    expect(A.fmtStamp(null)).toBe("");
  });
  it("ago", () => {
    freeze("2026-10-10T12:00:00Z");
    expect(A.ago("2026-10-10T11:59:40Z")).toBe("just now");
    expect(A.ago("2026-10-10T11:55:00Z")).toBe("5 min ago");
    expect(A.ago("2026-10-10T11:00:00Z")).toBe("1 hour ago");
    expect(A.ago("2026-10-10T09:00:00Z")).toBe("3 hours ago");
    expect(A.ago("2026-10-09T12:00:00Z")).toBe("1 day ago");
    expect(A.ago("2026-10-06T12:00:00Z")).toBe("4 days ago");
  });
  it("csvCell quotes only when needed", () => {
    expect(A.csvCell(null)).toBe("");
    expect(A.csvCell(5)).toBe("5");
    expect(A.csvCell("plain")).toBe("plain");
    expect(A.csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(A.csvCell("two\nlines")).toBe('"two\nlines"');
  });
  it("pct", () => {
    expect(A.pct(1, 3)).toBe(33);
    expect(A.pct(2, 3)).toBe(67);
    expect(A.pct(1, 0)).toBeNull();
  });
  it("weekStart is local Monday midnight", () => {
    const sun = new Date(2026, 9, 11, 15, 0).toISOString();
    const w = A.weekStart(sun);
    expect([w.getFullYear(), w.getMonth(), w.getDate(), w.getHours(), w.getDay()]).toEqual([2026, 9, 5, 0, 1]);
    const mon = A.weekStart(new Date(2026, 9, 12, 0, 30).toISOString());
    expect(mon.getDate()).toBe(12);
    expect(A.weekKey(sun)).toBe(w.getTime());
  });
  it("monthLabels: one label per new month, at least 3 columns apart", () => {
    const weeks = [0, 7, 14, 21, 28, 35, 42, 49].map((d) => new Date(2026, 8, 28 + d)); // from Mon 28 Sep
    const labels = A.monthLabels(weeks);
    const at = labels.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
    expect(at[0]).toBe(0);
    expect(at).toContain(5); // November starts at index 5
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(3);
    expect(labels[1]).toBe(""); // October starts at index 1, too close to the first label
  });
  it("readRoute reads the page from the hash", () => {
    location.hash = "#/Attendance/abc%20d";
    expect(A.readRoute()).toEqual({ tab: "Attendance", sub: "abc d" });
    location.hash = "#/Circles";
    expect(A.readRoute()).toEqual({ tab: "Circles", sub: null });
    location.hash = "#/Nope";
    expect(A.readRoute()).toEqual({ tab: "Overview", sub: null });
    location.hash = "#access_token=abc";
    expect(A.readRoute()).toEqual({ tab: "Overview", sub: null });
    location.hash = "";
  });
});

describe("requests", () => {
  const at = () => freeze("2026-10-10T12:00:00Z");
  const r = (request_type, details) => ({ request_type, details });
  it("blockedReason", () => {
    at();
    const live = { status: "live", starts_on: "2026-09-01" };
    expect(A.blockedReason(r("change_time", {}), null)).toBe("Circle not found");
    expect(A.blockedReason(r("change_time", {}), { status: "ended" })).toBe("Circle has ended");
    expect(A.blockedReason(r("change_time", { weekday: 2 }), live)).toBe("Request is missing the day or time");
    expect(A.blockedReason(r("change_time", { weekday: 2, start_time: "18:00", from: "2026-10-20" }), live)).toMatch(/^Due on .*20 Oct 2026: apply on or after that date$/);
    expect(A.blockedReason(r("change_time", { weekday: 2, start_time: "18:00", from: "2026-10-10" }), live)).toBeNull();
    expect(A.blockedReason(r("change_time", { weekday: 2, start_time: "18:00", from: "2026-10-20" }), { status: "pending" })).toBeNull();
    expect(A.blockedReason(r("change_start", {}), live)).toBe("Request is missing the date");
    expect(A.blockedReason(r("change_start", { from: "2026-11-01" }), live)).toBe("Already running, so the start date can't change");
    expect(A.blockedReason(r("change_start", { from: "2026-11-01" }), { status: "live", starts_on: "2026-10-20" })).toBeNull();
    expect(A.blockedReason(r("handover", { name: "B" }), live)).toBe("Request is missing the new facilitator's email");
    expect(A.blockedReason(r("stop", {}), live)).toBeNull();
    expect(A.blockedReason({ request_type: "other" }, live)).toBeNull();
  });
  it("blockedReason judges 'today' by the UK date", () => {
    freeze("2026-10-10T23:30:00Z"); // UK: 11 Oct
    expect(A.blockedReason(r("change_time", { weekday: 2, start_time: "18:00", from: "2026-10-11" }), { status: "live" })).toBeNull();
  });
  it("APPLY confirm texts", () => {
    at();
    const c = { name: "Circle A", status: "live" };
    expect(A.APPLY.stop.confirm(r("stop", { from: "2026-11-01" }), c)).toMatch(/^Make .*1 Nov 2026 the last date for "Circle A"\? Sessions continue until then\.$/);
    expect(A.APPLY.stop.confirm(r("stop", { from: "2026-10-10" }), c)).toBe('End "Circle A" now? This deletes its Zoom meeting.');
    expect(A.APPLY.stop.confirm(r("stop", {}), { ...c, status: "pending" })).toBe('End "Circle A" now?');
    expect(A.APPLY.change_time.confirm(r("change_time", { weekday: 2, start_time: "18:00:00" }), c)).toBe('Move "Circle A" to Tuesdays at 18:00? The Zoom link stays the same.');
    expect(A.APPLY.handover.confirm(r("handover", { email: "b@example.org" }), { ...c, status: "pending" })).toBe('Hand "Circle A" over to b@example.org?');
  });

  describe("applyRequest (Supabase calls mocked)", () => {
    const invoke = () => vi.spyOn(Object.getPrototypeOf(lib.supabase.functions), "invoke").mockResolvedValue({ data: { ok: true }, error: null });
    function fakeFrom() {
      const writes = [];
      vi.spyOn(lib.supabase, "from").mockImplementation((table) => ({ update: (patch) => ({ eq: async (k, v) => { writes.push({ table, patch, k, v }); return { error: null }; } }) }));
      return writes;
    }
    it("live change_time reschedules through the edge function", async () => {
      const spy = invoke();
      await A.applyRequest(r("change_time", { weekday: "2", start_time: "18:00" }), { id: "c1", status: "live" });
      expect(spy).toHaveBeenCalledWith("provision-circle", { body: { action: "reschedule", circle_id: "c1", patch: { weekday: 2, start_time: "18:00" } } });
    });
    it("not-live change_time releases the licence and re-allocates", async () => {
      const writes = fakeFrom();
      const rpc = vi.spyOn(lib.supabase, "rpc").mockResolvedValue({ data: [{ status: "conflict" }], error: null });
      const out = await A.applyRequest(r("change_time", { weekday: 4, start_time: "07:00", from: "2026-11-02" }), { id: "c1", status: "approved" });
      expect(writes).toEqual([{ table: "circles", patch: { weekday: 4, start_time: "07:00", preferred_start: "2026-11-02", licence_id: null, status: "pending", conflict_reason: null }, k: "id", v: "c1" }]);
      expect(rpc).toHaveBeenCalledWith("allocate_circle", { p_circle: "c1" });
      expect(out).toEqual({ conflict: true });
      rpc.mockResolvedValue({ data: { status: "approved" }, error: null });
      expect(await A.applyRequest(r("change_time", { weekday: 4, start_time: "07:00" }), { id: "c1", status: "pending" })).toBeUndefined();
    });
    it("change_start: live goes through reschedule, others update directly", async () => {
      const spy = invoke();
      await A.applyRequest(r("change_start", { from: "2026-11-02" }), { id: "c1", status: "live" });
      expect(spy.mock.calls[0][1].body).toEqual({ action: "reschedule", circle_id: "c1", patch: { preferred_start: "2026-11-02" } });
      const writes = fakeFrom();
      await A.applyRequest(r("change_start", { from: "2026-11-02" }), { id: "c1", status: "pending" });
      expect(writes[0].patch).toEqual({ preferred_start: "2026-11-02" });
    });
    it("handover and stop", async () => {
      freeze("2026-10-10T23:30:00Z"); // UK 11 Oct
      const spy = invoke();
      await A.applyRequest(r("handover", { name: "Bela", email: "b@example.org" }), { id: "c1", status: "live" });
      await A.applyRequest(r("stop", {}), { id: "c1", status: "live" });
      await A.applyRequest(r("stop", { from: "2026-12-01" }), { id: "c1", status: "live" });
      expect(spy.mock.calls.map((x) => x[1].body)).toEqual([
        { action: "handover", circle_id: "c1", facilitator: { name: "Bela", email: "b@example.org" } },
        { action: "end_on", circle_id: "c1", date: "2026-10-11" },
        { action: "end_on", circle_id: "c1", date: "2026-12-01" },
      ]);
    });
    it("a database error is thrown", async () => {
      vi.spyOn(lib.supabase, "from").mockImplementation(() => ({ update: () => ({ eq: async () => ({ error: new Error("denied") }) }) }));
      await expect(A.applyRequest(r("change_start", { from: "2026-11-02" }), { id: "c1", status: "pending" })).rejects.toThrow("denied");
    });
  });
});

describe("attendance", () => {
  it.each([
    ["Priya's iPhone", "priya"], ["Asha Example (she/her)", "asha example"], ["🙏 Ravi 🙏", "ravi"], ["[Host] Bela", "bela"],
    ["Asha’s MacBook Pro", "asha"], ["  CHITRA   Example ", "chitra example"], ["Samsung Galaxy S21", "samsung galaxy s21"],
    ["Zoom user", "zoom user"], ["Dev's Galaxy S21 Ultra", "dev"], ["José", "josé"],
  ])("personName %s -> %s", (raw, want) => expect(A.personName(raw)).toBe(want));

  it("cleanAttendance drops hosts, merges duplicates in a session and recounts", () => {
    const licences = [{ zoom_user_email: "Zoom1@Example.org", label: "Licence 01" }];
    const sessions = [{ id: "s1" }, { id: "s2" }];
    const rows = [
      { session_id: "s1", name: "Licence 01", minutes: 60 },
      { session_id: "s1", name: "Host", email: "zoom1@example.org", minutes: 60 },
      { session_id: "s1", name: "Priya's iPhone", minutes: 20 },
      { session_id: "s1", name: "Priya", minutes: 30 },
      { session_id: "s1", name: "Ravi", email: "Ravi@Example.org", minutes: 50 },
      { session_id: "s2", name: "priya", minutes: 40 },
    ];
    const out = A.cleanAttendance(sessions, rows, licences);
    expect(out.sessions).toEqual([{ id: "s1", participant_count: 2 }, { id: "s2", participant_count: 1 }]);
    const priya = out.rows.find((x) => x.session_id === "s1" && x.person_key === "priya");
    expect(priya.minutes).toBe(50);
    expect(out.rows.find((x) => x.person_key === "ravi@example.org").email).toBe("ravi@example.org");
    expect(A.cleanAttendance()).toEqual({ sessions: [], rows: [] });
  });

  it("buildCircle orders sessions and flags people who dropped off", () => {
    const sessions = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].reverse().map((d, i) => ({ id: `s${d}`, started_at: `${d}T18:00:00Z`, i }));
    const rows = new Map();
    const add = (d, key, name, minutes = 60) => rows.set(`s${d}`, [...(rows.get(`s${d}`) ?? []), { person_key: key, name, email: null, minutes }]);
    for (const d of ["2026-09-07", "2026-09-14", "2026-09-21"]) add(d, "asha", "Asha");
    for (const d of ["2026-09-07", "2026-10-05", "2026-10-12"]) add(d, "ravi", d === "2026-09-07" ? null : "Ravi");
    add("2026-09-07", "bela", "Bela");
    const { sessions: ordered, people } = A.buildCircle(sessions, rows);
    expect(ordered.map((s) => s.started_at.slice(0, 10))).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
    const by = Object.fromEntries(people.map((p) => [p.key, p]));
    expect(by.asha).toMatchObject({ count: 3, missedSince: 3, drifting: true, lastSeen: "2026-09-21T18:00:00Z" });
    expect(by.ravi).toMatchObject({ count: 3, missedSince: 0, drifting: false, name: "Ravi" });
    expect(by.bela).toMatchObject({ count: 1, missedSince: 5, drifting: false });
    expect(people.map((p) => p.key)).toEqual(["asha", "ravi", "bela"]);
  });
});

describe("WebsitePage helpers", () => {
  it("num", () => {
    expect(WP.num("")).toBeNull();
    expect(WP.num(" ")).toBeNull();
    expect(WP.num(null)).toBeNull();
    expect(WP.num("3")).toBe(3);
    expect(WP.num(0)).toBe(0);
  });
  it("byOrder sorts by order then title, unordered last", () => {
    const xs = [{ order: "", title: "B" }, { order: "2", title: "Z" }, { order: null, title: "A" }, { order: "1", title: "Y" }, { order: "2", title: "M" }];
    expect(xs.sort(WP.byOrder).map((x) => x.title)).toEqual(["Y", "M", "Z", "A", "B"]);
  });
  it("isCircleListing", () => {
    expect(WP.isCircleListing({ all: { MainTitle: "Gita Circulos (Espanol)" } })).toBe(true);
    expect(WP.isCircleListing({ all: { MainTitle: "Morning Japa (English)" } })).toBe(true);
    expect(WP.isCircleListing({ all: { MainTitle: "Retreat 2026" } })).toBe(false);
    expect(WP.isCircleListing({})).toBe(false);
  });
});
