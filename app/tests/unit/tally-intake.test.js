// tally-intake: field parsers, timezone mapping and the webhook handler (signature, names, notes, duplicates).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { attachFake } from "./helpers/fakeSupabase.js";
import { withDenoEnv } from "./helpers/env.js";

const SECRET = "test-signing-secret";
let t, handler, restoreEnv, origServe;
beforeAll(async () => {
  restoreEnv = withDenoEnv({ TALLY_SIGNING_SECRET: SECRET, TALLY_FORM_ID: " w5lkx6 " });
  origServe = globalThis.Deno.serve;
  globalThis.Deno.serve = (h) => { handler = h; return { shutdown() {} }; };
  t = await import("../../../supabase/functions/tally-intake/index.ts");
});
afterAll(() => { restoreEnv(); globalThis.Deno.serve = origServe; });

const field = (label, value, extra = {}) => ({ key: label, label, type: "INPUT_TEXT", value, ...extra });
const choice = (label, ...texts) => ({ key: label, label, type: "DROPDOWN", value: texts.map((_, i) => `o${i}`), options: texts.map((text, i) => ({ id: `o${i}`, text })) });

describe("text", () => {
  it("plain values are trimmed, missing values are empty", () => {
    expect(t.text(field("a", "  hi  "))).toBe("hi");
    expect(t.text(field("a", 42))).toBe("42");
    expect(t.text(field("a", null))).toBe("");
    expect(t.text(undefined)).toBe("");
  });
  it("choice values use option texts, unknown ids stay as ids", () => {
    expect(t.text(choice("Day", "Monday", "Friday"))).toBe("Monday, Friday");
    expect(t.text({ ...choice("Day", "Monday"), value: ["o0", "zz"] })).toBe("Monday, zz");
    expect(t.text({ label: "x", value: [] })).toBe("");
  });
});

describe("find", () => {
  const fields = [field("Your first name", "A"), field("First name of a referee", "B"), field("Last Name", "C"), field(null, "D")];
  it("first label containing a keyword, case-insensitive", () => {
    expect(t.find(fields, ["first name"]).value).toBe("A");
    expect(t.find(fields, ["surname", "last name"]).value).toBe("C");
  });
  it("respects excludes and null labels", () => {
    expect(t.find(fields, ["first name"], ["your"]).value).toBe("B");
    expect(t.find(fields, ["nothing"])).toBeUndefined();
  });
});

describe("preferencePair", () => {
  it("uses first/second in the labels when present, whatever the order", () => {
    const f = [field("Preferred day (second preference)", "Thu"), field("Preferred day (first preference)", "Wed")];
    const [a, b] = t.preferencePair(f, /\bday\b/, /today|birthday|date/);
    expect([a.value, b.value]).toEqual(["Wed", "Thu"]);
  });
  it("1st and 2nd work too", () => {
    const f = [field("2nd choice time", "8pm"), field("1st choice time", "7pm")];
    const [a, b] = t.preferencePair(f, /\btime\b/, /zone/);
    expect([a.value, b.value]).toEqual(["7pm", "8pm"]);
  });
  it("falls back to form order, and excludes look-alikes", () => {
    const f = [field("Today's date", "x"), field("Your birthday", "y"), field("Day", "Mon"), field("Time zone", "z"), field("Day", "Tue")];
    const [a, b] = t.preferencePair(f, /\bday\b/, /today|birthday|date/);
    expect([a.value, b.value]).toEqual(["Mon", "Tue"]);
  });
  it("single match has no second", () => {
    const [a, b] = t.preferencePair([field("Time", "7pm"), field("Time zone", "UK")], /\btime\b/, /zone/);
    expect(a.value).toBe("7pm");
    expect(b).toBeUndefined();
  });
});

describe("parseDay", () => {
  it.each([
    ["Monday", 1], ["tuesday", 2], ["WEDNESDAY", 3], ["Thurs", 4], ["Fri", 5], ["Saturday", 6], ["Sunday", 7], ["Weekly on Sun", 7],
  ])("%s -> %i", (s, d) => expect(t.parseDay(s)).toBe(d));
  it("unknown text", () => {
    expect(t.parseDay("")).toBeNull();
    expect(t.parseDay("Lunes")).toBeNull();
  });
});

