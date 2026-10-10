// Dashboard helpers in app/src/lib.js.
import { describe, it, expect, vi, afterEach } from "vitest";
import * as lib from "../../src/lib.js";

afterEach(() => vi.restoreAllMocks());
// supabase.functions is a getter that builds a new FunctionsClient each time, so spy on the shared prototype.
const invokeSpy = () => vi.spyOn(Object.getPrototypeOf(lib.supabase.functions), "invoke");
// ICU versions differ on "Thu 8 Oct 2026" vs "Thu, 8 Oct 2026"; expectations use fmtDate itself where dates are embedded.
const d = (iso) => lib.fmtDate(iso);

describe("time helpers", () => {
  it("hhmm", () => {
    expect(lib.hhmm("19:30:00")).toBe("19:30");
    expect(lib.hhmm("07:05")).toBe("07:05");
    expect(lib.hhmm(null)).toBe("");
    expect(lib.hhmm("")).toBe("");
  });
  it("toMin", () => {
    expect(lib.toMin("00:00")).toBe(0);
    expect(lib.toMin("19:30:00")).toBe(1170);
    expect(lib.toMin("23:59")).toBe(1439);
  });
  it("endTime wraps past midnight", () => {
    expect(lib.endTime("19:30:00", 60)).toBe("20:30");
    expect(lib.endTime("19:30", 75)).toBe("20:45");
    expect(lib.endTime("23:30", 60)).toBe("00:30");
    expect(lib.endTime("23:00", 120)).toBe("01:00");
    expect(lib.endTime("08:05", 0)).toBe("08:05");
  });
  it("tzName", () => {
    expect(lib.tzName("America/New_York")).toBe("New York");
    expect(lib.tzName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(lib.tzName("UTC")).toBe("UTC");
    expect(lib.tzName(null)).toBe("");
  });
});

describe("UK reference time", () => {
  const c = { weekday: 7, start_time: "19:30:00", ref_weekday: 1, ref_start_time: "01:30:00", duration_min: 60, timezone: "America/Chicago" };
  it("ukDay, ukStart, isUk", () => {
    expect(lib.ukDay(c)).toBe(1);
    expect(lib.ukStart(c)).toBe("01:30:00");
    expect(lib.ukDay({ weekday: 3 })).toBe(3);
    expect(lib.ukStart({ start_time: "10:00" })).toBe("10:00");
    expect(lib.isUk(c)).toBe(false);
    expect(lib.isUk({ timezone: "Europe/London" })).toBe(true);
    expect(lib.isUk({})).toBe(true);
  });
  it("ukWhen and localWhen", () => {
    expect(lib.ukWhen(c)).toBe("Mon 01:30–02:30");
    expect(lib.localWhen(c)).toBe("Sun 19:30 Chicago time");
    expect(lib.ukWhen({ weekday: 3, start_time: "23:30:00", duration_min: 60 })).toBe("Wed 23:30–00:30");
  });
});

describe("constants", () => {
  it("STATUS_LABEL covers every circle status in the database enum", () => {
    const enumValues = ["pending", "conflict", "approved", "live", "paused", "ended", "rejected"];
    expect(Object.keys(lib.STATUS_LABEL).sort()).toEqual([...enumValues].sort());
    for (const v of Object.values(lib.STATUS_LABEL)) expect(v).toBeTruthy();
  });
  it("DAYS and DAY_NAMES are Monday first, 1-based", () => {
    expect(lib.DAYS[1]).toBe("Mon");
    expect(lib.DAYS[7]).toBe("Sun");
    expect(lib.DAY_NAMES[1]).toBe("Monday");
    expect(lib.DAY_NAMES).toHaveLength(8);
  });
  it("every offered timezone is a valid IANA zone, with no duplicates", () => {
    expect(new Set(lib.TIMEZONES).size).toBe(lib.TIMEZONES.length);
    for (const tz of lib.TIMEZONES) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not.toThrow();
    expect(lib.TIMEZONES).toContain(lib.UK_TZ);
  });
  it("REQUEST_TYPES each have a label and fields", () => {
    for (const [k, v] of Object.entries(lib.REQUEST_TYPES)) {
      expect(v.label, k).toBeTruthy();
      expect(Array.isArray(v.fields)).toBe(true);
    }
  });
});

describe("fmtDate", () => {
  it("formats in a fixed way regardless of the local zone", () => {
    expect(lib.fmtDate("2026-10-08")).toMatch(/^Thu,? 8 Oct 2026$/);
    expect(lib.fmtDate("2026-03-29")).toMatch(/^Sun,? 29 Mar 2026$/);
    expect(lib.fmtDate("2026-01-01")).toMatch(/^Thu,? 1 Jan 2026$/);
    expect(lib.fmtDate("")).toBe("");
    expect(lib.fmtDate(null)).toBe("");
  });
});

describe("circleMessage", () => {
  const c = { name: "Gita Circle A", weekday: 3, start_time: "19:30:00", duration_min: 75, timezone: "Europe/London", starts_on: "2026-10-14", ends_on: "2026-12-16", join_url: "https://zoom.us/j/1", zoom_meeting_id: "123 456", passcode: "pw" };
  it("facilitator version includes the host key", () => {
    expect(lib.circleMessage(c, "246810")).toBe([
      "*Gita Circle A*", "Every Wednesday, 19:30–20:45 (London time)", `From ${d("2026-10-14")} to ${d("2026-12-16")}`, "",
      "Join Zoom: https://zoom.us/j/1", "Meeting ID: 123 456", "Passcode: pw", "",
      "Host key: 246810 (private: for you only, don't share it)", "To host: join, open Participants, choose Claim host and enter the host key.",
    ].join("\n"));
  });
  it("participants version leaves out the host key", () => {
    const m = lib.circleMessage(c, "246810", { forFacilitator: false });
    expect(m).not.toContain("246810");
    expect(m).not.toContain("Host key");
    expect(m.endsWith("Passcode: pw")).toBe(true);
  });
  it("missing join link, dates and Zoom details", () => {
    const m = lib.circleMessage({ ...c, join_url: null, zoom_meeting_id: null, passcode: null, starts_on: null }, undefined);
    expect(m).toContain("Join link: to follow");
    expect(m).not.toContain("From ");
    expect(m).not.toContain("Meeting ID");
    expect(m).not.toContain("undefined");
    expect(m).not.toContain("false");
    expect(m).toContain("Host key: ask the ThinkGita team");
  });
  it("start without end", () => {
    expect(lib.circleMessage({ ...c, ends_on: null }, null)).toContain(`From ${d("2026-10-14")}\n`);
  });
});

describe("requestSummary", () => {
  it.each([
    ["change_time", { weekday: 2, start_time: "18:00:00", from: "2026-11-03" }, `Move to Tuesdays at 18:00 from ${d("2026-11-03")}`],
    ["change_time", {}, "Move to ?s at ?"],
    ["change_start", { from: "2026-11-03" }, `Start on ${d("2026-11-03")}`],
    ["change_start", {}, "Start on ?"],
    ["pause", { from: "2026-11-03", until: "2026-11-24" }, `Pause from ${d("2026-11-03")} until ${d("2026-11-24")}`],
    ["pause", {}, "Pause from ? until ?"],
    ["handover", { name: "Bela", email: "bela@example.org" }, "Hand over to Bela (bela@example.org)"],
    ["handover", { email: "bela@example.org" }, "Hand over to bela@example.org"],
    ["handover", { name: "Bela" }, "Hand over to Bela"],
    ["handover", {}, "Hand over to ?"],
    ["stop", { from: "2026-12-01" }, `Stop the circle from ${d("2026-12-01")}`],
    ["stop", {}, "Stop the circle"],
    ["other", {}, "Other request"],
    ["mystery", undefined, "Other request"],
  ])("%s %j", (type, d, want) => expect(lib.requestSummary(type, d)).toBe(want));
});

describe("edge function calls (no network)", () => {
  it("adminAction sends action, circle and extras, and returns data", async () => {
    const spy = invokeSpy().mockResolvedValue({ data: { ok: 1 }, error: null });
    expect(await lib.adminAction("end_on", "c1", { date: "2026-12-01" })).toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledWith("provision-circle", { body: { action: "end_on", circle_id: "c1", date: "2026-12-01" } });
  });
  it("adminAction surfaces the function's own error message", async () => {
    invokeSpy().mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Circle has no licence assigned" }) } } });
    await expect(lib.adminAction("provision", "c1")).rejects.toThrow("Circle has no licence assigned");
  });
  it("adminAction keeps the generic message when the body is unreadable", async () => {
    invokeSpy().mockResolvedValue({ data: null, error: { message: "Failed to send", context: { json: async () => { throw new Error("no body"); } } } });
    await expect(lib.adminAction("provision", "c1")).rejects.toThrow("Failed to send");
  });
  it.each([
    [() => lib.websiteSync(), { action: "sync", all: false }],
    [() => lib.websiteSync(true), { action: "sync", all: true }],
    [() => lib.websitePublish(), { action: "publish" }],
    [() => lib.websiteSnapshot(), { action: "snapshot" }],
    [() => lib.websitePreview(), { action: "preview" }],
    [() => lib.websiteSetItem("it-1", { draft: false, order: 2 }), { action: "set_item", id: "it-1", draft: false, order: 2 }],
  ])("framer-sync call %#", async (call, body) => {
    const spy = invokeSpy().mockResolvedValue({ data: "ok", error: null });
    expect(await call()).toBe("ok");
    expect(spy).toHaveBeenCalledWith("framer-sync", { body });
  });
  it("framer-sync errors use the function's message", async () => {
    invokeSpy().mockResolvedValue({ data: null, error: { message: "x", context: { json: async () => ({ error: "Admins only" }) } } });
    await expect(lib.websitePublish()).rejects.toThrow("Admins only");
  });
});