describe("parseTime", () => {
  it.each([
    ["19:30", "19:30"], ["7:30pm", "19:30"], ["7.30 PM", "19:30"], ["7pm", "19:00"], ["8 pm", "20:00"], ["07:05", "07:05"],
    ["12pm", "12:00"], ["12am", "00:00"], ["12:30 am", "00:30"], ["11am", "11:00"], ["7:30-8:30pm", "19:30"], ["7 - 8 pm", "19:00"],
    ["1930", "19:30"], ["9", "09:00"], ["7:30am-8:30pm", "07:30"], ["19:30 UK time", "19:30"],
  ])("%s -> %s", (s, want) => expect(t.parseTime(s)).toBe(want));
  it.each(["", "evening", "25:00", "10:75", "pm"])("rejects %s", (s) => expect(t.parseTime(s)).toBeNull());
  // Bug: "730pm" (no separator, three digits) reads the hour as 73 and is rejected instead of giving 19:30.
  it.fails("reads 730pm as 19:30", () => expect(t.parseTime("730pm")).toBe("19:30"));
});

describe("toTimezone", () => {
  const fb = "Europe/London";
  it("Dhaka wins over Almaty for the shared Tally option", () => {
    expect(t.toTimezone("(GMT +6:00) Almaty, Dhaka", fb)).toEqual({ tz: "Asia/Dhaka", exact: true });
    expect(t.toTimezone("(GMT +6:00) Almaty", fb)).toEqual({ tz: "Asia/Almaty", exact: true });
  });
  it.each([
    ["(GMT -6:00) Central Time (US & Canada), Mexico City", "America/Chicago"],
    ["(GMT -5:00) Eastern Time (US & Canada), Bogota, Lima", "America/New_York"],
    ["(GMT -4:00) Atlantic Time (Canada), Caracas, La Paz", "America/Halifax"],
    ["(GMT -3:30) Newfoundland", "America/St_Johns"],
    ["(GMT -3:00) Brazil, Buenos Aires, Georgetown", "America/Sao_Paulo"],
    ["(GMT) Western Europe Time, London, Lisbon, Casablanca", "Europe/London"],
    ["(GMT +1:00) Brussels, Copenhagen, Madrid, Paris", "Europe/Brussels"],
    ["(GMT +2:00) Kaliningrad, South Africa", "Europe/Kaliningrad"],
    ["(GMT +3:00) Baghdad, Riyadh, Moscow, St. Petersburg", "Asia/Baghdad"],
    ["(GMT +4:00) Abu Dhabi, Muscat, Baku, Tbilisi", "Asia/Dubai"],
    ["(GMT +5:30) Bombay, Calcutta, Madras, New Delhi", "Asia/Kolkata"],
    ["(GMT +5:45) Kathmandu", "Asia/Kathmandu"],
    ["(GMT +8:00) Beijing, Perth, Singapore, Hong Kong", "Asia/Shanghai"],
    ["(GMT +9:30) Adelaide, Darwin", "Australia/Adelaide"],
    ["(GMT +10:00) Eastern Australia, Guam, Vladivostok", "Australia/Sydney"],
    ["(GMT +12:00) Auckland, Wellington, Fiji, Kamchatka", "Pacific/Auckland"],
    ["(GMT -10:00) Hawaii", "Pacific/Honolulu"],
    ["(GMT -8:00) Pacific Time (US & Canada)", "America/Los_Angeles"],
  ])("%s -> %s", (label, tz) => expect(t.toTimezone(label, fb)).toEqual({ tz, exact: true }));
  it("accepts an IANA name as is", () => {
    expect(t.toTimezone(" America/Argentina/Buenos_Aires ", fb)).toEqual({ tz: "America/Argentina/Buenos_Aires", exact: true });
    expect(t.toTimezone("Asia/Kolkata", fb)).toEqual({ tz: "Asia/Kolkata", exact: true });
  });
  it("whole-hour GMT offsets with no known city become fixed Etc zones (sign flipped)", () => {
    expect(t.toTimezone("(GMT +3:00) Somewhere", fb)).toEqual({ tz: "Etc/GMT-3", exact: false });
    expect(t.toTimezone("(GMT -7:00) Elsewhere", fb)).toEqual({ tz: "Etc/GMT+7", exact: false });
    expect(t.toTimezone("GMT+11:00", fb)).toEqual({ tz: "Etc/GMT-11", exact: false });
  });
  it("GMT itself means London, inexact", () => {
    expect(t.toTimezone("(GMT) Nowhere", fb)).toEqual({ tz: "Europe/London", exact: false });
    expect(t.toTimezone("(GMT +0:00) Nowhere", fb)).toEqual({ tz: "Europe/London", exact: false });
  });
  it("anything else falls back", () => {
    expect(t.toTimezone("", "Asia/Kolkata")).toEqual({ tz: "Asia/Kolkata", exact: false });
    expect(t.toTimezone("(GMT +5:45) Unknown", fb)).toEqual({ tz: fb, exact: false });
    expect(t.toTimezone("my local time", fb)).toEqual({ tz: fb, exact: false });
  });
  it("every mapped zone is a real IANA zone", () => {
    for (const [, tz] of t.TZ_KEYWORDS) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not.toThrow();
  });
});

describe("validSignature", () => {
  const sign = (body, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");
  it("accepts the right HMAC and rejects others", async () => {
    expect(await t.validSignature("{}", sign("{}"))).toBe(true);
    expect(await t.validSignature("{}", sign("{}", "other"))).toBe(false);
    expect(await t.validSignature("{}", sign("{ }"))).toBe(false);
    expect(await t.validSignature("{}", null)).toBe(false);
    expect(await t.validSignature("{}", "short")).toBe(false);
  });
});

// handler
const formFields = (over = {}) => {
  const f = {
    first: field("First name", "Arjun"), last: field("Last name", "Example"), initiated: field("Initiated name (if any)", "Ananda-rupa das"),
    email: field("Email", " Arjun@Example.org ", { type: "INPUT_EMAIL" }), phone: field("WhatsApp number", "+44 7000 000000", { type: "INPUT_PHONE_NUMBER" }),
    type: choice("Which circle do you wish to facilitate?", "Gita Circle"),
    day1: choice("Preferred day (first preference)", "Wednesday"), time1: field("Preferred time (first preference)", "7:30pm"),
    day2: choice("Preferred day (second preference)", "Thursday"), time2: field("Preferred time (second preference)", "8pm"),
    tz: choice("Your time zone", "(GMT +6:00) Almaty, Dhaka"), lang: field("Language of the circle", "English"),
    start: field("Preferred start date", "2026-11-04", { type: "INPUT_DATE" }), specify: field("If other, please specify", ""),
    ...over,
  };
  return Object.values(f).filter(Boolean);
};
const payload = (fields, data = {}) => ({ eventId: "evt-1", eventType: "FORM_RESPONSE", data: { responseId: "resp-1", formId: "w5lkx6", fields, ...data } });
const sign = (body) => createHmac("sha256", SECRET).update(body).digest("base64");
async function post(p, { signature } = {}) {
  const body = JSON.stringify(p);
  const res = await handler(new Request("http://localhost/tally-intake", { method: "POST", body, headers: { "tally-signature": signature ?? sign(body) } }));
  return { status: res.status, body: await res.json() };
}
let db;
function setup({ facilitators = [], circles = [] } = {}) {
  db = attachFake(t.db, { settings: [{ id: 1, default_timezone: "Europe/London", default_duration_min: 75 }], facilitators, circles, audit_log: [] });
  db.rpcResults.allocate_circle = async () => ({ data: { status: "approved", preference_used: 1 }, error: null });
}

describe("handler", () => {
  it("GET is a harmless ping", async () => {
    const res = await handler(new Request("http://localhost/", { method: "GET" }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects a bad signature", async () => {
    setup();
    const r = await post(payload(formFields()), { signature: "bad" });
    expect(r).toEqual({ status: 401, body: { error: "invalid signature" } });
    expect(db.calls).toEqual([]);
  });

  it("ignores other event types and other forms", async () => {
    setup();
    expect((await post({ eventType: "FORM_DELETED" })).body).toEqual({ ok: true, ignored: "FORM_DELETED" });
    expect((await post(payload(formFields(), { formId: "other1", formName: "Feedback" }))).body).toEqual({ ok: true, ignored: "different form" });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "intake_ignored", detail: { formId: "other1" } });
    expect(db.tables.circles).toHaveLength(0);
  });

  it("stores the facilitator and circle, then allocates a licence", async () => {
    setup();
    const r = await post(payload(formFields()));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "approved" });
    const [fac] = db.tables.facilitators;
    expect(fac).toMatchObject({ name: "Ananda-rupa das (Arjun Example)", email: "arjun@example.org", phone: "+44 7000 000000", first_name: "Arjun", last_name: "Example", initiated_name: "Ananda-rupa das" });
    const [c] = db.tables.circles;
    expect(c).toMatchObject({
      name: "Ananda-rupa das (Gita Circle)", facilitator_id: fac.id, weekday: 3, start_time: "19:30", alt_weekday: 4, alt_start_time: "20:00",
      duration_min: 75, timezone: "Asia/Dhaka", timezone_label: "(GMT +6:00) Almaty, Dhaka", circle_type: "Gita Circle", language: "English",
      preferred_start: "2026-11-04", notes: null, source: "tally", tally_submission_id: "resp-1",
    });
    expect(r.body.circle_id).toBe(c.id);
    expect(db.rpcCalls).toEqual([{ name: "allocate_circle", args: { p_circle: c.id } }]);
    expect(db.tables.audit_log.at(-1)).toMatchObject({ actor: "tally", action: "intake", circle_id: c.id, detail: { timezone: "Asia/Dhaka", status: "approved" } });
  });

  it("names without an initiated name, and with only an email", async () => {
    setup();
    await post(payload(formFields({ initiated: null })));
    expect(db.tables.facilitators[0].name).toBe("Arjun Example");
    expect(db.tables.circles[0].name).toBe("Arjun Example (Gita Circle)");
    setup();
    await post(payload(formFields({ initiated: null, first: null, last: null, type: null })));
    expect(db.tables.facilitators[0].name).toBe("arjun@example.org");
    expect(db.tables.circles[0].name).toBe("arjun@example.org");
    expect(db.tables.circles[0].circle_type).toBeNull();
  });

  it("initiated name with only an email", async () => {
    setup();
    await post(payload(formFields({ first: null, last: null })));
    expect(db.tables.facilitators[0].name).toBe("Ananda-rupa das (arjun@example.org)");
  });

  it("second preference is kept only when both day and time are readable", async () => {
    setup();
    await post(payload(formFields({ time2: field("Preferred time (second preference)", "whenever") })));
    expect(db.tables.circles[0]).toMatchObject({ alt_weekday: null, alt_start_time: null });
  });

  it("notes: specified type, inexact timezone and a possible duplicate", async () => {
    setup({ facilitators: [{ id: "f1", email: "arjun@example.org", name: "Old Name", phone: "+44 1", first_name: null, last_name: "Kept", initiated_name: null }],
      circles: [{ id: "c0", name: "Old circle", facilitator_id: "f1", status: "live" }, { id: "c9", name: "Gone", facilitator_id: "f1", status: "ended" }] });
    await post(payload(formFields({ specify: field("If other, please specify", "Youth circle"), tz: field("Time zone", "(GMT +3:00) Somewhere") })));
    const c = db.tables.circles.at(-1);
    expect(c.timezone).toBe("Etc/GMT-3");
    expect(c.notes).toBe('Specified: Youth circle\nTimezone "(GMT +3:00) Somewhere" was not recognised exactly; check it.\nPossible duplicate: this facilitator already has "Old circle".');
  });

  it("existing facilitators are never overwritten, only empty fields filled", async () => {
    setup({ facilitators: [{ id: "f1", email: "arjun@example.org", name: "Old Name", phone: "+44 1", first_name: null, last_name: "Kept", initiated_name: null }] });
    await post(payload(formFields()));
    expect(db.tables.facilitators).toHaveLength(1);
    expect(db.tables.facilitators[0]).toMatchObject({ name: "Old Name", phone: "+44 1", first_name: "Arjun", last_name: "Kept", initiated_name: "Ananda-rupa das" });
    expect(db.tables.circles[0].facilitator_id).toBe("f1");
  });

  it("unreadable required answers are logged, with 200 so Tally does not retry", async () => {
    setup();
    const r = await post(payload(formFields({ email: null, day1: choice("Preferred day (first preference)", "Someday"), time1: field("Preferred time (first preference)", "late") })));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: false, problems: ["email missing", 'could not read first preference day from "Someday"', 'could not read first preference time from "late"'] });
    expect(db.tables.circles).toHaveLength(0);
    expect(db.tables.audit_log.at(-1).action).toBe("intake_failed");
  });

  it("falls back to the default timezone and handles a missing start date", async () => {
    setup();
    await post(payload(formFields({ tz: null, start: field("Preferred start date", "next month") })));
    expect(db.tables.circles[0]).toMatchObject({ timezone: "Europe/London", timezone_label: null, preferred_start: null, notes: null });
  });

  it("a Tally retry of a stored submission re-allocates a stuck circle", async () => {
    setup({ circles: [{ id: "c7", status: "conflict", tally_submission_id: "resp-1" }] });
    db.failNext("circles", "insert", { message: "duplicate key", code: "23505" });
    const r = await post(payload(formFields()));
    expect(r.body).toEqual({ ok: true, duplicate: true });
    expect(db.rpcCalls).toEqual([{ name: "allocate_circle", args: { p_circle: "c7" } }]);
  });

  it("other insert errors return 500 and are logged", async () => {
    setup();
    db.failNext("circles", "insert", "boom");
    const r = await post(payload(formFields()));
    expect(r).toEqual({ status: 500, body: { error: "boom" } });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "intake_failed", detail: { error: "boom" } });
  });
});
